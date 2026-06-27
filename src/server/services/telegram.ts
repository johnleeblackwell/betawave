/**
 * Telegram channel adapter — broadcast + responder, plugged into the existing
 * syndication_destinations (creds) + respond inbox (social_comments) framework.
 * Telegram Bot API needs no platform approval: a bot token from @BotFather + a
 * chat/channel id. Free, instant, no algorithmic suppression — the quick win.
 *
 *   creds:  syndication_destinations row, platform='telegram',
 *           access_token = bot token, handle = chat/channel id.
 *   EARS:   pollTelegramUpdates() — getUpdates → ingest into the unified inbox.
 *   MOUTH:  sendApprovedTelegramReplies() — human-approved replies only.
 *   BROADCAST: sendTelegram() — post to the channel.
 */
import { v4 as uuid } from 'uuid'
import db from '../db.js'

export interface TgDest { id: string; client_id: string; handle: string; access_token: string }

const state = {
  get: (k: string) => (db.prepare(`SELECT value FROM app_state WHERE key=?`).get(k) as { value?: string } | undefined)?.value ?? null,
  set: (k: string, v: string) => db.prepare(`INSERT INTO app_state (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(k, v),
}

/** Raw Telegram Bot API call. Throws with Telegram's description on failure. */
export async function tg(token: string, method: string, params: Record<string, any> = {}): Promise<any> {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
  })
  const j = await r.json() as any
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description || 'HTTP ' + r.status}`)
  return j.result
}

export const validateToken = (token: string) => tg(token, 'getMe')   // → { id, username, ... }

export async function sendTelegram(dest: TgDest, text: string, replyToMessageId?: number): Promise<any> {
  return tg(dest.access_token, 'sendMessage', {
    chat_id: dest.handle, text,
    ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
  })
}

function activeDests(): TgDest[] {
  return db.prepare(`SELECT id, client_id, handle, access_token FROM syndication_destinations
                     WHERE platform='telegram' AND active=1 AND access_token!=''`).all() as unknown as TgDest[]
}

function ensureAccount(dest: TgDest): string {
  const row = db.prepare(`SELECT id FROM social_accounts WHERE client_id=? AND platform='telegram' AND username=?`)
    .get(dest.client_id, dest.handle) as { id?: string } | undefined
  if (row?.id) return row.id
  const id = uuid()
  db.prepare(`INSERT INTO social_accounts (id, client_id, platform, account_name, username, status)
              VALUES (?,?,'telegram',?,?,'active')`).run(id, dest.client_id, dest.handle, dest.handle)
  return id
}

/** EARS — poll inbound messages into the unified inbox. Telegram reads are free. */
export async function pollTelegramUpdates(): Promise<{ ingested: number }> {
  let ingested = 0
  for (const dest of activeDests()) {
    try {
      const accountId = ensureAccount(dest)
      const offKey = `tg_offset:${dest.id}`
      const off = state.get(offKey)
      const params: Record<string, any> = { timeout: 0, allowed_updates: ['message', 'channel_post'] }
      if (off) params.offset = Number(off)
      const updates = await tg(dest.access_token, 'getUpdates', params) as any[]
      let lastId = off ? Number(off) - 1 : 0
      for (const u of updates) {
        lastId = u.update_id
        const msg = u.message || u.channel_post
        const text = msg?.text || msg?.caption
        if (!msg || !text) continue
        const ext = `${msg.chat?.id}:${msg.message_id}`
        if (db.prepare(`SELECT 1 FROM social_comments WHERE account_id=? AND external_id=?`).get(accountId, ext)) continue
        const from = msg.from || {}
        const author = from.username ? `@${from.username}` : `${from.first_name || 'user'}${from.last_name ? ' ' + from.last_name : ''}`
        db.prepare(`INSERT INTO social_comments (id, account_id, platform, external_id, author_name, author_external_id, content, post_id, post_url, status)
                    VALUES (?,?,'telegram',?,?,?,?,?,?,'pending')`)
          .run(uuid(), accountId, ext, author, String(from.id || ''), text, String(msg.message_id), '')
        ingested++
      }
      if (updates.length) state.set(offKey, String(lastId + 1))   // ack: next offset = last update_id + 1
    } catch (e: any) {
      console.warn(`[telegram] poll failed for ${dest.handle}: ${e.message}`)
    }
  }
  if (ingested) console.log(`[telegram] ingested ${ingested} message(s) into the inbox`)
  return { ingested }
}

/** MOUTH — send replies a human APPROVED. Paced. */
export async function sendApprovedTelegramReplies(): Promise<{ sent: number; failed: number }> {
  const rows = db.prepare(`
    SELECT sr.id reply_id, sr.approved_content, sc.post_id, sa.client_id
    FROM social_replies sr
    JOIN social_comments sc ON sc.id = sr.comment_id
    JOIN social_accounts sa ON sa.id = sc.account_id
    WHERE sr.status='approved' AND sc.platform='telegram' LIMIT 5`).all() as any[]
  let sent = 0, failed = 0
  for (const r of rows) {
    const dest = db.prepare(`SELECT id, client_id, handle, access_token FROM syndication_destinations
                             WHERE client_id=? AND platform='telegram' AND active=1 AND access_token!=''`).get(r.client_id) as unknown as TgDest | undefined
    if (!dest) { db.prepare(`UPDATE social_replies SET status='failed', error_message='no active telegram bot' WHERE id=?`).run(r.reply_id); failed++; continue }
    try {
      db.prepare(`UPDATE social_replies SET status='sending' WHERE id=?`).run(r.reply_id)
      const res = await sendTelegram(dest, r.approved_content, Number(r.post_id) || undefined)
      db.prepare(`UPDATE social_replies SET status='sent', sent_at=unixepoch(), external_id=? WHERE id=?`).run(String(res?.message_id || ''), r.reply_id)
      sent++
      await new Promise(x => setTimeout(x, 2000))
    } catch (e: any) {
      db.prepare(`UPDATE social_replies SET status='failed', error_message=? WHERE id=?`).run(String(e.message).slice(0, 300), r.reply_id)
      failed++
    }
  }
  return { sent, failed }
}
