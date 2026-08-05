/**
 * Bulk lead import with priority scoring — global, owner-scoped.
 *
 * Mounted at /api/leads/bulk-import. For broad role-based campaigns (e.g. "every
 * Marketing Manager in Arizona") the point is to capture and draft for EVERYONE
 * the Sales Navigator search turns up, not to pre-filter the target list — a
 * limited number of manual LinkedIn sends per week is the real bottleneck, not
 * the personalisation engine. This route never excludes anyone; it computes a
 * transparent priority_score so the send queue can be worked best-fit-first.
 *
 * Unlike /contacts/bulk (which requires an existing organisation matched by
 * domain — the LeadSwift company-qualified flow), role-based leads usually
 * arrive with no pre-existing company record at all, so this route finds an
 * organisation by name within the vertical or creates a lightweight one.
 */
import { Router } from 'express'
import crypto from 'node:crypto'
import db from '../db.js'
import { advanceAfterTouch, advanceAfterReply, setStage, isStage, ACTIVE_STAGES } from '../services/pipeline.js'

const router = Router()

interface LeadItem {
  name: string
  title?: string
  company?: string
  location?: string
  profileUrl?: string
  mutual_connections?: number
  recently_hired?: boolean
  has_recent_posts?: boolean
  shared_groups?: boolean
}

/** Simple, transparent, re-tunable heuristic — no fabricated precision. */
function scoreLead(item: LeadItem, targetTitleWords: string[]): { score: number; signals: Record<string, unknown> } {
  let score = 50
  const title = (item.title || '').toLowerCase()
  const titleMatch = targetTitleWords.some(w => title.includes(w))
  if (titleMatch) score += 20

  const mutuals = Math.min(item.mutual_connections || 0, 10)
  score += mutuals >= 1 ? Math.min(mutuals * 5, 20) : 0

  if (item.recently_hired) score += 15
  if (item.has_recent_posts) score += 10   // active on-platform — also a good Contact Magnetism candidate
  if (item.shared_groups) score += 5

  score = Math.max(0, Math.min(100, score))
  return {
    score,
    signals: {
      title_match: titleMatch,
      mutual_connections: item.mutual_connections || 0,
      recently_hired: !!item.recently_hired,
      has_recent_posts: !!item.has_recent_posts,
      shared_groups: !!item.shared_groups,
    },
  }
}

router.post('/bulk-import', (req, res) => {
  const { clientId, verticalId, targetTitle, items } = req.body as {
    clientId: string; verticalId: string; targetTitle?: string; items: LeadItem[]
  }
  if (!clientId || !verticalId) return res.status(400).json({ error: 'clientId and verticalId required' })
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items[] required' })

  const vertical = db.prepare(`SELECT id FROM verticals WHERE id = ? AND client_id = ?`).get(verticalId, clientId)
  if (!vertical) return res.status(404).json({ error: 'Vertical not found for this client' })

  const targetTitleWords = (targetTitle || 'marketing manager').toLowerCase().split(/\s+/).filter(Boolean)

  const findOrgByName = db.prepare(`
    SELECT id FROM dl_organizations WHERE vertical_id = ? AND LOWER(name) = ? LIMIT 1
  `)
  const insertOrg = db.prepare(`
    INSERT INTO dl_organizations (id, client_id, vertical_id, name, hq_location, sub_segment)
    VALUES (?, ?, ?, ?, ?, 'role-based-lead')
  `)
  const existsContact = db.prepare(`
    SELECT 1 FROM dl_contacts WHERE organization_id = ? AND LOWER(full_name) = ? LIMIT 1
  `)
  const insertContact = db.prepare(`
    INSERT INTO dl_contacts
      (id, organization_id, full_name, role, linkedin_url, source, source_confidence, priority_score, priority_signals)
    VALUES (?, ?, ?, ?, ?, 'salesnav', 60, ?, ?)
  `)

  let inserted = 0, skipped = 0
  db.exec('BEGIN')
  try {
    for (const item of items) {
      const name = (item.name || '').trim()
      if (!name) { skipped++; continue }
      const companyName = (item.company || 'Unknown company').trim()

      let orgId: string
      const found = findOrgByName.get(verticalId, companyName.toLowerCase()) as any
      if (found) {
        orgId = found.id
      } else {
        orgId = crypto.randomUUID()
        insertOrg.run(orgId, clientId, verticalId, companyName, item.location || '')
      }

      if (existsContact.get(orgId, name.toLowerCase())) { skipped++; continue }

      const { score, signals } = scoreLead(item, targetTitleWords)
      insertContact.run(
        crypto.randomUUID(), orgId, name, item.title || '',
        item.profileUrl || '', score, JSON.stringify(signals),
      )
      inserted++
    }
    db.exec('COMMIT')
  } catch (e: any) {
    db.exec('ROLLBACK')
    return res.status(500).json({ error: e.message })
  }

  res.json({ inserted, skipped, total: items.length })
})

