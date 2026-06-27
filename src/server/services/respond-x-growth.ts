/**
 * Respond × Growth (X) — the compliant curation engine.
 *
 *   DISCOVER: search X for topically-relevant, NON-competitor content
 *             (per the client's configured niche) → Haiku scores relevance & brand-safety →
 *             create PENDING suggestions (repost / follow). Never auto-acts.
 *   EXECUTE:  perform only suggestions a human APPROVED, paced + per-kind daily
 *             caps. repost / like / follow / reply.
 *
 * Doctrine: human-approval gate on everything,
 * paced (no bursts), budget-aware reads (self-throttled), non-competitor filter,
 * brand-safe. Billing/ToS failures log + skip — never throw into the scheduler.
 */
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { getClient } from './claude.js'
import { buildOAuth1Header } from './syndication.js'

const HAIKU = 'claude-haiku-4-5'

db.prepare(`
  CREATE TABLE IF NOT EXISTS social_actions (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    account_id TEXT,
    kind TEXT NOT NULL,                       -- repost | follow | like | reply
    target_tweet_id TEXT,
    target_user_id TEXT,
    target_handle TEXT,
    target_name TEXT,
    target_text TEXT,
    target_url TEXT,
    reason TEXT,
    score REAL,
    draft TEXT,
    status TEXT NOT NULL DEFAULT 'pending',   -- pending|approved|rejected|executed|failed
    error TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    decided_at INTEGER,
    executed_at INTEGER,
    external_id TEXT
  )
`).run()
db.prepare(`CREATE INDEX IF NOT EXISTS idx_actions_client_status ON social_actions(client_id, status)`).run()

interface XDest { id: string; client_id: string; handle: string; api_key: string; api_secret: string; access_token: string; access_secret: string }

export interface GrowthConfig {
  /** Plain-language description of the brand + audience, used to steer curation.
   *  e.g. "an independent coffee roaster and its specialty-coffee audience". */
  niche: string
  queries: string[]
  blocked_handles: string[]
  caps: { repost: number; follow: number; like: number; reply: number }
  max_suggestions_per_run: number
  min_score: number
}
const DEFAULT_CONFIG: GrowthConfig = {
  niche: '',
  queries: [],
  blocked_handles: [],
  caps: { repost: 4, follow: 5, like: 10, reply: 5 },
  max_suggestions_per_run: 12,
  min_score: 0.6,
}

const state = {
  get: (k: string) => (db.prepare(`SELECT value FROM app_state WHERE key=?`).get(k) as { value?: string } | undefined)?.value ?? null,
  set: (k: string, v: string) => db.prepare(`INSERT INTO app_state (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(k, v),
}
export function getGrowthConfig(clientId: string): GrowthConfig {
  const raw = state.get(`growth:${clientId}`)
  if (!raw) return DEFAULT_CONFIG
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(raw) } } catch { return DEFAULT_CONFIG }
}
export function setGrowthConfig(clientId: string, cfg: Partial<GrowthConfig>): void {
  state.set(`growth:${clientId}`, JSON.stringify({ ...getGrowthConfig(clientId), ...cfg }))
}

async function xGet(d: XDest, url: string, params: Record<string, string>): Promise<any> {
  const auth = buildOAuth1Header('GET', url, d.api_key, d.api_secret, d.access_token, d.access_secret, params)
  const res = await fetch(`${url}?${new URLSearchParams(params)}`, { headers: { Authorization: auth } })
  if (!res.ok) throw new Error(`X GET ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}
async function xPost(d: XDest, url: string, body: any): Promise<string> {
  const auth = buildOAuth1Header('POST', url, d.api_key, d.api_secret, d.access_token, d.access_secret)
  const res = await fetch(url, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const txt = await res.text()
  if (!res.ok) throw new Error(`X POST ${res.status}: ${txt.slice(0, 200)}`)
  try { const j = JSON.parse(txt); return j?.data?.id || '' } catch { return '' }
}
async function userId(d: XDest): Promise<string> {
  const key = `x_user_id:${d.handle}`
  const cached = state.get(key)
  if (cached) return cached
  const data = await xGet(d, `https://api.twitter.com/2/users/by/username/${d.handle.replace(/^@/, '')}`, {})
  const id = data?.data?.id
  if (!id) throw new Error(`could not resolve user id for ${d.handle}`)
  state.set(key, id); return id
}
function ensureAccount(d: XDest): string {
  const row = db.prepare(`SELECT id FROM social_accounts WHERE client_id=? AND platform='twitter' AND username=?`).get(d.client_id, d.handle) as { id?: string } | undefined
  if (row?.id) return row.id
  const id = uuid()
  db.prepare(`INSERT INTO social_accounts (id, client_id, platform, account_name, username, status) VALUES (?,?,'twitter',?,?,'active')`).run(id, d.client_id, d.handle, d.handle)
  return id
}

/** Haiku: keep/score/reason per candidate. One call per batch (cheap). */
async function classify(cands: Array<{ handle: string; bio: string; text: string }>, cfg: GrowthConfig): Promise<Array<{ keep: boolean; score: number; reason: string }>> {
  const list = cands.map((c, i) => `#${i} ${c.handle} — bio: ${(c.bio || '').slice(0, 140)} — tweet: ${c.text.slice(0, 220)}`).join('\n')
  const niche = cfg.niche?.trim() || 'this brand and its target audience'
  const prompt = `You curate the X feed for ${niche}. For each item decide if it is worth AMPLIFYING (reposting) to their audience.
KEEP only if ALL: genuinely relevant to ${niche}; relevant or universally interesting to that audience; brand-safe (no NSFW, hate, politics, spam, drama); NOT a direct competitor promoting itself.
Prefer: relevant creators' work, industry events, complementary brands, culture/history/news, suppliers, and educational content.
Return ONLY a JSON array, one object per item in order: [{"i":0,"keep":true,"score":0.0-1.0,"reason":"<=12 words"}]. score = amplify-worthiness.
Items:
${list}`
  try {
    const r = await getClient().messages.create({ model: HAIKU, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] })
    const text = r.content.filter(b => b.type === 'text').map(b => (b as any).text).join('')
    const json = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1))
    return cands.map((_, i) => {
      const m = json.find((x: any) => x.i === i) || {}
      return { keep: !!m.keep, score: Number(m.score) || 0, reason: String(m.reason || '').slice(0, 120) }
    })
  } catch (e: any) {
    console.warn('[growth-x] classify failed:', e.message)
    return cands.map(() => ({ keep: false, score: 0, reason: '' }))
  }
}

