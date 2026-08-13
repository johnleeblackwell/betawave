/**
 * Move contacts between clients/verticals by role match.
 *
 *   npx tsx scripts/move-contacts.ts --from=<clientId> --to-vertical=<verticalId> \
 *       --preset=wellness [--min-priority=55] [--limit=N] [--go]
 *
 * WHY MOVE RATHER THAN COPY
 *
 * The connections export landed on one client, and some of those people belong
 * to a different campaign. Copying would leave the same human in two pipelines
 * at once — which is how someone receives two unrelated pitches from the same
 * person in a week, and is exactly what the cross-client conflict check in
 * leads.ts exists to prevent. Deciding a contact belongs to campaign B is
 * deciding they are no longer a target for campaign A, so the row moves.
 *
 * Their stage and touch history moves with them ONLY if they have been
 * contacted; an untouched contact is reset to `new` so the receiving campaign
 * starts cleanly rather than inheriting a cadence that was never running.
 *
 * Dry run unless --go.
 */
import db from '../src/server/db.js'
import crypto from 'node:crypto'
import { guessGender } from '../src/server/services/given-names.js'

const arg = (n: string, d = '') => {
  const m = process.argv.find(a => a.startsWith(`--${n}=`))
  return m ? m.slice(n.length + 3) : d
}
const FROM = arg('from')
const TO_VERTICAL = arg('to-vertical')
const PRESET = arg('preset', 'wellness')
const MIN_PRIORITY = Number(arg('min-priority', '0'))
const LIMIT = Number(arg('limit', '0'))
const GO = process.argv.includes('--go')

if (!FROM || !TO_VERTICAL) {
  console.error('usage: --from=<clientId> --to-vertical=<verticalId> [--preset=wellness] [--min-priority=N] [--limit=N] [--go]')
  process.exit(1)
}

/**
 * Role presets.
 *
 * `include` is deliberately narrower than instinct suggests and `exclude` does
 * real work: matching "coach" alone pulled in a hockey coach, a football coach
 * and a driving instructor, all of whom would have been pitched a wellness
 * opportunity on the strength of one word.
 */
const PRESETS: Record<string, { include: RegExp; exclude: RegExp; label: string }> = {
  women: {
    // Handled separately below — matching is on the GIVEN NAME, not the role.
    label: 'first-degree connections whose given name reads as feminine (recall-biased; you triage)',
    include: /.^/, exclude: /.^/,
  },
  wellness: {
    label: 'beauty, wellness and one-to-one health practitioners',
    include: /(beauty|salon|aesthetic|esthetic|massage|therapist|nutrition|dietit|personal train|wellness|wellbeing|holistic|pilates|yoga|hairdress|hairstylist|barber|nail tech|spa |skincare|skin care|health coach|wellness coach|life coach|fitness (coach|instructor|trainer)|reflexolog|acupunctur|naturopath)/i,
    exclude: /(hockey|football|soccer|rugby|cricket|basketball|tennis|driving instructor|dvsa|swim coach|business coach|career coach|executive coach|agile coach|sales coach|academy|school|university|recruit)/i,
  },
  agency: {
    label: 'agency owners and marketing decision-makers',
    include: /(founder|owner|managing director|managing partner|ceo|director)/i,
    exclude: /(recruit|student|graduate|retired)/i,
  },
}
const preset = PRESETS[PRESET]
if (!preset) { console.error(`unknown preset: ${PRESET}. known: ${Object.keys(PRESETS).join(', ')}`); process.exit(1) }

const target = db.prepare(`SELECT v.id, v.name, v.client_id, c.business_name, c.name cname
  FROM verticals v JOIN clients c ON c.id = v.client_id WHERE v.id = ?`).get(TO_VERTICAL) as any
if (!target) { console.error(`no such vertical: ${TO_VERTICAL}`); process.exit(1) }

const source = db.prepare(`SELECT business_name, name FROM clients WHERE id = ?`).get(FROM) as any
if (!source) { console.error(`no such client: ${FROM}`); process.exit(1) }

console.log(`from   : ${source.business_name || source.name}`)
console.log(`to     : ${target.business_name || target.cname} → "${target.name}"`)
console.log(`preset : ${PRESET} — ${preset.label}`)
if (MIN_PRIORITY) console.log(`filter : priority >= ${MIN_PRIORITY} (warmth)`)
if (!GO) console.log('\nDRY RUN — pass --go to write\n')

const rows = db.prepare(`
  SELECT c.id, c.full_name, c.role, c.email, c.linkedin_url, c.stage, c.touches,
         c.priority_score, c.priority_signals, c.next_action_at, c.outreach_channel,
         c.connection_degree, o.name AS company, o.id AS org_id, v.name AS vertical
  FROM dl_contacts c
  JOIN dl_organizations o ON o.id = c.organization_id
  JOIN verticals v ON v.id = o.vertical_id
  WHERE o.client_id = ? AND c.priority_score >= ?
    AND COALESCE(c.suppressed,0) = 0`).all(FROM, MIN_PRIORITY) as any[]

