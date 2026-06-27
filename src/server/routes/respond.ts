// @ts-nocheck
/**
 * Respond module routes.
 *
 * Mounted at /api/clients/:clientId/respond  (clientRouter, mergeParams)
 * Mounted at /api/respond                    (globalRouter)
 *
 * clientRouter
 *   GET  /          → summary (account count, pending comment count, open conversation count)
 *   GET  /inbox     → unified inbox (comments + conversations, filterable)
 *
 * globalRouter
 *   Accounts
 *     GET    /accounts/:clientId            → list all accounts for a client
 *     POST   /accounts/:clientId            → add account
 *     PUT    /accounts/:accountId           → update account (name, token, status…)
 *     DELETE /accounts/:accountId           → remove account
 *
 *   Comments (GBP / Instagram / Twitter / TikTok)
 *     GET    /comments/:accountId           → list comments for an account
 *     POST   /comments/:accountId           → manually ingest a comment (testing/import)
 *     PUT    /comments/:commentId/status    → mark ignored / archived
 *     POST   /comments/:commentId/draft     → generate AI draft reply
 *     POST   /comments/:commentId/reply     → approve + queue send
 *
 *   Conversations (WhatsApp)
 *     GET    /conversations/:accountId      → list conversations
 *     GET    /conversations/:conversationId/messages → messages in a thread
 *     POST   /conversations/:conversationId/draft    → generate AI draft reply
 *     POST   /conversations/:conversationId/send     → approve + queue send
 *     PUT    /conversations/:conversationId/status   → resolve / archive
 */
import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { getClient } from '../services/claude.js'
import { discoverXSuggestions, getGrowthConfig, setGrowthConfig } from '../services/respond-x-growth.js'

const HAIKU = 'claude-haiku-4-5'

// ─── Client-level router ──────────────────────────────────────────────────────

export const clientRespondRouter = Router({ mergeParams: true })

/** GET /api/clients/:clientId/respond — summary counts */
clientRespondRouter.get('/', (req, res) => {
  const { clientId } = req.params

  const accountCount = (db.prepare(`
    SELECT COUNT(*) as n FROM social_accounts WHERE client_id = ? AND status = 'active'
  `).get(clientId) as any).n

  const pendingComments = (db.prepare(`
    SELECT COUNT(*) as n FROM social_comments sc
    JOIN social_accounts sa ON sa.id = sc.account_id
    WHERE sa.client_id = ? AND sc.status = 'pending'
  `).get(clientId) as any).n

  const openConversations = (db.prepare(`
    SELECT COUNT(*) as n FROM social_conversations sc
    JOIN social_accounts sa ON sa.id = sc.account_id
    WHERE sa.client_id = ? AND sc.status = 'open'
  `).get(clientId) as any).n

  const platforms = db.prepare(`
    SELECT DISTINCT platform FROM social_accounts WHERE client_id = ? AND status = 'active'
  `).all(clientId).map((r: any) => r.platform)

  res.json({ account_count: accountCount, pending_comments: pendingComments, open_conversations: openConversations, platforms })
})

/** GET /api/clients/:clientId/respond/inbox — unified inbox */
clientRespondRouter.get('/inbox', (req, res) => {
  const { clientId } = req.params
  const { platform, status = 'pending', type, limit = 50, offset = 0 } = req.query

  const platformFilter = platform ? `AND sa.platform = '${platform}'` : ''

  // Comments
  const comments = (type === 'conversation') ? [] : db.prepare(`
    SELECT sc.*, sa.platform, sa.account_name, sa.location_label,
           sr.id as reply_id, sr.status as reply_status, sr.draft_content, sr.approved_content
    FROM social_comments sc
    JOIN social_accounts sa ON sa.id = sc.account_id
    LEFT JOIN social_replies sr ON sr.comment_id = sc.id
    WHERE sa.client_id = ? AND sc.status = ? ${platformFilter}
    ORDER BY sc.published_at DESC, sc.created_at DESC
    LIMIT ? OFFSET ?
  `).all(clientId, status, Number(limit), Number(offset)) as any[]

  // Conversations
  const conversations = (type === 'comment') ? [] : db.prepare(`
    SELECT sc.*, sa.platform, sa.account_name, sa.location_label
    FROM social_conversations sc
    JOIN social_accounts sa ON sa.id = sc.account_id
    WHERE sa.client_id = ? AND sc.status = ? ${platformFilter}
    ORDER BY sc.last_message_at DESC
    LIMIT ? OFFSET ?
  `).all(clientId, status === 'pending' ? 'open' : status, Number(limit), Number(offset)) as any[]

  res.json({ comments, conversations })
})