function insertAction(a: Record<string, any>): void {
  db.prepare(`INSERT INTO social_actions (id, client_id, account_id, kind, target_tweet_id, target_user_id, target_handle, target_name, target_text, target_url, reason, score, draft)
    VALUES (@id,@client_id,@account_id,@kind,@target_tweet_id,@target_user_id,@target_handle,@target_name,@target_text,@target_url,@reason,@score,@draft)`)
    .run({ id: uuid(), target_tweet_id: null, target_user_id: null, target_handle: null, target_name: null, target_text: null, target_url: null, reason: null, score: null, draft: null, account_id: null, ...a })
}

/** DISCOVER — search → score → create pending suggestions. Self-throttled. */
export async function discoverXSuggestions(force = false, onlyClientId?: string): Promise<{ created: number; discovered: boolean }> {
  const minutes = Number(process.env.GROWTH_DISCOVER_MINUTES ?? 720) // 2×/day
  const now = Math.floor(Date.now() / 1000)
  if (!force) {
    const last = Number(state.get('growth_x_last_discover') ?? 0)
    if (now - last < minutes * 60) return { created: 0, discovered: false }
    state.set('growth_x_last_discover', String(now))
  }
  let dests = db.prepare(`SELECT * FROM syndication_destinations WHERE platform='x' AND active=1 AND access_token!=''`).all() as unknown as XDest[]
  if (onlyClientId) dests = dests.filter(d => d.client_id === onlyClientId)
  let created = 0
  for (const dest of dests) {
    try {
      const cfg = getGrowthConfig(dest.client_id)
      const accountId = ensureAccount(dest)
      const ownId = await userId(dest)
      const blocked = new Set(cfg.blocked_handles.map(h => h.toLowerCase().replace(/^@/, '')))
      for (const q of cfg.queries) {
        if (created >= cfg.max_suggestions_per_run) break
        const data = await xGet(dest, 'https://api.twitter.com/2/tweets/search/recent', {
          query: q, max_results: '25', 'tweet.fields': 'author_id,public_metrics,lang',
          expansions: 'author_id', 'user.fields': 'username,name,description,public_metrics',
        })
        const tweets: any[] = data?.data ?? []
        const users: any[] = data?.includes?.users ?? []
        const cands: Array<{ t: any; author: any; handle: string }> = []
        for (const t of tweets) {
          if (t.author_id === ownId) continue
          const author = users.find(u => u.id === t.author_id)
          const uname = author?.username || ''
          if (!uname || blocked.has(uname.toLowerCase())) continue
          const dup = db.prepare(`SELECT 1 FROM social_actions WHERE client_id=? AND (target_tweet_id=? OR (kind='follow' AND target_user_id=?))`).get(dest.client_id, t.id, t.author_id)
          if (dup) continue
          cands.push({ t, author, handle: '@' + uname })
        }
        if (!cands.length) continue
        const scored = await classify(cands.map(c => ({ handle: c.handle, bio: c.author?.description || '', text: c.t.text || '' })), cfg)
        for (let i = 0; i < cands.length && created < cfg.max_suggestions_per_run; i++) {
          const s = scored[i]
          if (!s?.keep || s.score < cfg.min_score) continue
          const c = cands[i]
          insertAction({ client_id: dest.client_id, account_id: accountId, kind: 'repost', target_tweet_id: c.t.id, target_user_id: c.author?.id, target_handle: c.handle, target_name: c.author?.name, target_text: c.t.text, target_url: `https://x.com/${c.author?.username}/status/${c.t.id}`, reason: s.reason, score: s.score })
          created++
          // Strong, account-like targets also become a (separate, approvable) follow suggestion.
          const followers = c.author?.public_metrics?.followers_count ?? 0
          if (s.score >= 0.75 && followers >= 200 && created < cfg.max_suggestions_per_run) {
            const dupf = db.prepare(`SELECT 1 FROM social_actions WHERE client_id=? AND kind='follow' AND target_user_id=?`).get(dest.client_id, c.author.id)
            if (!dupf) {
              insertAction({ client_id: dest.client_id, account_id: accountId, kind: 'follow', target_user_id: c.author.id, target_handle: c.handle, target_name: c.author?.name, target_text: c.author?.description, target_url: `https://x.com/${c.author?.username}`, reason: `Relevant account — ${s.reason}`, score: s.score })
              created++
            }
          }
        }
      }
    } catch (e: any) {
      console.warn(`[growth-x] discover failed for ${dest.handle}: ${e.message}`)
    }
  }
  if (created) console.log(`[growth-x] created ${created} pending suggestion(s)`)
  return { created, discovered: true }
}

