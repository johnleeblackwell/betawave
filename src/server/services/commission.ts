/**
 * Commission calculation engine.
 *
 * Rules (fixed globally, not configurable per client):
 *   - 20% of first_payment_amount on engagement sign → first_20 commission
 *   - 10% of each subsequent invoice amount → recurring_10 commission
 *   - 6-month inactivity gate: if lead gen's last_new_sale_date is >180 days ago,
 *     recurring_10 commissions are created with status='suspended'
 *   - When a new sale is made, last_new_sale_date is updated and all suspended
 *     recurring commissions are re-activated to 'pending'
 */
import { v4 as uuid } from 'uuid'
import db from '../db.js'

const FIRST_COMMISSION_PCT   = 0.20   // 20% of first payment
const RECURRING_COMMISSION_PCT = 0.10 // 10% of recurring invoices
const SIX_MONTHS_S = 6 * 30 * 24 * 60 * 60  // ≈ 180 days

/** Current YYYY-MM string */
function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Check whether a lead gen is currently within the 6-month inactivity gate */
function isInactive(leadGenId: string): boolean {
  const lg = db.prepare('SELECT last_new_sale_date FROM lead_generators WHERE id = ?').get(leadGenId) as any
  if (!lg?.last_new_sale_date) return false   // never made a sale — gate not yet triggered
  return (Math.floor(Date.now() / 1000) - lg.last_new_sale_date) >= SIX_MONTHS_S
}

/**
 * Called when an engagement is signed.
 * Creates the 20% first-payment commission (status: pending — awaits invoice payment).
 * The first_payment_amount on the engagement row is the amount to take 20% of.
 */
export function onEngagementSigned(engagementId: string): void {
  const engagement = db.prepare(`
    SELECT e.*, p.source_lead_gen
    FROM engagements e
    LEFT JOIN prospects p ON p.id = e.prospect_id
    WHERE e.id = ?
  `).get(engagementId) as any

  if (!engagement) { console.warn(`[commission] Engagement ${engagementId} not found`); return }
  if (!engagement.source_lead_gen) { console.log(`[commission] Engagement ${engagementId} has no lead gen — no commission`); return }

  const leadGenId = engagement.source_lead_gen
  const amount = (engagement.first_payment_amount || engagement.value) * FIRST_COMMISSION_PCT

  db.prepare(`
    INSERT INTO commission_ledger
      (id, lead_gen_id, client_id, engagement_id, commission_type, first_payment_amount, amount, month, status)
    VALUES (?, ?, ?, ?, 'first_20', ?, ?, ?, 'pending')
  `).run(uuid(), leadGenId, engagement.client_id, engagementId,
         engagement.first_payment_amount || engagement.value, amount, currentMonth())

  console.log(`[commission] 20% commission created: £${amount.toFixed(2)} for lead gen ${leadGenId} on engagement ${engagementId}`)
}

/**
 * Called when an invoice is marked paid.
 * - If this is the FIRST invoice on the engagement: marks the existing first_20 commission as 'paid'.
 * - For all invoices: creates a recurring_10 commission (unless it's the first payment, or
 *   the engagement has no lead gen).
 * - Checks 6-month inactivity gate; creates suspended commission if inactive.
 * - Updates lead gen's last_new_sale_date if this is their first commission event.
 */
export function onInvoicePaid(invoiceId: string): void {
  const invoice = db.prepare(`
    SELECT i.*,
      e.prospect_id, e.payment_cadence, e.first_payment_amount,
      p.source_lead_gen
    FROM invoices i
    JOIN engagements e ON e.id = i.engagement_id
    LEFT JOIN prospects p ON p.id = e.prospect_id
    WHERE i.id = ?
  `).get(invoiceId) as any

  if (!invoice) { console.warn(`[commission] Invoice ${invoiceId} not found`); return }
  if (!invoice.source_lead_gen) { console.log(`[commission] Invoice ${invoiceId} has no lead gen — no commission`); return }

  const leadGenId = invoice.source_lead_gen

  // Is this the first invoice on this engagement?
  const priorPaidCount = (db.prepare(`
    SELECT COUNT(*) as n FROM invoices
    WHERE engagement_id = ? AND status = 'paid' AND id != ?
  `).get(invoice.engagement_id, invoiceId) as any).n

  const isFirstInvoice = priorPaidCount === 0

  if (isFirstInvoice) {
    // Mark the pending first_20 commission as paid
    db.prepare(`
      UPDATE commission_ledger SET status = 'paid', paid_date = unixepoch(), invoice_id = ?
      WHERE engagement_id = ? AND commission_type = 'first_20' AND status = 'pending'
    `).run(invoiceId, invoice.engagement_id)

    // Update last_new_sale_date — this counts as a new sale
    db.prepare('UPDATE lead_generators SET last_new_sale_date = unixepoch() WHERE id = ?').run(leadGenId)

    console.log(`[commission] First_20 commission paid for engagement ${invoice.engagement_id}`)

    // Resume any previously suspended recurring commissions
    resumeSuspendedCommissions(leadGenId)

    // Don't add recurring_10 on the first invoice — that's what the 20% covers
    return
  }

  // Recurring invoice — create recurring_10 commission
  const inactive = isInactive(leadGenId)
  const status = inactive ? 'suspended' : 'pending'
  const amount = invoice.amount * RECURRING_COMMISSION_PCT

  const month = invoice.month || currentMonth()

  db.prepare(`
    INSERT INTO commission_ledger
      (id, lead_gen_id, client_id, engagement_id, invoice_id, commission_type, amount, month, status, inactivity_flag)
    VALUES (?, ?, ?, ?, ?, 'recurring_10', ?, ?, ?, ?)
  `).run(uuid(), leadGenId, invoice.client_id, invoice.engagement_id,
         invoiceId, amount, month, status, inactive ? 1 : 0)

  console.log(`[commission] Recurring_10 commission created: £${amount.toFixed(2)} (${status}) for lead gen ${leadGenId}`)
}