// ─── Growth: the curation action queue (repost / follow / like / reply) ─────────

/** GET /api/clients/:clientId/respond/suggestions — pending growth actions */
clientRespondRouter.get('/suggestions', (req, res) => {
  const { clientId } = req.params
  const { status = 'pending', kind } = req.query
  const args: any[] = [clientId, status]
  let kindFilter = ''
  if (kind) { kindFilter = 'AND kind = ?'; args.push(kind) }
  const suggestions = db.prepare(`
    SELECT * FROM social_actions WHERE client_id = ? AND status = ? ${kindFilter}
    ORDER BY score DESC, created_at DESC LIMIT 200
  `).all(...args)
  const counts = db.prepare(`SELECT kind, COUNT(*) n FROM social_actions WHERE client_id=? AND status='pending' GROUP BY kind`).all(clientId)
  res.json({ suggestions, counts })
})

/** POST /api/clients/:clientId/respond/suggestions/discover — find new now */
clientRespondRouter.post('/suggestions/discover', async (req, res) => {
  try { res.json(await discoverXSuggestions(true, req.params.clientId)) }
  catch (e: any) { res.status(500).json({ error: e.message }) }
})

/** POST .../suggestions/:id/approve — queue for paced execution */
clientRespondRouter.post('/suggestions/:id/approve', (req, res) => {
  const info = db.prepare(`UPDATE social_actions SET status='approved', decided_at=unixepoch() WHERE id=? AND client_id=? AND status='pending'`).run(req.params.id, req.params.clientId)
  res.json({ ok: (info.changes ?? 0) > 0 })
})

/** POST .../suggestions/:id/reject */
clientRespondRouter.post('/suggestions/:id/reject', (req, res) => {
  const info = db.prepare(`UPDATE social_actions SET status='rejected', decided_at=unixepoch() WHERE id=? AND client_id=?`).run(req.params.id, req.params.clientId)
  res.json({ ok: (info.changes ?? 0) > 0 })
})

/** PATCH .../suggestions/:id — edit a reply draft before approving */
clientRespondRouter.patch('/suggestions/:id', (req, res) => {
  db.prepare(`UPDATE social_actions SET draft=? WHERE id=? AND client_id=?`).run(req.body?.draft ?? '', req.params.id, req.params.clientId)
  res.json({ ok: true })
})

/** Growth config (queries, competitor blocklist, caps) */
clientRespondRouter.get('/growth-config', (req, res) => res.json(getGrowthConfig(req.params.clientId)))
clientRespondRouter.put('/growth-config', (req, res) => { setGrowthConfig(req.params.clientId, req.body || {}); res.json(getGrowthConfig(req.params.clientId)) })

// ─── Global router ────────────────────────────────────────────────────────────

export const respondRouter = Router({ mergeParams: true })

// ── Accounts ──────────────────────────────────────────────────────────────────

const VALID_PLATFORMS = ['instagram', 'gbp', 'whatsapp', 'twitter', 'tiktok']

/** GET /api/respond/accounts/:clientId */
respondRouter.get('/accounts/:clientId', (req, res) => {
  const accounts = db.prepare(`
    SELECT id, client_id, platform, account_name, location_label, external_id,
           username, status, error_message, last_fetched_at, created_at,
           webhook_verified, token_expires_at
    FROM social_accounts WHERE client_id = ? ORDER BY platform ASC, account_name ASC
  `).all(req.params.clientId)
  res.json(accounts)
})

