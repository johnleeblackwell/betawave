// @ts-nocheck
/**
 * Demo seed — bootstraps a ready-to-explore βWave instance on first run.
 *
 * It creates ONE demo client: βWave itself. The instance comes configured to
 * market the very product you just installed — brand DNA, AI-citation tracking
 * queries, and a couple of draft posts — so a fresh install isn't an empty shell.
 * It's a live, self-proving example: βWave generating βWave's own marketing.
 *
 * Idempotent — safe to re-run; refreshes the demo client without duplicating.
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

// ─── 2. AI-citation tracking (tracked brand + queries) ───────────────────────
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
  { text: 'open source AI content generation and scheduling tool', category: 'discovery', priority: 2 },
  { text: 'how to track whether AI assistants recommend my business', category: 'discovery', priority: 2 },
  { text: 'self-hosted marketing automation with bring-your-own API keys', category: 'discovery', priority: 1 },
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

// ─── 3. Sample draft content ─────────────────────────────────────────────────
const demoPosts = [
  {
    type: 'blog',
    title: 'Own your marketing engine. Don’t rent it.',
    excerpt: 'Why we built βWave as software you install and own instead of one more SaaS subscription.',
    body:
      'Most businesses are renting ten marketing tools that each hold a slice of their data hostage. ' +
      'A scheduler here, a content tool there, an SEO seat, a social suite, an analytics login. ' +
      'Every one a monthly bill and a wall between you and your own work.\n\n' +
      'βWave collapses the stack into one engine you install on your own machine or server. ' +
      'Bring your own API keys, point it at a local model if you want, and your content never leaves your box. ' +
      'Cancel nothing — there is nothing to cancel. It’s yours.\n\n' +
      '(This is a demo post created by the seed script. Edit the βWave demo client or delete it and add your own.)',
    image_query: 'self hosted server ownership',
  },
  {
    type: 'blog',
    title: 'Do AI assistants recommend you? Now you can find out.',
    excerpt: 'AI-citation tracking shows whether ChatGPT, Claude, Gemini and Perplexity name you when customers ask.',
    body:
      'When someone asks an AI assistant "who’s the best option near me?", you are either in that answer or you are invisible. ' +
      'Most businesses have no idea which it is.\n\n' +
      'βWave’s Citation Tracker runs your high-intent queries across the major AI engines on a schedule and shows ' +
      'whether you were cited, which competitors were named, and what likely earned them the mention — so you can move the needle.\n\n' +
      '(Demo post from the seed script. The βWave demo client comes pre-loaded with example queries you can run.)',
    image_query: 'ai search assistant',
  },
]
const hasPost = db.prepare('SELECT 1 FROM content WHERE client_id = ? AND title = ?')
const insertPost = db.prepare(`INSERT INTO content (id, client_id, type, title, body, excerpt, status, image_query) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`)
let pAdded = 0
for (const p of demoPosts) {
  if (hasPost.get(client.id, p.title)) continue
  insertPost.run(uuid(), client.id, p.type, p.title, p.body, p.excerpt, p.image_query)
  pAdded++
}
console.log(`✅ Draft posts: ${pAdded} added (${demoPosts.length - pAdded} already present)`)

console.log('')
console.log('─'.repeat(46))
console.log(`  Demo ready. Open the app and explore the`)
console.log(`  "${BUSINESS}" client — brand DNA, citation`)
console.log(`  queries, and draft posts are pre-loaded.`)
console.log(`  Add your own AI key in Settings to generate.`)
console.log('─'.repeat(46))
