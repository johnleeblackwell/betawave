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
function leadIdFromUrl(url: string): string | null {
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
  const { linkedin_url, channel = 'connect', message } = req.body as
    { linkedin_url?: string; channel?: string; message?: string }
  if (!linkedin_url) return res.status(400).json({ error: 'linkedin_url required' })

  const id = leadIdFromUrl(linkedin_url)
  if (!id) return res.status(400).json({ error: 'Not a recognisable LinkedIn profile URL' })

  const contact = db.prepare(
    `SELECT c.id, c.full_name, c.outreach_status FROM dl_contacts c WHERE c.linkedin_url LIKE ? LIMIT 1`,
  ).get(`%${id}%`) as any
  if (!contact) return res.json({ ok: true, found: false })

  const allowed = ['connect', 'inmail', 'dm', 'email']
  const ch = allowed.includes(channel) ? channel : 'connect'

  db.prepare(`
    UPDATE dl_contacts
    SET outreach_status = 'messaged', outreach_channel = ?, outreach_sent_at = unixepoch(),
        outreach_message = COALESCE(NULLIF(?, ''), outreach_message)
    WHERE id = ?
  `).run(ch, message || '', contact.id)

  res.json({ ok: true, found: true, contact_id: contact.id, name: contact.full_name, channel: ch })
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

  const connectCap = Math.min(Math.max(parseInt(String(req.query.connects ?? '20'), 10) || 20, 1), 50)
  const inmailCap  = Math.min(Math.max(parseInt(String(req.query.inmails  ?? '10'), 10) || 10, 0), 50)

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

  const inmail = db.prepare(
    `SELECT ${cols} ${available} AND ${SENIOR_SQL} ORDER BY c.priority_score DESC, c.full_name LIMIT ?`,
  ).all(clientId, ...scopeArgs, inmailCap)

  const connect = db.prepare(
    `SELECT ${cols} ${available} AND NOT ${SENIOR_SQL} ORDER BY c.priority_score DESC, c.full_name LIMIT ?`,
  ).all(clientId, ...scopeArgs, connectCap)

  // Sent today, by channel — drives the "12 / 20 done" progress in the UI.
  const sentToday = db.prepare(`
    SELECT COALESCE(NULLIF(c.outreach_channel, ''), 'connect') AS channel, COUNT(*) AS n
    FROM dl_contacts c
    JOIN dl_organizations o ON o.id = c.organization_id
    WHERE o.client_id = ? ${scope}
      AND c.outreach_status = 'messaged'
      AND c.outreach_sent_at >= unixepoch('now', 'start of day')
    GROUP BY channel
  `).all(clientId, ...scopeArgs) as any[]

  const remaining = db.prepare(`SELECT COUNT(*) AS n ${available}`).get(clientId, ...scopeArgs) as any

  res.json({
    caps: { connects: connectCap, inmails: inmailCap },
    sent_today: {
      connect: sentToday.find(r => r.channel === 'connect')?.n || 0,
      inmail:  sentToday.find(r => r.channel === 'inmail')?.n  || 0,
      total:   sentToday.reduce((s, r) => s + r.n, 0),
    },
    remaining_in_list: remaining?.n ?? 0,
    inmail,
    connect,
  })
})

export default router
