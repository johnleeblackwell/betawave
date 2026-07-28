/**
 * βWave in-app agent route — /chat, /approve, /suggestions.
 *
 * Available to the owner (whole instance) AND to scoped users (operator / demo,
 * locked to their one client). The scope comes from the auth context set by the
 * middleware; the agent service enforces it in every tool, so a demo prospect
 * can only ever see and act on their own client. /approve is the only path on
 * which a gated action executes.
 */
import { Router } from 'express'
import { runAgent, resumeAgent, suggestions, type AgentMessage, type Scope } from '../services/agent.js'

const router = Router()

// The client a request is scoped to: null for the owner, the client_id for a
// scoped user (operator / demo). Read from the auth context the guard sets.
const scopeOf = (req: any): Scope => {
  const a = req.auth
  return a && a.role !== 'owner' && a.client_id ? String(a.client_id) : null
}

const friendlyError = (e: any): string => {
  const msg = String(e?.message || e)
  return /quota|usage limit|rate limit|429|529|overloaded/i.test(msg)
    ? 'The AI is rate-limited or over its cap right now — try again in a moment.'
    : msg
}

// Tap-to-run suggestions, scoped to the caller's client where applicable.
router.get('/suggestions', (req, res) => {
  try {
    res.json({ suggestions: suggestions(scopeOf(req)) })
  } catch (e: any) {
    console.error('[agent] suggestions failed:', String(e?.message || e))
    res.json({ suggestions: [] })
  }
})

router.post('/chat', async (req, res) => {
  const raw = Array.isArray(req.body?.messages) ? req.body.messages : []
  const messages: AgentMessage[] = raw
    .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string' && m.content.trim())
    .slice(-20)
  if (!messages.length) return res.status(400).json({ error: 'messages required' })

  try {
    res.json(await runAgent(messages, scopeOf(req)))
  } catch (e: any) {
    console.error('[agent] chat failed:', String(e?.message || e))
    res.status(500).json({ error: friendlyError(e) })
  }
})

router.post('/approve', async (req, res) => {
  const { id, decision } = req.body || {}
  if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'id required' })
  if (decision !== 'approve' && decision !== 'reject') return res.status(400).json({ error: "decision must be 'approve' or 'reject'" })

  try {
    res.json(await resumeAgent(id, decision, scopeOf(req)))
  } catch (e: any) {
    console.error('[agent] approve failed:', String(e?.message || e))
    res.status(500).json({ error: friendlyError(e) })
  }
})

export default router
