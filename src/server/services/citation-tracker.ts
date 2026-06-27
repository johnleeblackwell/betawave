// @ts-nocheck
/**
 * Citation Tracker — job worker.
 *
 * Registered as type 'citation_run' in job-runner.ts.
 * Reads brand + queries + competitors from DB, calls all four AI engines
 * (in parallel per query, sequential across queries), persists raw results,
 * then enqueues a citation_classify job for the mention-detection pass.
 *
 * Budget rules:
 *  - Pre-flight: estimated cost > budget × 1.2 → fail immediately, zero API calls.
 *  - Mid-run: running cost > budget snapshot → stop loop, mark run 'partial'.
 */
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { runQueryAcrossEngines, type EngineName } from './engines/index.js'
import { maybeSendCitationDropAlert } from './scheduler.js'

// Cross-engine average cost estimate used for the pre-flight check only.
// Calibrate this against real bills and update as needed.
const AVG_COST_PER_CALL_GBP = 0.006  // £ per (query × engine) call

const ALL_ENGINES: EngineName[] = ['anthropic', 'openai', 'perplexity', 'gemini']
const ENGINE_KEY: Record<EngineName, string> = {
  anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', perplexity: 'PERPLEXITY_API_KEY', gemini: 'GEMINI_API_KEY',
}
// Only query engines whose API key is configured — otherwise every call to that
// engine fails (e.g. OpenAI 429 with no key), wasting the run and littering the
// report with red errors. No key → engine is silently skipped.
function activeEngines(): EngineName[] {
  return ALL_ENGINES.filter(e => (process.env[ENGINE_KEY[e]] || '').trim().length > 0)
}

