/**
 * Syndication pipeline — RSS source → derivative post → X (Twitter) destination.
 *
 * Flow per route:
 *   1. Fetch RSS feed via existing rss service
 *   2. For each new item (not in `syndications` table for this route)
 *   3. LLM-rewrite source content into a tight, on-voice X post (≤280 chars)
 *   4. POST to X via OAuth 1.0a using route's destination credentials
 *   5. Persist syndications row with status + posted_id
 *
 * No approval queue — directive says source content is already public.
 * Daily cap per route prevents runaway costs / X rate limits.
 */
import crypto from 'node:crypto'
import db from '../db.js'
import Parser from 'rss-parser'
import { generate } from './llm.js'
import { sendTelegram } from './telegram.js'

/** Post to a destination by platform → normalized { id, url }.
 *  `opts.title` is used by long-form mesh destinations (Reddit self-post title, Medium title);
 *  micro-post platforms (X, Telegram) ignore it. */
export async function postToDestination(dest: any, text: string, mediaUrls: string[] = [], opts: { title?: string } = {}): Promise<{ id: string; url: string }> {
  if (dest.platform === 'x') {
    const r = await postToX(dest, text, mediaUrls)
    return { id: String(r.id), url: `https://x.com/${dest.handle.replace(/^@/, '')}/status/${r.id}` }
  }
  if (dest.platform === 'telegram') {
    const r = await sendTelegram(dest, text)   // text-only for now (no media)
    const handle = dest.handle.replace(/^@/, '')
    const url = /^-?\d+$/.test(dest.handle) ? '' : `https://t.me/${handle}/${r?.message_id ?? ''}`
    return { id: String(r?.message_id ?? ''), url }
  }
  // ── Mesh (off-domain) destinations ──
  if (dest.platform === 'reddit') {
    const title = (opts.title || text.split('\n')[0]).slice(0, 300)
    const body = opts.title ? text : (text.split('\n').slice(1).join('\n').trim() || text)
    return postToReddit(dest, title, body)
  }
  if (dest.platform === 'medium') {
    const title = (opts.title || text.split('\n')[0]).slice(0, 100)
    return postToMedium(dest, title, opts.title ? text : text)
  }
  if (dest.platform === 'facebook') {
    return postToFacebook(dest, text, mediaUrls)
  }
  if (dest.platform === 'instagram') {
    return postToInstagram(dest, text, mediaUrls)
  }
  if (dest.platform === 'linkedin') {
    return postToLinkedIn(dest, text, mediaUrls)
  }
  if (dest.platform === 'youtube') {
    throw new Error('YouTube posting depends on the video-generation pipeline (upstream) + YouTube Data API OAuth. Scaffolded — enable once video gen lands.')
  }
  throw new Error(`Platform ${dest.platform} not supported`)
}

const parser = new Parser({ timeout: 15000 })

/** Turn raw Anthropic/API error messages into something readable in the UI. */
function humaniseApiError(e: any): string {
  const msg: string = e?.message || String(e)
  // Anthropic SDK throws with the raw JSON body as the message
  try {
    const parsed = JSON.parse(msg.replace(/^\d+\s+/, '')) // strip leading status code
    if (parsed?.error?.type === 'overloaded_error') return 'Anthropic API is busy right now — try again in a moment'
    if (parsed?.error?.message) return `AI error: ${parsed.error.message}`
  } catch { /* not JSON */ }
  if (msg.includes('529') || msg.toLowerCase().includes('overload')) return 'Anthropic API is busy right now — try again in a moment'
  if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) return 'API key rejected — check your Anthropic API key'
  if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) return 'Rate limit hit — wait a minute and try again'
  return msg
}

interface Route {
  id: string
  client_id: string
  source_id: string
  destination_id: string
  rewrite_prompt: string
  active: number
  posts_today: number
  daily_cap: number
}

interface Source {
  id: string
  url: string
  handle: string
  source_type: string
  api_token: string
  last_item_id: string
}

interface PoolItem {
  id: string
  client_id: string
  source_type: string
  source_item_id: string
  url: string
  title: string
  body: string
  pub_date: number | null
  last_tweeted_at: number | null
  tweet_count: number
}

interface Destination {
  id: string
  platform: string
  handle: string
  api_key: string
  api_secret: string
  access_token: string
  access_secret: string
  account_id?: string   // Meta: FB Page ID / IG Business user ID
}

/**
 * Main tick — called by scheduler every 30 min.
 *
 * RSS routes → evergreen pool picker (LLM selects seasonally-appropriate item).
 * Instagram routes → live fetch, dedupe by syndications table (unchanged).
 */