/** EXECUTE — only human-approved actions, paced, per-kind daily caps. */
export async function executeApprovedXActions(): Promise<{ sent: number; failed: number }> {
  const rows = db.prepare(`SELECT * FROM social_actions WHERE status='approved' ORDER BY decided_at ASC LIMIT 5`).all() as any[]
  let sent = 0, failed = 0
  for (const a of rows) {
    const dest = db.prepare(`SELECT * FROM syndication_destinations WHERE client_id=? AND platform='x' AND active=1 AND access_token!=''`).get(a.client_id) as unknown as XDest | undefined
    if (!dest) { db.prepare(`UPDATE social_actions SET status='failed', error='no active X credentials' WHERE id=?`).run(a.id); failed++; continue }
    const cap = (getGrowthConfig(a.client_id).caps as any)[a.kind] ?? 5
    const usedToday = (db.prepare(`SELECT COUNT(*) n FROM social_actions WHERE client_id=? AND kind=? AND status='executed' AND executed_at>unixepoch()-86400`).get(a.client_id, a.kind) as any).n
    if (usedToday >= cap) continue // leave approved — will run tomorrow within cap
    try {
      const uid = await userId(dest)
      let resId = ''
      if (a.kind === 'repost') resId = await xPost(dest, `https://api.twitter.com/2/users/${uid}/retweets`, { tweet_id: a.target_tweet_id })
      else if (a.kind === 'like') resId = await xPost(dest, `https://api.twitter.com/2/users/${uid}/likes`, { tweet_id: a.target_tweet_id })
      else if (a.kind === 'follow') resId = await xPost(dest, `https://api.twitter.com/2/users/${uid}/following`, { target_user_id: a.target_user_id })
      else if (a.kind === 'reply') resId = await xPost(dest, `https://api.twitter.com/2/tweets`, { text: a.draft, reply: { in_reply_to_tweet_id: a.target_tweet_id } })
      db.prepare(`UPDATE social_actions SET status='executed', executed_at=unixepoch(), external_id=? WHERE id=?`).run(resId, a.id)
      console.log(`[growth-x] ${a.kind} executed for client ${a.client_id} → ${a.target_handle}`)
      sent++
      await new Promise(r => setTimeout(r, 5000)) // pacing — never burst
    } catch (e: any) {
      db.prepare(`UPDATE social_actions SET status='failed', error=? WHERE id=?`).run(String(e.message).slice(0, 300), a.id)
      console.error(`[growth-x] ${a.kind} failed: ${e.message}`)
      failed++
    }
  }
  return { sent, failed }
}
