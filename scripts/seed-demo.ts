/**
 * Populate the demo tenant so it actually demonstrates the product.
 *
 *   npx tsx scripts/seed-demo.ts --client=<id> [--wipe] [--go]
 *
 * WHY THIS EXISTS
 *
 * The demo tenant held 29 content pieces — which were three blog titles
 * repeated weekly by a schedule — and zero verticals, zero organisations, zero
 * contacts. So a prospect logging in saw a third of one pillar, repeating
 * itself. Reach, Respond and Measure appeared to be empty features rather than
 * unbuilt ones, and the duplication read as a bug. A demo that undersells the
 * product is worse than no demo, because the prospect has already formed a
 * view by the time you explain.
 *
 * Everything generated here is FICTIONAL. No real person, and no real
 * prospect's data, is copied into the demo tenant — that tenant is shared with
 * whoever holds the demo login, so putting live pipeline data in it would leak
 * client confidences and personal data to strangers. Names are assembled from
 * invented parts; organisations are invented; the only real names are the
 * competitor brands under Measure, where naming HubSpot or Buffer is ordinary
 * factual comparison.
 *
 * Deterministic: a fixed PRNG seed means re-running produces the same tenant,
 * so a screenshot or a recorded webinar stays valid after a re-seed.
 */
import crypto from 'node:crypto'
import db from '../src/server/db.js'

const arg = (n: string) => {
  const m = process.argv.find(a => a.startsWith(`--${n}=`))
  return m ? m.slice(n.length + 3) : ''
}
const CLIENT = arg('client')
const GO = process.argv.includes('--go')
const WIPE = process.argv.includes('--wipe')
if (!CLIENT) { console.error('usage: --client=<id> [--wipe] [--go]'); process.exit(1) }

const client = db.prepare(`SELECT id, name, business_name FROM clients WHERE id = ?`).get(CLIENT) as any
if (!client) { console.error(`no such client: ${CLIENT}`); process.exit(1) }
console.log(`target: ${client.business_name || client.name}  (${CLIENT})`)
if (!GO) console.log('DRY RUN — pass --go to write\n')