/**
 * Called when a lead gen makes a new sale (any new invoice first payment).
 * Re-activates all their suspended recurring commissions.
 */
export function resumeSuspendedCommissions(leadGenId: string): void {
  const result = db.prepare(`
    UPDATE commission_ledger
    SET status = 'pending', inactivity_flag = 0
    WHERE lead_gen_id = ? AND status = 'suspended' AND commission_type = 'recurring_10'
  `).run(leadGenId)

  if (result.changes > 0) {
    console.log(`[commission] Resumed ${result.changes} suspended recurring commission(s) for lead gen ${leadGenId}`)
  }
}

/**
 * Monthly settlement: aggregate all 'pending' commissions for a lead gen into a payout_ledger row.
 * Marks those commission rows as 'paid' and links them to the payout.
 * Returns the payout record.
 */
export function runMonthlySettlement(leadGenId: string, month?: string): any {
  const settleMonth = month || currentMonth()

  // Check for duplicate settlement
  const existing = db.prepare('SELECT * FROM payout_ledger WHERE lead_gen_id = ? AND month = ?').get(leadGenId, settleMonth)
  if (existing) {
    console.warn(`[commission] Settlement for ${leadGenId} / ${settleMonth} already exists`)
    return existing
  }

  // Gather pending commissions for this month
  const pending = db.prepare(`
    SELECT * FROM commission_ledger
    WHERE lead_gen_id = ? AND month = ? AND status = 'pending'
  `).all(leadGenId, settleMonth) as any[]

  const suspended = db.prepare(`
    SELECT * FROM commission_ledger
    WHERE lead_gen_id = ? AND month = ? AND status = 'suspended'
  `).all(leadGenId, settleMonth) as any[]

  const totalEarned = pending.reduce((s: number, c: any) => s + c.amount, 0)
  const hasSuspended = suspended.length > 0

  const payoutId = uuid()
  const settlementDate = Math.floor(Date.now() / 1000)

  db.prepare(`
    INSERT INTO payout_ledger (id, lead_gen_id, month, total_earned, total_paid, suspended_flag, settlement_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(payoutId, leadGenId, settleMonth, totalEarned, totalEarned, hasSuspended ? 1 : 0, settlementDate)

  // Mark pending commissions as paid
  if (pending.length > 0) {
    const ids = pending.map((c: any) => `'${c.id}'`).join(',')
    db.exec(`
      UPDATE commission_ledger
      SET status = 'paid', paid_date = ${settlementDate}, payout_id = '${payoutId}'
      WHERE id IN (${ids})
    `)
  }

  const payout = db.prepare('SELECT * FROM payout_ledger WHERE id = ?').get(payoutId)
  console.log(`[commission] Settlement complete for lead gen ${leadGenId} / ${settleMonth}: £${totalEarned.toFixed(2)}`)
  return payout
}

/**
 * Run settlements for ALL active lead generators for the given month.
 * Called by the monthly scheduler job.
 */
export function runAllSettlements(month?: string): void {
  const settleMonth = month || currentMonth()
  const leadGens = db.prepare(`SELECT id FROM lead_generators WHERE status = 'active'`).all() as any[]

  console.log(`[commission] Running settlements for ${leadGens.length} lead gen(s), month ${settleMonth}`)
  for (const { id } of leadGens) {
    try {
      runMonthlySettlement(id, settleMonth)
    } catch (err: any) {
      console.error(`[commission] Settlement failed for lead gen ${id}: ${err.message}`)
    }
  }
}

/**
 * Apply the inactivity gate: check all active lead gens and suspend any recurring
 * commissions that are 'pending' but the lead gen's gate has expired.
 * Run nightly by the scheduler.
 */
export function applyInactivityGates(): void {
  const now = Math.floor(Date.now() / 1000)
  const cutoff = now - SIX_MONTHS_S

  const inactiveLeadGens = db.prepare(`
    SELECT id FROM lead_generators
    WHERE status = 'active'
      AND last_new_sale_date IS NOT NULL
      AND last_new_sale_date < ?
  `).all(cutoff) as any[]

  for (const { id } of inactiveLeadGens) {
    const result = db.prepare(`
      UPDATE commission_ledger
      SET status = 'suspended', inactivity_flag = 1
      WHERE lead_gen_id = ? AND status = 'pending' AND commission_type = 'recurring_10'
    `).run(id)

    if (result.changes > 0) {
      console.log(`[commission] Inactivity gate applied: suspended ${result.changes} recurring commission(s) for lead gen ${id}`)
    }
  }
}