/** POST /api/respond/accounts/:clientId — add account */
respondRouter.post('/accounts/:clientId', (req, res) => {
  const { clientId } = req.params
  const { platform, account_name, location_label = '', external_id = '', username = '', access_token = '', refresh_token = '' } = req.body

  if (!platform || !VALID_PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: `platform must be one of: ${VALID_PLATFORMS.join(', ')}` })
  }
  if (!account_name?.trim()) return res.status(400).json({ error: 'account_name is required' })

  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId)
  if (!client) return res.status(404).json({ error: 'Client not found' })

  const id = uuid()
  db.prepare(`
    INSERT INTO social_accounts
      (id, client_id, platform, account_name, location_label, external_id, username, access_token, refresh_token, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', unixepoch())
  `).run(id, clientId, platform, account_name.trim(), location_label.trim(), external_id.trim(), username.trim(), access_token, refresh_token)

  res.status(201).json(db.prepare('SELECT * FROM social_accounts WHERE id = ?').get(id))
})

/** PUT /api/respond/accounts/:accountId */
respondRouter.put('/accounts/:accountId', (req, res) => {
  const { accountId } = req.params
  const { account_name, location_label, username, external_id, access_token, refresh_token, token_expires_at, status, error_message } = req.body

  const fields: string[] = []
  const values: any[] = []

  if (account_name !== undefined)     { fields.push('account_name = ?');     values.push(account_name) }
  if (location_label !== undefined)   { fields.push('location_label = ?');   values.push(location_label) }
  if (username !== undefined)         { fields.push('username = ?');          values.push(username) }
  if (external_id !== undefined)      { fields.push('external_id = ?');       values.push(external_id) }
  if (access_token !== undefined)     { fields.push('access_token = ?');      values.push(access_token) }
  if (refresh_token !== undefined)    { fields.push('refresh_token = ?');     values.push(refresh_token) }
  if (token_expires_at !== undefined) { fields.push('token_expires_at = ?'); values.push(token_expires_at) }
  if (status !== undefined)           { fields.push('status = ?');            values.push(status) }
  if (error_message !== undefined)    { fields.push('error_message = ?');     values.push(error_message) }

  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' })

  db.prepare(`UPDATE social_accounts SET ${fields.join(', ')} WHERE id = ?`).run(...values, accountId)
  const updated = db.prepare('SELECT * FROM social_accounts WHERE id = ?').get(accountId)
  if (!updated) return res.status(404).json({ error: 'Account not found' })
  res.json(updated)
})

/** DELETE /api/respond/accounts/:accountId */
respondRouter.delete('/accounts/:accountId', (req, res) => {
  db.prepare('DELETE FROM social_accounts WHERE id = ?').run(req.params.accountId)
  res.json({ ok: true })
})

// ── Comments ──────────────────────────────────────────────────────────────────

/** GET /api/respond/comments/:accountId */
respondRouter.get('/comments/:accountId', (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query
  const statusFilter = status ? `AND sc.status = '${status}'` : ''
  const comments = db.prepare(`
    SELECT sc.*, sr.id as reply_id, sr.status as reply_status,
           sr.draft_content, sr.approved_content, sr.sent_at
    FROM social_comments sc
    LEFT JOIN social_replies sr ON sr.comment_id = sc.id
    WHERE sc.account_id = ? ${statusFilter}
    ORDER BY sc.published_at DESC, sc.created_at DESC
    LIMIT ? OFFSET ?
  `).all(req.params.accountId, Number(limit), Number(offset))
  res.json(comments)
})