/**
 * The stable identity inside a LinkedIn URL.
 *
 * A Sales Navigator lead URL looks like:
 *   /sales/lead/ACwAAAA_fosBskn4...,NAME_SEARCH,NPq2
 * Only the first segment is the person. Everything after the comma is *search
 * context* — the SAME person reached from a different search carries a
 * different suffix, so matching on the whole URL silently fails to find people
 * who are definitely in the list. Match on the lead id alone.
 */
export function leadIdFromUrl(url: string): string | null {
  const u = (url || '').split('?')[0].replace(/\/+$/, '')
  const sn = u.match(/\/sales\/(?:lead|people)\/([^,/]+)/i)
  if (sn) return sn[1]
  // Stop at a comma here too — defensive. Public /in/ slugs don't normally
  // carry one, but a malformed/concatenated URL shouldn't silently produce a
  // key that matches nobody.
  const pub = u.match(/\/in\/([^,/]+)/i)
  if (pub) return pub[1]
  return null
}

export const ALLOWED_CHANNELS = ['connect', 'inmail', 'dm', 'email']

/** `outreach_channel` holds a SET of channels, comma-separated — one person can
 *  legitimately get a connection request AND a DM. Tolerates the legacy
 *  single-value rows (they parse to a one-element set) and junk/empty values. */
