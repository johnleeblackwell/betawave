/**
 * Consultant Mode — compliant content generation for direct-seller / MLM clients.
 * Mounted at /api/clients/:clientId/consultant.
 * Every draft passes through the MLM compliance gate (compliance-mlm.ts): the prompt is
 * guarded, the output scanned, blocked drafts retried once then flagged for review, and
 * mandated disclaimers auto-injected. Brand-agnostic; the client's `mlm_company` picks the ruleset.
 */
import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { generateCompliant, rulesetForClient } from '../services/compliance-mlm.js'

export const consultantRouter = Router({ mergeParams: true })

/** POST /post { topic, channel? } — generate one compliant consultant post. */
consultantRouter.post('/post', async (req, res) => {
  const clientId = req.params.clientId
  const topic = String(req.body?.topic || '').trim()
  const channel = (String(req.body?.channel || 'social').toLowerCase() === 'blog') ? 'blog' : 'social'
  if (!topic) return res.status(400).json({ error: 'topic required' })

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId) as any
  if (!client) return res.status(404).json({ error: 'client not found' })
  if (!rulesetForClient(client)) return res.status(400).json({ error: 'client is not configured as an MLM/consultant client (set clients.mlm_company)' })

  const businessName = client.business_name || 'an independent consultant'
  const system = `You write ${channel === 'blog' ? 'a short blog post' : 'one short social post'} for ${businessName}, an independent wellness consultant building a personal brand. Warm, genuine, first-person, helpful — like a real person sharing, not a brand advertising. Educational / lifestyle angle. End with a soft, non-pushy invitation to learn more (their link is appended separately). Plain text. No hashtags unless genuinely useful and compliant.`
  const prompt = `Write one ${channel} post about: ${topic}`

  try {
    const r = await generateCompliant(client, { system, prompt, max_tokens: channel === 'blog' ? 900 : 320, temperature: 0.8 })
    const status = r.blocked ? 'blocked' : 'draft'
    const id = uuid()
    db.prepare(`INSERT INTO content (id, client_id, type, title, body, status) VALUES (?,?,'consultant',?,?,?)`)
      .run(id, clientId, topic.slice(0, 120), r.text, status)
    res.json({
      id, status, blocked: r.blocked, reason: r.reason, attempts: r.attempts, text: r.text,
      compliance: r.compliance ? {
        blocks: r.compliance.blocks,
        warnings: r.compliance.warnings,
        requiredDisclaimers: r.compliance.requiredDisclaimers.map(d => d.id),
        missingDisclaimers: r.compliance.missingDisclaimers.map(d => d.id),
      } : null,
    })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})
