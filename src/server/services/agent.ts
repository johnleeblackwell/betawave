/**
 * βWave in-app agent — v3 (read + gated actions, client-scopable).
 *
 * The "Upgrade Bot": you talk to Claude inside the app and it inspects your
 * βWave instance with real tools, answering from live data instead of guessing.
 * It can also TAKE ACTIONS — but never on its own. Every action is GATED: the
 * loop pauses and the exact action is returned to the UI for approval. Nothing
 * writes until you tap Approve. The gate is enforced HERE, server-side.
 *
 * SCOPING: when a non-owner (operator / demo) uses the agent, a `scope` = their
 * client id is threaded through EVERY tool. Scoped, the agent can only ever see
 * and act on that one client — list_clients returns just them, every read is
 * filtered, and action tools are forced to that client. This is a hard security
 * boundary (a demo prospect must never see another tenant), enforced in the
 * tools themselves, not just the prompt. Owner = scope null = whole instance.
 *
 * Anthropic only (Opus 4.8) — tool use doesn't port cleanly to the fallback.
 */
import { randomUUID } from 'crypto'
import type Anthropic from '@anthropic-ai/sdk'
import db from '../db.js'
import { getClient, buildBlogPrompt } from './claude.js'
import { extractTitle, extractImageQuery, embedImageMarkdown, cleanTitleForSearch } from './content-utils.js'
import { getImageForPost } from './images.js'
import { logUsage } from './llm.js'

const safeJson = (s: any, fallback: any) => { try { return JSON.parse(s) } catch { return fallback } }

const MODEL = 'claude-opus-4-8'
const MAX_ITERS = 6
const PENDING_TTL_SECONDS = 3600   // abandoned proposals are swept after an hour

/** null = owner, whole instance. A client id = locked to that one client. */
export type Scope = string | null

// ── Read tools (execute inline, no gate) ─────────────────────────────────────
const READ_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_clients',
    description: 'List the client(s) you manage, with id and industry. Call this first when you need a client id.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false } as any,
  },
  {
    name: 'get_client',
    description: 'Full profile of one client: name, industry, tone of voice, target audience, which modules are enabled, and how many content pieces they have.',
    input_schema: {
      type: 'object',
      properties: { client_id: { type: 'string', description: 'Client UUID from list_clients' } },
      required: ['client_id'], additionalProperties: false,
    } as any,
  },
  {
    name: 'list_content',
    description: "A client's most recent content pieces (title, type, status, date). Use to answer 'what has X published / got in draft'.",
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client UUID' },
        limit: { type: 'integer', description: 'How many to return (default 10, max 30)' },
      },
      required: ['client_id'], additionalProperties: false,
    } as any,
  },
  {
    name: 'recent_posts',
    description: "Posts actually PUBLISHED to social/syndication destinations — which platform, when, the link, and a snippet. Use for 'when did we last post to LinkedIn / X / Telegram', 'what went out today', 'what has been published'. Optional client_id and platform.",
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        platform: { type: 'string', description: 'linkedin | x | facebook | telegram | instagram | reddit | medium' },
        limit: { type: 'integer' },
      },
      additionalProperties: false,
    } as any,
  },
  {
    name: 'respond_queue',
    description: "Incoming social comments and their reply status, each with its comment id (needed to draft a reply). Use for 'what's awaiting a reply', 'any new comments', 'what needs my attention'. status 'pending' = awaiting reply. Optional platform filter.",
    input_schema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        limit: { type: 'integer' },
      },
      additionalProperties: false,
    } as any,
  },
  {
    name: 'citations_summary',
    description: "Recent AI-citation tracking runs (the Measure module): which brand, when it ran, status, cost. Use for 'how's our AI visibility', 'when did citation tracking last run'.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false } as any,
  },
  {
    name: 'pipeline_overview',
    description: 'One-shot summary: content total + breakdown by status, posts published, comments awaiting reply, citation-run count. Good first call for "how are things".',
    input_schema: { type: 'object', properties: {}, additionalProperties: false } as any,
  },
]

