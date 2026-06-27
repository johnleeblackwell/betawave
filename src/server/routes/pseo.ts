/**
 * Next-Gen pSEO (AI-Signal / GEO) — client-scoped.
 * Mounted at /api/clients/:clientId/pseo.
 */
import { Router } from 'express'
import { runAiSignalForClient } from '../services/pseo.js'

export const pseoRouter = Router({ mergeParams: true })

/** POST /ai-signal { limit } — generate citation-optimised answer pages from the
 *  client's tracked citation queries. Saved to content as drafts. */
pseoRouter.post('/ai-signal', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.body?.limit) || 5, 1), 20)
  const node = typeof req.body?.node === 'string' ? req.body.node : undefined
  const educational = typeof req.body?.educational === 'boolean' ? req.body.educational : undefined
  try {
    res.json(await runAiSignalForClient(req.params.clientId, limit, { node, educational }))
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})
