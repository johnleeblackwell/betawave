/**
 * LinkedIn connections import — the warm list.
 *
 * Mounted at /api/connections.
 *
 * WHY THIS EXISTS
 *
 * Every other lead path in this codebase works INSIDE LinkedIn's constraints:
 * connection degree, InMail credits, the 20-a-day invitation cap. Those
 * constraints only apply to strangers. A 1st-degree connection can be messaged
 * free and without limit, forever — and LinkedIn will hand you the entire list
 * as a CSV, including email addresses for the connections who chose to share
 * them.
 *
 * So the cheapest, warmest and least rate-limited list available is the one
 * already accepted. It needs no scraping, no credits, no Sales Navigator seat,
 * and it arrives with the connection DATE, which is itself a signal: someone
 * who connected last month remembers you; someone from 2014 needs reminding.
 *
 * The file is `Connections.csv` from Settings → Data privacy → Get a copy of
 * your data → Connections. Its first three lines are a preamble ("Notes:",
 * blank, then the real header), which is why this cannot use the generic
 * importer unchanged.
 */
import { Router } from 'express'
import crypto from 'node:crypto'
import db from '../db.js'
import { parseCsvObjects, pick, firstEmail } from '../services/csv.js'
import { leadIdFromUrl } from './leads.js'

const router = Router({ mergeParams: true })

/** Strip LinkedIn's preamble so the real header row is first. */
function stripPreamble(csv: string): string {
  const lines = csv.split(/\r?\n/)
  const i = lines.findIndex(l => /first\s*name/i.test(l) && /last\s*name/i.test(l))
  return i > 0 ? lines.slice(i).join('\n') : csv
}

/**
 * Segmentation for the connections list.
 *
 * ── THE SEGMENT IS THE MESSAGE ──
 *
 * The earlier version of this sorted people by INDUSTRY, which was the right
 * shape when the product was sold as a £3.4k/month done-for-you retainer: at
 * that price the only question worth asking about a lead is "can they afford
 * it?", and industry proxies for that.
 *
 * At a $200 install and a $600 setup, affordability stops discriminating —
 * everyone on a 4,000-person professional network can pay $200. So sorting by
 * industry buys nothing, and the useful question becomes "what would this
 * person USE it for?", because that is the only thing the opening line has to
 * get right. Each bucket below corresponds to exactly one pitch:
 *
 *   Agency owners        → white-label it, bill your clients, keep the margin
 *   Founders & owners    → own the stack instead of renting five subscriptions
 *   Marketing leaders    → same output, minus the SaaS line items
 *   Sales leaders        → Reach on its own: pipeline, not posts
 *   Consultants & coaches→ a marketing department for a one-person business
 *   Creators & publishers→ Produce: the content engine, in your own voice
 *   Technical            → AGPL, self-hosted, here is the repo
 *   Property             → multi-branch, listings-led, relentless local content
 *   Recruiters           → content plus outbound is the whole job
 *
 * Ordering matters — first match wins, so specific tests sit above general
 * ones. Deliberately coarse and readable rather than clever: a wrong bucket is
 * fixed in seconds, whereas an opaque classifier misfiles people silently and
 * is only discovered after they have been pitched the wrong thing.
 */