/** PUT /api/respond/comments/:commentId/status */
respondRouter.put('/comments/:commentId/status', (req, res) => {
  const { status } = req.body
  const valid = ['pending', 'replied', 'ignored', 'archived']
  if (!valid.includes(status)) return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` })
  db.prepare('UPDATE social_comments SET status = ? WHERE id = ?').run(status, req.params.commentId)
  res.json(db.prepare('SELECT * FROM social_comments WHERE id = ?').get(req.params.commentId))
})

/** POST /api/respond/comments/:commentId/draft — generate AI reply draft */
respondRouter.post('/comments/:commentId/draft', async (req, res) => {
  const comment = db.prepare(`
    SELECT sc.*, sa.account_name, sa.platform, sa.location_label,
           c.tone_of_voice, c.business_name, c.industry
    FROM social_comments sc
    JOIN social_accounts sa ON sa.id = sc.account_id
    JOIN clients c ON c.id = sa.client_id
    WHERE sc.id = ?
  `).get(req.params.commentId) as any

  if (!comment) return res.status(404).json({ error: 'Comment not found' })

  try {
    const prompt = buildCommentReplyPrompt(comment)
    const response = await getClient().messages.create({
      model: HAIKU,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    })
    const draft = response.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim()

    // Upsert reply row
    const existing = db.prepare('SELECT id FROM social_replies WHERE comment_id = ?').get(comment.id) as any
    if (existing) {
      db.prepare('UPDATE social_replies SET draft_content = ?, status = ? WHERE id = ?')
        .run(draft, 'draft', existing.id)
      return res.json(db.prepare('SELECT * FROM social_replies WHERE id = ?').get(existing.id))
    } else {
      const id = uuid()
      db.prepare(`INSERT INTO social_replies (id, comment_id, draft_content, status, drafted_by, created_at) VALUES (?, ?, ?, 'draft', 'ai', unixepoch())`).run(id, comment.id, draft)
      return res.status(201).json(db.prepare('SELECT * FROM social_replies WHERE id = ?').get(id))
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

/** POST /api/respond/comments/:commentId/reply — approve + mark ready to send */
respondRouter.post('/comments/:commentId/reply', (req, res) => {
  const { content } = req.body
  if (!content?.trim()) return res.status(400).json({ error: 'content is required' })

  const existing = db.prepare('SELECT id FROM social_replies WHERE comment_id = ?').get(req.params.commentId) as any
  if (existing) {
    db.prepare(`UPDATE social_replies SET approved_content = ?, status = 'approved', approved_at = unixepoch() WHERE id = ?`)
      .run(content.trim(), existing.id)
    db.prepare("UPDATE social_comments SET status = 'replied' WHERE id = ?").run(req.params.commentId)
    return res.json(db.prepare('SELECT * FROM social_replies WHERE id = ?').get(existing.id))
  } else {
    const id = uuid()
    db.prepare(`INSERT INTO social_replies (id, comment_id, approved_content, status, drafted_by, approved_at, created_at) VALUES (?, ?, ?, 'approved', 'human', unixepoch(), unixepoch())`).run(id, req.params.commentId, content.trim())
    db.prepare("UPDATE social_comments SET status = 'replied' WHERE id = ?").run(req.params.commentId)
    return res.status(201).json(db.prepare('SELECT * FROM social_replies WHERE id = ?').get(id))
  }
})

// ── Conversations (WhatsApp) ───────────────────────────────────────────────────

/** GET /api/respond/conversations/:accountId */
respondRouter.get('/conversations/:accountId', (req, res) => {
  const { status, limit = 30, offset = 0 } = req.query
  const statusFilter = status ? `AND status = '${status}'` : ''
  const convs = db.prepare(`
    SELECT * FROM social_conversations
    WHERE account_id = ? ${statusFilter}
    ORDER BY last_message_at DESC LIMIT ? OFFSET ?
  `).all(req.params.accountId, Number(limit), Number(offset))
  res.json(convs)
})

/** GET /api/respond/conversations/:conversationId/messages */
respondRouter.get('/conversations/:conversationId/messages', (req, res) => {
  const messages = db.prepare(`
    SELECT * FROM social_messages WHERE conversation_id = ? ORDER BY created_at ASC
  `).all(req.params.conversationId)
  res.json(messages)
})

/** POST /api/respond/conversations/:conversationId/draft — AI draft reply */
respondRouter.post('/conversations/:conversationId/draft', async (req, res) => {
  const conv = db.prepare(`
    SELECT sc.*, sa.platform, sa.account_name, sa.location_label,
           c.tone_of_voice, c.business_name, c.industry
    FROM social_conversations sc
    JOIN social_accounts sa ON sa.id = sc.account_id
    JOIN clients c ON c.id = sa.client_id
    WHERE sc.id = ?
  `).get(req.params.conversationId) as any

  if (!conv) return res.status(404).json({ error: 'Conversation not found' })

  // Load last 10 messages for context
  const messages = db.prepare(`
    SELECT direction, content FROM social_messages
    WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 10
  `).all(conv.id) as any[]

  try {
    const prompt = buildConversationReplyPrompt(conv, messages.reverse())
    const response = await getClient().messages.create({
      model: HAIKU,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    })
    const draft = response.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim()

    // Store draft on the most recent inbound message
    const lastMsg = db.prepare(`
      SELECT id FROM social_messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1
    `).get(conv.id) as any

    if (lastMsg) {
      db.prepare('UPDATE social_messages SET draft_content = ? WHERE id = ?').run(draft, lastMsg.id)
    }

    res.json({ draft })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

/** PUT /api/respond/conversations/:conversationId/status */
respondRouter.put('/conversations/:conversationId/status', (req, res) => {
  const { status } = req.body
  const valid = ['open', 'replied', 'resolved', 'archived']
  if (!valid.includes(status)) return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` })
  db.prepare('UPDATE social_conversations SET status = ? WHERE id = ?').run(status, req.params.conversationId)
  res.json(db.prepare('SELECT * FROM social_conversations WHERE id = ?').get(req.params.conversationId))
})

