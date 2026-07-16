/**
 * Contact Magnetism enrichment — global, owner-scoped.
 *
 * Mounted at /api/enrich. Receives per-person context captured passively by the
 * βWave browser extension from a LinkedIn profile the user is actively viewing
 * (recent posts, own bio, genuine mutual connections, published links) and
 * attaches it to the matching dl_contacts row — wherever it lives, across every
 * client/vertical. Matches by normalized LinkedIn URL first, then falls back to
 * name + company (stored contact URLs are often Sales Nav lead URLs, while the
 * enrichment comes from a regular /in/ profile page, so URL alone won't match).
 *
 * Ethos: this grounds a message in something TRUE about a specific human. It
 * never sends anything, never fabricates familiarity, never bulk-harvests — one
 * profile, one moment of attention. See project-bwave-positioning (Human Contact).
 */
import { Router } from 'express'
import db from '../db.js'

const router = Router()

/** Strip a LinkedIn URL down to its stable identity slug for matching. */
function normalizeLinkedIn(url: string): string {
  if (!url) return ''
  const u = url.toLowerCase().trim()
  // Regular profile: linkedin.com/in/<slug>
  const inMatch = u.match(/linkedin\.com\/in\/([^/?#]+)/)
  if (inMatch) return `in:${inMatch[1]}`
  // Sales Navigator lead: linkedin.com/sales/lead/<id>,...
  const leadMatch = u.match(/linkedin\.com\/sales\/(?:lead|people)\/([^,/?#]+)/)
  if (leadMatch) return `lead:${leadMatch[1]}`
  return u.replace(/[?#].*$/, '').replace(/\/$/, '')
}

interface EnrichItem {
  linkedin_url?: string
  name?: string
  company?: string
  context: {
    headline?: string
    about?: string
    recent_posts?: { text: string; when?: string }[]
    mutual_connections?: string[]
    shared?: string[]        // shared groups / school / past employer
    links?: string[]         // links they chose to publish on their profile
    location?: string
    captured_from?: string   // the URL it was captured from
  }
}

router.post('/', (req, res) => {
  const { items } = req.body as { items: EnrichItem[] }
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'items[] required' })
  }

  // Pull every contact once, build a lookup by normalized URL + by name|company.
  const contacts = db.prepare(`
    SELECT c.id, c.full_name, c.linkedin_url, o.name AS company
    FROM dl_contacts c JOIN dl_organizations o ON o.id = c.organization_id
  `).all() as any[]

  const byUrl = new Map<string, string>()
  const byNameCompany = new Map<string, string>()
  for (const c of contacts) {
    const nu = normalizeLinkedIn(c.linkedin_url || '')
    if (nu) byUrl.set(nu, c.id)
    if (c.full_name) {
      byNameCompany.set(`${c.full_name.toLowerCase().trim()}|${(c.company || '').toLowerCase().trim()}`, c.id)
      byNameCompany.set(c.full_name.toLowerCase().trim(), c.id) // looser name-only fallback
    }
  }

  const now = Math.floor(Date.now() / 1000)
  const update = db.prepare(`UPDATE dl_contacts SET contact_context = ?, context_captured_at = ? WHERE id = ?`)

  let matched = 0
  const unmatched: { name?: string; company?: string; linkedin_url?: string }[] = []

  db.exec('BEGIN')
  try {
    for (const item of items) {
      const nu = normalizeLinkedIn(item.linkedin_url || '')
      let contactId = nu ? byUrl.get(nu) : undefined
      if (!contactId && item.name) {
        const key = `${item.name.toLowerCase().trim()}|${(item.company || '').toLowerCase().trim()}`
        contactId = byNameCompany.get(key) || byNameCompany.get(item.name.toLowerCase().trim())
      }
      if (!contactId) {
        unmatched.push({ name: item.name, company: item.company, linkedin_url: item.linkedin_url })
        continue
      }
      update.run(JSON.stringify(item.context || {}), now, contactId)
      matched++
    }
    db.exec('COMMIT')
  } catch (e: any) {
    db.exec('ROLLBACK')
    return res.status(500).json({ error: e.message })
  }

  res.json({ matched, unmatched_count: unmatched.length, unmatched })
})

export default router