export function segmentFor(position: string, company: string): string {
  const p = String(position || '').toLowerCase()
  const cn = String(company || '').toLowerCase()
  if (!`${p}${cn}`.trim()) return 'Unknown role'

  // Nobody trading is nobody to pitch. Checked first so a "student founder"
  // lands in the park bucket rather than the owners one.
  if (/\b(student|graduate|intern|seeking|open to work|unemployed|retired)\b/.test(`${p} ${cn}`))
    return 'Not trading — park'

  // Whether someone runs an AGENCY is a fact about their COMPANY, not about
  // the word "marketing" appearing in their title. Testing the combined string
  // filed a VP of Marketing at a logistics firm as an agency — which would
  // have offered her a white-label reseller deal for clients she does not have.
  const agencyCo = /\b(agency|agencies|studio|creative|advertis|marketing|digital|media|design|comms|communications|consultancy|pr|seo|web)\b/.test(cn)
  const boss = /\b(founder|co-?founder|owner|proprietor|principal|managing director|managing partner|ceo|chief executive|president|partner|director)\b/.test(p)

  if (/\b(recruit|talent acquisition|headhunt|staffing)\b/.test(`${p} ${cn}`)) return 'Recruiters — content engine'
  if (agencyCo && boss) return 'Agency owners — white-label'
  if (/\b(cmo|chief marketing|vp of marketing|vp marketing|head of marketing|marketing director|marketing manager|brand manager|head of brand|head of content|head of growth|growth lead)\b/.test(p))
    return 'Marketing leaders — replace the stack'
  if (/\b(sales director|head of sales|vp sales|vp of sales|business development|commercial director|sales manager|revenue officer|cro)\b/.test(p))
    return 'Sales leaders — pipeline'
  if (/\b(cto|chief technology|engineer|developer|software|devops|architect|data scientist|technical director|head of engineering|programmer)\b/.test(p))
    return 'Technical — self-hosters'
  // Property is the one industry bucket that survives, because it is the only
  // multi-branch, face-to-face cluster of any size in this particular network.
  if (/\b(estate agent|lettings|property|realtor|real estate|surveyor|housebuild|residential sales)\b/.test(`${p} ${cn}`))
    return 'Property & estate agency'
  // People who already publish for a living need the Produce module and
  // nothing else explained to them.
  if (/\b(writer|author|copywriter|editor|journalist|podcast|host|creator|speaker|producer|blogger|content)\b/.test(p))
    return 'Creators & publishers'
  if (/\b(consultant|freelance|coach|mentor|trainer|advisor|adviser|self-employed|fractional)\b/.test(p))
    return 'Consultants & coaches'
  if (/\b(professor|lecturer|teacher|academic|researcher|trustee|councillor|member of parliament|civil service)\b/.test(p))
    return 'Academia & public sector — park'
  if (boss) return 'Founders & owners'
  if (agencyCo) return 'Agency staff'
  if (/\b(manager|lead|specialist|executive|officer|analyst|assistant|coordinator|co-ordinator|associate|supervisor|head)\b/.test(p))
    return 'Employed — low priority'
  return 'Unsorted'
}

/**
 * Warmth from the connection date, expressed as the priority score.
 *
 * "1st degree" is not the same as "warm". Over half of this network was
 * connected in 2017–18 during what was evidently a mass-connect phase; those
 * people do not remember John, and opening as though they do is worse than
 * opening cold because it invites "who are you?" rather than a reply. Recency
 * is the only warmth signal the export actually carries, so it drives priority
 * and the working queue orders by it.
 */
export function warmthScore(connectedOn: string): { tier: string; score: number } {
  const m = /(\d{4})/.exec(String(connectedOn || ''))
  const y = m ? Number(m[1]) : 0
  if (y >= 2025) return { tier: 'hot', score: 95 }
  if (y >= 2023) return { tier: 'warm', score: 80 }
  if (y >= 2020) return { tier: 'cool', score: 55 }
  return { tier: 'dormant', score: 25 }
}

/**
 * POST /import — body: { clientId, csv, dry_run?, segment_prefix? }
 *
 * Creates one vertical per detected segment and files each connection into it,
 * so the list arrives already sorted by what they might plausibly want rather
 * than as an undifferentiated heap of several thousand names.
 */