export async function runCitationJob(jobId: string): Promise<void> {
  // ── Load job params ──────────────────────────────────────────────────────
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any
  if (!job) throw new Error(`Job ${jobId} not found`)

  const params = JSON.parse(job.params || '{}')
  const brand_id: string = params.brand_id
  if (!brand_id) throw new Error(`citation_run job ${jobId} missing brand_id in params`)

  // ── Load brand ───────────────────────────────────────────────────────────
  const brand = db.prepare('SELECT * FROM tracked_brands WHERE id = ?').get(brand_id) as any
  if (!brand) {
    return failJob(jobId, `Brand ${brand_id} not found`)
  }
  if (brand.status === 'paused') {
    return failJob(jobId, `Brand ${brand_id} is paused — skipping run`)
  }

  // ── Guard: skip if another run is already in-flight for this brand ───────
  const inFlight = db.prepare(`
    SELECT id FROM citation_runs WHERE brand_id = ? AND status = 'running' LIMIT 1
  `).get(brand_id) as any
  if (inFlight) {
    return failJob(jobId, `Another run (${inFlight.id}) is already running for brand ${brand_id}`)
  }

  // ── Load active queries and competitors ──────────────────────────────────
  const queries = db.prepare(`
    SELECT * FROM tracked_queries WHERE brand_id = ? AND active = 1 ORDER BY priority ASC, created_at ASC
  `).all(brand_id) as any[]

  const competitors = db.prepare(`
    SELECT * FROM tracked_competitors WHERE brand_id = ? AND active = 1
  `).all(brand_id) as any[]

  if (queries.length === 0) {
    return failJob(jobId, 'No active queries — add at least one query before running')
  }

  // ── Engine selection (only those with a configured API key) ──────────────
  const ENGINES = activeEngines()
  if (ENGINES.length === 0) {
    return failJob(jobId, 'No AI engines configured — set at least one engine API key (ANTHROPIC/OPENAI/PERPLEXITY/GEMINI)')
  }

  // ── Pre-flight cost check ────────────────────────────────────────────────
  const totalCalls = queries.length * ENGINES.length
  const estimatedCost = totalCalls * AVG_COST_PER_CALL_GBP
  const budget = brand.weekly_budget_gbp ?? 30

  if (estimatedCost > budget * 1.2) {
    return failJob(
      jobId,
      `budget_exceeded_preflight: estimated £${estimatedCost.toFixed(3)} exceeds limit £${(budget * 1.2).toFixed(3)}`,
    )
  }

  // ── Create citation_runs row ─────────────────────────────────────────────
  const runId = uuid()
  const runAt = Math.floor(Date.now() / 1000)

  db.prepare(`
    INSERT INTO citation_runs (id, brand_id, job_id, run_at, status, total_calls, budget_gbp)
    VALUES (?, ?, ?, ?, 'running', ?, ?)
  `).run(runId, brand_id, jobId, runAt, totalCalls, budget)

  db.prepare(`UPDATE jobs SET status = 'running', started_at = unixepoch(), total = ? WHERE id = ?`)
    .run(totalCalls, jobId)

  console.log(
    `[citation-tracker] Run ${runId} started — ${queries.length} queries × ${ENGINES.length} engines = ${totalCalls} calls. Budget: £${budget}`,
  )

  // ── Query loop ───────────────────────────────────────────────────────────
  // Engines within each query run in parallel; queries are sequential so we
  // can abort cleanly if the mid-run budget check triggers.
  let runningCost = 0
  let completed = 0
  let failed = 0
  let hitBudget = false
  const enginesSucceeded = new Set<string>()

  for (const query of queries) {
    if (hitBudget) break

    console.log(`[citation-tracker] Query "${query.text.slice(0, 60)}…"`)

    let results
    try {
      results = await runQueryAcrossEngines(query.text, ENGINES)
    } catch (err: any) {
      // runQueryAcrossEngines shouldn't throw — it returns partial. But guard anyway.
      console.error(`[citation-tracker] runQueryAcrossEngines threw: ${err.message}`)
      failed += ENGINES.length
      db.prepare(`UPDATE jobs SET failed = ? WHERE id = ?`).run(failed, jobId)
      continue
    }

    for (const r of results) {
      const resultId = uuid()

      if (r.error || !r.http_status || r.http_status >= 400) {
        // Engine failed — persist error row
        db.prepare(`
          INSERT INTO citation_results
            (id, run_id, query_id, engine, raw_response, latency_ms, http_status, error, created_at)
          VALUES (?, ?, ?, ?, '', ?, ?, ?, unixepoch())
        `).run(resultId, runId, query.id, r.engine, r.latency_ms, r.http_status ?? 0, r.error ?? `HTTP ${r.http_status}`)
        failed++
        console.warn(`[citation-tracker]   ${r.engine} ❌ (${r.error || 'HTTP ' + r.http_status})`)
      } else {
        // Success — persist full result
        db.prepare(`
          INSERT INTO citation_results
            (id, run_id, query_id, engine, raw_response, cited_sources, input_tokens, output_tokens, cost_gbp, latency_ms, http_status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
        `).run(resultId, runId, query.id, r.engine, r.raw, JSON.stringify(r.sources ?? []), r.input_tokens, r.output_tokens, r.cost_gbp, r.latency_ms, r.http_status)
        runningCost += r.cost_gbp
        completed++
        enginesSucceeded.add(r.engine)
        console.log(`[citation-tracker]   ${r.engine} ✅ ${r.latency_ms}ms ${r.input_tokens}+${r.output_tokens} tokens £${r.cost_gbp.toFixed(5)}`)
      }

      // Rolling totals on citation_runs after every single result
      db.prepare(`UPDATE citation_runs SET cost_gbp = ?, completed = ?, failed = ? WHERE id = ?`)
        .run(runningCost, completed, failed, runId)
    }

    // Update job progress after each query batch
    db.prepare(`UPDATE jobs SET completed = ?, failed = ? WHERE id = ?`).run(completed, failed, jobId)

    // Mid-run budget kill switch
    if (runningCost > budget) {
      const note = `budget_exceeded_mid_run: £${runningCost.toFixed(4)} spent vs £${budget} budget`
      console.warn(`[citation-tracker] ⚠️  ${note}`)
      db.prepare(`UPDATE citation_runs SET status = 'partial', notes = ? WHERE id = ?`).run(note, runId)
      hitBudget = true
    }
  }

  // ── Finalise ─────────────────────────────────────────────────────────────
  const finalRunStatus = hitBudget
    ? 'partial'
    : failed > 0 && completed === 0
      ? 'failed'
      : 'complete'

  db.prepare(`
    UPDATE citation_runs
    SET status = ?, engines_json = ?, completed = ?, failed = ?
    WHERE id = ?
  `).run(finalRunStatus, JSON.stringify([...enginesSucceeded]), completed, failed, runId)

  // Advance brand timestamps
  const nextSunday = nextSundayAt2300()
  db.prepare(`UPDATE tracked_brands SET last_run_at = ?, next_run_at = ? WHERE id = ?`)
    .run(runAt, nextSunday, brand_id)

  // Mark job done
  const jobFinalStatus = finalRunStatus === 'complete' ? 'complete' : finalRunStatus === 'partial' ? 'complete' : 'failed'
  db.prepare(`
    UPDATE jobs SET status = ?, completed = ?, failed = ?, completed_at = unixepoch(), result = ? WHERE id = ?
  `).run(
    jobFinalStatus,
    completed,
    failed,
    JSON.stringify({ run_id: runId, cost_gbp: runningCost, status: finalRunStatus }),
    jobId,
  )

  console.log(
    `[citation-tracker] Run ${runId} ${finalRunStatus}: ${completed} succeeded, ${failed} failed, £${runningCost.toFixed(4)} spent`,
  )

  // ── Enqueue classifier ────────────────────────────────────────────────────
  if (completed > 0) {
    const classifyJobId = uuid()
    db.prepare(`
      INSERT INTO jobs (id, type, status, params, created_at)
      VALUES (?, 'citation_classify', 'pending', ?, unixepoch())
    `).run(classifyJobId, JSON.stringify({ run_id: runId, brand_id }))
    console.log(`[citation-tracker] Enqueued citation_classify job ${classifyJobId}`)
  }

  // ── Drop alert (fire-and-forget — never blocks the run) ───────────────────
  maybeSendCitationDropAlert(brand_id).catch(err =>
    console.error(`[citation-tracker] Drop alert error: ${err.message}`),
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function failJob(jobId: string, reason: string): void {
  console.error(`[citation-tracker] Job ${jobId} failed: ${reason}`)
  db.prepare(`UPDATE jobs SET status = 'failed', error = ?, completed_at = unixepoch() WHERE id = ?`)
    .run(reason, jobId)
}

/** Next Sunday at 23:00 local time (in Unix seconds). */
function nextSundayAt2300(): number {
  const now = new Date()
  // getDay() 0 = Sunday, so days until next Sunday
  const daysUntil = (7 - now.getDay()) % 7 || 7
  const next = new Date(now)
  next.setDate(next.getDate() + daysUntil)
  next.setHours(23, 0, 0, 0)
  return Math.floor(next.getTime() / 1000)
}
