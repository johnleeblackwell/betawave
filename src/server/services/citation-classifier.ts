// @ts-nocheck
/**
 * Citation Classifier — job worker for type 'citation_classify'.
 *
 * Runs over citation_results rows where classified_at IS NULL, raw_response
 * is non-empty, and error is empty. Sends each to Claude Haiku for cheap,
 * fast classification. Batches 10 at a time (5 concurrent per batch).
 *
 * Fills in: brand_mentioned, brand_position, brand_quote, sentiment,
 * competitor_mentions_json.
 *
 * Why a separate pass: we can re-run, tune the prompt, and improve accuracy
 * without re-querying the expensive engines. Classification is independent
 * of data collection.
 */
import db from '../db.js'
import { getClient } from './claude.js'

const HAIKU_MODEL = 'claude-haiku-4-5'
const BATCH_SIZE = 10        // rows loaded per loop iteration
const CONCURRENCY = 5        // parallel Haiku calls per batch

interface ClassificationResult {
  brand_mentioned: boolean
  brand_position: 'first' | 'mid' | 'late' | 'absent'
  brand_quote: string
  sentiment: 'positive' | 'neutral' | 'negative' | null
  competitor_mentions: Array<{ name: string; position: 'first' | 'mid' | 'late' }>
}

const SAFE_DEFAULT: ClassificationResult = {
  brand_mentioned: false,
  brand_position: 'absent',
  brand_quote: '',
  sentiment: null,
  competitor_mentions: [],
}

export async function runCitationClassifyJob(jobId: string): Promise<void> {
  // ── Load job params ──────────────────────────────────────────────────────
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any
  if (!job) throw new Error(`Job ${jobId} not found`)

  const params = JSON.parse(job.params || '{}')
  const run_id: string = params.run_id
  const brand_id: string = params.brand_id
  if (!run_id || !brand_id) throw new Error(`citation_classify job ${jobId} missing run_id or brand_id`)

  // ── Load brand + competitors ─────────────────────────────────────────────
  const brand = db.prepare('SELECT * FROM tracked_brands WHERE id = ?').get(brand_id) as any
  if (!brand) throw new Error(`Brand ${brand_id} not found`)

  const competitors = db.prepare(
    'SELECT name, aliases_json FROM tracked_competitors WHERE brand_id = ? AND active = 1',
  ).all(brand_id) as any[]

  // Build flat list of all names and aliases for the prompt
  const competitorNames = competitors.map(c => {
    const aliases = JSON.parse(c.aliases_json || '[]') as string[]
    return [c.name, ...aliases].join(' / ')
  }).join(', ')

  // ── Find unclassified results for this run ────────────────────────────────
  // Excludes rows with errors (no raw_response to classify) and already-done rows.
  const allUnclassified = db.prepare(`
    SELECT r.id, r.raw_response, r.engine,
           q.text  AS query_text,
           q.category
    FROM   citation_results r
    LEFT JOIN tracked_queries q ON q.id = r.query_id
    WHERE  r.run_id        = ?
      AND  r.classified_at IS NULL
      AND  r.error         = ''
      AND  r.raw_response  != ''
    ORDER BY r.created_at ASC
  `).all(run_id) as any[]

  const total = allUnclassified.length

  if (total === 0) {
    console.log(`[citation-classifier] Job ${jobId}: no unclassified results for run ${run_id}`)
    db.prepare(`UPDATE jobs SET status = 'complete', completed_at = unixepoch(), result = ? WHERE id = ?`)
      .run(JSON.stringify({ classified: 0, failed: 0, run_id }), jobId)
    return
  }

  db.prepare(`UPDATE jobs SET status = 'running', started_at = unixepoch(), total = ? WHERE id = ?`)
    .run(total, jobId)

  console.log(`[citation-classifier] Job ${jobId}: classifying ${total} results for run ${run_id}`)

  // ── Batch + classify ─────────────────────────────────────────────────────
  let classified = 0
  let failed = 0

  for (let i = 0; i < allUnclassified.length; i += BATCH_SIZE) {
    const batch = allUnclassified.slice(i, i + BATCH_SIZE)

    // Process CONCURRENCY items in parallel within the batch
    for (let j = 0; j < batch.length; j += CONCURRENCY) {
      const chunk = batch.slice(j, j + CONCURRENCY)

      const results = await Promise.allSettled(
        chunk.map(row => classifyOne(row, brand, competitorNames)),
      )

      for (let k = 0; k < chunk.length; k++) {
        const row = chunk[k]
        const outcome = results[k]

        if (outcome.status === 'fulfilled') {
          const c = outcome.value
          db.prepare(`
            UPDATE citation_results
            SET classified_at           = unixepoch(),
                brand_mentioned         = ?,
                brand_position          = ?,
                brand_quote             = ?,
                sentiment               = ?,
                competitor_mentions_json = ?
            WHERE id = ?
          `).run(
            c.brand_mentioned ? 1 : 0,
            c.brand_position,
            c.brand_quote ?? '',
            c.sentiment ?? null,
            JSON.stringify(c.competitor_mentions ?? []),
            row.id,
          )
          classified++
          console.log(
            `[citation-classifier]   ${row.engine} "${(row.query_text ?? '').slice(0, 40)}…" → ` +
            `${c.brand_mentioned ? '✅ mentioned' : '❌ absent'} (${c.brand_position}) ${c.sentiment ?? ''}`,
          )
        } else {
          // Mark classified_at to avoid infinite re-attempts; error detail in console
          console.error(`[citation-classifier]   Failed ${row.id}: ${outcome.reason?.message ?? outcome.reason}`)
          db.prepare(`UPDATE citation_results SET classified_at = unixepoch() WHERE id = ?`).run(row.id)
          failed++
        }

        db.prepare(`UPDATE jobs SET completed = ?, failed = ? WHERE id = ?`).run(classified, failed, jobId)
      }
    }
  }

  // ── Finalise ─────────────────────────────────────────────────────────────
  const finalStatus = failed > 0 && classified === 0 ? 'failed' : 'complete'
  db.prepare(`
    UPDATE jobs
    SET status = ?, completed = ?, failed = ?, completed_at = unixepoch(), result = ?
    WHERE id = ?
  `).run(finalStatus, classified, failed, JSON.stringify({ classified, failed, run_id }), jobId)

  console.log(`[citation-classifier] Job ${jobId} ${finalStatus}: ${classified} classified, ${failed} failed`)

  // Close the loop: draft content targeting any query where the brand was
  // cited by NO engine this run. Own try/catch — a drafting failure must
  // never mark a successful classification job as failed.
  if (finalStatus === 'complete' && classified > 0) {
    try {
      const { draftContentForCitationGaps } = await import('./citation-gap-content.js')
      const { drafted, skipped } = await draftContentForCitationGaps(run_id, brand_id)
      if (drafted > 0) {
        console.log(`[citation-classifier] drafted ${drafted} gap-closing post(s) for run ${run_id} (${skipped} already existed)`)
      }
    } catch (e: any) {
      console.error('[citation-classifier] gap-content drafting failed (non-fatal):', e.message)
    }
  }
}

