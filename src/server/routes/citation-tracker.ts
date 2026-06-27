// @ts-nocheck
/**
 * Citation Tracker routes — two router groups:
 *
 * clientRouter  mounted at /api/clients/:clientId/citation-tracker
 *   GET  /          → brand row + counts summary
 *   POST /          → create tracked brand (422 if client already has one)
 *   PUT  /          → update settings (budget, cadence, status)
 *
 * brandRouter   mounted at /api/citation-tracker
 *   /:brandId/queries          GET / POST
 *   /:brandId/queries/:id      PUT / DELETE
 *   /:brandId/competitors      GET / POST
 *   /:brandId/competitors/:id  PUT / DELETE
 *   /:brandId/runs             GET / POST (manual trigger)
 *   /:brandId/runs/:runId      GET (run + results)
 */
import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'

// ─── Client-level router ──────────────────────────────────────────────────────
// Mounted at /api/clients/:clientId/citation-tracker (mergeParams: true)
export const clientRouter = Router({ mergeParams: true })

/** GET /api/clients/:clientId/citation-tracker — brand + counts */
clientRouter.get('/', (req, res) => {
  const { clientId } = req.params
  const brand = db.prepare('SELECT * FROM tracked_brands WHERE client_id = ?').get(clientId) as any
  if (!brand) return res.status(404).json({ error: 'No citation tracker set up for this client' })

  const queryCount = (db.prepare('SELECT COUNT(*) as n FROM tracked_queries WHERE brand_id = ? AND active = 1').get(brand.id) as any).n
  const competitorCount = (db.prepare('SELECT COUNT(*) as n FROM tracked_competitors WHERE brand_id = ? AND active = 1').get(brand.id) as any).n
  const lastRun = db.prepare('SELECT * FROM citation_runs WHERE brand_id = ? ORDER BY run_at DESC LIMIT 1').get(brand.id) as any

  res.json({ ...brand, query_count: queryCount, competitor_count: competitorCount, last_run: lastRun ?? null })
})

/** POST /api/clients/:clientId/citation-tracker — create brand */
clientRouter.post('/', (req, res) => {
  const { clientId } = req.params

  // 1:1 MVP — block if already exists
  const existing = db.prepare('SELECT id FROM tracked_brands WHERE client_id = ?').get(clientId)
  if (existing) return res.status(422).json({ error: 'Citation tracker already exists for this client. Use PUT to update settings.' })

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId) as any
  if (!client) return res.status(404).json({ error: 'Client not found' })

  const { name, primary_url = '', weekly_budget_gbp = 30, status = 'active' } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

  const id = uuid()
  db.prepare(`
    INSERT INTO tracked_brands (id, client_id, name, primary_url, industry, locations_json, weekly_budget_gbp, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
  `).run(id, clientId, name.trim(), primary_url.trim(), client.industry || '', '[]', weekly_budget_gbp, status)

  res.status(201).json(db.prepare('SELECT * FROM tracked_brands WHERE id = ?').get(id))
})