export async function runSyndicationTick(): Promise<{ posted: number; failed: number; skipped: number }> {
  const routes = db.prepare(`SELECT * FROM syndication_routes WHERE active = 1`).all() as unknown as Route[]
  let posted = 0, failed = 0, skipped = 0

  for (const route of routes) {
    if (route.posts_today >= route.daily_cap) { skipped++; continue }

    const source = db.prepare(`SELECT * FROM syndication_sources WHERE id = ? AND active = 1`).get(route.source_id) as Source | undefined
    const dest   = db.prepare(`SELECT * FROM syndication_destinations WHERE id = ? AND active = 1`).get(route.destination_id) as Destination | undefined
    if (!source || !dest) { skipped++; continue }

    // Destination-level stagger: when multiple routes feed the same X handle,
    // enforce a minimum gap between posts so they don't burst. Default 60 min.
    const minMinutes = (dest as any).min_minutes_between_posts ?? 60
    if (minMinutes > 0) {
      const lastOnDest = db.prepare(`
        SELECT posted_at FROM syndications
        WHERE destination_id = ? AND status = 'posted'
        ORDER BY posted_at DESC LIMIT 1
      `).get(dest.id) as { posted_at?: number } | undefined
      const lastTs = lastOnDest?.posted_at || 0
      const sinceSec = Math.floor(Date.now() / 1000) - lastTs
      if (lastTs > 0 && sinceSec < minMinutes * 60) {
        console.log(`[syndication] route ${route.id} skipped — destination ${dest.handle} throttled (${Math.floor(sinceSec/60)}/${minMinutes} min since last post)`)
        skipped++
        continue
      }
    }

    const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(route.client_id) as any

    try {
      if (source.source_type === 'rss') {
        // ── Pool-based path: refresh library, LLM picks the best post for today ──
        try {
          await upsertPoolFromRSS(source, route.client_id)
        } catch (e: any) {
          console.warn(`[syndication] pool refresh failed for source ${source.id}: ${e.message}`)
        }

        const poolItem = await pickBestFromPool(client, route.client_id, route.id)
        if (!poolItem) { skipped++; continue }

        const rewritten = await rewriteForX(client, poolItem.title, poolItem.body, route.rewrite_prompt, withUtm(poolItem.url, dest.platform), dest.platform)

        const syndId = crypto.randomUUID()
        db.prepare(`
          INSERT INTO syndications
            (id, client_id, route_id, source_id, destination_id, source_item_id,
             source_url, source_text, rewritten_text, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `).run(syndId, route.client_id, route.id, source.id, dest.id, poolItem.source_item_id,
               poolItem.url, poolItem.title + '\n\n' + poolItem.body.slice(0, 500), rewritten)

        try {
          // Image-first platforms: IG refuses text-only posts; FB photo posts
          // reach further than plain text. Stock cascade only — free, and the
          // URLs are stable for Meta's server-side download.
          let media: string[] = []
          if (dest.platform === 'instagram' || dest.platform === 'facebook') {
            media = await sourceMediaForPost(client, poolItem.title)
          }
          const { id: postedId, url: postedUrl } = await postToDestination(dest, rewritten, media)
          const now = Math.floor(Date.now() / 1000)
          db.prepare(`UPDATE syndications SET status='posted', posted_id=?, posted_url=?, posted_at=? WHERE id=?`)
            .run(postedId, postedUrl, now, syndId)
          db.prepare(`UPDATE syndication_routes SET posts_today = posts_today + 1 WHERE id = ?`).run(route.id)
          db.prepare(`UPDATE syndication_pool SET last_tweeted_at=?, tweet_count=tweet_count+1 WHERE id=?`)
            .run(now, poolItem.id)
          posted++
          console.log(`[syndication] pool post: ${dest.handle} (${dest.platform}) ← "${poolItem.title}" (${rewritten.length} chars)`)
        } catch (e: any) {
          markFailed(syndId, e.message)
          failed++
          console.error(`[syndication] post failed:`, e.message)
        }

      } else {
        // ── Live-fetch path: Instagram and other real-time sources ──
        const newItems = await fetchNewItems(source, route.id)
        if (newItems.length === 0) { skipped++; continue }

        const item = newItems[0]
        const rewritten = await rewriteForX(client, item.title || '', item.content || '', route.rewrite_prompt, withUtm(item.url, dest.platform), dest.platform)

        const syndId = crypto.randomUUID()
        db.prepare(`
          INSERT INTO syndications
            (id, client_id, route_id, source_id, destination_id, source_item_id,
             source_url, source_text, rewritten_text, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `).run(syndId, route.client_id, route.id, source.id, dest.id, item.id,
               item.url || '', (item.title || '') + '\n\n' + (item.content || ''), rewritten)

        try {
          let media: string[] = item.media_urls || []
          if (!media.length && (dest.platform === 'instagram' || dest.platform === 'facebook')) {
            media = await sourceMediaForPost(client, item.title || '')
          }
          const { id: postedId, url: postedUrl } = await postToDestination(dest, rewritten, media)
          db.prepare(`UPDATE syndications SET status='posted', posted_id=?, posted_url=?, posted_at=? WHERE id=?`)
            .run(postedId, postedUrl, Math.floor(Date.now() / 1000), syndId)
          db.prepare(`UPDATE syndication_routes SET posts_today = posts_today + 1 WHERE id = ?`).run(route.id)
          db.prepare(`UPDATE syndication_sources SET last_item_id = ?, last_polled = ? WHERE id = ?`)
            .run(item.id, Math.floor(Date.now() / 1000), source.id)
          posted++
          console.log(`[syndication] live post: ${dest.handle} (${dest.platform}) ← ${item.url} (${rewritten.length} chars)`)
        } catch (e: any) {
          markFailed(syndId, e.message)
          failed++
          console.error(`[syndication] post failed:`, e.message)
        }
      }
    } catch (e: any) {
      failed++
      console.error(`[syndication] route ${route.id} failed:`, e.message)
    }
  }

  return { posted, failed, skipped }
}

function markFailed(id: string, err: string) {
  db.prepare(`UPDATE syndications SET status = 'failed', error = ? WHERE id = ?`).run(err.slice(0, 500), id)
}

/**
 * Force-reset posts_today counters (manual / one-shot use).
 */
export function resetDailyCaps(): void {
  db.prepare(`UPDATE syndication_routes SET posts_today = 0`).run()
}

/**
 * Reset posts_today once per UTC day, PERSISTED across restarts.
 *
 * Safe to call on every scheduler tick — only acts when the calendar day rolls
 * over. Replaces the previous in-memory day tracker (`lastSyndicationDay` in
 * scheduler.ts), which reset to "today" on every server restart. After the
 * Hetzner migration that bug left posts_today frozen at the cap, silently
 * skipping all routes and halting the syndication feed.
 */