// ─── Classify a single result row ────────────────────────────────────────────

async function classifyOne(
  row: { id: string; raw_response: string; engine: string; query_text?: string },
  brand: { name: string },
  competitorNames: string,
): Promise<ClassificationResult> {
  const prompt = buildPrompt(brand.name, competitorNames, row.query_text ?? '', row.raw_response)

  const response = await getClient().messages.create({
    model: HAIKU_MODEL,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .trim()

  return parseClassification(raw)
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(brandName: string, competitorNames: string, queryText: string, engineResponse: string): string {
  return `You are classifying an AI engine response to determine whether a specific brand is mentioned, where in the response it appears, and how favourably it is described.

BRAND: ${brandName}
COMPETITORS: ${competitorNames || 'none listed'}
ORIGINAL QUERY: ${queryText}
ENGINE RESPONSE:
${engineResponse.slice(0, 3000)}${engineResponse.length > 3000 ? '\n[truncated]' : ''}

Return STRICT JSON — no other text, no markdown, no code fences. Use this exact shape:
{
  "brand_mentioned": boolean,
  "brand_position": "first" | "mid" | "late" | "absent",
  "brand_quote": "the exact sentence or bullet that mentions the brand (empty string if absent)",
  "sentiment": "positive" | "neutral" | "negative" | null,
  "competitor_mentions": [
    { "name": "exact competitor name from the list above", "position": "first" | "mid" | "late" }
  ]
}

Rules:
- brand_position "first": brand appears in the first sentence or first bullet point
- brand_position "late": brand appears in the final third of the response
- brand_position "mid": brand appears anywhere else in the response
- brand_position "absent": brand is not mentioned at all (set brand_mentioned: false)
- sentiment applies only to how the brand is described; null if absent
- competitor_mentions lists only competitors from the COMPETITORS list above that actually appear
- Match brand and competitor names loosely (ignore "The", capitalisation differences, common abbreviations)
- Return only valid JSON`
}

// ─── JSON extraction ──────────────────────────────────────────────────────────

function parseClassification(raw: string): ClassificationResult {
  // 1. Direct parse
  try { return validate(JSON.parse(raw)) } catch { /* fall through */ }

  // 2. Strip markdown code fences
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  try { return validate(JSON.parse(stripped)) } catch { /* fall through */ }

  // 3. Extract first {...} block
  const match = stripped.match(/\{[\s\S]*\}/)
  if (match) {
    try { return validate(JSON.parse(match[0])) } catch { /* fall through */ }
  }

  // 4. Give up — log and return safe default so the row still gets marked classified
  console.warn(`[citation-classifier] Could not parse JSON from Haiku: ${raw.slice(0, 200)}`)
  return SAFE_DEFAULT
}

function validate(obj: any): ClassificationResult {
  // Minimal normalisation — coerce types if Haiku returns slightly wrong shapes
  return {
    brand_mentioned: Boolean(obj.brand_mentioned),
    brand_position:  ['first', 'mid', 'late', 'absent'].includes(obj.brand_position)
                       ? obj.brand_position
                       : (obj.brand_mentioned ? 'mid' : 'absent'),
    brand_quote:     typeof obj.brand_quote === 'string' ? obj.brand_quote : '',
    sentiment:       ['positive', 'neutral', 'negative'].includes(obj.sentiment) ? obj.sentiment : null,
    competitor_mentions: Array.isArray(obj.competitor_mentions)
      ? obj.competitor_mentions.filter((m: any) => m?.name && m?.position)
      : [],
  }
}