function parseChannels(raw: unknown): Set<string> {
  return new Set(
    String(raw || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(s => ALLOWED_CHANNELS.includes(s)),
  )
}

/** Roles senior enough that a cold connection request usually goes unanswered —
 *  these are the InMail tier. Kept as SQL so ordering/counting stay in one query. */
const SENIOR_SQL = `(c.role LIKE '%Chief Marketing%' OR c.role LIKE '%CMO%'
                     OR c.role LIKE '%VP%' OR c.role LIKE '%Vice President%')`

/**
 * POST /api/leads/mark-contacted — record that outreach actually went out.
 *
 * Called by the capture extension FROM the LinkedIn page, because that's where
 * the work happens; asking someone to come back into βWave and tick a box is
 * the step everyone skips. Matches on the LinkedIn URL since that's the only
 * identifier the extension has.
 *
 * A URL that isn't in the list is NOT an error — it just means they're working
 * someone outside their imported leads. Returns 200 with found:false so the
 * extension can say so plainly instead of showing a failure.
 */
router.post('/mark-contacted', (req, res) => {
  const { linkedin_url, channel = 'connect', message, undo } = req.body as
    { linkedin_url?: string; channel?: string; message?: string; undo?: boolean }
  if (!linkedin_url) return res.status(400).json({ error: 'linkedin_url required' })

  const id = leadIdFromUrl(linkedin_url)
  if (!id) return res.status(400).json({ error: 'Not a recognisable LinkedIn profile URL' })

  const contact = db.prepare(
    `SELECT c.id, c.full_name, c.outreach_status, c.outreach_channel, c.stage, c.touches, c.outreach_sent_at
     FROM dl_contacts c WHERE c.linkedin_url LIKE ? LIMIT 1`,
  ).get(`%${id}%`) as any
  if (!contact) return res.json({ ok: true, found: false })

  // Undo — a mis-click is common (the buttons sit next to each other and the
  // real send happens in LinkedIn's UI, not here), and without this the only
  // fix was editing the database. Removes just THIS channel; the contact only
  // returns to the day's queue once no channels are left on them.
  if (undo) {
    const left = parseChannels(contact.outreach_channel)
    left.delete(channel)
    const csv = [...left].join(',')
    if (left.size) {
      db.prepare(`UPDATE dl_contacts SET outreach_channel = ? WHERE id = ?`).run(csv, contact.id)
    } else {
      db.prepare(`
        UPDATE dl_contacts
        SET outreach_status = 'not_contacted', outreach_channel = '', outreach_sent_at = NULL,
            stage = 'new', next_action_at = NULL, touches = 0
        WHERE id = ?
      `).run(contact.id)
    }
    return res.json({
      ok: true, found: true, contact_id: contact.id, name: contact.full_name,
      channels: [...left], undone: true, requeued: left.size === 0,
    })
  }

  const ch = ALLOWED_CHANNELS.includes(channel) ? channel : 'connect'

  // A connection request AND a DM to the same person on the same day is ONE
  // touch, not two — advancing per channel would race someone through the
  // sequence in an afternoon and burn the follow-ups that actually earn
  // replies. Only the first mark of the day moves the stage.
  const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000)
  const touchedToday = (contact.outreach_sent_at || 0) >= startOfDay
  const adv = touchedToday
    ? { stage: contact.stage || 'touch_1', next_action_at: undefined }
    : advanceAfterTouch(contact.stage || 'new')

  // Channels are a SET, not one value — a connection request and a DM to the
  // same person are two real touches, and recording only the last one loses
  // half the history. Stored comma-separated in the existing column so old
  // single-value rows keep working untouched.
  const channels = parseChannels(contact.outreach_channel)
  channels.add(ch)
  const csv = [...channels].join(',')

  if (touchedToday) {
    // Same-day second channel: record it, but leave the cadence alone.
    db.prepare(`
      UPDATE dl_contacts
      SET outreach_status = 'messaged', outreach_channel = ?, outreach_sent_at = unixepoch(),
          outreach_message = COALESCE(NULLIF(?, ''), outreach_message)
      WHERE id = ?
    `).run(csv, message || '', contact.id)
  } else {
    db.prepare(`
      UPDATE dl_contacts
      SET outreach_status = 'messaged', outreach_channel = ?, outreach_sent_at = unixepoch(),
          outreach_message = COALESCE(NULLIF(?, ''), outreach_message),
          stage = ?, next_action_at = ?, touches = touches + 1
      WHERE id = ?
    `).run(csv, message || '', adv.stage, adv.next_action_at ?? null, contact.id)
  }

  res.json({
    ok: true, found: true, contact_id: contact.id, name: contact.full_name,
    channel: ch, channels: [...channels],
    stage: adv.stage, next_action_at: adv.next_action_at ?? null,
  })
})

/**
 * GET /api/leads/contact-status?linkedin_url=… — what's already recorded.
 *
 * Lets the extension paint the Mark-sent buttons truthfully when you open a
 * profile, instead of showing a blank slate for someone you already contacted.
 * With multi-select that matters more: without it you can't tell whether you're
 * adding a second channel or about to double-send the first.
 */
router.get('/contact-status', (req, res) => {
  const url = String(req.query.linkedin_url || '')
  if (!url) return res.status(400).json({ error: 'linkedin_url required' })
  const id = leadIdFromUrl(url)
  if (!id) return res.json({ ok: true, found: false, channels: [] })

  const c = db.prepare(
    `SELECT id, full_name, outreach_status, outreach_channel, outreach_sent_at, stage, touches
     FROM dl_contacts WHERE linkedin_url LIKE ? LIMIT 1`,
  ).get(`%${id}%`) as any
  if (!c) return res.json({ ok: true, found: false, channels: [] })

  res.json({
    ok: true, found: true, name: c.full_name,
    channels: [...parseChannels(c.outreach_channel)],
    sent_at: c.outreach_sent_at || null,
    stage: c.stage || 'new',
    touches: c.touches || 0,
  })
})

