/**
 * Respond × X (Twitter) — the two organs the Respond module was missing:
 *
 *   EARS:  pollXMentions()        — ingest @mentions of each active X destination
 *                                   into social_comments (the unified inbox).
 *   MOUTH: sendApprovedXReplies() — post human-APPROVED replies back to X.
 *
 * COMPLIANCE BY DESIGN (see docs/GROWTH-RESPOND-PLAN.md):
 *   - Nothing is ever sent without explicit human approval (social_replies.status
 *     must be 'approved', set only by the approve endpoint/UI). No auto-reply in v1.
 *   - Paced: max replies per tick + gap between sends — never burst.
 *   - Read-budget aware: X API reads cost credits on usage billing. Polling is
 *     throttled (default every 360 min; RESPOND_POLL_MINUTES to tune) and
 *     persisted in app_state so restarts don't re-poll.
 *   - Billing/auth failures log + skip; they never throw into the scheduler.
 */
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { buildOAuth1Header } from './syndication.js'

interface XDest {
  id: string; client_id: string; handle: string
  api_key: string; api_secret: string; access_token: string; access_secret: string
}

const state = {
  get(key: string): string | null {
    const r = db.prepare(`SELECT value FROM app_state WHERE key = ?`).get(key) as { value?: string } | undefined
    return r?.value ?? null
  },
  set(key: string, value: string): void {
    db.prepare(`INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value)
  },
}

async function xGet(dest: XDest, url: string, params: Record<string, string>): Promise<any> {
  const auth = buildOAuth1Header('GET', url, dest.api_key, dest.api_secret, dest.access_token, dest.access_secret, params)
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${url}?${qs}`, { headers: { Authorization: auth } })
  if (!res.ok) throw new Error(`X API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

/** Resolve + cache the numeric X user id for a destination's handle. */
async function userId(dest: XDest): Promise<string> {
  const key = `x_user_id:${dest.handle}`
  const cached = state.get(key)
  if (cached) return cached
  const name = dest.handle.replace(/^@/, '')
  const data = await xGet(dest, `https://api.twitter.com/2/users/by/username/${name}`, {})
  const id = data?.data?.id
  if (!id) throw new Error(`could not resolve user id for ${dest.handle}`)
  state.set(key, id)
  return id
}

/** Ensure a Respond social_accounts row exists for this destination. */
function ensureAccount(dest: XDest): string {
  const row = db.prepare(`SELECT id FROM social_accounts WHERE client_id = ? AND platform = 'twitter' AND username = ?`)
    .get(dest.client_id, dest.handle) as { id?: string } | undefined
  if (row?.id) return row.id
  const id = uuid()
  db.prepare(`INSERT INTO social_accounts (id, client_id, platform, account_name, username, status)
              VALUES (?, ?, 'twitter', ?, ?, 'active')`).run(id, dest.client_id, dest.handle, dest.handle)
  console.log(`[respond-x] created social_account for ${dest.handle}`)
  return id
}

/**
 * EARS — poll @mentions for every active X destination into the inbox.
 * Self-throttled via app_state. Pass force=true to bypass (manual/testing).
 */
export async function pollXMentions(force = false): Promise<{ ingested: number; polled: boolean }> {
  const minutes = Number(process.env.RESPOND_POLL_MINUTES ?? 360)
  const now = Math.floor(Date.now() / 1000)
  const last = Number(state.get('respond_x_last_poll') ?? 0)
  if (!force && now - last < minutes * 60) return { ingested: 0, polled: false }
  state.set('respond_x_last_poll', String(now))

  const dests = db.prepare(`SELECT * FROM syndication_destinations WHERE platform = 'x' AND active = 1 AND access_token != ''`).all() as unknown as XDest[]
  let ingested = 0

  for (const dest of dests) {
    try {
      const accountId = ensureAccount(dest)
      const uid = await userId(dest)
      const sinceKey = `x_mentions_since:${accountId}`
      const params: Record<string, string> = {
        max_results: '25',
        'tweet.fields': 'author_id,created_at,conversation_id',
        expansions: 'author_id',
        'user.fields': 'username,name',
      }
      const since = state.get(sinceKey)
      if (since) params.since_id = since

      const data = await xGet(dest, `https://api.twitter.com/2/users/${uid}/mentions`, params)
      const tweets: any[] = data?.data ?? []
      const users: any[] = data?.includes?.users ?? []
      if (tweets.length > 0) state.set(sinceKey, tweets[0].id) // newest first

      for (const t of tweets) {
        if (t.author_id === uid) continue // our own posts
        const dup = db.prepare(`SELECT 1 FROM social_comments WHERE account_id = ? AND external_id = ?`).get(accountId, t.id)
        if (dup) continue
        const author = users.find(u => u.id === t.author_id)
        db.prepare(`
          INSERT INTO social_comments (id, account_id, platform, external_id, author_name, author_external_id, content, post_id, post_url, status)
          VALUES (?, ?, 'twitter', ?, ?, ?, ?, ?, ?, 'pending')
        `).run(
          uuid(), accountId, t.id,
          author ? `${author.name} (@${author.username})` : 'unknown',
          t.author_id, t.text ?? '', t.conversation_id ?? '',
          author ? `https://x.com/${author.username}/status/${t.id}` : '',
        )
        ingested++
      }
    } catch (e: any) {
      // Billing (402/403) or auth issues must not break the scheduler.
      console.warn(`[respond-x] poll failed for ${dest.handle}: ${e.message}`)
    }
  }
  if (ingested > 0) console.log(`[respond-x] ingested ${ingested} new mention(s) into the inbox`)
  return { ingested, polled: true }
}

/**
 * MOUTH — post replies that a human has APPROVED. Paced: max 5/tick, 5s gaps.
 */
export async function sendApprovedXReplies(): Promise<{ sent: number; failed: number }> {
  const rows = db.prepare(`
    SELECT sr.id AS reply_id, sr.approved_content, sc.external_id AS tweet_id, sa.client_id, sa.username
    FROM social_replies sr
    JOIN social_comments sc ON sc.id = sr.comment_id
    JOIN social_accounts sa ON sa.id = sc.account_id
    WHERE sr.status = 'approved' AND sc.platform = 'twitter'
    LIMIT 5
  `).all() as any[]

  let sent = 0, failed = 0
  for (const r of rows) {
    const dest = db.prepare(`SELECT * FROM syndication_destinations WHERE client_id = ? AND platform = 'x' AND active = 1 AND access_token != ''`)
      .get(r.client_id) as unknown as XDest | undefined
    if (!dest) {
      db.prepare(`UPDATE social_replies SET status = 'failed', error_message = 'no active X credentials for client' WHERE id = ?`).run(r.reply_id)
      failed++; continue
    }
    try {
      db.prepare(`UPDATE social_replies SET status = 'sending' WHERE id = ?`).run(r.reply_id)
      const url = 'https://api.twitter.com/2/tweets'
      const auth = buildOAuth1Header('POST', url, dest.api_key, dest.api_secret, dest.access_token, dest.access_secret)
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: r.approved_content, reply: { in_reply_to_tweet_id: r.tweet_id } }),
      })
      if (!res.ok) throw new Error(`X API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const data = await res.json() as any
      db.prepare(`UPDATE social_replies SET status = 'sent', sent_at = unixepoch(), external_id = ? WHERE id = ?`)
        .run(data?.data?.id ?? '', r.reply_id)
      console.log(`[respond-x] reply sent from ${r.username} → tweet ${r.tweet_id}`)
      sent++
      await new Promise(r2 => setTimeout(r2, 5000)) // pacing — never burst
    } catch (e: any) {
      db.prepare(`UPDATE social_replies SET status = 'failed', error_message = ? WHERE id = ?`).run(String(e.message).slice(0, 300), r.reply_id)
      console.error(`[respond-x] reply failed: ${e.message}`)
      failed++
    }
  }
  return { sent, failed }
}