export function maybeResetDailyCaps(): void {
  const today = new Date().toISOString().slice(0, 10) // UTC YYYY-MM-DD
  const row = db.prepare(`SELECT value FROM app_state WHERE key = 'syndication_last_reset'`).get() as { value?: string } | undefined
  if (row?.value === today) return
  db.prepare(`UPDATE syndication_routes SET posts_today = 0`).run()
  db.prepare(`INSERT INTO app_state (key, value) VALUES ('syndication_last_reset', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(today)
  console.log(`[syndication] daily caps reset (new UTC day ${today})`)
}

// ─────────────────────────────────────────────────────────────────────────────
// RSS fetching
// ─────────────────────────────────────────────────────────────────────────────
interface FeedItem {
  id: string
  url: string
  title: string
  content: string
  pub_date?: number
  media_urls?: string[]  // image URLs to attach to the post (up to 4 for X)
}

async function fetchNewItems(source: Source, routeId: string): Promise<FeedItem[]> {
  // Build dedupe set from items that were SUCCESSFULLY POSTED on this route.
  // Only 'posted' counts — a 'failed' attempt (e.g. X API 402 CreditsDepleted)
  // must remain eligible to retry, otherwise a transient outage permanently
  // burns that content and the feed silently dries up.
  const seen = new Set(
    (db.prepare(`SELECT source_item_id FROM syndications WHERE route_id = ? AND status = 'posted'`).all(routeId) as any[])
      .map(r => r.source_item_id)
  )

  let items: FeedItem[] = []
  if (source.source_type === 'rss') {
    items = await fetchFromRSS(source)
  } else if (source.source_type === 'apify_instagram') {
    items = await fetchFromApifyInstagram(source)
  } else if (source.source_type === 'ig_graph') {
    items = await fetchFromIgGraph(source)
  } else {
    return []
  }

  return items
    .filter(it => it.id && !seen.has(it.id))
    .sort((a, b) => (b.pub_date || 0) - (a.pub_date || 0))
    .slice(0, 5) // never consider more than 5 fresh items per tick
}

async function fetchFromRSS(source: Source): Promise<FeedItem[]> {
  const feed = await parser.parseURL(source.url)
  if (!feed.items || feed.items.length === 0) return []
  return feed.items.map(it => {
    // RSS images can live in several places — pick up the most common ones
    const mediaUrls: string[] = []
    if (it.enclosure?.url && (it.enclosure.type || '').startsWith('image/')) mediaUrls.push(it.enclosure.url)
    if ((it as any)['media:thumbnail']?.['$']?.url) mediaUrls.push((it as any)['media:thumbnail']['$'].url)
    if ((it as any)['media:content']?.['$']?.url) mediaUrls.push((it as any)['media:content']['$'].url)
    // Extract first <img src="..."> from content HTML as a final fallback
    const html = (it as any).content || (it as any)['content:encoded'] || ''
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i)
    if (imgMatch && !mediaUrls.includes(imgMatch[1])) mediaUrls.push(imgMatch[1])

    return {
      id:       it.guid || it.link || it.title || '',
      url:      it.link || '',
      title:    it.title || '',
      content:  (it.contentSnippet || it.content || '').slice(0, 2000),
      pub_date: it.isoDate ? Math.floor(new Date(it.isoDate).getTime() / 1000) : undefined,
      media_urls: mediaUrls.slice(0, 4),
    }
  })
}

/**
 * Apify Instagram Profile Scraper integration.
 *
 * For source_type='apify_instagram':
 *   - source.url     = the Instagram handle (no @, no URL — just 'yourbrandhandle')
 *   - source.api_token = Apify API token (from apify.com → Settings → Integrations)
 *
 * Calls the canonical actor `apify/instagram-profile-scraper` via the
 * synchronous run-sync-get-dataset-items endpoint. Returns the latest posts
 * normalised into the same FeedItem shape used by RSS.
 *
 * Cost: ~£0.001–0.005 per call (depending on Apify's per-result pricing tier).
 * At 30-min cadence this is ~£0.05–0.25/day per source.
 */
async function fetchFromApifyInstagram(source: Source): Promise<FeedItem[]> {
  if (!source.api_token) throw new Error('Apify API token is required on this source')
  const handle = source.url.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '')
  if (!handle) throw new Error('Instagram handle is required (url field)')

  const actorId = 'apify~instagram-profile-scraper'
  const endpoint = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(source.api_token)}`

  const input = {
    usernames: [handle],
    resultsLimit: 10,           // how many recent posts to pull per run
    addParentData: false,
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Apify HTTP ${res.status}: ${errText.slice(0, 300)}`)
  }

  const data = await res.json() as any[]
  if (!Array.isArray(data) || data.length === 0) return []

  // The Instagram Profile Scraper returns either:
  //   - One profile row containing a `latestPosts` array, OR
  //   - Posts directly as separate items.
  // Handle both shapes defensively.
  const rawPosts: any[] = []
  for (const row of data) {
    if (Array.isArray(row?.latestPosts)) {
      rawPosts.push(...row.latestPosts)
    } else if (row?.shortCode || row?.caption) {
      rawPosts.push(row)
    }
  }

  return rawPosts.map(p => {
    const shortCode = p.shortCode || p.shortcode || p.code || ''
    const caption   = (p.caption || p.text || '').slice(0, 2000)
    const url       = p.url || (shortCode ? `https://www.instagram.com/p/${shortCode}/` : '')
    const ts        = p.timestamp ? Math.floor(new Date(p.timestamp).getTime() / 1000)
                    : p.takenAtTimestamp ? Number(p.takenAtTimestamp) : undefined

    // Image extraction — handles single posts, carousels, and video thumbnails.
    // Different actor versions / post types return different field names; check
    // them all defensively. We grab up to 4 for X's media-per-tweet limit.
    const mediaUrls: string[] = []
    if (Array.isArray(p.images))             mediaUrls.push(...p.images)
    if (Array.isArray(p.imageUrls))          mediaUrls.push(...p.imageUrls)
    if (Array.isArray(p.sidecarMedia))       mediaUrls.push(...p.sidecarMedia.map((m: any) => m?.displayUrl || m?.url).filter(Boolean))
    if (p.displayUrl && !mediaUrls.includes(p.displayUrl))   mediaUrls.unshift(p.displayUrl)
    if (p.image_url && !mediaUrls.includes(p.image_url))     mediaUrls.unshift(p.image_url)
    if (p.thumbnailUrl && p.type === 'Video' && !mediaUrls.length) mediaUrls.push(p.thumbnailUrl)

    return {
      id:       shortCode || url || caption.slice(0, 40),
      url,
      title:    `@${handle} on Instagram`,
      content:  caption,
      pub_date: ts,
      media_urls: mediaUrls.slice(0, 4),
    }
  })
}

/**
 * Instagram Graph API — read your OWN account's recent media, free.
 *
 * For source_type='ig_graph':
 *   - source.url       = the IG Business user ID (numeric — same id used as
 *                         `account_id` on an Instagram/Facebook destination,
 *                         from Graph Explorer: me/accounts?fields=instagram_business_account)
 *   - source.api_token = a long-lived Page access token with instagram_basic
 *   - source.handle    = cosmetic only (e.g. '@yourbrand')
 *
 * This only works for accounts you administratively control (Business/Creator,
 * linked to a Facebook Page) — for public accounts you don't own, there is no
 * free official read path; that's what apify_instagram is for.
 */
