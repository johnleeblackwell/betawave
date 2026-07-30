/**
 * Google Search Console routes — mounted at /api/clients/:clientId/search-console.
 *
 * The client's own first-party Google data: what Google actually showed and
 * what people actually clicked. Read-only against their property.
 *
 * The AI-import endpoints exist because Search Console's Generative AI report
 * is UI-only — there is no API for AI Overviews / AI Mode. Rather than pretend
 * otherwise, the user exports the CSV by hand and uploads it here, and the app
 * is explicit about which numbers came from the API and which from a human.
 */
import { Router } from 'express'
import db from '../db.js'
import { listSites, summary, parseGenAiCsv, gscCreds, GSC_SCOPE } from '../services/search-console.js'

const router = Router({ mergeParams: true })

/** GET /status — connected? which property? is AI data present? */
router.get('/status', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const prop = db.prepare(`SELECT site_url, connected_at FROM gsc_properties WHERE client_id = ?`).get(clientId) as any
  const ai = db.prepare(`
    SELECT COUNT(*) n, MAX(imported_at) last_import, MIN(period_start) ps, MAX(period_end) pe
    FROM gsc_ai_rows WHERE client_id = ?
      AND imported_at = (SELECT MAX(imported_at) FROM gsc_ai_rows WHERE client_id = ?)
  `).get(clientId, clientId) as any

  res.json({
    credentials_present: !!gscCreds(),
    connected: !!prop,
    site_url: prop?.site_url || '',
    connected_at: prop?.connected_at || null,
    ai_import: ai?.n ? { rows: ai.n, imported_at: ai.last_import, period_start: ai.ps, period_end: ai.pe } : null,
    // Stated in the API response, not just the UI, so anything consuming this
    // (the agent, a report, a self-hoster's own script) inherits the caveat.
    ai_via_api: false,
    ai_note: 'Google exposes no API for AI Overviews / AI Mode. Those figures come from a Search Console CSV export you upload; everything else here is pulled live from the API.',
    oauth_scope: GSC_SCOPE,
  })
})

/** GET /sites — properties this Google account can read, for the picker. */
router.get('/sites', async (_req, res) => {
  try {
    res.json({ sites: await listSites() })
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message || e) })
  }
})

/** PUT /property — attach a property to this client. */
router.put('/property', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const siteUrl = String(req.body?.site_url || '').trim()
  if (!siteUrl) return res.status(400).json({ error: 'site_url required' })
  db.prepare(`
    INSERT INTO gsc_properties (client_id, site_url, connected_at) VALUES (?, ?, unixepoch())
    ON CONFLICT(client_id) DO UPDATE SET site_url = excluded.site_url, connected_at = unixepoch()
  `).run(clientId, siteUrl)
  res.json({ ok: true, site_url: siteUrl })
})

router.delete('/property', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  db.prepare(`DELETE FROM gsc_properties WHERE client_id = ?`).run(clientId)
  res.json({ ok: true })
})

/** GET /summary?days=28 — live pull. */
router.get('/summary', async (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const prop = db.prepare(`SELECT site_url FROM gsc_properties WHERE client_id = ?`).get(clientId) as any
  if (!prop) return res.status(400).json({ error: 'No Search Console property connected for this client.' })
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? '28'), 10) || 28, 1), 480)
  try {
    res.json(await summary(prop.site_url, days))
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message || e) })
  }
})

/**
 * POST /ai-import — body: { csv, period_start?, period_end? }
 * The hand-exported Generative AI report. Replaces the previous import for this
 * client: it's a snapshot of a period, not an append-only log, and keeping
 * stale rows around would quietly double-count.
 */
router.post('/ai-import', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const csv = String(req.body?.csv || '')
  if (!csv.trim()) return res.status(400).json({ error: 'csv required' })

  const rows = parseGenAiCsv(csv)
  if (!rows.length) {
    return res.status(400).json({
      error: 'No rows recognised in that CSV. Expected a Search Console export with a query column plus clicks/impressions.',
    })
  }
  const ps = String(req.body?.period_start || '')
  const pe = String(req.body?.period_end || '')
  const now = Math.floor(Date.now() / 1000)

  const insert = db.prepare(`
    INSERT INTO gsc_ai_rows (client_id, query, clicks, impressions, ctr, position, period_start, period_end, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  db.exec('BEGIN')
  try {
    db.prepare(`DELETE FROM gsc_ai_rows WHERE client_id = ?`).run(clientId)
    for (const r of rows) {
      insert.run(clientId, r.query, r.clicks, r.impressions, r.ctr, r.position, ps, pe, now)
    }
    db.exec('COMMIT')
  } catch (e: any) {
    db.exec('ROLLBACK')
    return res.status(500).json({ error: e.message })
  }
  res.json({ ok: true, imported: rows.length, period_start: ps, period_end: pe })
})

/** GET /ai — the most recent import. */
router.get('/ai', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const rows = db.prepare(`
    SELECT query, clicks, impressions, ctr, position, period_start, period_end, imported_at
    FROM gsc_ai_rows
    WHERE client_id = ? AND imported_at = (SELECT MAX(imported_at) FROM gsc_ai_rows WHERE client_id = ?)
    ORDER BY impressions DESC, clicks DESC
    LIMIT 200
  `).all(clientId, clientId) as any[]

  const totals = rows.reduce((a, r) => ({
    clicks: a.clicks + (r.clicks || 0),
    impressions: a.impressions + (r.impressions || 0),
  }), { clicks: 0, impressions: 0 })

  res.json({
    rows,
    totals: { ...totals, ctr: totals.impressions ? totals.clicks / totals.impressions : 0 },
    source: 'manual-csv-export',
    imported_at: rows[0]?.imported_at || null,
  })
})

export default router
