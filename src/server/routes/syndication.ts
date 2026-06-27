/**
 * Syndication routes — client-scoped.
 *
 * Mounted at /api/clients/:clientId/syndication
 *   GET    /sources                — list sources
 *   POST   /sources                — create
 *   PATCH  /sources/:id            — update
 *   DELETE /sources/:id
 *
 *   GET    /destinations           — list
 *   POST   /destinations           — create (with X creds)
 *   PATCH  /destinations/:id
 *   DELETE /destinations/:id
 *   POST   /destinations/:id/test  — verify credentials by hitting /users/me
 *
 *   GET    /routes                 — list (joined with src + dest labels)
 *   POST   /routes                 — link a source → destination
 *   PATCH  /routes/:id
 *   DELETE /routes/:id
 *   POST   /routes/:id/preview     — dry-run rewrite of latest item
 *   POST   /routes/:id/run-now     — force-run this route immediately
 *
 *   GET    /history                — recent syndications across all routes
 */
import { Router } from 'express'
import crypto from 'node:crypto'
import db from '../db.js'
import { testDestination, previewRoute, runSyndicationTick } from '../services/syndication.js'

const router = Router({ mergeParams: true })

// ─── Sources ─────────────────────────────────────────────────────────────────
router.get('/sources', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const rows = db.prepare(`SELECT * FROM syndication_sources WHERE client_id = ? ORDER BY created_at DESC`).all(clientId) as any[]
  res.json(rows.map(maskSourceToken))
})

router.post('/sources', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const { label, source_type = 'rss', url, handle = '', api_token = '' } = req.body
  if (!label?.trim() || !url?.trim()) return res.status(400).json({ error: 'label + url required' })
  if (source_type === 'apify_instagram' && !api_token?.trim()) {
    return res.status(400).json({ error: 'Apify API token required for apify_instagram source type' })
  }
  const id = crypto.randomUUID()
  db.prepare(`
    INSERT INTO syndication_sources (id, client_id, label, source_type, url, handle, api_token)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, clientId, label.trim(), source_type, url.trim(), handle.trim(), api_token.trim())
  res.json(maskSourceToken(db.prepare(`SELECT * FROM syndication_sources WHERE id = ?`).get(id)))
})

router.patch('/sources/:id', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  const row = db.prepare(`SELECT 1 FROM syndication_sources WHERE id = ? AND client_id = ?`).get(id, clientId)
  if (!row) return res.status(404).json({ error: 'Source not found' })

  const fields = ['label', 'source_type', 'url', 'handle', 'api_token', 'active']
  const updates: string[] = []
  const values: any[] = []
  for (const f of fields) {
    const v = req.body[f]
    if (v === undefined) continue
    // Skip mask placeholder values so we don't overwrite stored token with •••
    if (typeof v === 'string' && v.startsWith('•••')) continue
    updates.push(`${f} = ?`)
    values.push(v)
  }
  if (!updates.length) return res.status(400).json({ error: 'no fields' })
  values.push(id)
  db.prepare(`UPDATE syndication_sources SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  res.json(maskSourceToken(db.prepare(`SELECT * FROM syndication_sources WHERE id = ?`).get(id)))
})

function maskSourceToken(row: any): any {
  if (!row) return row
  return {
    ...row,
    api_token: row.api_token ? `•••${String(row.api_token).slice(-4)}` : '',
  }
}

router.delete('/sources/:id', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  db.prepare(`DELETE FROM syndication_sources WHERE id = ? AND client_id = ?`).run(id, clientId)
  res.json({ ok: true })
})

// ─── Destinations ────────────────────────────────────────────────────────────
router.get('/destinations', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  // Don't leak secrets back to the UI — mask them
  const rows = db.prepare(`SELECT * FROM syndication_destinations WHERE client_id = ? ORDER BY created_at DESC`).all(clientId) as any[]
  res.json(rows.map(maskSecrets))
})

router.post('/destinations', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const { label, platform = 'x', handle = '', api_key = '', api_secret = '', access_token = '', access_secret = '' } = req.body
  if (!label?.trim()) return res.status(400).json({ error: 'label required' })

  const id = crypto.randomUUID()
  db.prepare(`
    INSERT INTO syndication_destinations
      (id, client_id, label, platform, handle, api_key, api_secret, access_token, access_secret)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, clientId, label.trim(), platform, handle.trim(),
         api_key.trim(), api_secret.trim(), access_token.trim(), access_secret.trim())

  const row = db.prepare(`SELECT * FROM syndication_destinations WHERE id = ?`).get(id) as any
  res.json(maskSecrets(row))
})

router.patch('/destinations/:id', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  const row = db.prepare(`SELECT 1 FROM syndication_destinations WHERE id = ? AND client_id = ?`).get(id, clientId)
  if (!row) return res.status(404).json({ error: 'Destination not found' })

  // Don't overwrite secrets with mask placeholders
  const fields = ['label', 'platform', 'handle', 'api_key', 'api_secret', 'access_token', 'access_secret', 'active', 'min_minutes_between_posts']
  const updates: string[] = []
  const values: any[] = []
  for (const f of fields) {
    const v = req.body[f]
    if (v === undefined) continue
    // Skip mask-placeholder values
    if (typeof v === 'string' && v.startsWith('•••')) continue
    updates.push(`${f} = ?`)
    values.push(v)
  }
  if (!updates.length) return res.status(400).json({ error: 'no fields' })
  values.push(id)
  db.prepare(`UPDATE syndication_destinations SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  const updated = db.prepare(`SELECT * FROM syndication_destinations WHERE id = ?`).get(id) as any
  res.json(maskSecrets(updated))
})