/** POST /api/clients/:clientId/citation-tracker/suggest — AI-generate queries + competitors */
clientRouter.post('/suggest', async (req, res) => {
  const { clientId } = req.params
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId) as any
  if (!client) return res.status(404).json({ error: 'Client not found' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(503).json({ error: 'Anthropic API key not configured' })

  const profile = [
    `Business: ${client.business_name}`,
    `Industry: ${client.industry || ''}`,
    client.offerings       ? `Offerings: ${client.offerings}` : '',
    client.target_audience ? `Target audience: ${client.target_audience}` : '',
    client.geography       ? `Geography: ${client.geography}` : '',
    client.icp             ? `Ideal customer profile: ${client.icp}` : '',
    client.primary_domain  ? `Website: ${client.primary_domain}` : '',
  ].filter(Boolean).join('\n')

  const prompt = `You are a Generative Engine Optimisation analyst. Given this business profile, produce:

1. Exactly 20 queries that real users type into AI chatbots (ChatGPT, Claude, Perplexity, Gemini) when researching this category. Include best-of, comparison, decision, location, and "who should I use" style questions. Vary phrasing naturally.
2. Exactly 10 direct competitors with their primary website URLs.

Profile:
${profile}

Reply with ONLY valid JSON — no markdown fences, no commentary:
{"queries":[{"text":"…","category":"category-slug"},…],"competitors":[{"name":"…","url":"https://…"},…]}`

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!r.ok) { console.error('Anthropic suggest:', await r.text()); return res.status(502).json({ error: 'AI generation failed' }) }
    const data = await r.json() as any
    const text: string = data.content?.[0]?.text ?? ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return res.status(502).json({ error: 'Could not parse AI response' })
    return res.json(JSON.parse(jsonMatch[0]))
  } catch (err) {
    console.error('Suggest error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

/** PUT /api/clients/:clientId/citation-tracker — update settings */
clientRouter.put('/', (req, res) => {
  const { clientId } = req.params
  const brand = db.prepare('SELECT * FROM tracked_brands WHERE client_id = ?').get(clientId) as any
  if (!brand) return res.status(404).json({ error: 'No citation tracker for this client' })

  const { name, primary_url, weekly_budget_gbp, status, schedule_cron } = req.body
  if (name !== undefined) db.prepare("UPDATE tracked_brands SET name = ? WHERE id = ?").run(name, brand.id)
  if (primary_url !== undefined) db.prepare("UPDATE tracked_brands SET primary_url = ? WHERE id = ?").run(primary_url, brand.id)
  if (weekly_budget_gbp !== undefined) db.prepare("UPDATE tracked_brands SET weekly_budget_gbp = ? WHERE id = ?").run(Number(weekly_budget_gbp), brand.id)
  if (status !== undefined) db.prepare("UPDATE tracked_brands SET status = ? WHERE id = ?").run(status, brand.id)
  if (schedule_cron !== undefined) db.prepare("UPDATE tracked_brands SET schedule_cron = ? WHERE id = ?").run(schedule_cron, brand.id)

  res.json(db.prepare('SELECT * FROM tracked_brands WHERE id = ?').get(brand.id))
})

// ─── Brand-level router ───────────────────────────────────────────────────────
// Mounted at /api/citation-tracker
export const brandRouter = Router({ mergeParams: true })

// ── Queries ──────────────────────────────────────────────────────────────────

/** GET /api/citation-tracker/:brandId/queries */
brandRouter.get('/:brandId/queries', (req, res) => {
  const { brandId } = req.params
  res.json(db.prepare('SELECT * FROM tracked_queries WHERE brand_id = ? ORDER BY priority ASC, created_at ASC').all(brandId))
})

/** POST /api/citation-tracker/:brandId/queries — max 20 active */
brandRouter.post('/:brandId/queries', (req, res) => {
  const { brandId } = req.params
  const { text, category = '', priority = 1 } = req.body
  if (!text?.trim()) return res.status(400).json({ error: 'text is required' })

  const active = (db.prepare('SELECT COUNT(*) as n FROM tracked_queries WHERE brand_id = ? AND active = 1').get(brandId) as any).n
  if (active >= 20) return res.status(422).json({ error: 'Maximum 20 active queries per brand. Deactivate one before adding another.' })

  const id = uuid()
  db.prepare(`
    INSERT INTO tracked_queries (id, brand_id, text, category, priority, active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, unixepoch())
  `).run(id, brandId, text.trim(), category.trim(), Number(priority))

  res.status(201).json(db.prepare('SELECT * FROM tracked_queries WHERE id = ?').get(id))
})

/** PUT /api/citation-tracker/:brandId/queries/:id */
brandRouter.put('/:brandId/queries/:id', (req, res) => {
  const { id } = req.params
  const { text, category, priority, active } = req.body
  if (text !== undefined) db.prepare("UPDATE tracked_queries SET text = ? WHERE id = ?").run(text, id)
  if (category !== undefined) db.prepare("UPDATE tracked_queries SET category = ? WHERE id = ?").run(category, id)
  if (priority !== undefined) db.prepare("UPDATE tracked_queries SET priority = ? WHERE id = ?").run(Number(priority), id)
  if (active !== undefined) db.prepare("UPDATE tracked_queries SET active = ? WHERE id = ?").run(active ? 1 : 0, id)

  const updated = db.prepare('SELECT * FROM tracked_queries WHERE id = ?').get(id)
  if (!updated) return res.status(404).json({ error: 'Query not found' })
  res.json(updated)
})

/** DELETE /api/citation-tracker/:brandId/queries/:id */
brandRouter.delete('/:brandId/queries/:id', (req, res) => {
  const { id } = req.params
  db.prepare('DELETE FROM tracked_queries WHERE id = ?').run(id)
  res.json({ ok: true })
})

// ── Competitors ───────────────────────────────────────────────────────────────

/** GET /api/citation-tracker/:brandId/competitors */
brandRouter.get('/:brandId/competitors', (req, res) => {
  const { brandId } = req.params
  res.json(db.prepare('SELECT * FROM tracked_competitors WHERE brand_id = ? ORDER BY created_at ASC').all(brandId))
})

/** POST /api/citation-tracker/:brandId/competitors — max 10 active */
brandRouter.post('/:brandId/competitors', (req, res) => {
  const { brandId } = req.params
  const { name, url = '', aliases = [] } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

  const active = (db.prepare('SELECT COUNT(*) as n FROM tracked_competitors WHERE brand_id = ? AND active = 1').get(brandId) as any).n
  if (active >= 10) return res.status(422).json({ error: 'Maximum 10 active competitors per brand. Deactivate one before adding another.' })

  const id = uuid()
  db.prepare(`
    INSERT INTO tracked_competitors (id, brand_id, name, url, aliases_json, active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, unixepoch())
  `).run(id, brandId, name.trim(), url.trim(), JSON.stringify(aliases))

  res.status(201).json(db.prepare('SELECT * FROM tracked_competitors WHERE id = ?').get(id))
})

/** PUT /api/citation-tracker/:brandId/competitors/:id */
brandRouter.put('/:brandId/competitors/:id', (req, res) => {
  const { id } = req.params
  const { name, url, aliases, active } = req.body
  if (name !== undefined) db.prepare("UPDATE tracked_competitors SET name = ? WHERE id = ?").run(name, id)
  if (url !== undefined) db.prepare("UPDATE tracked_competitors SET url = ? WHERE id = ?").run(url, id)
  if (aliases !== undefined) db.prepare("UPDATE tracked_competitors SET aliases_json = ? WHERE id = ?").run(JSON.stringify(aliases), id)
  if (active !== undefined) db.prepare("UPDATE tracked_competitors SET active = ? WHERE id = ?").run(active ? 1 : 0, id)

  const updated = db.prepare('SELECT * FROM tracked_competitors WHERE id = ?').get(id)
  if (!updated) return res.status(404).json({ error: 'Competitor not found' })
  res.json(updated)
})

/** DELETE /api/citation-tracker/:brandId/competitors/:id */
brandRouter.delete('/:brandId/competitors/:id', (req, res) => {
  const { id } = req.params
  db.prepare('DELETE FROM tracked_competitors WHERE id = ?').run(id)
  res.json({ ok: true })
})

// ── Runs ─────────────────────────────────────────────────────────────────────

/** GET /api/citation-tracker/:brandId/runs — run history */
brandRouter.get('/:brandId/runs', (req, res) => {
  const { brandId } = req.params
  const limit = Number(req.query.limit ?? 20)
  const runs = db.prepare(`
    SELECT * FROM citation_runs WHERE brand_id = ? ORDER BY run_at DESC LIMIT ?
  `).all(brandId, limit)
  res.json(runs)
})

/** DELETE /api/citation-tracker/:brandId/runs/:runId — delete a run and all its results */
brandRouter.delete('/:brandId/runs/:runId', (req, res) => {
  const { runId } = req.params
  db.prepare('DELETE FROM citation_results WHERE run_id = ?').run(runId)
  db.prepare('DELETE FROM citation_runs WHERE id = ?').run(runId)
  res.json({ ok: true })
})

/**
 * GET /api/citation-tracker/:brandId/trend
 * Returns per-run citation share data for charting.
 * Each point: { run_id, run_at, overall_share, engine_shares: { anthropic, openai, perplexity, gemini } }
 * Only includes completed/partial runs that have been classified.
 * Limited to last 12 runs (3 months of weekly data).
 */
/** GET /api/citation-tracker/:brandId/decision-map — Decision Architecture node lens (DA-2 v1).
 *  Per decision-committee node: brand presence (Mention Rate) on that node's questions, from
 *  the latest completed run. Surfaces the role-level visibility gap and names the Isolate
 *  (the decisive gatekeeper seat where presence is weakest). NOTE: true Citation Isolation
 *  (cited-source overlap) needs source capture — DA-2b. This is the mention-based first cut. */
brandRouter.get('/:brandId/decision-map', (req, res) => {
  const { brandId } = req.params
  const run = db.prepare(`SELECT id, run_at FROM citation_runs WHERE brand_id = ? AND status IN ('complete','partial') ORDER BY run_at DESC LIMIT 1`).get(brandId) as any
  if (!run) return res.json({ nodes: [], isolate: null, note: 'no completed run yet' })

  const rows = db.prepare(`
    SELECT COALESCE(NULLIF(tq.da_node,''),'untagged') AS node,
           GROUP_CONCAT(DISTINCT tq.da_function) AS functions,
           COUNT(DISTINCT cr.query_id) AS queries,
           COUNT(*) AS results,
           SUM(CASE WHEN cr.brand_mentioned = 1 THEN 1 ELSE 0 END) AS mentions
    FROM citation_results cr
    JOIN tracked_queries tq ON tq.id = cr.query_id
    WHERE cr.run_id = ? AND (cr.error IS NULL OR cr.error = '')
    GROUP BY node ORDER BY node
  `).all(run.id) as any[]

  const nodes = rows.map(r => ({ ...r, mention_rate: r.results ? +(r.mentions / r.results).toFixed(3) : 0 }))
  // The Isolate: the decisive gatekeeper seat if its presence is weak; else the weakest-presence seat.
  const gk = nodes.find(n => n.node === 'gatekeeper')
  const weakest = nodes.filter(n => n.node !== 'untagged').slice().sort((a, b) => a.mention_rate - b.mention_rate)[0]
  const isolate = (gk && gk.mention_rate < 0.5) ? 'gatekeeper' : (weakest?.node ?? null)
  res.json({
    run_id: run.id, run_at: run.run_at, nodes, isolate,
    note: 'DA-2 v1: brand presence (Mention Rate) per decision node. True Citation Isolation (source-overlap) requires source capture (DA-2b).',
  })
})

/** GET /api/citation-tracker/:brandId/off-domain-targets — the mesh placement map.
 *  Aggregates the cited-source URLs (captured from Perplexity etc.) across the latest run
 *  into ranked third-party domains, grouped by committee node. This is Decision Architecture's
 *  off-domain target discovery: where the engines actually pull answers from (DA: 94–100% off-domain). */
brandRouter.get('/:brandId/off-domain-targets', (req, res) => {
  const { brandId } = req.params
  const run = db.prepare(`SELECT id, run_at FROM citation_runs WHERE brand_id = ? AND status IN ('complete','partial') ORDER BY run_at DESC LIMIT 1`).get(brandId) as any
  if (!run) return res.json({ targets: [], byNode: {}, note: 'no completed run yet' })
  const brand = db.prepare('SELECT * FROM tracked_brands WHERE id = ?').get(brandId) as any
  const own = String(brand?.domain || '').replace(/^https?:\/\//, '').replace(/^www\./, '').toLowerCase()

  const rows = db.prepare(`
    SELECT cr.cited_sources AS s, COALESCE(NULLIF(tq.da_node,''),'untagged') AS node
    FROM citation_results cr JOIN tracked_queries tq ON tq.id = cr.query_id
    WHERE cr.run_id = ? AND cr.cited_sources NOT IN ('', '[]')
  `).all(run.id) as any[]

  const map = new Map<string, { domain: string; citations: number; nodes: Set<string>; sample: Set<string> }>()
  for (const r of rows) {
    let urls: string[] = []
    try { urls = JSON.parse(r.s) } catch { continue }
    const seen = new Set<string>()
    for (const u of urls) {
      let host = ''
      try { host = new URL(u).hostname.replace(/^www\./, '').toLowerCase() } catch { continue }
      if (!host || (own && host === own) || seen.has(host)) continue
      seen.add(host)
      const e = map.get(host) || { domain: host, citations: 0, nodes: new Set(), sample: new Set() }
      e.citations++; e.nodes.add(r.node); if (e.sample.size < 2) e.sample.add(u)
      map.set(host, e)
    }
  }
  const targets = [...map.values()]
    .map(e => ({ domain: e.domain, citations: e.citations, nodes: [...e.nodes], sample: [...e.sample] }))
    .sort((a, b) => b.citations - a.citations)
  const byNode: Record<string, string[]> = {}
  for (const t of targets) for (const n of t.nodes) { byNode[n] = byNode[n] || []; if (byNode[n].length < 10) byNode[n].push(t.domain) }
  res.json({ run_id: run.id, run_at: run.run_at, total_targets: targets.length, targets: targets.slice(0, 40), byNode, note: 'Off-domain surfaces the engines cite for this brand — the mesh placement map (sources from Perplexity citations).' })
})

brandRouter.get('/:brandId/trend', (req, res) => {
  const { brandId } = req.params
  const limit = Number(req.query.limit ?? 12)

  const runs = db.prepare(`
    SELECT id, run_at FROM citation_runs
    WHERE brand_id = ? AND status IN ('complete', 'partial')
    ORDER BY run_at DESC LIMIT ?
  `).all(brandId, limit) as any[]

  if (runs.length === 0) return res.json([])

  const points = runs.map((run: any) => {
    // Overall share: % of classified results where brand was mentioned
    const overall = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN brand_mentioned = 1 THEN 1 ELSE 0 END) as mentioned
      FROM citation_results
      WHERE run_id = ? AND classified_at IS NOT NULL AND error = ''
    `).get(run.id) as any

    // Per-engine share
    const engines = db.prepare(`
      SELECT
        engine,
        COUNT(*) as total,
        SUM(CASE WHEN brand_mentioned = 1 THEN 1 ELSE 0 END) as mentioned
      FROM citation_results
      WHERE run_id = ? AND classified_at IS NOT NULL AND error = ''
      GROUP BY engine
    `).all(run.id) as any[]

    const engine_shares: Record<string, number> = {}
    for (const e of engines) {
      engine_shares[e.engine] = e.total > 0 ? Math.round((e.mentioned / e.total) * 100) : 0
    }

    return {
      run_id: run.id,
      run_at: run.run_at,
      overall_share: overall.total > 0 ? Math.round((overall.mentioned / overall.total) * 100) : 0,
      total_classified: overall.total,
      engine_shares,
    }
  }).reverse() // chronological order for chart

  res.json(points)
})

/**
 * POST /api/citation-tracker/:brandId/runs — manual trigger.
 * Creates a jobs row (citation_run) and the job-runner picks it up within 15s.
 */
brandRouter.post('/:brandId/runs', (req, res) => {
  const { brandId } = req.params

  const brand = db.prepare('SELECT * FROM tracked_brands WHERE id = ?').get(brandId) as any
  if (!brand) return res.status(404).json({ error: 'Brand not found' })
  if (brand.status === 'paused') return res.status(422).json({ error: 'Brand is paused — unpause before triggering a run' })

  // Guard: no concurrent runs
  const running = db.prepare("SELECT id FROM citation_runs WHERE brand_id = ? AND status = 'running' LIMIT 1").get(brandId)
  if (running) return res.status(409).json({ error: 'A run is already in progress for this brand' })

  const jobId = uuid()
  db.prepare(`
    INSERT INTO jobs (id, type, status, params, created_at)
    VALUES (?, 'citation_run', 'pending', ?, unixepoch())
  `).run(jobId, JSON.stringify({ brand_id: brandId }))

  res.status(201).json({ job_id: jobId, message: 'Run queued — job-runner picks up within 15 seconds' })
})

/** GET /api/citation-tracker/:brandId/runs/:runId — run + results */
brandRouter.get('/:brandId/runs/:runId', (req, res) => {
  const { runId } = req.params
  const run = db.prepare('SELECT * FROM citation_runs WHERE id = ?').get(runId) as any
  if (!run) return res.status(404).json({ error: 'Run not found' })

  const results = db.prepare(`
    SELECT r.*, q.text as query_text, q.category
    FROM citation_results r
    LEFT JOIN tracked_queries q ON q.id = r.query_id
    WHERE r.run_id = ?
    ORDER BY r.created_at ASC
  `).all(runId)

  res.json({ ...run, results })
})

// ── Reports ───────────────────────────────────────────────────────────────────

/** GET /api/citation-tracker/:brandId/reports — list saved reports */
brandRouter.get('/:brandId/reports', (req, res) => {
  const { brandId } = req.params
  const limit = Number(req.query.limit ?? 20)
  const reports = db.prepare(`
    SELECT id, brand_id, run_id, emailed_at, created_at
    FROM citation_reports
    WHERE brand_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(brandId, limit)
  res.json(reports)
})

/** GET /api/citation-tracker/:brandId/reports/:reportId — full HTML report */
brandRouter.get('/:brandId/reports/:reportId', (req, res) => {
  const { reportId } = req.params
  const report = db.prepare('SELECT * FROM citation_reports WHERE id = ?').get(reportId) as any
  if (!report) return res.status(404).json({ error: 'Report not found' })
  res.json(report)
})

/**
 * POST /api/citation-tracker/:brandId/runs/:runId/report
 * Manually trigger report generation for a completed/classified run.
 */
brandRouter.post('/:brandId/runs/:runId/report', (req, res) => {
  const { brandId, runId } = req.params
  const run = db.prepare('SELECT * FROM citation_runs WHERE id = ? AND brand_id = ?').get(runId, brandId) as any
  if (!run) return res.status(404).json({ error: 'Run not found' })

  const jobId = uuid()
  db.prepare(`
    INSERT INTO jobs (id, type, status, params, created_at)
    VALUES (?, 'citation_report', 'pending', ?, unixepoch())
  `).run(jobId, JSON.stringify({ run_id: runId, brand_id: brandId }))

  res.status(201).json({ job_id: jobId, message: 'Report generation queued' })
})

/**
 * POST /api/citation-tracker/:brandId/runs/:runId/classify
 * Manually re-trigger the mention-detection pass for a completed run.
 * Useful for reprocessing after prompt improvements.
 */
brandRouter.post('/:brandId/runs/:runId/classify', (req, res) => {
  const { brandId, runId } = req.params

  const run = db.prepare('SELECT * FROM citation_runs WHERE id = ? AND brand_id = ?').get(runId, brandId) as any
  if (!run) return res.status(404).json({ error: 'Run not found' })

  // Reset classified_at on unclassified-eligible rows so the worker re-processes them
  const { reset } = req.body
  if (reset) {
    db.prepare(`
      UPDATE citation_results SET classified_at = NULL
      WHERE run_id = ? AND error = '' AND raw_response != ''
    `).run(runId)
  }

  const jobId = uuid()
  db.prepare(`
    INSERT INTO jobs (id, type, status, params, created_at)
    VALUES (?, 'citation_classify', 'pending', ?, unixepoch())
  `).run(jobId, JSON.stringify({ run_id: runId, brand_id: brandId }))

  res.status(201).json({ job_id: jobId, message: 'Classification job queued' })
})
