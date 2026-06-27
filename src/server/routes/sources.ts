// @ts-nocheck
import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'

const router = Router({ mergeParams: true }) as any

// List sources for a client
router.get('/', (req, res) => {
  const sources = db.prepare('SELECT * FROM sources WHERE client_id = ? ORDER BY rowid ASC').all(req.params.clientId)
  res.json(sources.map(s => ({ ...(s as any), keywords: JSON.parse((s as any).keywords) })))
})

// Add source
router.post('/', (req, res) => {
  const { type, url, keywords, label } = req.body
  if (!type || !label) return res.status(400).json({ error: 'type and label are required' })
  const id = uuid()
  db.prepare(`
    INSERT INTO sources (id, client_id, type, url, keywords, label)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.params.clientId, type, url || '', JSON.stringify(keywords || []), label)
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(id)
  res.status(201).json({ ...(source as any), keywords: JSON.parse((source as any).keywords) })
})

// Toggle source active state
router.patch('/:id/toggle', (req, res) => {
  db.prepare('UPDATE sources SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?').run(req.params.id)
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(req.params.id)
  res.json({ ...(source as any), keywords: JSON.parse((source as any).keywords) })
})

// Delete source
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM sources WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router