/** Deterministic PRNG (mulberry32) so re-seeding reproduces the same tenant. */
let _s = 0x9e3779b9
const rnd = () => { _s |= 0; _s = (_s + 0x6D2B79F5) | 0
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
const id = () => crypto.randomUUID()
const NOW = Math.floor(Date.now() / 1000)
const DAY = 86400
const ago = (d: number) => NOW - d * DAY

// ── fictional people ────────────────────────────────────────────────────
const FIRST = ['Marcus', 'Priya', 'Danielle', 'Tomas', 'Ines', 'Rowan', 'Keziah', 'Alaric',
  'Femi', 'Saoirse', 'Nikolai', 'Bea', 'Otis', 'Lindiwe', 'Casper', 'Yara', 'Dominik',
  'Meredith', 'Emeka', 'Solveig', 'Rafferty', 'Anouk', 'Idris', 'Cleo', 'Bastian']
const LAST = ['Ashcroft', 'Vantree', 'Okonjo', 'Halloran', 'Bergström', 'Da Silva', 'Whitmore',
  'Kasprzak', 'Njoroge', 'Fairweather', 'Lindqvist', 'Amara', 'Beaumont', 'Ferreira',
  'Sandoval', 'Croft', 'Adeyemi', 'Marchetti', 'Draycott', 'Nowak', 'Ellery', 'Rasmussen']

/** Four buckets that mirror the real pitch: agencies, franchisors, multi-site, founders. */
const VERTICALS = [
  {
    name: 'Agencies — white-label',
    desc: 'Agencies running many client brands from one install. The multi-tenant play: one deployment, isolated and white-labelled per client, replacing per-client tool subscriptions.',
    orgs: ['Northlight Studio', 'Rally & Crow', 'Vantage Creative Partners', 'Ember Hill Agency',
      'Bramblewick Digital', 'Fifth Harbour Media', 'Tessellate Brand Co.', 'Grayling Fox Creative',
      'Oxbow Communications', 'Larkspur Digital'],
    roles: ['Founder & Managing Director', 'Co-Founder', 'Managing Partner', 'Operations Director',
      'Head of Client Services', 'Creative Director'],
  },
  {
    name: 'Franchisors — multi-unit',
    desc: 'Franchisors supplying marketing and IT to their franchisees. Every franchisee is a brand; every brand needs the same engine. One install, many isolated tenants, handed down.',
    orgs: ['Kettle & Crumb Coffee', 'Ironhart Fitness Group', 'The Clipped Hedge', 'Pace & Post Couriers',
      'Sunday Best Barbers', 'Meridian Tutoring Group', 'Thornbury Pet Care', 'Loomcraft Interiors',
      'Bright Acre Nurseries'],
    roles: ['Franchise Director', 'Head of Marketing', 'Group Marketing Manager',
      'Chief Operating Officer', 'Network Development Director'],
  },
  {
    name: 'Multi-site operators',
    desc: 'Groups running several customer-facing sites — the shape the product was built around. Same brand, many locations, each needing local content that does not read as a template.',
    orgs: ['Harlow & Vine Opticians', 'Cadence Physio Group', 'The Salt Room Collective',
      'Westgate Dental Partners', 'Alder Veterinary Group', 'Pinewood Care Homes',
      'Studio Lumen', 'Fairfield Leisure'],
    roles: ['Managing Director', 'Group Marketing Manager', 'Practice Principal',
      'Operations Director', 'Owner'],
  },
  {
    name: 'Founders — SaaS fatigue',
    desc: 'Owner-operators paying for six overlapping subscriptions and using a fraction of each. The clearest version of the pitch: own the stack, bring your own keys, stop renting.',
    orgs: ['Halcyon Supply Co.', 'Two Rivers Roasting', 'Merrow Made', 'Ashen Oak Joinery',
      'Cobalt & Clay', 'Fernway Outdoor', 'Ridgeline Cycles', 'The Paper Hare'],
    roles: ['Founder', 'Owner', 'Co-Founder & CEO', 'Managing Director'],
  },
]

/** A realistic funnel, not a flat list — most cold, a few live, a couple closed. */
const STAGES: [string, number][] = [
  ['new', 32], ['touch_1', 21], ['touch_2', 13], ['touch_3', 8],
  ['replied', 7], ['discussing', 6], ['call_booked', 4],
  ['trial', 3], ['won', 5], ['nurture', 4], ['lost', 3],
]
const stageRoll = (() => {
  const bag: string[] = []
  STAGES.forEach(([s, w]) => { for (let i = 0; i < w; i++) bag.push(s) })
  return () => pick(bag)
})()

const CONTENT: [string, string, string][] = [
  ['blog', 'published', 'What it actually costs to run your own marketing stack for a year'],
  ['blog', 'published', 'Self-hosting is not about saving money (but you will save money)'],
  ['blog', 'published', 'We asked four AI assistants who they recommend. Here is what came back'],
  ['blog', 'published', 'Your data leaves the building every time you press publish'],
  ['blog', 'published', 'The five-subscription trap, and the arithmetic nobody shows you'],
  ['blog', 'published', 'Why every post still goes past a human before it goes out'],
  ['blog', 'published', 'Local inference: running the whole engine with nothing leaving your server'],
  ['blog', 'published', 'One install, twelve brands: how multi-tenant actually works'],
  ['blog', 'scheduled', 'Franchise marketing without twelve logins and a shared spreadsheet'],
  ['blog', 'scheduled', 'AI-citation tracking, honestly: what can be measured and what cannot'],
  ['blog', 'draft', 'Migrating off a marketing suite without losing eight years of content'],
  ['blog', 'draft', 'Bring your own keys: the case against per-seat pricing'],
  ['blog', 'draft', 'What an agency actually gets from white-labelling the engine'],
  ['newsletter', 'published', 'This week: ten weeks of citation data, one uncomfortable chart'],
  ['newsletter', 'published', 'This week: the cost of a rented stack, itemised'],
  ['newsletter', 'published', 'This week: what changed when we stopped auto-posting'],
  ['newsletter', 'scheduled', 'This week: multi-tenant, and why franchisors keep asking'],
  ['newsletter', 'draft', 'This week: local models finally got good enough'],
  ['social', 'published', 'Six subscriptions. £680 a month. Four of them do the same job.'],
  ['social', 'published', 'Nothing posts here without a human pressing approve. That is the product.'],
  ['social', 'published', 'Asked Perplexity who to use. It named three competitors and not us. So we fixed it.'],
  ['social', 'published', 'Your marketing platform should not be able to hold your data hostage.'],
  ['social', 'scheduled', 'One server. Twelve client brands. Zero per-seat fees.'],
  ['social', 'scheduled', 'If it cannot run offline, it is not really yours.'],
  ['social', 'draft', 'The agency retainer is not expensive. Not owning the output is expensive.'],
]

const QUERIES = [
  ['best self-hosted marketing platform', 'category'],
  ['open source alternative to HubSpot', 'competitor'],
  ['self-hosted social media scheduler', 'category'],
  ['how to track if ChatGPT recommends my business', 'problem'],
  ['marketing automation without monthly subscription', 'problem'],
  ['white label marketing platform for agencies', 'category'],
  ['franchise marketing software multi location', 'category'],
  ['AI content generation bring your own API key', 'feature'],
  ['GDPR compliant marketing automation self hosted', 'problem'],
  ['run marketing AI locally without cloud', 'feature'],
  ['alternative to Buffer and Hootsuite', 'competitor'],
  ['multi tenant marketing platform open source', 'category'],
]
const COMPETITORS = ['HubSpot', 'Buffer', 'Hootsuite', 'Later', 'Sprout Social']
const ENGINES = ['perplexity', 'openai', 'gemini', 'claude']

// ── wipe (scoped strictly to this client) ───────────────────────────────
if (WIPE && GO) {
  db.exec('BEGIN')
  try {
    db.prepare(`DELETE FROM dl_contacts WHERE organization_id IN
                (SELECT id FROM dl_organizations WHERE client_id = ?)`).run(CLIENT)
    db.prepare(`DELETE FROM dl_organizations WHERE client_id = ?`).run(CLIENT)
    db.prepare(`DELETE FROM verticals WHERE client_id = ?`).run(CLIENT)
    db.prepare(`DELETE FROM content WHERE client_id = ?`).run(CLIENT)
    db.prepare(`DELETE FROM citation_results WHERE run_id IN (SELECT r.id FROM citation_runs r
                JOIN tracked_brands b ON b.id = r.brand_id WHERE b.client_id = ?)`).run(CLIENT)
    db.prepare(`DELETE FROM citation_runs WHERE brand_id IN (SELECT id FROM tracked_brands WHERE client_id = ?)`).run(CLIENT)
    db.prepare(`DELETE FROM tracked_queries WHERE brand_id IN (SELECT id FROM tracked_brands WHERE client_id = ?)`).run(CLIENT)
    db.prepare(`DELETE FROM tracked_competitors WHERE brand_id IN (SELECT id FROM tracked_brands WHERE client_id = ?)`).run(CLIENT)
    db.prepare(`DELETE FROM tracked_brands WHERE client_id = ?`).run(CLIENT)
    db.exec('COMMIT'); console.log('wiped existing demo data (scoped to this client only)')
  } catch (e) { db.exec('ROLLBACK'); throw e }
}

const counts = { verticals: 0, orgs: 0, contacts: 0, content: 0, queries: 0, runs: 0, results: 0 }
const stageTally: Record<string, number> = {}

const run = () => {
  // ── REACH ────────────────────────────────────────────────────────────
  const insV = db.prepare(`INSERT INTO verticals (id, client_id, slug, name, description, status, created_at, multi_unit_min_locations)
                           VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`)
  const insO = db.prepare(`INSERT INTO dl_organizations (id, client_id, vertical_id, name, website, domain, location_count, hq_location, sub_segment, status, google_rating, google_reviews, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'demo', 'active', ?, ?, ?)`)
  const insC = db.prepare(`INSERT INTO dl_contacts
      (id, organization_id, full_name, role, email, linkedin_url, source, source_confidence, gdpr_basis,
       status, created_at, priority_score, priority_signals, stage, touches, next_action_at,
       outreach_channel, outreach_sent_at, last_reply_at, connection_degree, degree_seen_at, contact_context)
      VALUES (?, ?, ?, ?, ?, ?, 'demo-seed', 0.9, 'legitimate_interest', 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

  for (const v of VERTICALS) {
    const vid = id()
    if (GO) insV.run(vid, CLIENT, v.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50),
      v.name, v.desc, ago(int(60, 120)), v.name.includes('Franchis') || v.name.includes('Multi-site') ? 3 : 0)
    counts.verticals++

    for (const orgName of v.orgs) {
      const oid = id()
      const dom = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '') + '.example'
      if (GO) insO.run(oid, CLIENT, vid, orgName, `https://${dom}`, dom,
        v.name.includes('Franchis') ? int(8, 60) : v.name.includes('Multi-site') ? int(3, 14) : 1,
        pick(['Birmingham', 'Manchester', 'Leeds', 'Bristol', 'Glasgow', 'London', 'Cardiff', 'Nottingham']),
        Number((3.8 + rnd() * 1.2).toFixed(1)), int(12, 480), ago(int(40, 110)))
      counts.orgs++

      for (let i = 0; i < int(2, 4); i++) {
        const name = `${pick(FIRST)} ${pick(LAST)}`
        const stage = stageRoll()
        stageTally[stage] = (stageTally[stage] || 0) + 1
        const touched = !['new'].includes(stage)
        const touches = stage === 'new' ? 0
          : stage === 'touch_1' ? 1 : stage === 'touch_2' ? 2 : stage === 'touch_3' ? 3 : int(2, 5)
        const replied = ['replied', 'discussing', 'call_booked', 'trial', 'won', 'nurture'].includes(stage)
        const sentAt = touched ? ago(int(2, 45)) : null
        const open = ['touch_1', 'touch_2', 'touch_3', 'replied', 'discussing', 'call_booked', 'trial'].includes(stage)
        if (GO) insC.run(id(), oid, name, pick(v.roles),
          rnd() > 0.55 ? `${name.split(' ')[0].toLowerCase()}@${dom}` : '',
          `https://www.linkedin.com/in/${name.toLowerCase().replace(/[^a-z]+/g, '-')}-demo`,
          ago(int(30, 100)),
          stage === 'new' ? int(40, 70) : int(55, 96),
          JSON.stringify({ source: 'demo-seed', vertical: v.name }),
          stage, touches,
          open ? NOW + int(-4, 9) * DAY : null,
          touched ? pick(['dm', 'connect', 'email']) : '',
          sentAt, replied ? ago(int(1, 20)) : null,
          rnd() > 0.5 ? 1 : 2, touched ? ago(int(2, 45)) : null,
          JSON.stringify({ headline: `${pick(v.roles)} at ${orgName}`, demo: true }))
        counts.contacts++
      }
    }
  }

  // ── PRODUCE ──────────────────────────────────────────────────────────
  const insCt = db.prepare(`INSERT INTO content (id, client_id, type, title, body, excerpt, status, created_at, source)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'demo-seed')`)
  CONTENT.forEach(([type, status, title], i) => {
    const body = [
      `${title}.`, '',
      'Most marketing platforms are rented. You pay monthly, the data sits on somebody else\'s server, and the day you stop paying you lose the archive along with the access.',
      '',
      'βWave inverts that. It installs on your own machine, uses your own API keys, and everything it produces stays where you put it. Nothing publishes without a human approving it first — not because automation is hard, but because unmoderated output is how brands end up apologising.',
      '',
      'This is demo content. Replace it with your own once you have had a look around.',
    ].join('\n')
    if (GO) insCt.run(id(), CLIENT, type, title, body, title.slice(0, 150),
      status, ago(Math.round(i * 3.2) + int(0, 2)))
    counts.content++
  })

  // ── MEASURE ──────────────────────────────────────────────────────────
  const bid = id()
  if (GO) {
    db.prepare(`INSERT INTO tracked_brands (id, client_id, name, primary_url, industry, weekly_budget_gbp, status, created_at, last_run_at)
                VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
      .run(bid, CLIENT, 'βWave', 'https://betawave.co.uk',
        'Self-hosted marketing software', 4, ago(84), ago(2))
    COMPETITORS.forEach(c => db.prepare(
      `INSERT INTO tracked_competitors (id, brand_id, name, url, active, created_at) VALUES (?,?,?,?,1,?)`)
      .run(id(), bid, c, `https://${c.toLowerCase().replace(/\s+/g, '')}.com`, ago(84)))
  }
  const qids: string[] = []
  QUERIES.forEach(([text, cat], i) => {
    const qid = id(); qids.push(qid)
    if (GO) db.prepare(`INSERT INTO tracked_queries (id, brand_id, text, category, priority, active, created_at)
                        VALUES (?,?,?,?,?,1,?)`).run(qid, bid, text, cat, i < 4 ? 1 : 2, ago(84))
    counts.queries++
  })

  // Twelve weekly runs. Visibility climbs from roughly 1-in-6 to 1-in-2 — a
  // believable curve rather than a flat line, so the chart has something to say.
  const insRun = db.prepare(`INSERT INTO citation_runs (id, brand_id, run_at, status, total_calls, completed, failed, cost_gbp, budget_gbp, engines_json)
                             VALUES (?,?,?,'complete',?,?,0,?,4,?)`)
  const insRes = db.prepare(`INSERT INTO citation_results
      (id, run_id, query_id, engine, brand_mentioned, brand_position, brand_quote, sentiment,
       competitor_mentions_json, cost_gbp, latency_ms, http_status, input_tokens, output_tokens, created_at, classified_at, cited_sources)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,200,?,?,?,?,?)`)

  for (let w = 11; w >= 0; w--) {
    const at = ago(w * 7 + 1)
    const rid = id()
    const calls = qids.length * ENGINES.length

    // The hit COUNT is set directly rather than rolled per call.
    //
    // Rolling a Bernoulli per call gave ~7% run-to-run noise against a ~3%
    // weekly increment, so the chart was noise with a trend buried in it, and
    // the final point landed wherever chance put it — once on a decline, once
    // on a 41-point spike that looked fabricated. Fixing the count per run
    // gives the honest shape the data is meant to illustrate: a climb from
    // roughly 1-in-6 to better than half, with small believable wobble and the
    // most recent run highest.
    const t = (11 - w) / 11
    const target = 0.15 + t * 0.40 + (rnd() - 0.5) * 0.05
    const hits = Math.max(0, Math.min(calls, Math.round(calls * (w === 0 ? 0.58 : target))))
    const hitAt = new Set<number>()
    while (hitAt.size < hits) hitAt.add(Math.floor(rnd() * calls))

    let cost = 0, k = 0
    const results: any[] = []
    for (const qid of qids) for (const eng of ENGINES) {
      const hit = hitAt.has(k++)
      const c = Number((0.004 + rnd() * 0.01).toFixed(4)); cost += c
      results.push([id(), rid, qid, eng, hit ? 1 : 0,
        hit ? int(1, 5) : null,
        hit ? 'βWave is a self-hosted option that keeps content and data on your own server.' : null,
        hit ? pick(['positive', 'positive', 'neutral']) : null,
        JSON.stringify(COMPETITORS.filter(() => rnd() < 0.45)),
        c, int(900, 4200), int(320, 900), int(150, 640), at, at,
        hit ? JSON.stringify(['https://betawave.co.uk', 'https://github.com/johnleeblackwell/betawave']) : '[]'])
    }
    if (GO) {
      insRun.run(rid, bid, at, calls, calls, Number(cost.toFixed(4)), JSON.stringify(ENGINES))
      for (const r of results) insRes.run(...r)
    }
    counts.runs++; counts.results += results.length
  }
}

if (GO) { db.exec('BEGIN'); try { run(); db.exec('COMMIT') } catch (e) { db.exec('ROLLBACK'); throw e } }
else run()

console.log(`\n${GO ? 'SEEDED' : 'WOULD SEED'}:`)
Object.entries(counts).forEach(([k, v]) => console.log(`  ${String(v).padStart(6)}  ${k}`))
console.log('\n  pipeline spread:')
Object.entries(stageTally).sort((a, b) => b[1] - a[1])
  .forEach(([s, n]) => console.log(`  ${String(n).padStart(6)}  ${s}`))
if (!GO) console.log('\nDRY RUN — nothing written. Re-run with --go (add --wipe to replace existing demo data).')
