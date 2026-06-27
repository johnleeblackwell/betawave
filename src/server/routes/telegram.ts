/**
 * Telegram setup — per client (mounted at /api/clients/:clientId/telegram).
 * Client-scoped, so an operator can configure their own client's channel.
 */
import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { validateToken, sendTelegram, type TgDest } from '../services/telegram.js'

export const telegramRouter = Router({ mergeParams: true })

function dest(clientId: string): TgDest | undefined {
  return db.prepare(`SELECT id, client_id, handle, access_token FROM syndication_destinations
                     WHERE client_id=? AND platform='telegram'`).get(clientId) as unknown as TgDest | undefined
}

/** Mirror the client's existing active content sources to the Telegram destination
 *  (one route per source), so connecting a channel makes content actually flow. */
function ensureTelegramRoutes(clientId: string, tgDestId: string): number {
  const sources = db.prepare(`
    SELECT source_id, rewrite_prompt, daily_cap FROM syndication_routes
    WHERE client_id=? AND active=1 AND destination_id != ?
    GROUP BY source_id`).all(clientId, tgDestId) as any[]
  let created = 0
  for (const s of sources) {
    const exists = db.prepare(`SELECT 1 FROM syndication_routes WHERE client_id=? AND source_id=? AND destination_id=?`)
      .get(clientId, s.source_id, tgDestId)
    if (exists) continue
    db.prepare(`INSERT INTO syndication_routes (id, client_id, source_id, destination_id, rewrite_prompt, daily_cap, active)
                VALUES (?,?,?,?,?,?,1)`).run(uuid(), clientId, s.source_id, tgDestId, s.rewrite_prompt || '', s.daily_cap || 3)
    created++
  }
  return created
}

/** GET — is Telegram configured for this client? */
telegramRouter.get('/', (req, res) => {
  const d = db.prepare(`SELECT handle, active FROM syndication_destinations WHERE client_id=? AND platform='telegram'`)
    .get(req.params.clientId) as { handle?: string; active?: number } | undefined
  res.json({ configured: !!d, chat: d?.handle || '', active: d?.active === 1 })
})

/** PUT { token, chatId } — validate the bot token, then save/replace the channel config. */
telegramRouter.put('/', async (req, res) => {
  const { clientId } = req.params
  const token = (req.body?.token ?? '').toString().trim()
  const chatId = (req.body?.chatId ?? '').toString().trim()
  if (!token || !chatId) return res.status(400).json({ error: 'token and chatId required' })
  let me: any
  try { me = await validateToken(token) } catch (e: any) { return res.status(400).json({ error: 'invalid bot token — ' + e.message }) }
  const existing = dest(clientId)
  if (existing) {
    db.prepare(`UPDATE syndication_destinations SET handle=?, access_token=?, active=1 WHERE id=?`).run(chatId, token, existing.id)
  } else {
    db.prepare(`INSERT INTO syndication_destinations (id, client_id, label, platform, handle, access_token, active)
                VALUES (?,?,?,'telegram',?,?,1)`).run(uuid(), clientId, 'Telegram', chatId, token)
  }
  const tgDest = dest(clientId)!
  const routesCreated = ensureTelegramRoutes(clientId, tgDest.id)
  res.json({ ok: true, bot: me?.username ? '@' + me.username : 'bot', routes_created: routesCreated })
})

/** POST /test — send a test broadcast to the channel. */
telegramRouter.post('/test', async (req, res) => {
  const d = dest(req.params.clientId)
  if (!d?.access_token) return res.status(400).json({ error: 'Telegram not configured' })
  try {
    const r = await sendTelegram(d, (req.body?.text ?? '').toString().trim() || '✅ βWave™ is connected to this Telegram channel.')
    res.json({ ok: true, message_id: r?.message_id })
  } catch (e: any) { res.json({ ok: false, error: e.message }) }
})

/** DELETE — disconnect Telegram for this client. */
telegramRouter.delete('/', (req, res) => {
  db.prepare(`UPDATE syndication_destinations SET active=0 WHERE client_id=? AND platform='telegram'`).run(req.params.clientId)
  res.json({ ok: true })
})
