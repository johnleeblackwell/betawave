/**
 * Client overview — the numbers behind the landing page.
 *
 * Mounted at /api/clients/:clientId/overview.
 *
 * WHY THIS EXISTS
 *
 * The Overview tab is the first screen anyone sees after logging in, and it
 * showed identity fields and a brand-voice paragraph — a configuration screen.
 * A prospect being shown the product therefore opened it and saw settings, with
 * every piece of evidence that the thing works sitting one click away under
 * Produce, Reach and Measure. The same is true of a self-hoster's first run:
 * the landing screen said nothing about whether anything was happening.
 *
 * So this returns the handful of counts that prove the engine is running, in
 * one query set, cheap enough to load on every visit. Deliberately read-only
 * and deliberately aggregate — no individual contact leaves this endpoint,
 * because the Overview is also what a demo visitor sees.
 */
import { Router } from 'express'
import db from '../db.js'

const router = Router({ mergeParams: true })

const n = (sql: string, ...args: any[]): number => {
  try { return (db.prepare(sql).get(...args) as any)?.n ?? 0 } catch { return 0 }
}

router.get('/', (req, res) => {
  const clientId = String((req.params as any).clientId || '')
  if (!clientId) return res.status(400).json({ error: 'clientId required' })

  // ── Produce ──
  const produce = {
    published: n(`SELECT COUNT(*) n FROM content WHERE client_id=? AND status='published'`, clientId),
    scheduled: n(`SELECT COUNT(*) n FROM content WHERE client_id=? AND status='scheduled'`, clientId),
    drafts: n(`SELECT COUNT(*) n FROM content WHERE client_id=? AND status='draft'`, clientId),
    last_30_days: n(`SELECT COUNT(*) n FROM content WHERE client_id=? AND created_at >= unixepoch()-2592000`, clientId),
  }

  // ── Reach ──
  const contactsWhere = `FROM dl_contacts c JOIN dl_organizations o ON o.id=c.organization_id WHERE o.client_id=?`
  const reach = {
    segments: n(`SELECT COUNT(*) n FROM verticals WHERE client_id=?`, clientId),
    organisations: n(`SELECT COUNT(*) n FROM dl_organizations WHERE client_id=?`, clientId),
    contacts: n(`SELECT COUNT(*) n ${contactsWhere}`, clientId),
    // "In play" is anyone with an open thread — the number that matters daily,
    // as distinct from the total, which only ever goes up.
    in_play: n(`SELECT COUNT(*) n ${contactsWhere} AND c.stage IN
                ('touch_1','touch_2','touch_3','replied','discussing','call_booked','trial')`, clientId),
    due_today: n(`SELECT COUNT(*) n ${contactsWhere} AND c.next_action_at IS NOT NULL
                  AND c.next_action_at <= unixepoch()`, clientId),
    replied: n(`SELECT COUNT(*) n ${contactsWhere} AND c.last_reply_at IS NOT NULL`, clientId),
    won: n(`SELECT COUNT(*) n ${contactsWhere} AND c.stage='won'`, clientId),
  }

  const pipeline = (() => {
    try {
      return db.prepare(`SELECT c.stage, COUNT(*) n
        FROM dl_contacts c JOIN dl_organizations o ON o.id=c.organization_id
        WHERE o.client_id=? AND c.stage IS NOT NULL AND c.stage<>''
        GROUP BY c.stage ORDER BY n DESC`).all(clientId) as any[]
    } catch { return [] }
  })()

  // ── Measure ──
  // Visibility = share of engine answers that named the brand, per run. Two
  // most recent runs give the delta; a single number with no direction is the
  // kind of metric people stop looking at.
  const runs = (() => {
    try {
      return db.prepare(`
        SELECT r.run_at,
               ROUND(100.0 * SUM(res.brand_mentioned) / NULLIF(COUNT(*),0), 1) pct,
               COUNT(*) calls
        FROM citation_runs r
        JOIN citation_results res ON res.run_id = r.id
        JOIN tracked_brands b ON b.id = r.brand_id
        WHERE b.client_id = ?
        GROUP BY r.id ORDER BY r.run_at DESC LIMIT 12`).all(clientId) as any[]
    } catch { return [] }
  })()
  const measure = {
    tracked_queries: n(`SELECT COUNT(*) n FROM tracked_queries q
                        JOIN tracked_brands b ON b.id=q.brand_id WHERE b.client_id=?`, clientId),
    runs: n(`SELECT COUNT(*) n FROM citation_runs r
             JOIN tracked_brands b ON b.id=r.brand_id WHERE b.client_id=?`, clientId),
    visibility_pct: runs.length ? runs[0].pct : null,
    previous_pct: runs.length > 1 ? runs[1].pct : null,
    // Oldest-first so a sparkline reads left to right.
    trend: runs.slice().reverse().map(r => ({ at: r.run_at, pct: r.pct })),
  }

  // ── Recent activity ──
  // One merged, human-readable stream. The point of the Overview is "is this
  // thing alive?", and a list of dated events answers that faster than counts.
  const activity: any[] = []
  try {
    for (const r of db.prepare(`SELECT title, type, status, created_at FROM content
        WHERE client_id=? ORDER BY created_at DESC LIMIT 5`).all(clientId) as any[])
      activity.push({ at: r.created_at, kind: 'content',
        text: `${r.status === 'published' ? 'Published' : r.status === 'scheduled' ? 'Scheduled' : 'Drafted'} ${r.type}: ${r.title}` })
  } catch { /* table shape varies by install age */ }
  try {
    for (const r of db.prepare(`SELECT c.full_name, c.stage, c.last_reply_at, o.name co
        FROM dl_contacts c JOIN dl_organizations o ON o.id=c.organization_id
        WHERE o.client_id=? AND c.last_reply_at IS NOT NULL
        ORDER BY c.last_reply_at DESC LIMIT 5`).all(clientId) as any[])
      activity.push({ at: r.last_reply_at, kind: 'reply',
        text: `${r.full_name} at ${r.co} replied — now ${String(r.stage || '').replace(/_/g, ' ')}` })
  } catch { /* ditto */ }
  activity.sort((a, b) => b.at - a.at)

  res.json({ produce, reach, pipeline, measure, activity: activity.slice(0, 8) })
})

export default router
