import { Router } from 'express'
import db from '../db.js'

const router = Router({ mergeParams: true })

// Trigger a colony agent run for a client
router.post('/run', async (req, res) => {
  try {
    const { clientId } = req.params as { clientId: string }
    const { runAgent } = await import('../services/colonyAgent.js')
    const result = await runAgent(clientId)
    res.json(result)
  } catch (err) {
    res.status(500).json({
      success: false,
      error: (err as Error)?.message || 'Agent run failed',
    })
  }
})

// Get agent status / last runs for a colony
router.get('/status', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const recentContent = db.prepare(`
    SELECT id, title, type, status, created_at, image_query
    FROM content WHERE client_id = ? ORDER BY created_at DESC LIMIT 10
  `).all(clientId)
  res.json({ colonyId: clientId, contentCount: (recentContent as any[]).length, recentContent })
})

export default router
