/**
 * Goals — a scoreboard, not a task list.
 *
 * Mounted at /api/goals.
 *
 * WHY A SCOREBOARD AND NOT A KANBAN
 *
 * A card board needs maintaining, and the week you are too busy to move cards
 * is the week it stops describing reality — at which point it is worse than
 * nothing, because it looks authoritative while lying. Every count here is
 * derived from what the pipeline already records: when a message was sent, when
 * someone replied, what stage they reached. There is nothing to tick off and
 * nothing to forget, so it cannot drift away from the truth. It goes red on its
 * own.
 *
 * Targets are stored, actuals are computed. That split is the whole design.
 */
import { Router } from 'express'
import crypto from 'node:crypto'
import db from '../db.js'

const router = Router()

db.exec(`
  CREATE TABLE IF NOT EXISTS goals (
    id           TEXT PRIMARY KEY,
    client_id    TEXT,              -- NULL = applies across every campaign
    metric       TEXT NOT NULL,     -- 'touches' | 'replies' | 'calls' | 'won'
    period       TEXT NOT NULL,     -- 'day' | 'week' | 'month'
    target       INTEGER NOT NULL,
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch())
  )
`)

/** Period boundaries in the operator's own week — Monday start, not Sunday. */
const SINCE: Record<string, string> = {
  day: `unixepoch('now','start of day')`,
  week: `unixepoch('now','weekday 1','-7 days','start of day')`,
  month: `unixepoch('now','start of month')`,
}

/**
 * Actuals.
 *
 * `touches` counts outreach ATTEMPTS, which is the only number wholly within
 * John's control — replies and calls are other people's decisions, and a target
 * you cannot influence directly is demoralising rather than motivating. It is
 * counted from outreach_sent_at rather than from a "mark done" button, so it
 * reflects messages that actually went out.
 */
function actual(metric: string, period: string, clientId?: string): number {
  const since = SINCE[period] || SINCE.day
  const scope = clientId ? `AND o.client_id = ?` : ``
  const args = clientId ? [clientId] : []
  const sql: Record<string, string> = {
    touches: `SELECT COUNT(*) n FROM dl_contacts c
              JOIN dl_organizations o ON o.id = c.organization_id
              WHERE c.outreach_sent_at IS NOT NULL AND c.outreach_sent_at >= ${since} ${scope}`,
    replies: `SELECT COUNT(*) n FROM dl_contacts c
              JOIN dl_organizations o ON o.id = c.organization_id
              WHERE c.last_reply_at IS NOT NULL AND c.last_reply_at >= ${since} ${scope}`,
    calls:   `SELECT COUNT(*) n FROM dl_contacts c
              JOIN dl_organizations o ON o.id = c.organization_id
              WHERE c.stage IN ('call_booked','trial') AND c.context_captured_at >= ${since} ${scope}`,
    won:     `SELECT COUNT(*) n FROM dl_contacts c
              JOIN dl_organizations o ON o.id = c.organization_id
              WHERE c.stage = 'won' AND c.context_captured_at >= ${since} ${scope}`,
  }
  try { return (db.prepare(sql[metric] || sql.touches).get(...args) as any)?.n ?? 0 }
  catch { return 0 }
}

/** GET / — every active goal with its live number. */
router.get('/', (_req, res) => {
  const goals = db.prepare(`SELECT * FROM goals WHERE active = 1 ORDER BY period, metric`).all() as any[]
  const clients = Object.fromEntries(
    (db.prepare(`SELECT id, business_name, name FROM clients`).all() as any[])
      .map(c => [c.id, c.business_name || c.name]))

  const rows = goals.map(g => {
    const done = actual(g.metric, g.period, g.client_id || undefined)
    return {
      ...g,
      client_name: g.client_id ? (clients[g.client_id] || 'unknown') : 'All campaigns',
      actual: done,
      pct: g.target > 0 ? Math.min(100, Math.round((done / g.target) * 100)) : 0,
      met: done >= g.target,
    }
  })

  // Per-campaign outreach today, whether or not a goal exists for it — so a
  // campaign quietly receiving no attention is visible rather than absent.
  const byClient = db.prepare(`
    SELECT cl.id, COALESCE(cl.business_name, cl.name) AS name, COUNT(c.id) AS n
    FROM clients cl
    JOIN dl_organizations o ON o.client_id = cl.id
    JOIN dl_contacts c ON c.organization_id = o.id
      AND c.outreach_sent_at >= ${SINCE.day}
    GROUP BY cl.id ORDER BY n DESC`).all() as any[]

  res.json({
    goals: rows,
    today_by_campaign: byClient,
    totals: {
      today: actual('touches', 'day'),
      week: actual('touches', 'week'),
      month: actual('touches', 'month'),
      replies_week: actual('replies', 'week'),
      calls_month: actual('calls', 'month'),
    },
  })
})

/** POST / — create or update a target. */
router.post('/', (req, res) => {
  const { id, client_id, metric, period, target, active } = req.body || {}
  if (!metric || !period || target == null) {
    return res.status(400).json({ error: 'metric, period and target are required' })
  }
  if (!['day', 'week', 'month'].includes(period)) return res.status(400).json({ error: 'bad period' })
  if (id) {
    db.prepare(`UPDATE goals SET client_id=?, metric=?, period=?, target=?, active=? WHERE id=?`)
      .run(client_id || null, metric, period, Number(target), active === false ? 0 : 1, id)
    return res.json({ ok: true, id })
  }
  const newId = crypto.randomUUID()
  db.prepare(`INSERT INTO goals (id, client_id, metric, period, target) VALUES (?,?,?,?,?)`)
    .run(newId, client_id || null, metric, period, Number(target))
  res.json({ ok: true, id: newId })
})

/** DELETE /:id */
router.delete('/:id', (req, res) => {
  db.prepare(`DELETE FROM goals WHERE id = ?`).run(req.params.id)
  res.json({ ok: true })
})

export default router