async function fetchFromIgGraph(source: Source): Promise<FeedItem[]> {
  if (!source.api_token) throw new Error('ig_graph source needs a Page access token in api_token')
  const igUserId = source.url.trim()
  if (!igUserId) throw new Error('ig_graph source needs the IG Business user ID in url')

  const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp'
  const endpoint = `https://graph.facebook.com/v19.0/${igUserId}/media?fields=${fields}&limit=10&access_token=${encodeURIComponent(source.api_token)}`

  const res = await fetch(endpoint)
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Instagram Graph API HTTP ${res.status}: ${errText.slice(0, 300)}`)
  }

  const data = await res.json() as any
  const posts: any[] = Array.isArray(data?.data) ? data.data : []

  return posts.map(p => {
    const ts = p.timestamp ? Math.floor(new Date(p.timestamp).getTime() / 1000) : undefined
    // Video posts have no media_url for the video itself in this field set —
    // fall back to the thumbnail so there's still an image to attach.
    const mediaUrl = p.media_type === 'VIDEO' ? p.thumbnail_url : p.media_url
    return {
      id:       p.id,
      url:      p.permalink || '',
      title:    `@${source.handle?.replace(/^@/, '') || igUserId} on Instagram`,
      content:  (p.caption || '').slice(0, 2000),
      pub_date: ts,
      media_urls: mediaUrl ? [mediaUrl] : [],
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Evergreen pool — upsert + LLM picker
// ─────────────────────────────────────────────────────────────────────────────

/** Fetch all RSS items and upsert them into the pool for this client. */
async function upsertPoolFromRSS(source: Source, clientId: string): Promise<void> {
  const items = await fetchFromRSS(source)
  const stmt = db.prepare(`
    INSERT INTO syndication_pool (id, client_id, source_type, source_item_id, url, title, body, pub_date)
    VALUES (?, ?, 'rss', ?, ?, ?, ?, ?)
    ON CONFLICT(client_id, source_item_id) DO UPDATE SET
      url   = excluded.url,
      title = excluded.title,
      body  = excluded.body
  `)
  for (const item of items) {
    stmt.run(crypto.randomUUID(), clientId, item.id, item.url, item.title,
             item.content.slice(0, 3000), item.pub_date ?? null)
  }
}

/** Cooldown: don't re-tweet the same item on the same route within this window. */
const POOL_COOLDOWN_DAYS = 60
const POOL_COOLDOWN_SECS = POOL_COOLDOWN_DAYS * 24 * 60 * 60

/**
 * LLM-assisted picker — returns the pool item most suitable for today.
 *
 * Excludes items posted on this route within the cooldown window, then asks
 * Claude Haiku to pick the seasonally-appropriate item from the shortlist.
 * Falls back to the highest-priority candidate if the LLM call fails.
 */
async function pickBestFromPool(client: any, clientId: string, routeId: string): Promise<PoolItem | null> {
  const now = Math.floor(Date.now() / 1000)
  const cutoff = now - POOL_COOLDOWN_SECS

  // Items recently posted on this route (within cooldown)
  const recentIds = new Set(
    (db.prepare(`SELECT source_item_id FROM syndications WHERE route_id = ? AND posted_at > ?`)
      .all(routeId, cutoff) as any[]).map(r => r.source_item_id)
  )

  // Candidates: not recently tweeted globally, not recently posted on this route
  // Order: never-tweeted first, then least-recently-tweeted; break ties by pub_date desc
  const candidates = (db.prepare(`
    SELECT * FROM syndication_pool
    WHERE client_id = ?
      AND (last_tweeted_at IS NULL OR last_tweeted_at < ?)
    ORDER BY tweet_count ASC, COALESCE(last_tweeted_at, 0) ASC, COALESCE(pub_date, 0) DESC
    LIMIT 20
  `).all(clientId, cutoff) as unknown as PoolItem[])
    .filter(p => !recentIds.has(p.source_item_id))
    .slice(0, 15)

  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  // Build a compact list for the LLM — title + publish month only
  const today = new Date()
  const monthYear = today.toLocaleString('en-GB', { month: 'long', year: 'numeric' })
  const businessName = client.business_name || 'the business'

  const list = candidates.map((c, i) => {
    const pubLabel = c.pub_date
      ? new Date(c.pub_date * 1000).toLocaleString('en-GB', { month: 'long', year: 'numeric' })
      : 'undated'
    return `${i + 1}. [${c.id}] "${c.title}" (${pubLabel}, tweeted ${c.tweet_count}×)`
  }).join('\n')

  const prompt =
`Today is ${monthYear} (UK).
Blog post candidates for ${businessName}:
${list}

Pick the single best post to tweet today.
- It is currently ${today.toLocaleString('en-GB', { month: 'long' })} — avoid summer/outdoor content in winter, Christmas content in summer
- Deprioritise posts about specific events, expired promotions, or celebrities who may no longer be trending
- Prefer posts not tweeted recently (low tweet count)
- Evergreen educational content is always suitable

Reply with ONLY the ID from the brackets. Nothing else.`

  try {
    const result = await generate(client, {
      system: 'You are a content scheduler. Output only a single pool item ID — no explanation, no quotes.',
      prompt,
      max_tokens: 60,
      temperature: 0,
    })
    const pickedId = result.text.trim().replace(/['"[\]\s]/g, '')
    const picked = candidates.find(c => c.id === pickedId)
    if (picked) {
      console.log(`[syndication] pool picker chose: "${picked.title}" (from ${candidates.length} candidates)`)
      return picked
    }
    console.warn(`[syndication] pool picker returned unknown id "${pickedId}" — using fallback`)
  } catch (e: any) {
    console.warn(`[syndication] pool picker LLM failed: ${e.message} — using fallback`)
  }
  return candidates[0]
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM rewriter — convert source content into on-voice X post
// ─────────────────────────────────────────────────────────────────────────────
/** Tag outbound links so GA can attribute social traffic per platform. */
function withUtm(url: string | undefined | null, platform: string): string | undefined {
  if (!url) return undefined
  try {
    const u = new URL(url)
    u.searchParams.set('utm_source', platform)
    u.searchParams.set('utm_medium', 'social')
    u.searchParams.set('utm_campaign', 'syndication')
    return u.toString()
  } catch { return url }
}

/** Free stock image for image-first platforms. Best-effort — never blocks the post
 *  (except on IG, where postToInstagram itself enforces the image requirement). */
async function sourceMediaForPost(client: any, title: string): Promise<string[]> {
  try {
    const { getImageForPost } = await import('./images.js')
    const img = await getImageForPost({
      title,
      industry: client.industry || '',
      excerpt: '',
      imageSource: 'stock',   // stock only — DALL-E per syndicated post would burn spend silently
      searchQuery: title,
    })
    return img?.downloadUrl ? [img.downloadUrl] : []
  } catch (e: any) {
    console.warn(`[syndication] image sourcing failed for "${title}": ${e.message}`)
    return []
  }
}

// Per-platform rewrite behaviour. X stays the default (and the function keeps
// its historical name — every call site already routes through here).
const REWRITE_SPECS: Record<string, { label: string; budget: number; appendUrl: boolean; rules: string }> = {
  x: {
    label: 'X (formerly Twitter)', budget: 253, appendUrl: true,
    rules: `- One idea, one sentence preferred
- No hashtag spam — at most 2 if they're genuinely useful`,
  },
  facebook: {
    label: 'Facebook', budget: 600, appendUrl: true,
    rules: `- 40–80 words, warm and conversational — like telling a friend, not broadcasting
- End with a question or soft invitation to comment when natural
- At most 1–2 hashtags, or none`,
  },
  linkedin: {
    label: 'LinkedIn', budget: 2500, appendUrl: false,
    rules: `- 120–200 words. LinkedIn's hard limit is 3000 characters — do not write a tweet
- Do NOT include a URL. LinkedIn suppresses reach on posts carrying external links,
  so the post must stand alone and deliver the insight rather than tease it
- Open with a specific, concrete claim. Never a question hook ("Ever wondered…")
- Short paragraphs, one or two sentences each, separated by blank lines
- No hashtags, no emoji, no engagement-bait CTA`,
  },
  instagram: {
    label: 'Instagram', budget: 2000, appendUrl: false,
    rules: `- 100–150 word caption. The FIRST LINE must hook — it's all that shows before "…more"
- Do NOT include any URL — links are not clickable in IG captions
- Emojis woven through naturally
- End with a blank line then 10–15 relevant hashtags`,
  },
}