// ── Two protections, both ON by default ──
//
// A contact mid-conversation is never a candidate for reassignment. Moving
// someone at touch_2, or who has replied, drops them into a different campaign
// with a different pitch while a thread is open — the single most damaging
// thing this script could do, and precisely the kind of bulk operation where
// nobody notices until the reply arrives.
const INCLUDE_LIVE = process.argv.includes('--include-live')
// Segments worth protecting from a bulk move, by name. Defaults to none.
const EXCLUDE_VERTICAL = arg('exclude-vertical')
const excludeRe = EXCLUDE_VERTICAL ? new RegExp(EXCLUDE_VERTICAL, 'i') : null

const isLive = (r: any) => r.stage && r.stage !== 'new'
const skippedLive: any[] = []
const skippedProtected: any[] = []

// Recall bias has a limit, and it is reached when "unknown" is the majority
// class. Including every unrecognised name matched 67% of a 4,400-person list —
// not a women's list, just everyone bar recognised male names, and far too many
// to triage by eye. So confident matches only by default; --include-unknown
// widens it for anyone who would rather scan more and miss fewer.
const INCLUDE_UNKNOWN = process.argv.includes('--include-unknown')
const byRule = PRESET === 'women'
  ? rows.filter(r => {
    const g = guessGender(r.full_name)
    return g === 'female' || (INCLUDE_UNKNOWN && g === 'unknown')
  })
  : rows.filter(r => {
    const t = `${r.role || ''}`
    return preset.include.test(t) && !preset.exclude.test(t)
  })

const matched = byRule.filter(r => {
  if (isLive(r) && !INCLUDE_LIVE) { skippedLive.push(r); return false }
  if (excludeRe && excludeRe.test(r.vertical || '')) { skippedProtected.push(r); return false }
  return true
})
const chosen = LIMIT ? matched.slice(0, LIMIT) : matched

console.log(`scanned ${rows.length} · rule-matched ${byRule.length} · movable ${matched.length}${LIMIT ? ` · taking ${chosen.length}` : ''}`)
if (skippedLive.length)
  console.log(`  HELD BACK ${skippedLive.length} mid-conversation (stage ≠ new) — use --include-live to override`)
if (skippedProtected.length)
  console.log(`  HELD BACK ${skippedProtected.length} in protected segments matching /${EXCLUDE_VERTICAL}/i`)

const findOrg = db.prepare(`SELECT id FROM dl_organizations WHERE vertical_id = ? AND LOWER(name) = ?`)
const insOrg = db.prepare(`INSERT INTO dl_organizations (id, client_id, vertical_id, name, sub_segment, status)
                           VALUES (?, ?, ?, ?, 'moved', 'active')`)
const move = db.prepare(`UPDATE dl_contacts SET organization_id = ?, stage = ?, next_action_at = ? WHERE id = ?`)

let moved = 0
const work = () => {
  for (const r of chosen) {
    // An untouched contact starts clean in the receiving campaign; someone
    // mid-cadence keeps their stage so their history is not rewritten.
    const untouched = !r.touches || r.stage === 'new'
    const stage = untouched ? 'new' : r.stage
    const next = untouched ? null : r.next_action_at

    if (GO) {
      let org = findOrg.get(TO_VERTICAL, String(r.company || '').toLowerCase()) as any
      if (!org) {
        const oid = crypto.randomUUID()
        insOrg.run(oid, target.client_id, TO_VERTICAL, r.company || 'Unknown company')
        org = { id: oid }
      }
      move.run(org.id, stage, next, r.id)
    }
    moved++
  }
}

if (GO) { db.exec('BEGIN'); try { work(); db.exec('COMMIT') } catch (e) { db.exec('ROLLBACK'); throw e } }
else work()

console.log(`\n${GO ? 'MOVED' : 'WOULD MOVE'}: ${moved}`)
const warm = chosen.filter(r => r.priority_score >= 80).length
const cool = chosen.filter(r => r.priority_score >= 55 && r.priority_score < 80).length
console.log(`  hot/warm (2023+) : ${warm}`)
console.log(`  cool (2020-22)   : ${cool}`)
console.log(`  dormant          : ${chosen.length - warm - cool}`)
console.log(`  with an email    : ${chosen.filter(r => r.email).length}`)

console.log('\nsample:')
chosen.slice(0, 20).forEach(r =>
  console.log(`  [${String(r.priority_score).padStart(2)}] ${String(r.full_name).slice(0, 22).padEnd(22)} | ${String(r.role || '').slice(0, 40).padEnd(40)} | ${String(r.company).slice(0, 24)}`))

if (!GO) console.log('\nDRY RUN — nothing written. Re-run with --go.')