/**
 * GET /api/leads/search?q=&limit= — find anyone, by name, company or email.
 *
 * Absent until now, which meant the only people visible were those the queue
 * happened to surface today. Someone who replied — the single most important
 * event in the pipeline — was unreachable unless their follow-up was due,
 * so the reply could not be recorded against them at all.
 */
router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim()
  if (q.length < 2) return res.json({ results: [] })
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '25'), 10) || 25, 1), 100)
  const like = `%${q}%`

  const results = db.prepare(`
    SELECT c.id, c.full_name, c.role, c.email, c.linkedin_url, c.stage, c.touches,
           c.outreach_channel, c.next_action_at, c.last_reply_at, c.suppressed,
           o.name AS company, v.name AS segment
    FROM dl_contacts c
    JOIN dl_organizations o ON o.id = c.organization_id
    LEFT JOIN verticals v ON v.id = o.vertical_id
    WHERE c.full_name LIKE ? OR o.name LIKE ? OR c.email LIKE ?
    ORDER BY
      -- Exact-ish name matches first; someone typing a name wants that person,
      -- not every company that happens to contain the string.
      CASE WHEN c.full_name LIKE ? THEN 0 ELSE 1 END,
      c.touches DESC, c.full_name
    LIMIT ?
  `).all(like, like, like, `${q}%`, limit)

  res.json({ results })
})

/**
 * POST /api/leads/:id/replied — someone answered.
 *
 * The highest-signal event in the system and the one nothing else can detect:
 * the extension sees a page, not an inbox, and βWave has no access to LinkedIn
 * messages or your mail. One click here beats an integration that only ever
 * covers one channel.
 *
 * A reply outranks whatever the cadence had planned — straight to `replied`,
 * back tomorrow, because a warm reply left three days goes cold.
 */
router.post('/:id/replied', (req, res) => {
  const contact = db.prepare(`SELECT id, full_name FROM dl_contacts WHERE id = ?`).get(req.params.id) as any
  if (!contact) return res.status(404).json({ error: 'Contact not found' })
  const adv = advanceAfterReply()
  db.prepare(`
    UPDATE dl_contacts SET stage = ?, next_action_at = ?, last_reply_at = unixepoch() WHERE id = ?
  `).run(adv.stage, adv.next_action_at, contact.id)
  res.json({ ok: true, name: contact.full_name, ...adv })
})

/**
 * PATCH /api/leads/:id/stage — move someone by hand.
 *
 * Body: { stage }. Won/lost/nurture clear the schedule so closed business
 * stops reappearing in a daily queue; active stages get a fresh due date.
 */
router.patch('/:id/stage', (req, res) => {
  const { stage } = req.body || {}
  if (!isStage(stage)) return res.status(400).json({ error: 'unknown stage' })
  const contact = db.prepare(`SELECT id, full_name FROM dl_contacts WHERE id = ?`).get(req.params.id) as any
  if (!contact) return res.status(404).json({ error: 'Contact not found' })
  const adv = setStage(stage)
  db.prepare(`UPDATE dl_contacts SET stage = ?, next_action_at = ? WHERE id = ?`)
    .run(adv.stage, adv.next_action_at, contact.id)
  res.json({ ok: true, name: contact.full_name, ...adv })
})

/**
 * POST /api/leads/:id/snooze — body: { days }. Not now, but not never.
 */
router.post('/:id/snooze', (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.body?.days ?? '7'), 10) || 7, 1), 365)
  const contact = db.prepare(`SELECT id, full_name FROM dl_contacts WHERE id = ?`).get(req.params.id) as any
  if (!contact) return res.status(404).json({ error: 'Contact not found' })
  const next = Math.floor(Date.now() / 1000) + days * 86400
  db.prepare(`UPDATE dl_contacts SET next_action_at = ? WHERE id = ?`).run(next, contact.id)
  res.json({ ok: true, name: contact.full_name, next_action_at: next, days })
})

