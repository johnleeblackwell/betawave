import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { onEngagementSigned } from '../services/commission.js'

const router = Router({ mergeParams: true })

const VALID_TYPES    = ['founder_retainer', 'monthly_retainer', 'annual_retainer', 'one_off']
const VALID_CADENCES = ['monthly', 'annual', 'one_off']
const VALID_STATUSES = ['active', 'paused', 'churned', 'cancelled']

// Calculate what first_payment_amount should be based on cadence + value
function calcFirstPayment(value: number, cadence: string): number {
  if (cadence === 'annual') return value * 12
  return value // monthly or one_off
}

// List engagements for a client
router.get('/', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const rows = db.prepare(`
    SELECT e.*,
      p.name   AS prospect_name,
      p.email  AS prospect_email,
      p.source_lead_gen
    FROM engagements e
    LEFT JOIN prospects p ON p.id = e.prospect_id
    WHERE e.client_id = ?
    ORDER BY e.created_at DESC
  `).all(clientId)
  res.json(rows)
})

// Get a single engagement
router.get('/:id', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  const row = db.prepare(`
    SELECT e.*,
      p.name  AS prospect_name,
      p.email AS prospect_email,
      p.source_lead_gen
    FROM engagements e
    LEFT JOIN prospects p ON p.id = e.prospect_id
    WHERE e.id = ? AND e.client_id = ?
  `).get(id, clientId)
  if (!row) return res.status(404).json({ error: 'Engagement not found' })
  res.json(row)
})

// Create engagement (signing a deal)
router.post('/', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const {
    prospect_id = null,
    type = 'monthly_retainer',
    value,
    payment_cadence = 'monthly',
    notes = '',
  } = req.body as {
    prospect_id?: string | null
    type?: string
    value: number
    payment_cadence?: string
    notes?: string
  }

  if (!value || isNaN(Number(value))) return res.status(400).json({ error: 'value (monthly rate) is required' })
  if (!VALID_TYPES.includes(type))    return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` })
  if (!VALID_CADENCES.includes(payment_cadence)) return res.status(400).json({ error: `payment_cadence must be one of: ${VALID_CADENCES.join(', ')}` })

  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId)
  if (!client) return res.status(404).json({ error: 'Client not found' })

  if (prospect_id) {
    const prospect = db.prepare('SELECT id FROM prospects WHERE id = ? AND client_id = ?').get(prospect_id, clientId)
    if (!prospect) return res.status(400).json({ error: 'Prospect not found for this client' })
  }

  const id = uuid()
  const first_payment_amount = calcFirstPayment(Number(value), payment_cadence)
  const signed_at = Math.floor(Date.now() / 1000)

  db.prepare(`
    INSERT INTO engagements
      (id, client_id, prospect_id, type, value, payment_cadence, first_payment_amount, signed_at, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(id, clientId, prospect_id, type, Number(value), payment_cadence,
         first_payment_amount, signed_at, notes)

  // If prospect exists, advance their status to 'signed'
  if (prospect_id) {
    db.prepare(`UPDATE prospects SET status = 'signed', updated_at = unixepoch() WHERE id = ?`)
      .run(prospect_id)
  }

  const row = db.prepare(`
    SELECT e.*, p.name AS prospect_name, p.source_lead_gen
    FROM engagements e LEFT JOIN prospects p ON p.id = e.prospect_id
    WHERE e.id = ?
  `).get(id)

  // Trigger 20% first-payment commission creation
  try { onEngagementSigned(id) } catch (err: any) { console.error('[engagements] Commission trigger failed:', err.message) }

  res.status(201).json(row)
})

// Update engagement status (churn, pause, reactivate)
router.patch('/:id', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  const existing = db.prepare('SELECT * FROM engagements WHERE id = ? AND client_id = ?').get(id, clientId)
  if (!existing) return res.status(404).json({ error: 'Engagement not found' })

  const { status, notes } = req.body as { status?: string; notes?: string }
  if (status && !VALID_STATUSES.includes(status))
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` })

  db.prepare(`
    UPDATE engagements SET
      status     = COALESCE(?, status),
      notes      = COALESCE(?, notes),
      updated_at = unixepoch()
    WHERE id = ? AND client_id = ?
  `).run(status ?? null, notes ?? null, id, clientId)

  const row = db.prepare('SELECT * FROM engagements WHERE id = ?').get(id)
  res.json(row)
})

export default router