const one = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as any)?.n ?? 0

// Scoped counters — when a client id is given, restrict to that client.
const contentCount = (scope: Scope) => scope
  ? one('SELECT COUNT(*) n FROM content WHERE client_id = ?', scope)
  : one('SELECT COUNT(*) n FROM content')
const awaitingCount = (scope: Scope) => scope
  ? one("SELECT COUNT(*) n FROM social_comments WHERE status = 'pending' AND account_id IN (SELECT id FROM social_accounts WHERE client_id = ?)", scope)
  : one("SELECT COUNT(*) n FROM social_comments WHERE status = 'pending'")

function runReadTool(name: string, input: any, scope: Scope): unknown {
  switch (name) {
    case 'list_clients':
      return db.prepare(`
        SELECT c.id, c.business_name, c.industry,
          (SELECT COUNT(*) FROM content WHERE client_id = c.id) AS content_pieces,
          (SELECT MAX(posted_at) FROM syndications WHERE client_id = c.id AND status = 'posted') AS last_posted_at
        FROM clients c ${scope ? 'WHERE c.id = ?' : ''} ORDER BY c.business_name`).all(...(scope ? [scope] : []))

    case 'get_client': {
      const cid = scope || input.client_id   // scoped users can only ever see their own
      const c = db.prepare(
        'SELECT id, business_name, industry, tone_of_voice, target_audience, modules_enabled FROM clients WHERE id = ?',
      ).get(cid) as any
      if (!c) return { error: 'No client with that id. Call list_clients first.' }
      const content_count = one('SELECT COUNT(*) n FROM content WHERE client_id = ?', cid)
      const posts_published = one("SELECT COUNT(*) n FROM syndications WHERE client_id = ? AND status = 'posted'", cid)
      return { ...c, content_count, posts_published }
    }

    case 'list_content': {
      const cid = scope || input.client_id
      return db.prepare(
        'SELECT id, type, title, status, created_at FROM content WHERE client_id = ? ORDER BY created_at DESC LIMIT ?',
      ).all(cid, Math.min(Number(input.limit) || 10, 30))
    }

    case 'recent_posts': {
      const where = ["s.status = 'posted'"]; const params: any[] = []
      const cid = scope || input.client_id
      if (cid) { where.push('s.client_id = ?'); params.push(cid) }
      if (input.platform) { where.push('LOWER(d.platform) = ?'); params.push(String(input.platform).toLowerCase()) }
      params.push(Math.min(Number(input.limit) || 10, 30))
      return db.prepare(`
        SELECT s.posted_at, s.posted_url, d.platform, d.label AS destination,
               cl.business_name AS client, substr(COALESCE(s.rewritten_text, s.source_text), 1, 160) AS text
        FROM syndications s
        LEFT JOIN syndication_destinations d ON d.id = s.destination_id
        LEFT JOIN clients cl ON cl.id = s.client_id
        WHERE ${where.join(' AND ')}
        ORDER BY COALESCE(s.posted_at, s.created_at) DESC LIMIT ?`).all(...params)
    }

    case 'respond_queue': {
      const where: string[] = []; const params: any[] = []
      if (scope) { where.push('account_id IN (SELECT id FROM social_accounts WHERE client_id = ?)'); params.push(scope) }
      if (input.platform) { where.push('LOWER(platform) = ?'); params.push(String(input.platform).toLowerCase()) }
      params.push(Math.min(Number(input.limit) || 15, 40))
      const rows = db.prepare(`
        SELECT id, platform, author_name, status, sentiment, created_at, post_url, substr(content, 1, 180) AS content
        FROM social_comments ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY created_at DESC LIMIT ?`).all(...params)
      return { awaiting_reply_total: awaitingCount(scope), recent: rows }
    }

    case 'citations_summary':
      return db.prepare(`
        SELECT b.name AS brand, r.status, r.run_at, r.total_calls, ROUND(r.cost_gbp, 4) AS cost_gbp
        FROM citation_runs r LEFT JOIN tracked_brands b ON b.id = r.brand_id
        ${scope ? 'WHERE r.brand_id IN (SELECT id FROM tracked_brands WHERE client_id = ?)' : ''}
        ORDER BY r.run_at DESC LIMIT 10`).all(...(scope ? [scope] : []))

    case 'pipeline_overview': {
      const byStatus = scope
        ? db.prepare('SELECT status, COUNT(*) n FROM content WHERE client_id = ? GROUP BY status ORDER BY n DESC').all(scope)
        : db.prepare('SELECT status, COUNT(*) n FROM content GROUP BY status ORDER BY n DESC').all()
      return {
        ...(scope ? {} : { clients: one('SELECT COUNT(*) n FROM clients') }),
        content_total: contentCount(scope),
        content_by_status: byStatus,
        posts_published: scope
          ? one("SELECT COUNT(*) n FROM syndications WHERE status = 'posted' AND client_id = ?", scope)
          : one("SELECT COUNT(*) n FROM syndications WHERE status = 'posted'"),
        comments_awaiting_reply: awaitingCount(scope),
        citation_runs: scope
          ? one('SELECT COUNT(*) n FROM citation_runs WHERE brand_id IN (SELECT id FROM tracked_brands WHERE client_id = ?)', scope)
          : one('SELECT COUNT(*) n FROM citation_runs'),
      }
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}

// ── Proactive suggestions ────────────────────────────────────────────────────
export interface Suggestion { label: string; prompt: string; hint?: string }

export function suggestions(scope: Scope = null): Suggestion[] {
  const out: Suggestion[] = []

  const awaiting = awaitingCount(scope)
  if (awaiting > 0) out.push({
    label: 'Draft a reply to a waiting comment',
    prompt: 'Draft a reply to the most recent comment awaiting a response.',
    hint: `${awaiting} awaiting`,
  })

  const blocked = scope
    ? one("SELECT COUNT(*) n FROM content WHERE status = 'blocked' AND client_id = ?", scope)
    : one("SELECT COUNT(*) n FROM content WHERE status = 'blocked'")
  if (blocked > 0) out.push({
    label: 'Look at the blocked content',
    prompt: 'What content is currently blocked, and why? Show me.',
    hint: `${blocked} blocked`,
  })

  // A client that could use a fresh draft. Scoped → always the one client.
  const target = scope
    ? db.prepare('SELECT business_name FROM clients WHERE id = ?').get(scope) as any
    : db.prepare(`
        SELECT c.business_name FROM clients c
        WHERE (SELECT COUNT(*) FROM content WHERE client_id = c.id) > 0
          AND NOT EXISTS (
            SELECT 1 FROM syndications s
            WHERE s.client_id = c.id AND s.status = 'posted'
              AND COALESCE(s.posted_at, s.created_at) > unixepoch() - 14 * 86400)
        ORDER BY c.business_name LIMIT 1`).get() as any
  if (target) out.push({
    label: `Draft a blog post for ${target.business_name}`,
    prompt: `Suggest a strong blog topic for ${target.business_name} and draft the post.`,
    hint: scope ? undefined : 'quiet lately',
  })

  out.push({ label: 'State of the operation', prompt: 'Give me the state of the operation.' })
  out.push({ label: 'What went out this week?', prompt: 'What have we published or posted in the last 7 days?' })

  return out.slice(0, 4)
}

// ── Action tools (GATED — never run inside the loop, only via approval) ───────
interface ActionTool {
  schema: Anthropic.Tool
  danger: 'normal' | 'destructive'
  /** Do the expensive/generative work at PROPOSE time so the owner approves the
   *  ACTUAL result. Scope forces the target client for scoped users. */
  prepare?: (input: any, scope: Scope) => Promise<any>
  summarize: (input: any, prepared?: any) => string
  /** The write. Only ever called from resumeAgent() after approval. Scope forces
   *  / validates the client so a scoped user can only act on their own. */
  execute: (input: any, prepared: any, scope: Scope) => unknown
}

const ACTION_TOOLS: Record<string, ActionTool> = {
  draft_comment_reply: {
    schema: {
      name: 'draft_comment_reply',
      description:
        "Save a DRAFT reply to a social comment. Does NOT post — it stores the draft against the comment for review in the Respond module. Get the comment id from respond_queue. Use for 'draft a reply', 'suggest a response to that comment'.",
      input_schema: {
        type: 'object',
        properties: {
          comment_id: { type: 'string', description: 'Comment id from respond_queue' },
          text: { type: 'string', description: 'The reply text to save as a draft' },
        },
        required: ['comment_id', 'text'], additionalProperties: false,
      } as any,
    },
    danger: 'normal',
    summarize: (input) => {
      const c = db.prepare('SELECT author_name, platform, substr(content,1,120) AS content FROM social_comments WHERE id = ?').get(input.comment_id) as any
      const who = c ? `${c.author_name || 'someone'} on ${c.platform}` : 'a comment'
      const re = c?.content ? ` (re: “${c.content.trim()}”)` : ''
      const txt = String(input.text || '').trim()
      return `Save a DRAFT reply to ${who}${re}. Nothing is posted — it goes to the Respond queue to send.\n\nDraft: “${txt}”`
    },
    execute: (input, _prepared, scope) => {
      const comment = db.prepare(
        'SELECT sc.id, sa.client_id FROM social_comments sc LEFT JOIN social_accounts sa ON sa.id = sc.account_id WHERE sc.id = ?',
      ).get(input.comment_id) as any
      if (!comment) return { error: 'No comment with that id.' }
      if (scope && comment.client_id !== scope) return { error: 'That comment belongs to a different client.' }
      const text = String(input.text || '').trim()
      if (!text) return { error: 'Empty draft text.' }
      const existing = db.prepare('SELECT id FROM social_replies WHERE comment_id = ?').get(comment.id) as any
      if (existing) {
        db.prepare("UPDATE social_replies SET draft_content = ?, status = 'draft', drafted_by = 'ai' WHERE id = ?").run(text, existing.id)
        return { ok: true, reply_id: existing.id, saved: 'draft', note: 'Updated the existing draft. Nothing posted.' }
      }
      const id = randomUUID()
      db.prepare(
        "INSERT INTO social_replies (id, comment_id, draft_content, status, drafted_by, created_at) VALUES (?, ?, ?, 'draft', 'ai', unixepoch())",
      ).run(id, comment.id, text)
      return { ok: true, reply_id: id, saved: 'draft', note: 'Draft saved. Nothing posted — review and send it from Respond.' }
    },
  },

  draft_blog_post: {
    schema: {
      name: 'draft_blog_post',
      description:
        "Generate and save a DRAFT blog post for a client, grounded in that client's profile (voice, audience, expertise). Writes the full piece and saves it as a DRAFT in Content — does NOT publish. Get the client id from list_clients. Use for 'write / draft a blog / article for X about Y'. Always provide a topic.",
      input_schema: {
        type: 'object',
        properties: {
          client_id: { type: 'string', description: 'Client UUID from list_clients' },
          topic: { type: 'string', description: 'What the post should be about — a sentence or a few words.' },
        },
        required: ['client_id', 'topic'], additionalProperties: false,
      } as any,
    },
    danger: 'normal',
    prepare: async (input, scope) => {
      const cid = scope || input.client_id   // scoped users only ever draft for their own client
      const c = db.prepare(
        'SELECT id, business_name, industry, expertise_areas, tone_of_voice, target_audience, style_notes, location, blocked_topics, image_source, image_keywords FROM clients WHERE id = ?',
      ).get(cid) as any
      if (!c) return { error: 'No client with that id. Call list_clients first.' }
      const topic = String(input.topic || '').trim()
      if (!topic) return { error: 'No topic given.' }
      const clientForPrompt = {
        ...c,
        expertise_areas: safeJson(c.expertise_areas, []),
        blocked_topics: c.blocked_topics ? safeJson(c.blocked_topics, undefined) : undefined,
      }
      const prompt = buildBlogPrompt(clientForPrompt, '', topic)
      const res = await getClient().messages.create({
        model: MODEL, max_tokens: 4096, thinking: { type: 'adaptive' } as any,
        messages: [{ role: 'user', content: prompt }],
      })
      const raw = (res.content as Anthropic.ContentBlock[])
        .filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('')
      const { body: cleanBody, imageQuery } = extractImageQuery(raw)
      const title = extractTitle(cleanBody)
      const excerpt = cleanBody.replace(/[#*]/g, '').slice(0, 220).trim() + '…'

      // Same fix as the manual Generate tab: actually fetch and embed the image
      // instead of discarding the IMAGE_QUERY line. Best-effort — a failed
      // provider just leaves the body without one.
      let body = cleanBody
      const imageSource = c.image_source || 'auto'
      if (imageSource !== 'none') {
        try {
          const image = await getImageForPost({
            title, industry: c.industry, excerpt,
            imageSource, searchQuery: imageQuery || c.image_keywords || cleanTitleForSearch(title),
          })
          if (image) body = embedImageMarkdown(cleanBody, { downloadUrl: image.downloadUrl, alt: image.alt, credit: image.credit })
        } catch { /* non-critical — draft still saves without an image */ }
      }

      return {
        client_id: cid, client_name: c.business_name, title, body, excerpt, image_query: imageQuery,
        words: body.trim().split(/\s+/).length,
        tokens_in: res.usage.input_tokens, tokens_out: res.usage.output_tokens,
      }
    },
    summarize: (_input, prepared) => {
      if (!prepared || prepared.error) return `⚠️ Couldn't generate a draft: ${prepared?.error || 'unknown error'}. Nothing will be saved.`
      // Strip the embedded image markdown + its credit line too — this is a
      // plain-text chat preview, an image link would just read as noise.
      const preview = prepared.body
        .replace(/^!\[.*?\]\(.*?\)$/gm, '').replace(/^\*[^*]+\*$/gm, '')
        .replace(/[#*>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 280)
      return `Save a new blog DRAFT for ${prepared.client_name} — “${prepared.title}” (~${prepared.words} words). Nothing is published; it lands in Content as a draft to edit.\n\n${preview}…`
    },
    execute: (_input, prepared, scope) => {
      if (!prepared || prepared.error) return { error: prepared?.error || 'Generation failed; nothing saved.' }
      const cid = scope || prepared.client_id
      const id = randomUUID()
      db.prepare(
        "INSERT INTO content (id, client_id, type, title, body, excerpt, status, image_query) VALUES (?, ?, 'blog', ?, ?, ?, 'draft', ?)",
      ).run(id, cid, prepared.title, prepared.body, prepared.excerpt, prepared.image_query || '')
      const cost_gbp = logUsage({
        clientId: cid, purpose: 'agent_draft_blog', provider: 'anthropic', model: MODEL,
        tokensIn: prepared.tokens_in || 0, tokensOut: prepared.tokens_out || 0,
        contentId: id, ok: true,
      })
      return { ok: true, content_id: id, title: prepared.title, cost_gbp, saved: 'draft', note: "Blog draft saved to Content. Nothing published." }
    },
  },
}

const ACTION_NAMES = new Set(Object.keys(ACTION_TOOLS))
const ALL_TOOLS: Anthropic.Tool[] = [...READ_TOOLS, ...Object.values(ACTION_TOOLS).map(a => a.schema)]

// ── Pending-action store (the paused state between propose and approve) ───────
interface PendingPayload {
  convo: Anthropic.MessageParam[]
  readResults: Anthropic.ToolResultBlockParam[]
  actions: { tool_use_id: string; tool: string; input: any; prepared?: any }[]
  scope: Scope
}

function savePending(payload: PendingPayload): string {
  db.prepare('DELETE FROM agent_pending_actions WHERE created_at < unixepoch() - ?').run(PENDING_TTL_SECONDS)
  const id = randomUUID()
  db.prepare('INSERT INTO agent_pending_actions (id, payload) VALUES (?, ?)').run(id, JSON.stringify(payload))
  return id
}
function takePending(id: string): PendingPayload | null {
  const row = db.prepare('SELECT payload FROM agent_pending_actions WHERE id = ?').get(id) as any
  if (!row) return null
  db.prepare('DELETE FROM agent_pending_actions WHERE id = ?').run(id)
  try { return JSON.parse(row.payload) as PendingPayload } catch { return null }
}

function buildSystem(scope: Scope): string {
  const base = `You are the βWave in-app assistant — an AI operator embedded inside the βWave marketing platform.

You can INSPECT: clients and their profiles, content (drafts + published), posts actually published to each social/syndication destination and when, the reply queue (incoming comments awaiting a response, each with a comment id), and AI-citation tracking runs. For "how are things", pipeline_overview is a good first call. For "when did we last post to X", use recent_posts with a platform filter.

Use the tools to answer from REAL data. Never invent a client name, a number, a date, or a status — if you'd be guessing, call a tool instead. Call list_clients to resolve a name to an id before tools that need one. If a tool genuinely can't answer something, say so plainly and say what you CAN show.

You can also take ACTIONS, but every action is gated: calling an action tool does NOT run it — it is shown to the user for approval, and only runs if approved. Propose actions plainly and let the gate do its job. Take ONE action at a time. Available actions:
- draft_comment_reply: save a DRAFT reply to a comment (needs the comment id from respond_queue). Posts nothing — the draft goes to the Respond queue. First call respond_queue, write a reply in the client's voice matching the comment's tone, then call draft_comment_reply.
- draft_blog_post: generate and save a DRAFT blog post for a client (needs the client id, plus a topic). Publishes nothing — writes the full piece in the client's voice as a draft in Content. Resolve the client to an id, then call draft_blog_post with a clear topic. You do NOT write the post yourself — the tool generates it; just give a good topic.

If asked to do something with no action tool (publish, send, schedule, delete), say plainly that that isn't wired yet — you can draft comment replies and draft blog posts — and offer the relevant data or a draft instead.

Be proactive. When you finish answering, if there's an obvious useful next thing you could do, briefly OFFER it and ask if they'd like it — one suggestion, only when it genuinely follows.

Voice: concise, plain-spoken, no fluff. When you cite a number or a client, it came from a tool call.`

  if (!scope) return base + '\n\nYou are talking to the platform owner (John); you can see every client.'

  const c = db.prepare('SELECT business_name FROM clients WHERE id = ?').get(scope) as any
  const name = c?.business_name || 'this client'
  return `IMPORTANT — SCOPE: You are operating INSIDE a single client's workspace: ${name}. Every tool you call is automatically limited to ${name}. You cannot see, name, or act on any other client, and you must not imply other clients exist. "The operation", "the pipeline", "we" all mean ${name} specifically.\n\n${base}`
}

export interface AgentMessage { role: 'user' | 'assistant'; content: string }

export interface AgentResult {
  reply: string
  trace: { tool: string; input: any }[]
  pending?: { id: string; actions: { tool: string; summary: string; danger: string }[] }
}

const textOf = (content: Anthropic.ContentBlock[]) =>
  content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('')

const resultBlock = (id: string, out: unknown): Anthropic.ToolResultBlockParam => ({
  type: 'tool_result', tool_use_id: id, content: JSON.stringify(out).slice(0, 8000),
})

/** Run the loop until a final answer or a gated pause. `scope` locks every tool
 *  to one client when set. */
async function driveLoop(convo: Anthropic.MessageParam[], trace: AgentResult['trace'], scope: Scope): Promise<AgentResult> {
  const client = getClient()
  const system = buildSystem(scope)

  for (let i = 0; i < MAX_ITERS; i++) {
    const res = await client.messages.create({
      model: MODEL, max_tokens: 1500, system, tools: ALL_TOOLS, messages: convo,
      // NB: no `temperature` — Opus 4.8 rejects sampling params with a 400.
    })

    if (res.stop_reason !== 'tool_use') {
      return { reply: textOf(res.content as Anthropic.ContentBlock[]) || '(no answer)', trace }
    }

    const toolUses = (res.content as Anthropic.ContentBlock[]).filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )
    const gated = toolUses.filter(t => ACTION_NAMES.has(t.name))
    convo.push({ role: 'assistant', content: res.content })

    if (gated.length === 0) {
      const results = toolUses.map(t => {
        let out: unknown
        try { out = runReadTool(t.name, t.input, scope) } catch (e: any) { out = { error: String(e?.message || e) } }
        trace.push({ tool: t.name, input: t.input })
        return resultBlock(t.id, out)
      })
      convo.push({ role: 'user', content: results })
      continue
    }

    // Action turn — PAUSE. Compute reads now, run prepare() (so the actual result
    // is what's approved), park it, hand a proposal to the UI.
    const readResults = toolUses
      .filter(t => !ACTION_NAMES.has(t.name))
      .map(t => {
        let out: unknown
        try { out = runReadTool(t.name, t.input, scope) } catch (e: any) { out = { error: String(e?.message || e) } }
        trace.push({ tool: t.name, input: t.input })
        return resultBlock(t.id, out)
      })

    const actions: PendingPayload['actions'] = []
    const proposal: { tool: string; summary: string; danger: string }[] = []
    for (const t of gated) {
      const tool = ACTION_TOOLS[t.name]
      let prepared: any
      if (tool.prepare) {
        try { prepared = await tool.prepare(t.input, scope) } catch (e: any) { prepared = { error: String(e?.message || e) } }
      }
      actions.push({ tool_use_id: t.id, tool: t.name, input: t.input, prepared })
      proposal.push({ tool: t.name, summary: tool.summarize(t.input, prepared), danger: tool.danger })
    }
    const id = savePending({ convo, readResults, actions, scope })
    return { reply: textOf(res.content as Anthropic.ContentBlock[]), trace, pending: { id, actions: proposal } }
  }

  return { reply: "I got stuck looping on that — try rephrasing?", trace }
}

/** Fresh conversation. `scope` = client id for non-owners; null for owner. */
export async function runAgent(messages: AgentMessage[], scope: Scope = null): Promise<AgentResult> {
  const convo: Anthropic.MessageParam[] = messages.map(m => ({ role: m.role, content: m.content }))
  return driveLoop(convo, [], scope)
}

/** Resume after the owner's decision. Scope is carried from the parked state, so
 *  the executed action stays inside the same client the proposal was made in. */
export async function resumeAgent(id: string, decision: 'approve' | 'reject', callerScope: Scope = null): Promise<AgentResult> {
  const pending = takePending(id)
  if (!pending) throw new Error('That action has expired or was already handled — ask me again.')
  const scope = pending.scope ?? null
  // A scoped caller can only resume an action created in their own scope — never
  // let one client's login execute an action parked under another scope.
  if ((callerScope ?? null) !== scope) throw new Error('That action was not yours to approve.')

  const trace: AgentResult['trace'] = []
  const gatedResults = pending.actions.map(a => {
    if (decision === 'approve') {
      let out: unknown
      try { out = ACTION_TOOLS[a.tool]?.execute(a.input, a.prepared, scope) ?? { error: 'Unknown action.' } }
      catch (e: any) { out = { error: String(e?.message || e) } }
      trace.push({ tool: a.tool, input: a.input })
      return resultBlock(a.tool_use_id, out)
    }
    return resultBlock(a.tool_use_id, {
      declined: true,
      note: 'The user declined this action. Do not retry or propose it again unless asked; acknowledge briefly and stop.',
    })
  })

  const convo = pending.convo
  convo.push({ role: 'user', content: [...pending.readResults, ...gatedResults] })
  return driveLoop(convo, trace, scope)
}
