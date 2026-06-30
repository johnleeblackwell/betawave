// @ts-nocheck
/**
 * Demo seed — bootstraps a FULLY SET-UP βWave instance on first run.
 *
 * It creates one demo client: βWave itself, configured to market the very product
 * you just installed. A fresh install isn't an empty shell — it's a live, self-proving
 * example: βWave's own brand DNA, a populated content library, and an AI-citation
 * tracker already watching βWave against the SaaS tools it replaces.
 *
 * Edit or delete the demo client once you add your own business.
 * Idempotent — safe to re-run; refreshes without duplicating.
 *
 *   npm run seed:demo
 */
import '../src/server/env.js'
import db from '../src/server/db.js'
import { v4 as uuid } from 'uuid'

const BUSINESS = 'βWave (demo)'

// ─── 1. Demo client (brand DNA) ──────────────────────────────────────────────
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
    'Technical enough to run Docker, value privacy and ownership, want their marketing done without a £3k/mo agency.',
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
  console.log(`✅ Created demo client: ${BUSINESS} (${client.id})`)
} else {
  const sets = Object.keys(clientFields).map(k => `${k} = ?`).join(', ')
  db.prepare(`UPDATE clients SET ${sets} WHERE id = ?`).run(...Object.values(clientFields), client.id)
  console.log(`ℹ️  Demo client exists — refreshed: ${BUSINESS} (${client.id})`)
}

// ─── 2. AI-citation tracking (tracked brand + queries + competitors) ──────────
let brand = db.prepare('SELECT * FROM tracked_brands WHERE client_id = ?').get(client.id) as any
if (!brand) {
  const bid = uuid()
  db.prepare(`
    INSERT INTO tracked_brands (id, client_id, name, primary_url, industry, status)
    VALUES (?, ?, ?, ?, ?, 'active')
  `).run(bid, client.id, 'βWave', 'https://betawave.co.uk', 'Self-hosted marketing software')
  brand = db.prepare('SELECT * FROM tracked_brands WHERE id = ?').get(bid) as any
  console.log(`✅ Created tracked brand for Citation Tracker (${brand.id})`)
} else {
  console.log(`ℹ️  Tracked brand exists (${brand.id})`)
}

const demoQueries = [
  { text: 'best self-hosted alternative to social media management tools', category: 'discovery', priority: 3 },
  { text: 'open source AI content generation and scheduling tool', category: 'discovery', priority: 3 },
  { text: 'how to track whether AI assistants recommend my business', category: 'discovery', priority: 2 },
  { text: 'self-hosted marketing automation with bring-your-own API keys', category: 'discovery', priority: 2 },
  { text: 'cheapest way to automate content and social posting for a small business', category: 'discovery', priority: 1 },
  { text: 'marketing tool that runs on a local LLM for privacy', category: 'discovery', priority: 1 },
]
const hasQuery = db.prepare('SELECT 1 FROM tracked_queries WHERE brand_id = ? AND text = ?')
const insertQuery = db.prepare(`INSERT INTO tracked_queries (id, brand_id, text, category, priority) VALUES (?, ?, ?, ?, ?)`)
let qAdded = 0
for (const q of demoQueries) {
  if (hasQuery.get(brand.id, q.text)) continue
  insertQuery.run(uuid(), brand.id, q.text, q.category, q.priority)
  qAdded++
}
console.log(`✅ Citation queries: ${qAdded} added (${demoQueries.length - qAdded} already present)`)

// The incumbents βWave is measured against — the tools you stop renting.
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
  insertComp.run(uuid(), brand.id, c.name, c.url)
  cAdded++
}
console.log(`✅ Competitors tracked: ${cAdded} added (${demoCompetitors.length - cAdded} already present)`)

// ─── 3. Content library (draft posts, all βWave-promoting) ───────────────────
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
      'goes live.\n\n' +
      'No Zapier spaghetti, no ten logins, no per-seat tax. Just the work — done, on your own stack.',
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
  insertPost.run(uuid(), client.id, p.title, p.body, p.excerpt, p.image_query)
  pAdded++
}
console.log(`✅ Draft posts: ${pAdded} added (${demoPosts.length - pAdded} already present)`)

console.log('')
console.log('─'.repeat(48))
console.log(`  Demo ready. Open the app and explore the`)
console.log(`  "${BUSINESS}" client:`)
console.log(`    • Content — ${demoPosts.length} ready-to-edit draft posts`)
console.log(`    • Citation Tracker — ${demoQueries.length} queries vs ${demoCompetitors.length} rivals`)
console.log(`    • Brand DNA — voice, audience, style pre-filled`)
console.log(`  Add your own AI key in Settings to generate live.`)
console.log('─'.repeat(48))