async function rewriteForX(client: any, title: string, body: string, customPrompt: string, sourceUrl?: string, platform: string = 'x'): Promise<string> {
  const brandVoice = client.brand_voice || client.tone_of_voice || 'professional, warm'
  const businessName = client.business_name || 'the business'
  const spec = REWRITE_SPECS[platform] || REWRITE_SPECS.x

  // X counts every URL as 23 chars (t.co). Budget text to 253 chars so the
  // appended URL + space fits within the 280 hard limit.
  const appendUrl = spec.appendUrl && !!sourceUrl
  const textBudget = platform === 'x' ? (appendUrl ? 253 : 270) : spec.budget

  const system = customPrompt || `You rewrite social posts for ${spec.label} on behalf of “${businessName}”.

VOICE: ${brandVoice}

RULES:
- Maximum ${textBudget} characters${appendUrl ? ' — a source link will be appended automatically, do NOT include a URL yourself' : ''}
${spec.rules}
- No “Excited to announce”, no marketing-speak, no AI clichés
- Keep relevant emojis from source if natural
- Sound like a human posted it from a phone, not a brand strategist
- Plain text only — no markdown

Output ONLY the post text. Nothing else. No quotes around it. No prefix.`

  const prompt = `Source post:\n\nTitle: ${title}\n\nBody: ${body}\n\nRewrite as one ${spec.label} post.`

  const result = await generate(client, { system, prompt, max_tokens: 700, temperature: 0.8 })
  let text = result.text.trim()
  // Strip wrapping quotes if model added any
  if ((text.startsWith('”') && text.endsWith('”')) || (text.startsWith('”') && text.endsWith('”'))) {
    text = text.slice(1, -1).trim()
  }
  // Hard cap text portion — chop at last space if over budget
  if (text.length > textBudget) {
    text = text.slice(0, textBudget - 1).replace(/\s+\S*$/, '') + '…'
  }
  // Append source URL — X/FB auto-preview it as a card
  if (appendUrl) text = `${text} ${sourceUrl}`
  return text
}

// ─────────────────────────────────────────────────────────────────────────────
// X (Twitter) API v2 — OAuth 1.0a User Context for posting tweets
// ─────────────────────────────────────────────────────────────────────────────
// Meta Graph API — Facebook Pages + Instagram Business
//
// Both use the SAME credentials model: dest.account_id = the Graph object id
// (FB Page ID, or IG Business user ID), dest.access_token = a long-lived Page
// access token from a Meta app where the Page/IG account is linked.
// IG hard rule: the API refuses text-only posts — an image URL is mandatory,
// and it must be publicly fetchable (Meta's servers download it).
// ─────────────────────────────────────────────────────────────────────────────
const META_GRAPH = 'https://graph.facebook.com/v21.0'