// ─── AI prompt builders ───────────────────────────────────────────────────────

function buildCommentReplyPrompt(comment: any): string {
  const platformLabel: Record<string, string> = {
    gbp: 'Google Business Profile review',
    instagram: 'Instagram comment',
    twitter: 'Twitter/X mention',
    tiktok: 'TikTok comment',
  }

  return `You are writing a reply on behalf of ${comment.business_name}, a ${comment.industry} business.
Location: ${comment.location_label || comment.account_name}
Tone of voice: ${comment.tone_of_voice || 'professional and friendly'}
Platform: ${platformLabel[comment.platform] ?? comment.platform}
${comment.rating ? `Star rating: ${comment.rating}/5` : ''}

${comment.platform === 'gbp' ? 'Review' : 'Comment'} from ${comment.author_name || 'a customer'}:
"${comment.content}"

Write a ${comment.rating && comment.rating <= 2 ? 'professional, empathetic response that acknowledges the concern and offers to resolve it offline' : 'warm, genuine reply that thanks them and feels personal — not corporate'}.

Rules:
- Keep it under 150 words
- Do not use hashtags
- Match the tone: ${comment.tone_of_voice || 'professional'}
- Do not start with "Thank you for your review" — vary the opening
- For negative reviews (1–2 stars): acknowledge, apologise sincerely, invite them to contact directly
- Reply text only — no labels, no quotes around the reply`
}

function buildConversationReplyPrompt(conv: any, messages: any[]): string {
  const history = messages.map(m => `${m.direction === 'inbound' ? conv.contact_name || 'Customer' : conv.account_name}: ${m.content}`).join('\n')

  return `You are responding to a WhatsApp message on behalf of ${conv.business_name}, a ${conv.industry} business.
Location: ${conv.location_label || conv.account_name}
Tone: ${conv.tone_of_voice || 'friendly and helpful'}

Conversation history:
${history}

Write the next reply from ${conv.account_name}. Keep it conversational, brief (under 100 words), and helpful. If they're asking about booking or pricing, invite them to visit or call. Reply text only.`
}
