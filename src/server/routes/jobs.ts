// @ts-nocheck
// Jobs — background batch-work tracking (pSEO runs, niche reports, scheduled posts).
// This file is the data/query layer only; job execution workers live in src/server/services
// (e.g. scheduler.ts today; pSEO + report workers in later tasks).
import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'

const router = Router() as any

const VALID_TYPES = ['pseo_batch', 'report_generate', 'scheduled_post']
const VALID_STATUS = ['pending', 'running', 'complete', 'failed', 'cancelled']

function parseRow(r: any) {
  if (!r) return r
  return {
    ...r,
    params: JSON.parse(r.params || '{}'),
    result: JSON.parse(r.result || '{}'),
  }
}

// List jobs, newest first. Filter by client_id, type, or status.
router.get('/', (req, res) => {
  const { client_id, type, status } = req.query as Record<string, string>
  const clauses: string[] = []
  const args: any[] = []
  if (client_id) { clauses.push('client_id = ?'); args.push(client_id) }
  if (type)      { clauses.push('type = ?');      args.push(type) }
  if (status)    { clauses.push('status = ?');    args.push(status) }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = db.prepare(`SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT 200`).all(...args)
  res.json(rows.map(parseRow))
})

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Job not found' })
  res.json(parseRow(row))
})

// Create a job in 'pending' state. The worker (in services/) transitions it to 'running'
// when it picks the job up, then to 'complete' or 'failed'.
router.post('/', (req, res) => {
  const { client_id, type, params, total } = req.body
  if (!type || !VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of ${VALID_TYPES.join(', ')}` })
  }
  const id = uuid()
  db.prepare(`
    INSERT INTO jobs (id, client_id, type, status, total, params)
    VALUES (?, ?, ?, 'pending', ?, ?)
  `).run(
    id,
    client_id || null,
    type,
    Number(total) || 0,
    JSON.stringify(params || {})
  )
  res.status(201).json(parseRow(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id)))
})

// Patch progress fields. Used by workers to push tick-level updates.
// Sets started_at on first transition to 'running' and completed_at on terminal states.
router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Job not found' })
  const { status, completed, failed, result, error, total } = req.body

  const nextStatus = status && VALID_STATUS.includes(status) ? status : (existing as any).status
  const wasTerminal = ['complete', 'failed', 'cancelled'].includes((existing as any).status)
  const isTerminal = ['complete', 'failed', 'cancelled'].includes(nextStatus)

  const startedAt = (existing as any).started_at ||
    (nextStatus === 'running' ? Math.floor(Date.now() / 1000) : null)
  const completedAt = (existing as any).completed_at ||
    (isTerminal && !wasTerminal ? Math.floor(Date.now() / 1000) : null)

  db.prepare(`
    UPDATE jobs
    SET status = ?, completed = ?, failed = ?, total = ?, result = ?, error = ?, started_at = ?, completed_at = ?
    WHERE id = ?
  `).run(
    nextStatus,
    completed ?? (existing as any).completed,
    failed ?? (existing as any).failed,
    total ?? (existing as any).total,
    result !== undefined ? JSON.stringify(result) : (existing as any).result,
    error ?? (existing as any).error,
    startedAt,
    completedAt,
    req.params.id
  )
  res.json(parseRow(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id)))
})

// Cancel a pending/running job. Workers should check the status each tick and bail if cancelled.
router.post('/:id/cancel', (req, res) => {
  const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Job not found' })
  if (['complete', 'failed', 'cancelled'].includes((existing as any).status)) {
    return res.status(400).json({ error: `Job already ${(existing as any).status}` })
  }
  db.prepare(`
    UPDATE jobs SET status = 'cancelled', completed_at = unixepoch() WHERE id = ?
  `).run(req.params.id)
  res.json(parseRow(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id)))
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// --- Convenience: kick off a pSEO batch in one call.
// Accepts either an explicit location_ids array, or `all_active: true` to
// pick up every active location for the client.
router.post('/pseo', (req, res) => {
  const {
    client_id,
    template_id,
    location_ids,
    all_active,
    extra_vars,
    wp_publish,
    wp_post_status,
    wp_category_id,
  } = req.body

  if (!client_id || !template_id) {
    return res.status(400).json({ error: 'client_id and template_id are required' })
  }

  let ids: string[] = Array.isArray(location_ids) ? location_ids.filter(Boolean) : []
  if (all_active && !ids.length) {
    ids = (db.prepare('SELECT id FROM locations WHERE client_id = ? AND active = 1 ORDER BY name ASC').all(client_id) as any[])
      .map((r: any) => r.id)
  }
  if (!ids.length) {
    return res.status(400).json({ error: 'No locations selected (pass location_ids[] or all_active:true with active locations configured)' })
  }

  const template = db.prepare('SELECT id FROM templates WHERE id = ?').get(template_id)
  if (!template) return res.status(404).json({ error: 'Template not found' })

  const id = uuid()
  db.prepare(`
    INSERT INTO jobs (id, client_id, type, status, total, params)
    VALUES (?, ?, 'pseo_batch', 'pending', ?, ?)
  `).run(
    id,
    client_id,
    ids.length,
    JSON.stringify({
      template_id,
      location_ids: ids,
      extra_vars: extra_vars || {},
      wp_publish: !!wp_publish,
      wp_post_status: wp_post_status || 'draft',
      wp_category_id: Number(wp_category_id) || 0,
    })
  )
  res.status(201).json(parseRow(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id)))
})

export default router
