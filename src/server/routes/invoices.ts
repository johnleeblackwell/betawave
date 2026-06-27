import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { onInvoicePaid } from '../services/commission.js'

const router = Router({ mergeParams: true })

const VALID_STATUSES = ['pending', 'paid', 'overdue', 'cancelled']

// List invoices for a client (optionally filter by engagement)
router.get('/', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const { engagement_id, status } = req.query as { engagement_id?: string; status?: string }

  let query = `
    SELECT i.*,
      e.type             AS engagement_type,
      e.payment_cadence,
      e.value            AS engagement_value,
      p.name             AS prospect_name,
      p.source_lead_gen
    FROM invoices i
    JOIN engagements e ON e.id = i.engagement_id
    LEFT JOIN prospects p ON p.id = e.prospect_id
    WHERE i.client_id = ?
  `
  const params: any[] = [clientId]
  if (engagement_id) { query += ` AND i.engagement_id = ?`; params.push(engagement_id) }
  if (status)        { query += ` AND i.status = ?`;         params.push(status) }
  query += ` ORDER BY i.created_at DESC`

  res.json(db.prepare(query).all(...params))
})

// Create invoice (raise a new invoice against an engagement)
router.post('/', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const { engagement_id, amount, month = '', notes = '' } = req.body as {
    engagement_id: string; amount: number; month?: string; notes?: string
  }

  if (!engagement_id) return res.status(400).json({ error: 'engagement_id is required' })
  if (!amount || isNaN(Number(amount))) return res.status(400).json({ error: 'amount is required' })

  const engagement = db.prepare('SELECT * FROM engagements WHERE id = ? AND client_id = ?').get(engagement_id, clientId)
  if (!engagement) return res.status(404).json({ error: 'Engagement not found for this client' })

  const id = uuid()
  db.prepare(`
    INSERT INTO invoices (id, client_id, engagement_id, amount, month, status, notes)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, clientId, engagement_id, Number(amount), month, notes)

  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id)
  res.status(201).json(row)
})

// Mark invoice paid — this is the trigger point for commission calculation (Commit 3)
router.post('/:id/mark-paid', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND client_id = ?').get(id, clientId) as any
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' })
  if (invoice.status === 'paid') return res.status(400).json({ error: 'Invoice already marked paid' })

  const paid_at = Math.floor(Date.now() / 1000)
  db.prepare(`UPDATE invoices SET status = 'paid', paid_at = ? WHERE id = ?`).run(paid_at, id)

  // Trigger commission calculation (20% first payment / 10% recurring)
  try { onInvoicePaid(id) } catch (err: any) { console.error('[invoices] Commission trigger failed:', err.message) }

  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id)
  res.json({ ok: true, invoice: row })
})

// Update invoice status
router.patch('/:id', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ? AND client_id = ?').get(id, clientId)
  if (!existing) return res.status(404).json({ error: 'Invoice not found' })

  const { status, notes, amount } = req.body as { status?: string; notes?: string; amount?: number }
  if (status && !VALID_STATUSES.includes(status))
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` })

  db.prepare(`
    UPDATE invoices SET
      status = COALESCE(?, status),
      notes  = COALESCE(?, notes),
      amount = COALESCE(?, amount)
    WHERE id = ? AND client_id = ?
  `).run(status ?? null, notes ?? null, amount ?? null, id, clientId)

  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id)
  res.json(row)
})

export default router
