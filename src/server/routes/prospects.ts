import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'

const router = Router({ mergeParams: true })

const VALID_STATUSES = ['lead', 'qualified', 'proposal_sent', 'signed', 'active', 'churned']

// List prospects for a client
router.get('/', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const { status } = req.query as { status?: string }

  let query = `SELECT * FROM prospects WHERE client_id = ?`
  const params: any[] = [clientId]
  if (status) { query += ` AND status = ?`; params.push(status) }
  query += ` ORDER BY created_at DESC`

  const rows = db.prepare(query).all(...params)
  res.json(rows)
})

// Get a single prospect
router.get('/:id', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  const row = db.prepare('SELECT * FROM prospects WHERE id = ? AND client_id = ?').get(id, clientId)
  if (!row) return res.status(404).json({ error: 'Prospect not found' })
  res.json(row)
})

// Create prospect
router.post('/', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const { name, email = '', phone = '', company = '', status = 'lead', notes = '',
          source_lead_gen = '' } = req.body as {
    name: string; email?: string; phone?: string; company?: string
    status?: string; notes?: string; source_lead_gen?: string
  }

  if (!name?.trim()) return res.status(400).json({ error: 'name is required' })
  if (status && !VALID_STATUSES.includes(status))
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` })

  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId)
  if (!client) return res.status(404).json({ error: 'Client not found' })

  const id = uuid()
  const attribution_timestamp = source_lead_gen ? Math.floor(Date.now() / 1000) : null

  db.prepare(`
    INSERT INTO prospects (id, client_id, name, email, phone, company, status, source_lead_gen,
                           attribution_timestamp, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, clientId, name.trim(), email, phone, company, status,
         source_lead_gen, attribution_timestamp, notes)

  const row = db.prepare('SELECT * FROM prospects WHERE id = ?').get(id)
  res.status(201).json(row)
})

// Update prospect
router.patch('/:id', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  const existing = db.prepare('SELECT * FROM prospects WHERE id = ? AND client_id = ?').get(id, clientId) as any
  if (!existing) return res.status(404).json({ error: 'Prospect not found' })

  const { name, email, phone, company, status, notes } = req.body as {
    name?: string; email?: string; phone?: string; company?: string
    status?: string; notes?: string
  }

  // Attribution is immutable once set — only allow setting if not already set
  if (status && !VALID_STATUSES.includes(status))
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` })

  db.prepare(`
    UPDATE prospects SET
      name       = COALESCE(?, name),
      email      = COALESCE(?, email),
      phone      = COALESCE(?, phone),
      company    = COALESCE(?, company),
      status     = COALESCE(?, status),
      notes      = COALESCE(?, notes),
      updated_at = unixepoch()
    WHERE id = ? AND client_id = ?
  `).run(name ?? null, email ?? null, phone ?? null, company ?? null,
         status ?? null, notes ?? null, id, clientId)

  const row = db.prepare('SELECT * FROM prospects WHERE id = ?').get(id)
  res.json(row)
})

// Delete prospect
router.delete('/:id', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  const result = db.prepare('DELETE FROM prospects WHERE id = ? AND client_id = ?').run(id, clientId)
  if (result.changes === 0) return res.status(404).json({ error: 'Prospect not found' })
  res.json({ ok: true })
})

export default router