async function metaApi(path: string, params: Record<string, string>): Promise<any> {
  const res = await fetch(`${META_GRAPH}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
  const data = await res.json() as any
  if (!res.ok || data.error) {
    const msg = data?.error?.message || `HTTP ${res.status}`
    throw new Error(`Meta API ${path}: ${msg}`)
  }
  return data
}

async function postToFacebook(dest: Destination & { account_id?: string }, text: string, mediaUrls: string[] = []): Promise<{ id: string; url: string }> {
  const pageId = (dest.account_id || '').trim()
  if (!pageId) throw new Error('Facebook destination needs account_id (the Page ID) — edit the destination and add it')
  if (!dest.access_token) throw new Error('Facebook destination needs access_token (a Page access token)')

  let data: any
  if (mediaUrls.length > 0) {
    // Photo post — image URL is downloaded by Meta's servers
    data = await metaApi(`${pageId}/photos`, {
      url: mediaUrls[0],
      caption: text,
      access_token: dest.access_token,
    })
  } else {
    data = await metaApi(`${pageId}/feed`, {
      message: text,
      access_token: dest.access_token,
    })
  }
  const id = String(data.post_id || data.id)
  return { id, url: `https://www.facebook.com/${id}` }
}

async function postToInstagram(dest: Destination & { account_id?: string }, text: string, mediaUrls: string[] = []): Promise<{ id: string; url: string }> {
  const igUserId = (dest.account_id || '').trim()
  if (!igUserId) throw new Error('Instagram destination needs account_id (the IG Business user ID) — edit the destination and add it')
  if (!dest.access_token) throw new Error('Instagram destination needs access_token (a Page access token with instagram_content_publish)')
  if (!mediaUrls.length) throw new Error('Instagram requires an image — the Graph API refuses text-only posts. Attach media or enable image sourcing on the route.')

  // Two-step publish: create a media container, then publish it
  const container = await metaApi(`${igUserId}/media`, {
    image_url: mediaUrls[0],
    caption: text.slice(0, 2200),
    access_token: dest.access_token,
  })
  const published = await metaApi(`${igUserId}/media_publish`, {
    creation_id: container.id,
    access_token: dest.access_token,
  })
  const id = String(published.id)
  const handle = (dest.handle || '').replace(/^@/, '')
  return { id, url: handle ? `https://www.instagram.com/${handle}/` : '' }
}

/**
 * LinkedIn — Posts API (personal profile, `w_member_social` scope).
 *
 * Credential acquisition is a one-time manual OAuth 2.0 flow (LinkedIn has no
 * in-browser token generator like Meta's Graph API Explorer, so βWave doesn't
 * attempt to automate it): visit LinkedIn's authorize URL, approve, exchange
 * the returned code for an access token, then resolve the person URN via the
 * OpenID Connect /v2/userinfo endpoint. See docs/syndicate.md.
 *
 * Access tokens last ~60 days with no refresh token on standard self-serve
 * apps — re-authorize when postToDestination starts throwing 401s.
 */
async function postToLinkedIn(dest: Destination & { account_id?: string }, text: string, mediaUrls: string[] = []): Promise<{ id: string; url: string }> {
  const authorUrn = (dest.account_id || '').trim()
  if (!authorUrn) throw new Error('LinkedIn destination needs account_id (your person URN, e.g. urn:li:person:abc123) — see docs/syndicate.md')
  if (!dest.access_token) throw new Error('LinkedIn destination needs access_token (OAuth token with the w_member_social scope)')

  const LI_VERSION = '202401'
  const headers = {
    'Authorization': `Bearer ${dest.access_token}`,
    'Content-Type': 'application/json',
    'LinkedIn-Version': LI_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
  }

  let mediaId: string | null = null
  if (mediaUrls.length > 0) {
    try {
      mediaId = await uploadImageToLinkedIn(authorUrn, dest.access_token, mediaUrls[0])
    } catch (e: any) {
      console.warn(`[syndication] LinkedIn image upload failed, posting text-only: ${e.message}`)
    }
  }

  const body: any = {
    author: authorUrn,
    commentary: text,
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  }
  if (mediaId) {
    body.content = { media: { id: mediaId } }
  }

  const res = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`LinkedIn API HTTP ${res.status}: ${errText.slice(0, 300)}`)
  }
  // LinkedIn's Posts API returns the created post's id in a response header, not the body.
  const postId = res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id') || ''
  if (!postId) throw new Error('LinkedIn API returned no post id in response headers')
  return { id: postId, url: `https://www.linkedin.com/feed/update/${postId}/` }
}

