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

export default router
