// @ts-nocheck
import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { calculateNextRun, runSchedule } from '../services/scheduler.js'

const router = Router({ mergeParams: true }) as any

// List schedules for a client
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM schedules WHERE client_id = ? ORDER BY created_at ASC').all(req.params.clientId)
  res.json(rows)
})

// Create schedule
router.post('/', (req, res) => {
  const { content_type = 'blog', frequency = 'weekly', day_of_week = 1, time_of_day = '09:00', auto_publish_email = 0, auto_publish_wp = 0, topic_hint = '', wp_post_status = '', wp_category_id = 0 } = req.body
  const id = uuid()
  const next_run = calculateNextRun(frequency, day_of_week, time_of_day)

  db.prepare(`
    INSERT INTO schedules (id, client_id, content_type, frequency, day_of_week, time_of_day, auto_publish_email, auto_publish_wp, enabled, next_run, topic_hint, wp_post_status, wp_category_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(id, req.params.clientId, content_type, frequency, day_of_week, time_of_day, auto_publish_email ? 1 : 0, auto_publish_wp ? 1 : 0, next_run, topic_hint, wp_post_status, Number(wp_category_id))

  res.json(db.prepare('SELECT * FROM schedules WHERE id = ?').get(id))
})

// Update schedule
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id) as any
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const content_type = req.body.content_type ?? existing.content_type
  const frequency = req.body.frequency ?? existing.frequency
  const day_of_week = req.body.day_of_week ?? existing.day_of_week
  const time_of_day = req.body.time_of_day ?? existing.time_of_day
  const auto_publish_email = req.body.auto_publish_email !== undefined ? (req.body.auto_publish_email ? 1 : 0) : existing.auto_publish_email
  const auto_publish_wp = req.body.auto_publish_wp !== undefined ? (req.body.auto_publish_wp ? 1 : 0) : existing.auto_publish_wp
  const enabled = req.body.enabled !== undefined ? (req.body.enabled ? 1 : 0) : existing.enabled
  const topic_hint = req.body.topic_hint !== undefined ? req.body.topic_hint : existing.topic_hint
  const wp_post_status = req.body.wp_post_status !== undefined ? req.body.wp_post_status : existing.wp_post_status
  const wp_category_id = req.body.wp_category_id !== undefined ? Number(req.body.wp_category_id) : existing.wp_category_id

  // Recalculate next_run whenever schedule settings change
  const next_run = enabled ? calculateNextRun(frequency, day_of_week, time_of_day) : null

  db.prepare(`
    UPDATE schedules SET content_type=?, frequency=?, day_of_week=?, time_of_day=?,
    auto_publish_email=?, auto_publish_wp=?, enabled=?, next_run=?, topic_hint=?,
    wp_post_status=?, wp_category_id=? WHERE id=?
  `).run(content_type, frequency, day_of_week, time_of_day, auto_publish_email, auto_publish_wp, enabled, next_run, topic_hint, wp_post_status, wp_category_id, req.params.id)

  res.json(db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id))
})

// Delete schedule
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// Run a schedule immediately (manual trigger / test)
router.post('/:id/run-now', async (req, res) => {
  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id) as any
  if (!schedule) return res.status(404).json({ error: 'Not found' })

  try {
    await runSchedule(schedule)
    const now = Math.floor(Date.now() / 1000)
    db.prepare('UPDATE schedules SET last_run = ? WHERE id = ?').run(now, schedule.id)
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Run failed' })
  }
})

export default router