/**
 * GET /api/leads/pipeline?clientId=&verticalId= — counts by stage.
 * The scoreboard: where everyone actually is, and what's overdue.
 */
router.get('/pipeline', (req, res) => {
  const clientId = String(req.query.clientId || '')
  const verticalId = String(req.query.verticalId || '')
  if (!clientId) return res.status(400).json({ error: 'clientId required' })
  const scope = verticalId ? 'AND o.vertical_id = ?' : ''
  const args = verticalId ? [clientId, verticalId] : [clientId]

  const rows = db.prepare(`
    SELECT c.stage, COUNT(*) AS n
    FROM dl_contacts c JOIN dl_organizations o ON o.id = c.organization_id
    WHERE o.client_id = ? ${scope} AND COALESCE(c.suppressed,0) = 0
    GROUP BY c.stage
  `).all(...args) as any[]

  const overdue = db.prepare(`
    SELECT COUNT(*) AS n
    FROM dl_contacts c JOIN dl_organizations o ON o.id = c.organization_id
    WHERE o.client_id = ? ${scope} AND COALESCE(c.suppressed,0) = 0
      AND c.next_action_at IS NOT NULL AND c.next_action_at <= unixepoch()
  `).get(...args) as any

  const by: Record<string, number> = {}
  for (const r of rows) by[r.stage || 'new'] = r.n
  res.json({ by_stage: by, overdue: overdue?.n ?? 0 })
})

/**
 * GET /api/leads/today — the day's work queue.
 *
 * Replaces hand-pulling a list out of the database. Serves the highest-priority
 * uncontacted leads, split by the channel that can actually reach them:
 * senior roles get InMail (they rarely accept cold connects), everyone else
 * gets a connection request. Also reports what's already gone out today so the
 * UI can hold the daily cap — exceeding LinkedIn's limit gets the account
 * restricted, which ends the campaign rather than slowing it.
 */
