/**
 * Mark everyone in a LinkedIn connections export as 1st degree.
 *
 *   npx tsx scripts/backfill-degree-from-export.ts --file=Connections.csv [--go]
 *
 * WHY
 *
 * Connections.csv contains first-degree connections and nothing else — that is
 * what the file IS. So membership of it is proof of degree, not evidence toward
 * a guess, and it is better proof than anything the extension reads off a page,
 * because it comes from LinkedIn's own record of the account.
 *
 * The import that created contacts from this file already set degree 1 on the
 * rows it inserted. What it could not do was fix rows it SKIPPED: a contact
 * already captured from Sales Navigator is deduplicated rather than
 * re-imported, and keeps whatever degree it had — usually none. Those are
 * precisely the rows the work queue was left guessing about, and the guess was
 * wrong often enough to put unreachable people in a day's list.
 *
 * Matching mirrors the importer: LinkedIn lead id, then email, then name plus
 * company. Never downgrades anyone — it only ever sets degree 1, so running it
 * twice is harmless and a later export simply widens the set.
 */
import fs from 'node:fs'
import db from '../src/server/db.js'
import { parseCsvObjects, pick, firstEmail } from '../src/server/services/csv.js'
import { leadIdFromUrl } from '../src/server/routes/leads.js'

const arg = (n: string) => {
  const m = process.argv.find(a => a.startsWith(`--${n}=`))
  return m ? m.slice(n.length + 3) : ''
}
const FILE = arg('file')
const GO = process.argv.includes('--go')
if (!FILE) { console.error('usage: --file=Connections.csv [--go]'); process.exit(1) }

function stripPreamble(csv: string): string {
  const lines = csv.split(/\r?\n/)
  const i = lines.findIndex(l => /first\s*name/i.test(l) && /last\s*name/i.test(l))
  return i > 0 ? lines.slice(i).join('\n') : csv
}

const rows = parseCsvObjects(stripPreamble(fs.readFileSync(FILE, 'utf8')))
console.log(`rows in export: ${rows.length}`)

const personKey = (name: string, company: string) =>
  `${String(name || '').toLowerCase().replace(/[^a-z ]/g, '').trim()}|` +
  `${String(company || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim()}`

// Index the export three ways, same as the importer.
const byLead = new Set<string>()
const byEmail = new Set<string>()
const byPerson = new Set<string>()
for (const r of rows) {
  const name = `${pick(r, 'first_name', 'firstname', 'first')} ${pick(r, 'last_name', 'lastname', 'last')}`.trim()
  const company = pick(r, 'company', 'company_name') || 'Unknown company'
  const url = pick(r, 'url', 'profile_url', 'linkedin_url')
  const email = firstEmail(pick(r, 'email_address', 'email'))
  const lid = url ? leadIdFromUrl(url) : null
  if (lid) byLead.add(lid)
  if (email) byEmail.add(email.toLowerCase())
  if (name) byPerson.add(personKey(name, company))
}
console.log(`indexed: ${byLead.size} lead ids · ${byEmail.size} emails · ${byPerson.size} people`)

const contacts = db.prepare(`
  SELECT c.id, c.full_name, c.email, c.linkedin_url, c.connection_degree, c.outreach_channel,
         c.stage, o.name AS company, cl.business_name AS campaign
  FROM dl_contacts c
  JOIN dl_organizations o ON o.id = c.organization_id
  JOIN clients cl ON cl.id = o.client_id`).all() as any[]

const upd = db.prepare(`UPDATE dl_contacts
  SET connection_degree = 1, degree_seen_at = unixepoch() WHERE id = ?`)

/**
 * --demote: the export is authoritative in BOTH directions.
 *
 * If someone is absent from Connections.csv they are not a first-degree
 * connection, so a 'dm' channel tag on their record cannot mean what the queue
 * was reading it to mean — it means an InMail was sent into a pending request.
 * Leaving them at unknown degree kept them in the work queue on a guess that
 * this very export disproves.
 *
 * Only touches rows with NO recorded degree, so nothing verified is overwritten
 * and a genuine first-degree contact captured some other way is left alone. The
 * one blind spot is anyone connected AFTER the export was generated; they
 * correct themselves the moment their profile is opened, since the extension
 * records the degree it reads.
 */
const DEMOTE = process.argv.includes('--demote')
const dem = db.prepare(`UPDATE dl_contacts
  SET connection_degree = 2, degree_seen_at = unixepoch() WHERE id = ?`)
let demoted = 0
const demotedRows: any[] = []

let already1 = 0, willSet = 0, notInExport = 0, contradicted = 0
const changed: any[] = []

const work = () => {
  for (const c of contacts) {
    const lid = c.linkedin_url ? leadIdFromUrl(c.linkedin_url) : null
    const inExport =
      (lid && byLead.has(lid)) ||
      (c.email && byEmail.has(String(c.email).toLowerCase())) ||
      byPerson.has(personKey(c.full_name, c.company))

    if (!inExport) {
      notInExport++
      if (DEMOTE && c.connection_degree == null) {
        demoted++
        demotedRows.push(c)
        if (GO) dem.run(c.id)
      }
      continue
    }
    if (Number(c.connection_degree) === 1) { already1++; continue }
    // Worth surfacing: the page said 2nd but the export says connected. Almost
    // always means the request was accepted after the page was read.
    if (Number(c.connection_degree) === 2 || Number(c.connection_degree) === 3) contradicted++
    willSet++
    changed.push(c)
    if (GO) upd.run(c.id)
  }
}

if (GO) { db.exec('BEGIN'); try { work(); db.exec('COMMIT') } catch (e) { db.exec('ROLLBACK'); throw e } }
else work()

console.log(`\n${GO ? 'SET' : 'WOULD SET'} degree = 1 on ${willSet} contacts`)
console.log(`  already marked 1st  : ${already1}`)
console.log(`  not in this export  : ${notInExport}  (genuinely 2nd/3rd, or never connected)`)
console.log(`  page said 2nd/3rd but export says connected: ${contradicted}  (request accepted since)`)
if (DEMOTE) {
  console.log(`\n${GO ? 'SET' : 'WOULD SET'} degree = 2 on ${demoted} contacts absent from the export`)
  const dm = demotedRows.filter(c => `,${c.outreach_channel || ''},`.includes(',dm,')).length
  console.log(`  of which ${dm} carried a 'dm' tag — the ones the queue was serving as free follow-ups`)
}

if (changed.length) {
  console.log('\nsample of what changes:')
  changed.slice(0, 15).forEach(c => console.log(
    `  ${String(c.full_name).slice(0, 24).padEnd(24)} | was ${String(c.connection_degree ?? 'unknown').padEnd(7)} | ${String(c.campaign).padEnd(10)} | ${c.stage || 'new'}`))
}
if (!GO) console.log('\nDRY RUN — nothing written. Re-run with --go.')