router.post('/import', (req, res) => {
  const clientId = String(req.body?.clientId || '')
  const csvRaw = String(req.body?.csv || '')
  const dryRun = !!req.body?.dry_run
  const prefix = String(req.body?.segment_prefix || 'LinkedIn').trim()

  if (!clientId) return res.status(400).json({ error: 'clientId required' })
  if (!csvRaw.trim()) return res.status(400).json({ error: 'csv required' })
  const client = db.prepare(`SELECT id FROM clients WHERE id = ?`).get(clientId)
  if (!client) return res.status(404).json({ error: 'Client not found' })

  const rows = parseCsvObjects(stripPreamble(csvRaw))
  if (!rows.length) return res.status(400).json({ error: 'no rows found — is this the Connections.csv from the LinkedIn export?' })

  // Identity across the whole database, by LinkedIn lead id then by email.
  // Someone already being worked keeps their existing record, stage and touch
  // history — importing a second copy is how a booked call ended up back in a
  // cold queue once already.
  const knownLeadIds = new Set<string>()
  const knownEmails = new Set<string>()
  const knownPeople = new Set<string>()

  // Three keys, because no single one spans both sources. The export gives a
  // vanity URL (/in/charlieblower); a Sales Navigator capture stores an opaque
  // lead id (/sales/lead/ACwAAA...). leadIdFromUrl yields DIFFERENT ids for the
  // same human, so lead-id matching alone re-imports everyone already captured
  // — including a contact with a call already booked. Name plus company closes
  // that gap: two people of the same name at the same company is vanishingly
  // rare, and a false match costs one missed import, whereas a false miss costs
  // a duplicate of a live conversation.
  const personKey = (name: string, company: string) =>
    `${String(name || '').toLowerCase().replace(/[^a-z ]/g, '').trim()}|` +
    `${String(company || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim()}`

  for (const r of db.prepare(
    `SELECT c.linkedin_url, c.email, c.full_name, o.name AS company
     FROM dl_contacts c JOIN dl_organizations o ON o.id = c.organization_id`,
  ).all() as any[]) {
    const id = r.linkedin_url ? leadIdFromUrl(r.linkedin_url) : null
    if (id) knownLeadIds.add(id)
    if (r.email) knownEmails.add(String(r.email).toLowerCase())
    if (r.full_name) knownPeople.add(personKey(r.full_name, r.company))
  }

  const findVertical = db.prepare(`SELECT id FROM verticals WHERE client_id = ? AND name = ?`)
  const insertVertical = db.prepare(
    `INSERT INTO verticals (id, client_id, slug, name, description, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', unixepoch())`)
  const findOrg = db.prepare(`SELECT id FROM dl_organizations WHERE vertical_id = ? AND LOWER(name) = ?`)
  const insertOrg = db.prepare(
    `INSERT INTO dl_organizations (id, client_id, vertical_id, name, sub_segment)
     VALUES (?, ?, ?, ?, 'linkedin-connection')`)
  const insertContact = db.prepare(
    `INSERT INTO dl_contacts
       (id, organization_id, full_name, role, email, linkedin_url, source, source_confidence,
        connection_degree, degree_seen_at, gdpr_basis, priority_score, priority_signals)
     VALUES (?, ?, ?, ?, ?, ?, 'linkedin-export', 0.95, 1, unixepoch(), ?, ?, ?)`)

  const bySegment: Record<string, number> = {}
  const byWarmth: Record<string, number> = {}
  let imported = 0, skippedExisting = 0, skippedEmpty = 0, withEmail = 0
  const samples: any[] = []

  const work = () => {
    for (const row of rows) {
      const first = pick(row, 'first_name', 'firstname', 'first')
      const last = pick(row, 'last_name', 'lastname', 'last')
      const name = `${first} ${last}`.trim()
      if (!name) { skippedEmpty++; continue }

      const email = firstEmail(pick(row, 'email_address', 'email'))
      const company = pick(row, 'company', 'company_name') || 'Unknown company'
      const position = pick(row, 'position', 'title', 'job_title')
      const url = pick(row, 'url', 'profile_url', 'linkedin_url')
      const connectedOn = pick(row, 'connected_on', 'connected')

      const leadId = url ? leadIdFromUrl(url) : null
      if ((leadId && knownLeadIds.has(leadId))
        || (email && knownEmails.has(email.toLowerCase()))
        || knownPeople.has(personKey(name, company))) {
        skippedExisting++
        continue
      }

      const segment = `${prefix} — ${segmentFor(position, company)}`
      const { tier, score } = warmthScore(connectedOn)
      bySegment[segment] = (bySegment[segment] || 0) + 1
      byWarmth[tier] = (byWarmth[tier] || 0) + 1
      if (email) withEmail++
      if (samples.length < 12) samples.push({ name, position, company, email: email || '', segment, connectedOn, warmth: tier })

      if (dryRun) { imported++; continue }

      let v = findVertical.get(clientId, segment) as any
      if (!v) {
        const vid = crypto.randomUUID()
        insertVertical.run(vid, clientId, `li-${segment.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(0, 60),
          segment, 'Imported from the LinkedIn connections export — all 1st degree, free to message.')
        v = { id: vid }
      }
      let org = findOrg.get(v.id, company.toLowerCase()) as any
      if (!org) {
        const oid = crypto.randomUUID()
        insertOrg.run(oid, clientId, v.id, company)
        org = { id: oid }
      }

      // An existing connection is a corporate-subscriber contact in a B2B
      // context and, more to the point, someone who chose to connect. Still
      // recorded explicitly rather than assumed, so the email path can reason
      // about it like any other row.
      insertContact.run(
        crypto.randomUUID(), org.id, name, position, email, url,
        'legitimate_interest', score,
        JSON.stringify({ source: 'linkedin-export', connected_on: connectedOn || null, warmth: tier }),
      )
      if (leadId) knownLeadIds.add(leadId)
      if (email) knownEmails.add(email.toLowerCase())
      knownPeople.add(personKey(name, company))
      imported++
    }
  }

  if (dryRun) work()
  else {
    db.exec('BEGIN')
    try { work(); db.exec('COMMIT') }
    catch (e: any) { db.exec('ROLLBACK'); return res.status(500).json({ error: e.message }) }
  }

  res.json({
    dry_run: dryRun,
    rows_in_file: rows.length,
    imported,
    with_email: withEmail,
    skipped_already_known: skippedExisting,
    skipped_no_name: skippedEmpty,
    segments: Object.fromEntries(Object.entries(bySegment).sort((a, b) => b[1] - a[1])),
    warmth: byWarmth,
    sample: samples,
  })
})

export default router