router.delete('/destinations/:id', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  db.prepare(`DELETE FROM syndication_destinations WHERE id = ? AND client_id = ?`).run(id, clientId)
  res.json({ ok: true })
})

router.post('/destinations/:id/test', async (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  const row = db.prepare(`SELECT 1 FROM syndication_destinations WHERE id = ? AND client_id = ?`).get(id, clientId)
  if (!row) return res.status(404).json({ error: 'Destination not found' })
  const result = await testDestination(id)
  res.json(result)
})

// ─── Routes ──────────────────────────────────────────────────────────────────
router.get('/routes', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const rows = db.prepare(`
    SELECT r.*,
      s.label AS source_label, s.url AS source_url, s.handle AS source_handle,
      d.label AS dest_label,   d.platform AS dest_platform, d.handle AS dest_handle,
      (SELECT COUNT(*) FROM syndications WHERE route_id = r.id AND status = 'posted') AS posted_count
    FROM syndication_routes r
    JOIN syndication_sources      s ON s.id = r.source_id
    JOIN syndication_destinations d ON d.id = r.destination_id
    WHERE r.client_id = ?
    ORDER BY r.created_at DESC
  `).all(clientId)
  res.json(rows)
})

router.post('/routes', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const { source_id, destination_id, rewrite_prompt = '', daily_cap = 10 } = req.body
  if (!source_id || !destination_id) return res.status(400).json({ error: 'source_id + destination_id required' })

  // Verify both belong to this client
  const src = db.prepare(`SELECT 1 FROM syndication_sources WHERE id = ? AND client_id = ?`).get(source_id, clientId)
  const dst = db.prepare(`SELECT 1 FROM syndication_destinations WHERE id = ? AND client_id = ?`).get(destination_id, clientId)
  if (!src || !dst) return res.status(404).json({ error: 'Source or destination not found' })

  const id = crypto.randomUUID()
  db.prepare(`
    INSERT INTO syndication_routes (id, client_id, source_id, destination_id, rewrite_prompt, daily_cap)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, clientId, source_id, destination_id, rewrite_prompt, Number(daily_cap) || 10)
  res.json(db.prepare(`SELECT * FROM syndication_routes WHERE id = ?`).get(id))
})

router.patch('/routes/:id', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  const row = db.prepare(`SELECT 1 FROM syndication_routes WHERE id = ? AND client_id = ?`).get(id, clientId)
  if (!row) return res.status(404).json({ error: 'Route not found' })

  // If source_id or destination_id is being changed, verify both belong to this client
  if (req.body.source_id !== undefined) {
    const src = db.prepare(`SELECT 1 FROM syndication_sources WHERE id = ? AND client_id = ?`).get(req.body.source_id, clientId)
    if (!src) return res.status(400).json({ error: 'Source not found or does not belong to this client' })
  }
  if (req.body.destination_id !== undefined) {
    const dst = db.prepare(`SELECT 1 FROM syndication_destinations WHERE id = ? AND client_id = ?`).get(req.body.destination_id, clientId)
    if (!dst) return res.status(400).json({ error: 'Destination not found or does not belong to this client' })
  }

  const fields = ['source_id', 'destination_id', 'rewrite_prompt', 'daily_cap', 'active']
  const updates: string[] = []
  const values: any[] = []
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]) }
  }
  if (!updates.length) return res.status(400).json({ error: 'no fields' })
  values.push(id)
  db.prepare(`UPDATE syndication_routes SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  res.json(db.prepare(`SELECT * FROM syndication_routes WHERE id = ?`).get(id))
})

router.delete('/routes/:id', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  db.prepare(`DELETE FROM syndication_routes WHERE id = ? AND client_id = ?`).run(id, clientId)
  res.json({ ok: true })
})

router.post('/routes/:id/preview', async (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  const row = db.prepare(`SELECT 1 FROM syndication_routes WHERE id = ? AND client_id = ?`).get(id, clientId)
  if (!row) return res.status(404).json({ error: 'Route not found' })
  res.json(await previewRoute(id))
})

router.post('/routes/:id/run-now', async (req, res) => {
  // Forces an immediate full-pipeline tick (across ALL routes); a future
  // refinement could isolate to just this route's id. Today: run all + report.
  const result = await runSyndicationTick()
  res.json(result)
})

// ─── History ─────────────────────────────────────────────────────────────────
router.get('/history', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  res.json(
    db.prepare(`
      SELECT s.*, r.rewrite_prompt,
        src.label AS source_label, src.handle AS source_handle,
        dst.label AS dest_label,   dst.handle AS dest_handle, dst.platform AS dest_platform
      FROM syndications s
      JOIN syndication_routes r       ON r.id = s.route_id
      JOIN syndication_sources src    ON src.id = s.source_id
      JOIN syndication_destinations dst ON dst.id = s.destination_id
      WHERE s.client_id = ?
      ORDER BY s.created_at DESC
      LIMIT 100
    `).all(clientId)
  )
})

// ─── Helpers ─────────────────────────────────────────────────────────────────
function maskSecrets(d: any): any {
  return {
    ...d,
    api_key:       d.api_key       ? `•••${String(d.api_key).slice(-4)}`       : '',
    api_secret:    d.api_secret    ? `•••••••${String(d.api_secret).slice(-4)}` : '',
    access_token:  d.access_token  ? `•••${String(d.access_token).slice(-6)}`  : '',
    access_secret: d.access_secret ? `•••••••${String(d.access_secret).slice(-4)}` : '',
  }
}

export default router
