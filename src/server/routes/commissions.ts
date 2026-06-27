/**
 * Admin commission and payout routes.
 *
 * GET  /api/commissions                    — all commissions (filterable)
 * GET  /api/commissions/payouts            — all payout ledger records
 * POST /api/commissions/settle             — manually trigger settlement for a lead gen / month
 * POST /api/commissions/settle-all         — run all settlements for current month
 * GET  /api/lead-generators/:id/commissions — commissions for one lead gen (admin view)
 * GET  /api/lead-generators/:id/payouts    — payouts for one lead gen (admin view)
 */
import { Router } from 'express'
import db from '../db.js'
import { runMonthlySettlement, runAllSettlements, applyInactivityGates } from '../services/commission.js'

const router = Router()

// All commissions (admin)
router.get('/', (req, res) => {
  const { lead_gen_id, client_id, status, month } = req.query as Record<string, string>

  let query = `
    SELECT cl.*,
      lg.name  AS lead_gen_name,
      lg.email AS lead_gen_email,
      c.business_name AS client_name
    FROM commission_ledger cl
    JOIN lead_generators lg ON lg.id = cl.lead_gen_id
    JOIN clients c ON c.id = cl.client_id
    WHERE 1=1
  `
  const params: any[] = []
  if (lead_gen_id) { query += ` AND cl.lead_gen_id = ?`; params.push(lead_gen_id) }
  if (client_id)   { query += ` AND cl.client_id = ?`;   params.push(client_id) }
  if (status)      { query += ` AND cl.status = ?`;      params.push(status) }
  if (month)       { query += ` AND cl.month = ?`;       params.push(month) }
  query += ` ORDER BY cl.created_at DESC`

  res.json(db.prepare(query).all(...params))
})

// Payout ledger (admin)
router.get('/payouts', (req, res) => {
  const { lead_gen_id, month } = req.query as Record<string, string>

  let query = `
    SELECT pl.*, lg.name AS lead_gen_name, lg.email AS lead_gen_email
    FROM payout_ledger pl
    JOIN lead_generators lg ON lg.id = pl.lead_gen_id
    WHERE 1=1
  `
  const params: any[] = []
  if (lead_gen_id) { query += ` AND pl.lead_gen_id = ?`; params.push(lead_gen_id) }
  if (month)       { query += ` AND pl.month = ?`;       params.push(month) }
  query += ` ORDER BY pl.month DESC, pl.created_at DESC`

  res.json(db.prepare(query).all(...params))
})

// Manually trigger settlement for one lead gen
router.post('/settle', (req, res) => {
  const { lead_gen_id, month } = req.body as { lead_gen_id: string; month?: string }
  if (!lead_gen_id) return res.status(400).json({ error: 'lead_gen_id required' })

  const lg = db.prepare('SELECT id FROM lead_generators WHERE id = ?').get(lead_gen_id)
  if (!lg) return res.status(404).json({ error: 'Lead generator not found' })

  try {
    const payout = runMonthlySettlement(lead_gen_id, month)
    res.json({ ok: true, payout })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Run all settlements (trigger from admin or scheduler)
router.post('/settle-all', (req, res) => {
  const { month } = req.body as { month?: string }
  try {
    runAllSettlements(month)
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Apply inactivity gates (nightly)
router.post('/apply-gates', (_req, res) => {
  try {
    applyInactivityGates()
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
