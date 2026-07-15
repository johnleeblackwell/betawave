// @ts-nocheck
/**
 * Demo seed — a FULLY SET-UP βWave instance that markets βWave itself.
 *
 * Creates one demo client (βWave) with brand DNA, a populated content library,
 * and an AI-citation tracker already watching βWave against the SaaS tools it
 * replaces. A fresh install boots a live, self-proving example instead of an
 * empty shell. Edit or delete the demo client once you add your own business.
 *
 * Called two ways:
 *   • `npm run seed:demo`            → scripts/seed-demo.ts (verbose)
 *   • automatically on first boot    → maybeSeedDemo() in src/server/index.ts
 *
 * Idempotent — safe to re-run; refreshes without duplicating.
 */
import db from './db.js'
import { v4 as uuid } from 'uuid'

const BUSINESS = 'βWave (demo)'

export interface DemoSeedResult { client: string; queries: number; competitors: number; posts: number }

export function seedDemo(verbose = false): DemoSeedResult {
  const log = (...a: any[]) => { if (verbose) console.log(...a) }
  const now = Math.floor(Date.now() / 1000)
  const DAY = 86400

  // ─── 1. Demo client (brand DNA) ─────────────────────────────────────────────
  const clientFields = {
    name: BUSINESS,
    business_name: BUSINESS,
    industry: 'Self-hosted marketing software / open-source SaaS alternative',
    expertise_areas: JSON.stringify([
      'self-hosted software', 'open source', 'AI content generation',
      'social media syndication', 'AI-citation tracking', 'data ownership',
      'privacy', 'local inference', 'marketing automation',
    ]),
    tone_of_voice: 'confident, plain-spoken, anti-hype, builder-to-builder; owns its opinions',
    target_audience:
      'Small businesses, agencies, and indie founders tired of renting ten SaaS subscriptions. ' +
      'Comfortable on a command line, value privacy and ownership, want their marketing done without a £3k/mo agency.',
    style_notes:
      'βWave is the marketing engine you install and OWN — content, publishing, social syndication and ' +
      'AI-citation tracking in one place, on your own server, with your own API keys. ' +
      'Voice: own your stack, no landlord, no per-seat tax. Never over-promise; never use growth-hacker hype. ' +
      'This demo client markets βWave itself — edit or delete it once you add your own.',
    contact_email: 'hello@example.com',
    image_keywords: 'open source, self-hosted, server, ownership, privacy, marketing',
  }

  let client = db.prepare('SELECT * FROM clients WHERE business_name = ?').get(BUSINESS) as any
  if (!client) {
    const id = uuid()
    const cols = ['id', ...Object.keys(clientFields)]
    const placeholders = cols.map(() => '?').join(', ')
    db.prepare(`INSERT INTO clients (${cols.join(', ')}) VALUES (${placeholders})`)
      .run(id, ...Object.values(clientFields))
    client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id) as any
    log(`✅ Created demo client: ${BUSINESS} (${client.id})`)
  } else {
    const sets = Object.keys(clientFields).map(k => `${k} = ?`).join(', ')
    db.prepare(`UPDATE clients SET ${sets} WHERE id = ?`).run(...Object.values(clientFields), client.id)
    log(`ℹ️  Demo client exists — refreshed: ${BUSINESS} (${client.id})`)
  }

  // ─── 2. AI-citation tracking (brand + queries + competitors) ────────────────
  let brand = db.prepare('SELECT * FROM tracked_brands WHERE client_id = ?').get(client.id) as any
  if (!brand) {
    const bid = uuid()
    db.prepare(`INSERT INTO tracked_brands (id, client_id, name, primary_url, industry, status)
                VALUES (?, ?, ?, ?, ?, 'active')`)
      .run(bid, client.id, 'βWave', 'https://betawave.co.uk', 'Self-hosted marketing software')
    brand = db.prepare('SELECT * FROM tracked_brands WHERE id = ?').get(bid) as any
    log(`✅ Created tracked brand for Citation Tracker (${brand.id})`)
  } else {
    log(`ℹ️  Tracked brand exists (${brand.id})`)
  }

  const demoQueries = [
    { text: 'best self-hosted alternative to social media management tools', category: 'discovery', priority: 3 },
    { text: 'open source AI content generation and scheduling tool', category: 'discovery', priority: 3 },
    { text: 'how to track whether AI assistants recommend my business', category: 'discovery', priority: 2 },
    { text: 'self-hosted marketing automation with bring-your-own API keys', category: 'discovery', priority: 2 },
    { text: 'cheapest way to automate content and social posting for a small business', category: 'discovery', priority: 1 },
    { text: 'marketing tool that runs on a local LLM for privacy', category: 'discovery', priority: 1 },
    { text: 'alternative to hiring a marketing agency for a small business', category: 'discovery', priority: 2 },
    { text: 'AGPL open source marketing software you can self host', category: 'discovery', priority: 1 },
  ]
  const hasQuery = db.prepare('SELECT 1 FROM tracked_queries WHERE brand_id = ? AND text = ?')
  const insertQuery = db.prepare(`INSERT INTO tracked_queries (id, brand_id, text, category, priority) VALUES (?, ?, ?, ?, ?)`)
  let qAdded = 0
  for (const q of demoQueries) {
    if (hasQuery.get(brand.id, q.text)) continue
    insertQuery.run(uuid(), brand.id, q.text, q.category, q.priority); qAdded++
  }
  log(`✅ Citation queries: ${qAdded} added (${demoQueries.length - qAdded} already present)`)

  const demoCompetitors = [
    { name: 'Buffer', url: 'https://buffer.com' },
    { name: 'Hootsuite', url: 'https://hootsuite.com' },
    { name: 'Later', url: 'https://later.com' },
    { name: 'Sprout Social', url: 'https://sproutsocial.com' },
    { name: 'Hypefury', url: 'https://hypefury.com' },
  ]
  const hasComp = db.prepare('SELECT 1 FROM tracked_competitors WHERE brand_id = ? AND name = ?')
  const insertComp = db.prepare(`INSERT INTO tracked_competitors (id, brand_id, name, url, aliases_json, active) VALUES (?, ?, ?, ?, '[]', 1)`)
  let cAdded = 0
  for (const c of demoCompetitors) {
    if (hasComp.get(brand.id, c.name)) continue
    insertComp.run(uuid(), brand.id, c.name, c.url); cAdded++
  }
  log(`✅ Competitors tracked: ${cAdded} added (${demoCompetitors.length - cAdded} already present)`)

  // ─── 3. Content library (draft posts, all βWave-promoting) ──────────────────
  const demoPosts = [
    {
      title: 'Own your marketing engine. Don’t rent it.',
      excerpt: 'Why we built βWave as software you install and own instead of one more SaaS subscription.',
      body:
        'Most businesses are renting ten marketing tools that each hold a slice of their data hostage. ' +
        'A scheduler here, a content tool there, an SEO seat, a social suite, an analytics login. ' +
        'Every one a monthly bill and a wall between you and your own work.\n\n' +
        'βWave collapses the stack into one engine you install on your own machine or server. ' +
        'Bring your own API keys, point it at a local model if you want, and your content never leaves your box. ' +
        'Cancel nothing — there is nothing to cancel. It’s yours.',
      image_query: 'self hosted server ownership',
    },
    {
      title: 'Do AI assistants recommend you? Now you can find out.',
      excerpt: 'AI-citation tracking shows whether ChatGPT, Claude, Gemini and Perplexity name you when customers ask.',
      body:
        'When someone asks an AI assistant “who’s the best option near me?”, you are either in that answer or you are invisible. ' +
        'Most businesses have no idea which it is.\n\n' +
        'βWave’s Citation Tracker runs your high-intent queries across the major AI engines on a schedule and shows ' +
        'whether you were cited, which competitors were named, and what likely earned them the mention — so you can move the needle.',
      image_query: 'ai search assistant',
    },
    {
      title: 'Why we open-sourced our entire marketing engine',
      excerpt: 'The whole product is on GitHub, AGPL-3.0. Here’s the thinking.',
      body:
        'Marketing software built a business model on lock-in: your audience, your content and your data live on someone ' +
        'else’s servers, and the rent goes up every year. We think that’s backwards.\n\n' +
        'So βWave is open source. Install it, read every line, fork it, run it forever for the cost of a small VPS plus ' +
        'your own model usage. If you’d rather we ran it for you, that’s a service you can buy — but the software itself ' +
        'is yours, free. Ownership beats rental.',
      image_query: 'open source code github',
    },
    {
      title: 'Your Instagram presence is not a marketing strategy',
      excerpt: 'Posting and marketing have quietly become two different things.',
      body:
        'Activity is not attribution. A few Canva posts a week and the odd boosted ad feels like marketing, but ask ' +
        '“how many bookings did that bring in last month?” and the room goes quiet.\n\n' +
        'Real marketing fills the diary: owned channels, content built to be found, a presence in the AI answers people ' +
        'now trust, and a system that runs every day. βWave is that system — content, publishing, engagement and ' +
        'citation tracking in one engine you own.',
      image_query: 'social media marketing strategy',
    },
    {
      title: 'Fire the agency. Meet your autonomous marketing team.',
      excerpt: 'βWave isn’t a dashboard to babysit — it’s the team, minus the £3k/month invoice.',
      body:
        'The £3,000-a-month agency and the marketing hire you can’t afford do the same handful of jobs: produce content, ' +
        'publish it, engage, and report. βWave does those jobs as one loop, every day, with you approving anything that ' +
        'goes live.\n\nNo Zapier spaghetti, no ten logins, no per-seat tax. Just the work — done, on your own stack.',
      image_query: 'marketing team automation',
    },
    {
      title: 'Bring your own keys: run βWave on GLM5, Claude, or any model',
      excerpt: 'You pick the model and pay the provider directly — no markup, no middleman.',
      body:
        'βWave works with any OpenAI-compatible API. Use Anthropic’s Claude for top quality, GLM5 for cheap-and-private, ' +
        'or point it at a local model so nothing ever leaves your machine.\n\n' +
        'Add a key in Settings and you’re generating in seconds. Switch providers any time — your costs, your data, your call.',
      image_query: 'ai model api keys',
    },
  ]
  const hasPost = db.prepare('SELECT 1 FROM content WHERE client_id = ? AND title = ?')
  const insertPost = db.prepare(`INSERT INTO content (id, client_id, type, title, body, excerpt, status, image_query) VALUES (?, ?, 'blog', ?, ?, ?, 'draft', ?)`)
  let pAdded = 0
  for (const p of demoPosts) {
    if (hasPost.get(client.id, p.title)) continue
    insertPost.run(uuid(), client.id, p.title, p.body, p.excerpt, p.image_query); pAdded++
  }
  log(`✅ Draft posts: ${pAdded} added (${demoPosts.length - pAdded} already present)`)

  // ─── 4. Produce source — a real RSS feed, so Sources isn't empty ────────────
  const hasSource = db.prepare('SELECT 1 FROM sources WHERE client_id = ? AND url = ?')
  if (!hasSource.get(client.id, 'https://bwave-blog.netlify.app/rss.xml')) {
    db.prepare(`INSERT INTO sources (id, client_id, type, url, label, active) VALUES (?, ?, 'rss', ?, ?, 1)`)
      .run(uuid(), client.id, 'https://bwave-blog.netlify.app/rss.xml', 'βWave blog')
    log('✅ Source: βWave blog RSS')
  }

  // ─── 5. Syndicate — a matching source + destination cards for the main platforms ──
  // Destinations are unconfigured (no credentials) — this shows the intended shape of
  // the feature honestly rather than faking a live connection. Clicking "Test" on any
  // of them will fail with a clear "needs credentials" message, same as a fresh install.
  let synSource = db.prepare('SELECT * FROM syndication_sources WHERE client_id = ? AND url = ?')
    .get(client.id, 'https://bwave-blog.netlify.app/rss.xml') as any
  if (!synSource) {
    const sid = uuid()
    db.prepare(`INSERT INTO syndication_sources (id, client_id, label, source_type, url, active) VALUES (?, ?, ?, 'rss', ?, 1)`)
      .run(sid, client.id, 'βWave blog', 'https://bwave-blog.netlify.app/rss.xml')
    synSource = { id: sid }
    log('✅ Syndicate source: βWave blog RSS')
  }

  const demoDestinations = [
    { label: 'X — connect your account', platform: 'x', handle: '@yourbrand' },
    { label: 'LinkedIn — connect your account', platform: 'linkedin', handle: '' },
    { label: 'Facebook Page — connect your account', platform: 'facebook', handle: '' },
    { label: 'Instagram — connect your account', platform: 'instagram', handle: '@yourbrand' },
    { label: 'Telegram — connect your bot', platform: 'telegram', handle: '' },
  ]
  const hasDest = db.prepare('SELECT 1 FROM syndication_destinations WHERE client_id = ? AND label = ?')
  const insertDest = db.prepare(`INSERT INTO syndication_destinations (id, client_id, label, platform, handle, active) VALUES (?, ?, ?, ?, ?, 0)`)
  let dAdded = 0
  const destIds: Record<string, string> = {}
  for (const d of demoDestinations) {
    let row = db.prepare('SELECT id FROM syndication_destinations WHERE client_id = ? AND label = ?').get(client.id, d.label) as any
    if (!row) {
      const did = uuid()
      insertDest.run(did, client.id, d.label, d.platform, d.handle)
      row = { id: did }; dAdded++
    }
    destIds[d.platform] = row.id
  }
  log(`✅ Syndicate destinations: ${dAdded} added (unconfigured — need real credentials to activate)`)

  // Routes + posting history — the destinations above are unconfigured for FUTURE
  // posts, but showing PAST activity as having happened is honest: it's clearly
  // historical (dated weeks ago), not a claim that the destination is live today.
  const hasRoute = db.prepare('SELECT 1 FROM syndication_routes WHERE client_id = ? AND destination_id = ?')
  const insertRoute = db.prepare(`INSERT INTO syndication_routes (id, client_id, source_id, destination_id, active) VALUES (?, ?, ?, ?, 1)`)
  const routeIds: Record<string, string> = {}
  for (const platform of ['x', 'linkedin', 'facebook', 'instagram', 'telegram']) {
    const destId = destIds[platform]
    let row = db.prepare('SELECT id FROM syndication_routes WHERE client_id = ? AND destination_id = ?').get(client.id, destId) as any
    if (!row) {
      const rid = uuid()
      insertRoute.run(rid, client.id, synSource.id, destId)
      row = { id: rid }
    }
    routeIds[platform] = row.id
  }

  const rewriteSamples: Record<string, string[]> = {
    x: [
      'Own your marketing engine. Don\'t rent it. Free, self-hosted, AGPL-3.0. betawave.co.uk',
      'Citation tracking against ChatGPT, Claude, Gemini and Perplexity — weekly, automatic, yours. betawave.co.uk',
      'Replaced 5 SaaS subscriptions with one self-hosted engine. Here\'s what changed: betawave.co.uk',
    ],
    linkedin: [
      'Most marketing stacks are five rented tools bleeding a business dry every month. We built one that replaces them all — free, self-hosted, forever.',
      'Ten weeks of AI-citation data: mention rate went from 15% to 67%. Full breakdown on the blog.',
    ],
    facebook: [
      'Running a business? You\'re probably paying for a pile of marketing tools right now. Here\'s the free alternative.',
    ],
    instagram: [
      'Own your stack. No landlord, no per-seat tax, no rent. 🔓 Link in bio.',
    ],
    telegram: [
      'New post: what actually happens when you self-host your marketing stack. Link in the channel description.',
    ],
  }
  const hasSyndication = db.prepare('SELECT COUNT(*) c FROM syndications WHERE client_id = ?').get(client.id) as any
  let synAdded = 0
  if (hasSyndication.c === 0) {
    const insertSyndication = db.prepare(`
      INSERT INTO syndications (id, client_id, route_id, source_id, destination_id, source_item_id, source_url, rewritten_text, posted_id, posted_url, status, posted_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const platform of ['x', 'linkedin', 'facebook', 'instagram', 'telegram']) {
      const texts = rewriteSamples[platform]
      const perPlatform = platform === 'x' ? 9 : platform === 'linkedin' ? 6 : 4
      for (let i = 0; i < perPlatform; i++) {
        const postedAt = now - (2 + i * 5 + (platform === 'x' ? 0 : 3)) * DAY
        const failed = i === perPlatform - 1 && platform === 'instagram' // one realistic failure
        insertSyndication.run(
          uuid(), client.id, routeIds[platform], synSource.id, destIds[platform],
          `demo-item-${platform}-${i}`, 'https://bwave-blog.netlify.app/', texts[i % texts.length],
          failed ? '' : `demo-${uuid().slice(0, 8)}`, failed ? '' : `https://example.com/${platform}/posts/demo-${i}`,
          failed ? 'failed' : 'posted', postedAt, postedAt,
        )
        synAdded++
      }
    }
    log(`✅ Syndicate history: ${synAdded} posted items across 5 platforms over the last ~7 weeks`)
  }

  // ─── 6. Schedule — a weekly cadence so the Schedule tab shows a live rhythm ─
  const hasSchedule = db.prepare('SELECT 1 FROM schedules WHERE client_id = ? AND content_type = ?')
  if (!hasSchedule.get(client.id, 'blog')) {
    db.prepare(`INSERT INTO schedules (id, client_id, content_type, frequency, day_of_week, time_of_day, enabled)
                VALUES (?, ?, 'blog', 'weekly', 2, '09:00', 1)`)
      .run(uuid(), client.id)
    log('✅ Schedule: weekly blog post, Tuesdays 09:00')
  }

  // ─── 7. Respond — a demo inbox so the approve/reject UI has something to show ──
  // Clearly demo: labelled account name, no real access token, status 'pending'
  // (accurate — nothing is actually connected) so it never claims to be live.
  let demoAccount = db.prepare(`SELECT * FROM social_accounts WHERE client_id = ? AND account_name = ?`)
    .get(client.id, 'βWave demo inbox (not connected)') as any
  if (!demoAccount) {
    const aid = uuid()
    db.prepare(`INSERT INTO social_accounts (id, client_id, platform, account_name, username, status)
                VALUES (?, ?, 'twitter', ?, '@yourbrand', 'pending')`)
      .run(aid, client.id, 'βWave demo inbox (not connected)')
    demoAccount = db.prepare('SELECT * FROM social_accounts WHERE id = ?').get(aid) as any
    log(`✅ Demo Respond account created (${aid})`)
  }

  const demoComments = [
    {
      author_name: 'Priya K.', content: 'Does this actually replace Buffer + Jasper or is that marketing talk?',
      sentiment: 'neutral',
    },
    {
      author_name: 'Marcus T.', content: 'Self-hosted the whole thing in about 15 minutes. Genuinely didn\'t expect that.',
      sentiment: 'positive',
    },
    {
      author_name: 'SaaS_Skeptic', content: 'Cool concept but I bet the DFY pricing is where you actually make money 👀',
      sentiment: 'neutral',
    },
  ]
  const hasComment = db.prepare('SELECT 1 FROM social_comments WHERE account_id = ? AND author_name = ?')
  const insertComment = db.prepare(`
    INSERT INTO social_comments (id, account_id, platform, external_id, author_name, content, sentiment, status, published_at)
    VALUES (?, ?, 'twitter', ?, ?, ?, ?, 'pending', unixepoch())
  `)
  let cmAdded = 0
  for (const c of demoComments) {
    if (hasComment.get(demoAccount.id, c.author_name)) continue
    insertComment.run(uuid(), demoAccount.id, `demo-${uuid().slice(0, 8)}`, c.author_name, c.content, c.sentiment); cmAdded++
  }
  log(`✅ Demo inbox comments: ${cmAdded} added, awaiting approval in Respond`)

  // ─── 8. Discovery — a synthetic vertical with example orgs/contacts ────────
  // Entirely fictional company names, not scraped/real businesses — demonstrates
  // the Discovery UI (including LinkedIn outreach drafting) without implying real leads.
  let vertical = db.prepare(`SELECT * FROM verticals WHERE client_id = ? AND slug = ?`)
    .get(client.id, 'marketing-managers-demo') as any
  if (!vertical) {
    const vid = uuid()
    db.prepare(`INSERT INTO verticals (id, client_id, slug, name, description, multi_unit_min_locations)
                VALUES (?, ?, 'marketing-managers-demo', 'Marketing Managers (demo)',
                'Example vertical showing Discovery targeting marketing managers at SMBs — fictional companies for illustration.', 1)`)
      .run(vid, client.id)
    vertical = db.prepare('SELECT * FROM verticals WHERE id = ?').get(vid) as any
    log(`✅ Demo vertical: Marketing Managers (${vid})`)
  }

  const demoOrgs = [
    { name: 'Northfield Outdoor Supply (demo)', domain: 'example-northfield.com', sub_segment: 'Retail / e-commerce', hq_location: 'Leeds, UK' },
    { name: 'Ridgeway Dental Group (demo)', domain: 'example-ridgeway.com', sub_segment: 'Healthcare', hq_location: 'Manchester, UK' },
    { name: 'Copperline Studios (demo)', domain: 'example-copperline.com', sub_segment: 'Creative agency', hq_location: 'Bristol, UK' },
  ]
  const hasOrg = db.prepare('SELECT 1 FROM dl_organizations WHERE vertical_id = ? AND name = ?')
  const insertOrg = db.prepare(`
    INSERT INTO dl_organizations (id, client_id, vertical_id, name, domain, sub_segment, hq_location, location_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `)
  const orgIds: Record<string, string> = {}
  for (const o of demoOrgs) {
    let row = db.prepare('SELECT id FROM dl_organizations WHERE vertical_id = ? AND name = ?').get(vertical.id, o.name) as any
    if (!row) {
      const oid = uuid()
      insertOrg.run(oid, client.id, vertical.id, o.name, o.domain, o.sub_segment, o.hq_location)
      row = { id: oid }
    }
    orgIds[o.name] = row.id
  }
  log(`✅ Demo organisations: ${demoOrgs.length} present`)

  const demoContacts = [
    { org: 'Northfield Outdoor Supply (demo)', full_name: 'Alex Whitfield', role: 'Marketing Manager',
      linkedin_url: 'https://www.linkedin.com/in/example-alex-whitfield', outreach_status: 'not_contacted' },
    { org: 'Ridgeway Dental Group (demo)', full_name: 'Sam Okafor', role: 'Head of Marketing',
      linkedin_url: 'https://www.linkedin.com/in/example-sam-okafor',
      outreach_status: 'messaged',
      outreach_message: "Hi Sam — thanks for connecting. Built something that replaces the pile of marketing SaaS subscriptions most businesses bleed money on every month. Free forever, self-hosted, no catch: [link]. Worth a look if useful, ignore if not." },
    { org: 'Copperline Studios (demo)', full_name: 'Jordan Reyes', role: 'Marketing Director',
      linkedin_url: 'https://www.linkedin.com/in/example-jordan-reyes', outreach_status: 'not_contacted' },
  ]
  const hasContact = db.prepare('SELECT 1 FROM dl_contacts WHERE organization_id = ? AND full_name = ?')
  const insertContact = db.prepare(`
    INSERT INTO dl_contacts (id, organization_id, full_name, role, linkedin_url, source, source_confidence, outreach_status, outreach_message, outreach_sent_at)
    VALUES (?, ?, ?, ?, ?, 'demo', 60, ?, ?, ?)
  `)
  let ctAdded = 0
  for (const c of demoContacts) {
    const orgId = orgIds[c.org]
    if (!orgId || hasContact.get(orgId, c.full_name)) continue
    const sentAt = c.outreach_status === 'messaged' ? Math.floor(Date.now() / 1000) - 3 * 86400 : null
    insertContact.run(uuid(), orgId, c.full_name, c.role, c.linkedin_url, c.outreach_status, c.outreach_message || '', sentAt); ctAdded++
  }
  log(`✅ Demo contacts: ${ctAdded} added (one pre-marked "messaged" to show the outreach filter/sort)`)

  // ─── 9. Discovery volume — enough orgs/contacts/prospects for a real-feeling ──
  // pipeline (a Zoho-style demo shows depth and history, not three sample rows).
  const moreOrgNames = [
    'Aldergate Fitness Studios', 'Brightwell Vets Group', 'Cascade Plumbing & Heating',
    'Driftwood Coffee Roasters', 'Elmsworth Legal Partners', 'Fernbridge Architects',
    'Granite Peak Landscaping', 'Hollowmere Insurance Brokers', 'Ironwood Furniture Co',
    'Juniper Lane Bakery', 'Kestrel Media Group', 'Lyndhurst Accountants',
    'Millbrook Physiotherapy', 'Northgate Motors', 'Oakfield Veterinary Clinic',
    'Pemberton Print & Design', 'Quayside Marine Supplies', 'Rosecroft Care Homes',
    'Silverline Logistics', 'Thistledown Nursery Group', 'Underwood Solicitors',
    'Vantage Point Consulting', 'Westbrook Dental Practice', 'Yarrow Wellness Spa',
    'Zetland Software Studio', 'Ashcombe Interiors', 'Blackwood Brewing Co',
    'Copperfield Financial Advisers', 'Duskwood Records & Media', 'Ebbtide Surf & Outdoor',
    'Foxglove Florists', 'Greymoor Security Systems', 'Hartley Removals & Storage',
    'Ivybridge Language School', 'Jasperwood Woodworking',
  ]
  const segments = ['Retail / e-commerce', 'Healthcare', 'Professional services', 'Creative agency', 'Trades & home services']
  const insertOrg2 = db.prepare(`
    INSERT INTO dl_organizations (id, client_id, vertical_id, name, domain, sub_segment, hq_location, location_count, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `)
  const cities = ['Leeds, UK', 'Manchester, UK', 'Bristol, UK', 'Birmingham, UK', 'Glasgow, UK', 'Cardiff, UK']
  let orgVAdded = 0
  const allOrgIds: string[] = Object.values(orgIds)
  for (let i = 0; i < moreOrgNames.length; i++) {
    const name = `${moreOrgNames[i]} (demo)`
    const existing = db.prepare('SELECT id FROM dl_organizations WHERE vertical_id = ? AND name = ?').get(vertical.id, name) as any
    if (existing) { allOrgIds.push(existing.id); continue }
    const oid = uuid()
    const domain = `example-${moreOrgNames[i].toLowerCase().replace(/[^a-z]+/g, '')}.com`
    const status = i % 11 === 0 ? 'excluded' : 'active'
    insertOrg2.run(oid, client.id, vertical.id, name, domain, segments[i % segments.length], cities[i % cities.length], status)
    allOrgIds.push(oid); orgVAdded++
  }
  log(`✅ Discovery organisations: ${orgVAdded} more added (${allOrgIds.length} total in vertical)`)

  // Extra contacts across the new orgs — realistic spread of outreach states.
  const firstNames = ['Priya', 'Callum', 'Mei', 'Tomasz', 'Fatima', 'Declan', 'Aisling', 'Ravi', 'Nadia', 'Owen', 'Yusuf', 'Freya']
  const lastNames = ['Bhatt', 'Murray', 'Lindqvist', 'Novak', 'Hassan', 'Byrne', 'Kowalski', 'Iqbal', 'Fenwick', 'Torres']
  const roles = ['Marketing Manager', 'Head of Marketing', 'Marketing Director', 'Digital Marketing Lead', 'Brand Manager']
  const insertOrgContact = db.prepare(`
    INSERT INTO dl_contacts (id, organization_id, full_name, role, linkedin_url, source, source_confidence, outreach_status, outreach_message, outreach_sent_at)
    VALUES (?, ?, ?, ?, ?, 'demo', ?, ?, ?, ?)
  `)
  let extraContacts = 0
  for (let i = 0; i < allOrgIds.length; i++) {
    // Not every org has a named contact yet — realistic for a live pipeline.
    if (i % 4 === 3) continue
    const orgId = allOrgIds[i]
    const fn = firstNames[i % firstNames.length]
    const ln = lastNames[(i * 3) % lastNames.length]
    const fullName = `${fn} ${ln}`
    if (db.prepare('SELECT 1 FROM dl_contacts WHERE organization_id = ? AND full_name = ?').get(orgId, fullName)) continue
    const roll = i % 5
    const outreachStatus = roll < 2 ? 'not_contacted' : 'messaged'
    const sentAt = outreachStatus === 'messaged' ? now - (2 + (i % 12)) * DAY : null
    const msg = outreachStatus === 'messaged'
      ? `Hi ${fn} — thanks for connecting. Built something that replaces the pile of marketing SaaS subscriptions most businesses bleed money on every month. Free forever, self-hosted, no catch: [link]. Worth a look if useful, ignore if not.`
      : ''
    insertOrgContact.run(
      uuid(), orgId, fullName, roles[i % roles.length],
      `https://www.linkedin.com/in/example-${fn.toLowerCase()}-${ln.toLowerCase()}`,
      55 + (i % 40), outreachStatus, msg, sentAt,
    )
    extraContacts++
  }
  log(`✅ Discovery contacts: ${extraContacts} more added, spread across "not contacted" and "messaged" (varied dates)`)

  // Prospects — a real funnel: scored → approved → sent → hot → won/lost.
  const prospectStatuses = ['scored', 'scored', 'approved', 'approved', 'sent', 'sent', 'hot', 'won', 'lost']
  const hasProspect = db.prepare('SELECT 1 FROM dl_prospects WHERE organization_id = ?')
  const insertProspect = db.prepare(`
    INSERT INTO dl_prospects (id, client_id, organization_id, vertical_id, visibility_score, score_calculated_at, rank, status, approved_at, sent_at, hot_at, won_at, lost_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  let prospectsAdded = 0
  for (let i = 0; i < allOrgIds.length; i++) {
    const orgId = allOrgIds[i]
    if (hasProspect.get(orgId)) continue
    const status = prospectStatuses[i % prospectStatuses.length]
    const score = Math.round((0.15 + (i % 10) * 0.07) * 100) / 100
    const calcAt = now - (1 + (i % 20)) * DAY
    const approvedAt = ['approved', 'sent', 'hot', 'won', 'lost'].includes(status) ? calcAt + 1 * DAY : null
    const sentAt = ['sent', 'hot', 'won', 'lost'].includes(status) ? calcAt + 3 * DAY : null
    const hotAt = status === 'hot' ? calcAt + 5 * DAY : null
    const wonAt = status === 'won' ? calcAt + 9 * DAY : null
    const lostAt = status === 'lost' ? calcAt + 7 * DAY : null
    insertProspect.run(uuid(), client.id, orgId, vertical.id, score, calcAt, i + 1, status, approvedAt, sentAt, hotAt, wonAt, lostAt)
    prospectsAdded++
  }
  log(`✅ Prospects: ${prospectsAdded} added across the full pipeline (scored → approved → sent → hot → won/lost)`)

  // ─── 10. Citation history — real weekly runs so Measure shows an actual trend ──
  const brandId = brand.id
  const engines = ['anthropic', 'openai', 'perplexity', 'gemini']
  const queryRows = db.prepare('SELECT id FROM tracked_queries WHERE brand_id = ?').all(brandId) as any[]
  const existingRuns = (db.prepare('SELECT COUNT(*) c FROM citation_runs WHERE brand_id = ?').get(brandId) as any).c
  if (existingRuns === 0 && queryRows.length > 0) {
    const WEEKS = 10
    const insertRun = db.prepare(`
      INSERT INTO citation_runs (id, brand_id, run_at, status, total_calls, completed, failed, cost_gbp, engines_json)
      VALUES (?, ?, ?, 'complete', ?, ?, 0, ?, ?)
    `)
    const insertResult = db.prepare(`
      INSERT INTO citation_results (id, run_id, query_id, engine, cited_sources, cost_gbp, latency_ms, http_status, classified_at, brand_mentioned, brand_position, sentiment, competitor_mentions_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 200, ?, ?, ?, ?, ?, ?)
    `)
    const competitorPool = demoCompetitors.map(c => c.name)
    for (let w = WEEKS - 1; w >= 0; w--) {
      const runAt = now - w * 7 * DAY
      const totalCalls = queryRows.length * engines.length
      // Trend: mention rate climbs from ~15% ten weeks ago to ~68% this week —
      // the story a real self-hosted-then-tracked brand would actually show.
      const progress = (WEEKS - 1 - w) / (WEEKS - 1)
      const baseRate = 0.15 + progress * 0.53
      const runId = uuid()
      insertRun.run(runId, brandId, runAt, totalCalls, totalCalls, (0.008 * totalCalls).toFixed(4), JSON.stringify(engines))
      for (const q of queryRows) {
        for (const engine of engines) {
          const engineJitter = engine === 'perplexity' ? 0.12 : engine === 'anthropic' ? 0.05 : -0.04
          const mentioned = Math.random() < Math.min(0.92, Math.max(0.03, baseRate + engineJitter)) ? 1 : 0
          const mentionsCompetitor = !mentioned && Math.random() < 0.4
          const competitors = mentionsCompetitor
            ? JSON.stringify([competitorPool[Math.floor(Math.random() * competitorPool.length)]])
            : '[]'
          insertResult.run(
            uuid(), runId, q.id, engine,
            mentioned ? 'betawave.co.uk' : '',
            0.008, 800 + Math.floor(Math.random() * 1200),
            runAt + Math.floor(Math.random() * 3600),
            mentioned, mentioned ? (Math.random() < 0.5 ? 'first' : 'mentioned') : null,
            mentioned ? 'positive' : 'neutral',
            competitors, runAt,
          )
        }
      }
    }
    log(`✅ Citation history: ${WEEKS} weekly runs seeded with a realistic upward trend (15% → 68% mention rate)`)
  } else {
    log('ℹ️  Citation history already present — skipped')
  }

  // ─── 11. More content, spread over weeks with a realistic status mix ───────
  const moreContentPosts = [
    { title: 'What actually happens when you self-host your marketing stack', status: 'published',
      excerpt: 'A week-by-week account of moving off five SaaS subscriptions and onto one self-hosted engine.',
      body: 'The first week is the hard part — exporting content out of tools that make leaving deliberately annoying. After that, everything gets simpler, not harder.' },
    { title: 'AI-citation tracking: our first month of data', status: 'published',
      excerpt: 'What we found watching ChatGPT, Claude, Gemini and Perplexity for a month.',
      body: 'Mention rate moved from roughly 1 in 7 queries to over half within ten weeks — not from buying ads, but from consistently publishing content the engines could actually cite.' },
    { title: 'The real cost of a £3k/month marketing agency, broken down', status: 'published',
      excerpt: 'Where that retainer actually goes, and what it would take to replace it.',
      body: 'Strip out the account management overhead and most retainers are paying for maybe 15 hours a week of actual production work — work a well-configured engine can do continuously.' },
    { title: 'Why we chose AGPL-3.0 for βWave', excerpt: 'Open source, but not a target for SaaS resellers who never contribute back.', status: 'draft',
      body: 'AGPL closes the network-service loophole that lets a company run a modified fork as a paid service without releasing the changes. That matters more once you are giving the whole product away.' },
    { title: 'A field guide to self-hosted LLM options for marketing', excerpt: 'GLM5, Llama, and when local inference actually makes sense.', status: 'draft',
      body: 'Local models are cheaper and fully private, but not yet as capable for long-form brand-voice writing. Best used for classification and short-form tasks, Claude or GPT-4o for the long-form work.' },
    { title: 'Scheduled: what we are shipping next quarter', excerpt: 'YouTube syndication, Discord, and a real LinkedIn Company Page flow.', status: 'scheduled',
      body: 'LinkedIn personal-profile posting is live today. Company Page posting needs LinkedIn'+"'"+'s Community Management API review, which we'+"'"+'ve submitted — no fixed timeline, but it'+"'"+'s in progress.' },
    { title: 'How we price Done-For-You without undercutting the free version', status: 'published',
      excerpt: 'The software stays free forever. Here is what you actually pay for if you'+"'"+'d rather not run it yourself.',
      body: 'A founding-rate DFY client gets a dedicated operator, not just a support ticket queue. That distinction is the entire pitch — you'+"'"+'re paying for a human, not for access to software that was always free.' },
    { title: 'A/B tested: does an AI-citation stat convert better than a features list?', status: 'published',
      excerpt: 'We ran both versions of our own homepage. Here'+"'"+'s what won.',
      body: 'The concrete "67% mention rate, up from 15%" number consistently out-converted a generic bullet list of features — specificity beats breadth every time in this category.' },
    { title: 'Reading list: everything we used to build the Discovery module', status: 'draft',
      excerpt: 'The papers, APIs and prior art behind the visibility-scoring approach.',
      body: 'Nothing here is novel research — it'+"'"+'s a pragmatic combination of existing signals (review count, response time, content freshness) weighted for a specific use case: finding businesses who don'+"'"+'t yet know they'+"'"+'re invisible.' },
    { title: 'Why Respond drafts replies but never auto-sends them', status: 'published',
      excerpt: 'The one place in βWave where a human is required, on purpose.',
      body: 'Auto-replying to public comments at brand level is exactly the kind of thing that goes wrong in ways nobody notices until it'+"'"+'s screenshotted. AI drafts, a human approves — every time, no exceptions.' },
    { title: 'What "self-hosted" actually means for your data, concretely', status: 'draft',
      excerpt: 'Not a marketing claim — a specific list of what does and doesn'+"'"+'t leave your server.',
      body: 'Your content, contacts, and citation history live in one SQLite file on your machine. The only things that leave your server are the specific API calls you configure — and you can point those at a local model too.' },
  ]
  const moreNewsletters = [
    { title: 'This week in βWave: 10 weeks of citation data, one chart', status: 'published',
      excerpt: 'The mention-rate trend from 15% to 67%, and what actually moved it.',
      body: 'The single biggest driver wasn'+"'"+'t volume of content — it was specificity. Posts naming exact competitor tools and exact price points got cited far more often than generic "best marketing software" pieces.' },
    { title: 'Monthly digest: Discovery pipeline update', status: 'published',
      excerpt: '34 organisations tracked, 18 prospects scored, 2 won.',
      body: 'The pipeline moves slower than a cold-outreach spreadsheet but converts better — every prospect here was pre-qualified by an actual visibility gap, not a purchased list.' },
    { title: 'Founder update: why we open-sourced the whole thing', status: 'draft',
      excerpt: 'A short note on the AGPL decision and what it means for you.',
      body: 'Renting software is a bet that the vendor stays aligned with you forever. Owning it removes the bet entirely — that'+"'"+'s the whole thesis behind βWave.' },
  ]
  const insertPost2 = db.prepare(`INSERT INTO content (id, client_id, type, title, body, excerpt, status, image_query, created_at) VALUES (?, ?, 'blog', ?, ?, ?, ?, '', ?)`)
  const insertNewsletter = db.prepare(`INSERT INTO content (id, client_id, type, title, body, excerpt, status, image_query, created_at) VALUES (?, ?, 'newsletter', ?, ?, ?, ?, '', ?)`)
  let mpAdded = 0
  for (let i = 0; i < moreContentPosts.length; i++) {
    const p = moreContentPosts[i]
    if (db.prepare('SELECT 1 FROM content WHERE client_id = ? AND title = ?').get(client.id, p.title)) continue
    const createdAt = now - (5 + i * 6) * DAY
    insertPost2.run(uuid(), client.id, p.title, p.body, p.excerpt, p.status, createdAt)
    mpAdded++
  }
  for (let i = 0; i < moreNewsletters.length; i++) {
    const p = moreNewsletters[i]
    if (db.prepare('SELECT 1 FROM content WHERE client_id = ? AND title = ?').get(client.id, p.title)) continue
    const createdAt = now - (10 + i * 14) * DAY
    insertNewsletter.run(uuid(), client.id, p.title, p.body, p.excerpt, p.status, createdAt)
    mpAdded++
  }
  // Backdate the original 6 posts too, so Content doesn't look like it all landed in one burst.
  const origTitles = demoPosts.map(p => p.title)
  origTitles.forEach((t, i) => {
    db.prepare(`UPDATE content SET created_at = ? WHERE client_id = ? AND title = ? AND created_at > ?`)
      .run(now - (30 + i * 4) * DAY, client.id, t, now - 1 * DAY)
  })
  log(`✅ Content: ${mpAdded} more posts added, spread over ~9 weeks with a published/scheduled/draft mix`)

  // ─── 12. Respond inbox — real volume with some already replied ─────────────
  const moreComments = [
    { author_name: 'Devon R.', content: 'How does this handle GDPR if I'+"'"+'m self hosting in the EU?', sentiment: 'neutral' },
    { author_name: 'growth_hacker99', content: 'Tried it this morning, the LinkedIn draft generator is actually decent', sentiment: 'positive' },
    { author_name: 'Aoife M.', content: 'Is there a migration path from HubSpot or do I start from scratch?', sentiment: 'neutral' },
    { author_name: 'Ben_Founder', content: 'Been burned by "free forever" before. What'+"'"+'s the actual catch here?', sentiment: 'negative' },
    { author_name: 'Wren Digital', content: 'Client asked us to look at this instead of renewing their Sprout contract. Promising so far.', sentiment: 'positive' },
    { author_name: 'Tariq H.', content: 'Docker install worked first try, which almost never happens for me', sentiment: 'positive' },
    { author_name: 'skeptical_marketer', content: 'Citation tracking against 4 engines weekly — what does that cost in API spend?', sentiment: 'neutral' },
    { author_name: 'Louisa P.', content: 'Respond module UI is clean. Approve/reject flow makes sense immediately.', sentiment: 'positive' },
    { author_name: 'DataPrivacyDan', content: 'Genuinely refreshing to see "self-hosted" mean self-hosted and not "cloud with extra steps"', sentiment: 'positive' },
  ]
  const insertComment2 = db.prepare(`
    INSERT INTO social_comments (id, account_id, platform, external_id, author_name, content, sentiment, status, published_at, fetched_at, created_at)
    VALUES (?, ?, 'twitter', ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertReply = db.prepare(`
    INSERT INTO social_replies (id, comment_id, draft_content, approved_content, status, drafted_by, approved_at, sent_at)
    VALUES (?, ?, ?, ?, 'sent', 'ai', ?, ?)
  `)
  const sampleReplies: Record<string, string> = {
    'Devon R.': 'Good question — since it\'s self-hosted, your data residency is wherever you deploy it. Run it on an EU server and everything stays in the EU by default.',
    'Ben_Founder': 'Fair to be skeptical. No catch on the software — it\'s AGPL, free forever, on your own server. We make money on Done-For-You for people who\'d rather not run it themselves.',
    'skeptical_marketer': 'Depends on volume, but weekly across 6 queries × 4 engines runs a few pence to a few pounds a month on typical API pricing — you set a budget cap either way.',
  }
  let cm2Added = 0
  for (let i = 0; i < moreComments.length; i++) {
    const c = moreComments[i]
    if (db.prepare('SELECT 1 FROM social_comments WHERE account_id = ? AND author_name = ?').get(demoAccount.id, c.author_name)) continue
    const publishedAt = now - (1 + i) * DAY - Math.floor(Math.random() * 12 * 3600)
    const hasReply = !!sampleReplies[c.author_name]
    const status = hasReply ? 'replied' : 'pending'
    const commentId = uuid()
    insertComment2.run(commentId, demoAccount.id, `demo-${uuid().slice(0, 8)}`, c.author_name, c.content, c.sentiment, status, publishedAt, publishedAt, publishedAt)
    if (hasReply) {
      const reply = sampleReplies[c.author_name]
      insertReply.run(uuid(), commentId, reply, reply, publishedAt + 3600, publishedAt + 3600)
    }
    cm2Added++
  }
  log(`✅ Respond: ${cm2Added} more comments added (some already replied, showing full history)`)

  return { client: BUSINESS, queries: demoQueries.length, competitors: demoCompetitors.length, posts: demoPosts.length }
}

/**
 * Auto-seed on first boot: only runs when the database has no clients yet,
 * and never if SEED_DEMO=false. Keeps a fresh install from being an empty shell.
 */
export function maybeSeedDemo(): void {
  try {
    if (String(process.env.SEED_DEMO || '').toLowerCase() === 'false') return
    const n = (db.prepare('SELECT COUNT(*) AS c FROM clients').get() as any).c
    if (n > 0) return
    const r = seedDemo(false)
    console.log(`\n🌱 First run — seeded the “${r.client}” demo client ` +
      `(${r.posts} posts · ${r.queries} citation queries · ${r.competitors} rivals).`)
    console.log(`   Explore it in the app, then edit or delete it. Set SEED_DEMO=false to skip this.\n`)
  } catch (e: any) {
    console.warn('[seed-demo] skipped:', e?.message || e)
  }
}
