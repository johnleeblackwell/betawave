/**
 * Import a LinkedIn Connections.csv from the command line.
 *
 *   npx tsx scripts/import-connections.ts --file=Connections.csv --client=<id> [--go]
 *
 * Dry run by default. Nothing is written until --go is passed, because the last
 * time a connections file went in unchecked it put 769 junk rows into the
 * pipeline and had to be reversed from a backup.
 *
 * Deliberately calls the SAME segmentFor/warmthScore the HTTP route uses rather
 * than reimplementing them — two copies of a classifier drift, and then the
 * segments you inspected are not the segments you imported.
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import db from '../src/server/db.js'
import { parseCsvObjects, pick, firstEmail } from '../src/server/services/csv.js'
import { segmentFor, warmthScore } from '../src/server/routes/connections-import.js'
import { leadIdFromUrl } from '../src/server/routes/leads.js'

const arg = (n: string) => {
  const m = process.argv.find(a => a.startsWith(`--${n}=`))
  return m ? m.slice(n.length + 3) : ''
}
const FILE = arg('file')
const CLIENT = arg('client')
const PREFIX = arg('prefix') || 'LinkedIn'
const GO = process.argv.includes('--go')

if (!FILE || !CLIENT) {
  console.error('usage: --file=Connections.csv --client=<clientId> [--prefix=LinkedIn] [--go]')
  process.exit(1)
}

/** LinkedIn puts a three-line preamble above the real header. */
function stripPreamble(csv: string): string {
  const lines = csv.split(/\r?\n/)
  const i = lines.findIndex(l => /first\s*name/i.test(l) && /last\s*name/i.test(l))
  return i > 0 ? lines.slice(i).join('\n') : csv
}

const rows = parseCsvObjects(stripPreamble(fs.readFileSync(FILE, 'utf8')))
console.log(`rows in file: ${rows.length}`)

const client = db.prepare(`SELECT id, name, business_name FROM clients WHERE id = ?`).get(CLIENT) as any
if (!client) { console.error(`no such client: ${CLIENT}`); process.exit(1) }
console.log(`client: ${client.business_name || client.name}`)

// Identity across the WHOLE database, not just this client. Someone already
// being worked keeps their record, stage and touch history; importing a second
// copy is how a booked call ended up back in a cold queue once already.
const knownLeadIds = new Set<string>()
const knownEmails = new Set<string>()
const knownPeople = new Set<string>()
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
console.log(`already known: ${knownPeople.size} people, ${knownEmails.size} emails`)

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
      connection_degree, degree_seen_at, gdpr_basis, priority_score, priority_signals, stage)
   VALUES (?, ?, ?, ?, ?, ?, 'linkedin-export', 0.95, 1, unixepoch(), 'legitimate_interest', ?, ?, 'new')`)

const bySegment: Record<string, number> = {}
const byWarmth: Record<string, number> = {}
const segWarm: Record<string, Record<string, number>> = {}
let imported = 0, skippedExisting = 0, skippedEmpty = 0, withEmail = 0

const work = () => {
  for (const row of rows) {
    const name = `${pick(row, 'first_name', 'firstname', 'first')} ${pick(row, 'last_name', 'lastname', 'last')}`.trim()
    if (!name) { skippedEmpty++; continue }

    const email = firstEmail(pick(row, 'email_address', 'email'))
    const company = pick(row, 'company', 'company_name') || 'Unknown company'
    const position = pick(row, 'position', 'title', 'job_title')
    const url = pick(row, 'url', 'profile_url', 'linkedin_url')
    const connectedOn = pick(row, 'connected_on', 'connected')

    const leadId = url ? leadIdFromUrl(url) : null
    if ((leadId && knownLeadIds.has(leadId))
      || (email && knownEmails.has(email.toLowerCase()))
      || knownPeople.has(personKey(name, company))) { skippedExisting++; continue }

    const segment = `${PREFIX} — ${segmentFor(position, company)}`
    const { tier, score } = warmthScore(connectedOn)
    bySegment[segment] = (bySegment[segment] || 0) + 1
    byWarmth[tier] = (byWarmth[tier] || 0) + 1
    ;(segWarm[segment] ||= {})[tier] = ((segWarm[segment] || {})[tier] || 0) + 1
    if (email) withEmail++

    if (GO) {
      let v = findVertical.get(CLIENT, segment) as any
      if (!v) {
        const vid = crypto.randomUUID()
        insertVertical.run(vid, CLIENT, `li-${segment.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(0, 60),
          segment, 'LinkedIn connections export — all 1st degree, free to message. Priority = connection recency.')
        v = { id: vid }
      }
      let org = findOrg.get(v.id, company.toLowerCase()) as any
      if (!org) {
        const oid = crypto.randomUUID()
        insertOrg.run(oid, CLIENT, v.id, company)
        org = { id: oid }
      }
      insertContact.run(crypto.randomUUID(), org.id, name, position, email, url, score,
        JSON.stringify({ source: 'linkedin-export', connected_on: connectedOn || null, warmth: tier }))
    }

    knownPeople.add(personKey(name, company))
    if (leadId) knownLeadIds.add(leadId)
    if (email) knownEmails.add(email.toLowerCase())
    imported++
  }
}

if (GO) {
  db.exec('BEGIN')
  try { work(); db.exec('COMMIT') } catch (e) { db.exec('ROLLBACK'); throw e }
} else work()

const W = ['hot', 'warm', 'cool', 'dormant']
console.log(`\n${GO ? 'IMPORTED' : 'WOULD IMPORT'}: ${imported}   (skipped known: ${skippedExisting}, no name: ${skippedEmpty}, with email: ${withEmail})`)
console.log(`\n  ${'SEGMENT'.padEnd(46)}${W.map(w => w.toUpperCase().padStart(9)).join('')}     TOTAL`)
for (const [s, n] of Object.entries(bySegment).sort((a, b) => b[1] - a[1]))
  console.log(`  ${s.padEnd(46)}${W.map(w => String((segWarm[s] || {})[w] || 0).padStart(9)).join('')}  ${String(n).padStart(8)}`)
const workable = (byWarmth.hot || 0) + (byWarmth.warm || 0) + (byWarmth.cool || 0)
console.log(`\n  workable now (2020+): ${workable}`)
console.log(`  dormant (pre-2020):   ${byWarmth.dormant || 0}`)
if (!GO) console.log('\nDRY RUN — nothing written. Re-run with --go to commit.')