/** Two-step image upload: initialize (get an upload URL + image URN), then PUT the bytes. */
async function uploadImageToLinkedIn(authorUrn: string, accessToken: string, mediaUrl: string): Promise<string | null> {
  const initRes = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': '202401',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({ initializeUploadRequest: { owner: authorUrn } }),
  })
  if (!initRes.ok) throw new Error(`init upload HTTP ${initRes.status}: ${(await initRes.text().catch(() => '')).slice(0, 200)}`)
  const initData = await initRes.json() as any
  const uploadUrl = initData?.value?.uploadUrl
  const imageUrn = initData?.value?.image
  if (!uploadUrl || !imageUrn) throw new Error('LinkedIn init upload returned no uploadUrl/image urn')

  const imgRes = await fetch(mediaUrl, { redirect: 'follow' })
  if (!imgRes.ok) throw new Error(`download HTTP ${imgRes.status}`)
  const arrayBuf = await imgRes.arrayBuffer()

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${accessToken}` },
    body: Buffer.from(arrayBuf),
  })
  if (!putRes.ok) throw new Error(`image PUT HTTP ${putRes.status}`)

  return imageUrn
}

// ─────────────────────────────────────────────────────────────────────────────
async function postToX(dest: Destination, text: string, mediaUrls: string[] = []): Promise<{ id: string }> {
  // Upload up to 4 images first. Image upload failures fall back to text-only —
  // missing image is better than missing tweet.
  const mediaIds: string[] = []
  for (const mediaUrl of mediaUrls.slice(0, 4)) {
    try {
      const id = await uploadMediaToX(dest, mediaUrl)
      if (id) mediaIds.push(id)
    } catch (e: any) {
      console.warn(`[syndication] media upload failed for ${mediaUrl}: ${e.message}`)
    }
  }

  const url = 'https://api.twitter.com/2/tweets'
  const auth = buildOAuth1Header(
    'POST', url,
    dest.api_key, dest.api_secret,
    dest.access_token, dest.access_secret,
  )
  const payload: any = { text }
  if (mediaIds.length > 0) {
    payload.media = { media_ids: mediaIds }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`X API HTTP ${res.status}: ${errText.slice(0, 300)}`)
  }
  const data = await res.json() as any
  if (!data?.data?.id) throw new Error(`X API returned no tweet id: ${JSON.stringify(data).slice(0, 200)}`)
  return { id: data.data.id }
}

/**
 * Upload a remote image to X's media endpoint and return the media_id.
 *
 * Flow:
 *   1. Fetch the image bytes
 *   2. POST to https://upload.twitter.com/1.1/media/upload.json with
 *      multipart/form-data containing the bytes
 *   3. Return the media_id_string for inclusion in /2/tweets
 *
 * OAuth 1.0a signing for multipart only signs the OAuth params themselves,
 * not the body (per Twitter's docs for media upload). Our buildOAuth1Header
 * with empty bodyParams produces the correct signature base.
 *
 * Limits per X docs: 5MB per image, JPEG/PNG/GIF/WEBP. Larger images skipped.
 */
async function uploadMediaToX(dest: Destination, mediaUrl: string): Promise<string | null> {
  // Download
  const imgRes = await fetch(mediaUrl, { redirect: 'follow' })
  if (!imgRes.ok) throw new Error(`download HTTP ${imgRes.status}`)
  const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
  if (!contentType.startsWith('image/')) throw new Error(`unsupported content-type ${contentType}`)
  const arrayBuf = await imgRes.arrayBuffer()
  if (arrayBuf.byteLength > 5 * 1024 * 1024) throw new Error(`image too large (${(arrayBuf.byteLength / 1024 / 1024).toFixed(1)}MB > 5MB)`)

  const blob = new Blob([arrayBuf], { type: contentType })
  const form = new FormData()
  form.append('media', blob)

  const url = 'https://upload.twitter.com/1.1/media/upload.json'
  const auth = buildOAuth1Header(
    'POST', url,
    dest.api_key, dest.api_secret,
    dest.access_token, dest.access_secret,
    {} // multipart: only sign OAuth params, not the body
  )

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': auth },
    body: form,
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`upload HTTP ${res.status}: ${errText.slice(0, 200)}`)
  }
  const data = await res.json() as any
  return data.media_id_string || (data.media_id ? String(data.media_id) : null)
}

// ─────────────────────────────────────────────────────────────────────────────
// Mesh destinations — off-domain placement (Reddit, Medium). Decision-Architecture
// Tier 3a. Credentials reuse the syndication_destinations columns:
//   reddit: api_key=client_id, api_secret=client_secret, access_token=username,
//           access_secret=password, handle=subreddit (e.g. "r/glp1" or "glp1")
//   medium: access_token=integration_token, handle=@profile (cosmetic)
// COMPLIANCE: Reddit self-promo rules are strict — mesh posts MUST be genuinely
// helpful + disclosed, and should pass human review before posting (enforced at the
// generator/route layer). Medium posts are created as DRAFTS for the same reason.
// ─────────────────────────────────────────────────────────────────────────────
const MESH_UA = process.env.REDDIT_USER_AGENT || 'betawave-mesh/1.0'

async function postToReddit(dest: Destination, title: string, text: string): Promise<{ id: string; url: string }> {
  if (!dest.api_key || !dest.api_secret || !dest.access_token || !dest.access_secret) {
    throw new Error('Reddit needs client_id (api_key), client_secret (api_secret), username (access_token), password (access_secret)')
  }
  const basic = Buffer.from(`${dest.api_key}:${dest.api_secret}`).toString('base64')
  const tokRes = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': MESH_UA },
    body: new URLSearchParams({ grant_type: 'password', username: dest.access_token, password: dest.access_secret }),
  })
  if (!tokRes.ok) throw new Error(`Reddit auth HTTP ${tokRes.status}: ${(await tokRes.text().catch(() => '')).slice(0, 200)}`)
  const token = (await tokRes.json() as any)?.access_token
  if (!token) throw new Error('Reddit auth returned no access_token')

  const sr = String(dest.handle || '').replace(/^\/?(r\/)?/i, '').replace(/^@/, '')
  if (!sr) throw new Error('Reddit destination needs a subreddit in `handle`')
  const subRes = await fetch('https://oauth.reddit.com/api/submit', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': MESH_UA },
    body: new URLSearchParams({ sr, kind: 'self', title: title.slice(0, 300), text, api_type: 'json', resubmit: 'true' }),
  })
  if (!subRes.ok) throw new Error(`Reddit submit HTTP ${subRes.status}: ${(await subRes.text().catch(() => '')).slice(0, 200)}`)
  const data = await subRes.json() as any
  const errs = data?.json?.errors
  if (Array.isArray(errs) && errs.length) throw new Error(`Reddit: ${JSON.stringify(errs).slice(0, 200)}`)
  const d = data?.json?.data || {}
  return { id: String(d.id || d.name || ''), url: d.url || '' }
}

async function postToMedium(dest: Destination, title: string, markdown: string): Promise<{ id: string; url: string }> {
  const token = dest.access_token
  if (!token) throw new Error('Medium needs an integration token in access_token')
  const me = await fetch('https://api.medium.com/v1/me', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  if (!me.ok) throw new Error(`Medium auth HTTP ${me.status}: ${(await me.text().catch(() => '')).slice(0, 200)}`)
  const authorId = (await me.json() as any)?.data?.id
  if (!authorId) throw new Error('Medium /me returned no author id')
  const res = await fetch(`https://api.medium.com/v1/users/${authorId}/posts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ title, contentFormat: 'markdown', content: `# ${title}\n\n${markdown}`, publishStatus: 'draft', notifyFollowers: false }),
  })
  if (!res.ok) throw new Error(`Medium HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  const d = (await res.json() as any)?.data || {}
  return { id: d.id || '', url: d.url || '' }
}

/** Post a single mesh fragment directly to a configured destination (used by the
 *  fragment generator + manual tests). Returns the posted id/url. */
export async function postToMeshDestination(destId: string, title: string, body: string, mediaUrls: string[] = []): Promise<{ id: string; url: string }> {
  const dest = db.prepare(`SELECT * FROM syndication_destinations WHERE id = ?`).get(destId) as Destination | undefined
  if (!dest) throw new Error('Destination not found')
  return postToDestination(dest, body, mediaUrls, { title })
}

/**
 * Build OAuth 1.0a signed Authorization header for X API v2.
 * RFC 5849 compliant. No external deps.
 */
export function buildOAuth1Header(
  method: string, url: string,
  consumerKey: string, consumerSecret: string,
  token: string, tokenSecret: string,
  bodyParams: Record<string, string> = {},
): string {
  const nonce = crypto.randomBytes(16).toString('hex')
  const timestamp = Math.floor(Date.now() / 1000).toString()

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: token,
    oauth_version: '1.0',
  }

  // Build signature base
  const allParams = { ...oauthParams, ...bodyParams }
  const paramString = Object.keys(allParams)
    .sort()
    .map(k => `${encodeRFC3986(k)}=${encodeRFC3986(allParams[k])}`)
    .join('&')

  const baseUrl = url.split('?')[0]
  const signatureBase = [
    method.toUpperCase(),
    encodeRFC3986(baseUrl),
    encodeRFC3986(paramString),
  ].join('&')

  const signingKey = `${encodeRFC3986(consumerSecret)}&${encodeRFC3986(tokenSecret)}`
  const signature = crypto.createHmac('sha1', signingKey).update(signatureBase).digest('base64')

  oauthParams.oauth_signature = signature

  const headerParams = Object.keys(oauthParams)
    .sort()
    .map(k => `${encodeRFC3986(k)}="${encodeRFC3986(oauthParams[k])}"`)
    .join(', ')

  return `OAuth ${headerParams}`
}

function encodeRFC3986(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g, '%21').replace(/\*/g, '%2A')
    .replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29')
}

/**
 * Manual test — verify destination credentials work by hitting /2/users/me.
 * Returns { ok, handle?, error? }
 */
export async function testDestination(destId: string): Promise<{ ok: boolean; handle?: string; error?: string }> {
  const dest = db.prepare(`SELECT * FROM syndication_destinations WHERE id = ?`).get(destId) as Destination | undefined
  if (!dest) return { ok: false, error: 'Destination not found' }

  if (dest.platform === 'reddit') {
    try {
      if (!dest.api_key || !dest.api_secret || !dest.access_token || !dest.access_secret) return { ok: false, error: 'Reddit needs client_id/client_secret/username/password' }
      const basic = Buffer.from(`${dest.api_key}:${dest.api_secret}`).toString('base64')
      const r = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': MESH_UA },
        body: new URLSearchParams({ grant_type: 'password', username: dest.access_token, password: dest.access_secret }),
      })
      if (!r.ok) return { ok: false, error: `Reddit HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}` }
      return (await r.json() as any)?.access_token ? { ok: true, handle: `u/${dest.access_token} → r/${String(dest.handle).replace(/^\/?(r\/)?/i, '')}` } : { ok: false, error: 'No token returned' }
    } catch (e: any) { return { ok: false, error: e.message } }
  }
  if (dest.platform === 'medium') {
    try {
      if (!dest.access_token) return { ok: false, error: 'Medium needs an integration token' }
      const r = await fetch('https://api.medium.com/v1/me', { headers: { Authorization: `Bearer ${dest.access_token}`, Accept: 'application/json' } })
      if (!r.ok) return { ok: false, error: `Medium HTTP ${r.status}` }
      const u = (await r.json() as any)?.data
      return u?.id ? { ok: true, handle: u.username || u.name } : { ok: false, error: 'No author returned' }
    } catch (e: any) { return { ok: false, error: e.message } }
  }
  if (dest.platform === 'facebook' || dest.platform === 'instagram') {
    try {
      const accountId = (dest.account_id || '').trim()
      if (!accountId) return { ok: false, error: `${dest.platform === 'facebook' ? 'Page ID' : 'IG user ID'} (account_id) missing` }
      if (!dest.access_token) return { ok: false, error: 'Page access token missing' }
      const fields = dest.platform === 'facebook' ? 'name' : 'username'
      const r = await fetch(`${META_GRAPH}/${accountId}?fields=${fields}&access_token=${encodeURIComponent(dest.access_token)}`)
      const data = await r.json() as any
      if (!r.ok || data.error) return { ok: false, error: data?.error?.message || `Meta HTTP ${r.status}` }
      return { ok: true, handle: data.name || data.username || accountId }
    } catch (e: any) { return { ok: false, error: e.message } }
  }
  if (dest.platform !== 'x') return { ok: false, error: `Test not implemented for ${dest.platform}` }

  try {
    const url = 'https://api.twitter.com/2/users/me'
    const auth = buildOAuth1Header(
      'GET', url,
      dest.api_key, dest.api_secret,
      dest.access_token, dest.access_secret,
    )
    const res = await fetch(url, { headers: { 'Authorization': auth } })
    if (!res.ok) {
      const t = await res.text()
      return { ok: false, error: `HTTP ${res.status}: ${t.slice(0, 200)}` }
    }
    const data = await res.json() as any
    return { ok: true, handle: data?.data?.username || dest.handle }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

/**
 * One-shot dry run for a route — fetches latest item, rewrites, returns proposed
 * text WITHOUT posting. Used by UI preview button.
 */
export async function previewRoute(routeId: string): Promise<{
  ok: boolean
  source_item?: FeedItem
  rewritten?: string
  error?: string
}> {
  try {
    const route = db.prepare(`SELECT * FROM syndication_routes WHERE id = ?`).get(routeId) as Route | undefined
    if (!route) return { ok: false, error: 'Route not found' }
    const source = db.prepare(`SELECT * FROM syndication_sources WHERE id = ?`).get(route.source_id) as Source | undefined
    if (!source) return { ok: false, error: 'Source not found' }
    const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(route.client_id) as any
    const previewDest = db.prepare(`SELECT * FROM syndication_destinations WHERE id = ?`).get(route.destination_id) as Destination | undefined
    const previewPlatform = previewDest?.platform || 'x'

    if (source.source_type === 'rss') {
      // Pool path: refresh + LLM pick so preview shows exactly what the next real post would be
      await upsertPoolFromRSS(source, route.client_id)
      const poolItem = await pickBestFromPool(client, route.client_id, route.id)
      if (!poolItem) return { ok: false, error: 'No suitable content in pool for today — try again after more blog posts are published or the cooldown window resets' }
      const rewritten = await rewriteForX(client, poolItem.title, poolItem.body, route.rewrite_prompt, withUtm(poolItem.url, previewPlatform), previewPlatform)
      return {
        ok: true,
        source_item: { id: poolItem.source_item_id, url: poolItem.url, title: poolItem.title, content: poolItem.body },
        rewritten,
      }
    }

    // Live-fetch path for Instagram / other real-time sources
    let items: FeedItem[] = []
    if (source.source_type === 'apify_instagram') items = await fetchFromApifyInstagram(source)
    else if (source.source_type === 'ig_graph') items = await fetchFromIgGraph(source)
    else return { ok: false, error: `Unsupported source type: ${source.source_type}` }

    if (items.length === 0) return { ok: false, error: 'No items in feed' }
    const item = items.sort((a, b) => (b.pub_date || 0) - (a.pub_date || 0))[0]
    const rewritten = await rewriteForX(client, item.title, item.content, route.rewrite_prompt, withUtm(item.url, previewPlatform), previewPlatform)
    return { ok: true, source_item: item, rewritten }
  } catch (e: any) {
    return { ok: false, error: humaniseApiError(e) }
  }
}