router.get('/today', (req, res) => {
  const clientId = String(req.query.clientId || '')
  const verticalId = String(req.query.verticalId || '')
  if (!clientId) return res.status(400).json({ error: 'clientId required' })

  // Per-segment DM quota. DM is now the primary channel: in practice every
  // Sales Navigator lead worked so far has been reachable by direct message,
  // and DMs carry no daily ceiling — so the old "senior roles get InMail"
  // split was rationing a resource that wasn't scarce and spending InMail
  // credits that weren't needed.
  const dmCap = Math.min(Math.max(parseInt(String(req.query.dms ?? '30'), 10) || 30, 1), 200)
  const connectCap = Math.min(Math.max(parseInt(String(req.query.connects ?? '20'), 10) || 20, 0), 50)

  const scope = verticalId ? 'AND o.vertical_id = ?' : ''
  const scopeArgs = verticalId ? [verticalId] : []

  const available = `
    FROM dl_contacts c
    JOIN dl_organizations o ON o.id = c.organization_id
    WHERE o.client_id = ? ${scope}
      AND COALESCE(c.outreach_status, 'not_contacted') = 'not_contacted'
      AND COALESCE(c.suppressed, 0) = 0
      AND c.linkedin_url != ''
  `
  const cols = `c.id, c.full_name, c.role, c.linkedin_url, c.priority_score, o.name AS company`

  // ── Follow-ups FIRST ──────────────────────────────────────────────────────
  // Replies cluster at touches 3-5, so returning to people already contacted
  // beats adding new ones. Worked in due-date order (most overdue first) — a
  // follow-up that slides a week has lost most of its value.
  const dueCols = `${cols}, c.stage, c.touches, c.next_action_at, c.outreach_channel`
  const due = db.prepare(`
    SELECT ${dueCols}
    FROM dl_contacts c
    JOIN dl_organizations o ON o.id = c.organization_id
    WHERE o.client_id = ? ${scope}
      AND COALESCE(c.suppressed, 0) = 0
      AND c.next_action_at IS NOT NULL
      AND c.next_action_at <= unixepoch()
      AND c.stage IN (${ACTIVE_STAGES.map(() => '?').join(',')})
    ORDER BY c.next_action_at ASC, c.priority_score DESC
    LIMIT ?
  `).all(clientId, ...scopeArgs, ...ACTIVE_STAGES, dmCap)

  // New contacts top the day up to the quota — never at the expense of a
  // follow-up that's already owed.
  const newCap = Math.max(0, dmCap - due.length)
  const queue = newCap
    ? db.prepare(
        `SELECT ${cols}, CASE WHEN ${SENIOR_SQL} THEN 1 ELSE 0 END AS senior
         ${available} AND c.stage = 'new'
         ORDER BY c.priority_score DESC, c.full_name LIMIT ?`,
      ).all(clientId, ...scopeArgs, newCap)
    : []

  // Sent today, by channel — drives the "12 / 20 done" progress in the UI.
  // Counted per-channel with LIKE rather than GROUP BY, because a contact can
  // carry several channels ("connect,dm") and must count toward EACH of them:
  // the 20/day ceiling that gets accounts restricted is specifically on
  // connection requests, so a connect+DM has to score against the connect cap.
  const chExpr = `',' || COALESCE(NULLIF(c.outreach_channel, ''), 'connect') || ','`
  const countCh = (name: string) =>
    `SUM(CASE WHEN ${chExpr} LIKE '%,${name},%' THEN 1 ELSE 0 END)`
  const sentToday = db.prepare(`
    SELECT
      ${countCh('connect')} AS connect,
      ${countCh('inmail')}  AS inmail,
      ${countCh('dm')}      AS dm,
      ${countCh('email')}   AS email,
      COUNT(*)              AS people
    FROM dl_contacts c
    JOIN dl_organizations o ON o.id = c.organization_id
    WHERE o.client_id = ? ${scope}
      AND c.outreach_status = 'messaged'
      AND c.outreach_sent_at >= unixepoch('now', 'start of day')
  `).get(clientId, ...scopeArgs) as any

  const remaining = db.prepare(`SELECT COUNT(*) AS n ${available}`).get(clientId, ...scopeArgs) as any

  // ⚠️ ACCOUNT-WIDE connect count — deliberately unscoped by client or vertical.
  // LinkedIn rate-limits the ACCOUNT, not the campaign. Running four segments
  // each showing "0/20 connects" would invite 80 requests in a day and get the
  // account restricted, which ends every campaign at once rather than slowing
  // one. This is the number that actually governs the day.
  const accountConnects = db.prepare(`
    SELECT ${countCh('connect')} AS connect, ${countCh('dm')} AS dm, COUNT(*) AS people
    FROM dl_contacts c
    WHERE c.outreach_status = 'messaged'
      AND c.outreach_sent_at >= unixepoch('now', 'start of day')
  `).get() as any

  const connectsLeft = Math.max(0, connectCap - (accountConnects?.connect || 0))

  res.json({
    caps: { dms: dmCap, connects: connectCap },
    // This segment's progress.
    sent_today: {
      connect: sentToday?.connect || 0,
      inmail:  sentToday?.inmail  || 0,
      dm:      sentToday?.dm      || 0,
      email:   sentToday?.email   || 0,
      // People contacted, not touches — connect+DM on one person is one person.
      people:  sentToday?.people  || 0,
      total:   sentToday?.people  || 0,
    },
    // The whole LinkedIn account, every segment. `connects_left` is the only
    // number that should ever gate sending a connection request.
    account_today: {
      connect: accountConnects?.connect || 0,
      dm:      accountConnects?.dm      || 0,
      people:  accountConnects?.people  || 0,
      connects_left: connectsLeft,
      connect_cap_hit: connectsLeft === 0,
    },
    remaining_in_list: remaining?.n ?? 0,
    due,
    queue,
  })
})

export default router
