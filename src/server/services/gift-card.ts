/**
 * Gift card service.
 *
 * - generateRedemptionCode(): unique 16-char code (4×4 with dashes, e.g. VIXX-K9TM-4PQ2-RJNB)
 * - sendGiftCardEmail(): email delivery of the code to the buyer
 * - markRedeemed(): partial or full redemption, updates purchase status
 * - getRemainingBalance(): sum of denomination minus all redemptions
 */
import { randomBytes } from 'crypto'
import nodemailer from 'nodemailer'
import db from '../db.js'

/** Generate a human-readable redemption code: XXXX-XXXX-XXXX-XXXX */
export function generateRedemptionCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no O/0/I/1 to avoid confusion
  let code = ''
  const raw = randomBytes(12)
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 3 === 0) code += '-'
    code += chars[raw[i] % chars.length]
  }
  return code
}

/** Send the gift card email to the buyer */
export async function sendGiftCardEmail(purchaseId: string): Promise<void> {
  const purchase = db.prepare(`
    SELECT gcp.*, gcs.denomination, gcs.label, c.business_name, c.contact_email,
           c.smtp_host, c.smtp_port, c.smtp_user, c.smtp_pass, c.smtp_from
    FROM shop_purchases gcp
    JOIN shop_skus gcs ON gcs.id = gcp.sku_id
    JOIN clients c ON c.id = gcp.client_id
    WHERE gcp.id = ?
  `).get(purchaseId) as any

  if (!purchase) throw new Error(`Purchase ${purchaseId} not found`)

  const smtpHost = purchase.smtp_host || process.env.SMTP_HOST
  const smtpUser = purchase.smtp_user || process.env.SMTP_USER
  const smtpPass = purchase.smtp_pass || process.env.SMTP_PASS
  const smtpFrom = purchase.smtp_from || process.env.SMTP_FROM || smtpUser

  if (!smtpHost || !smtpUser || !smtpPass) {
    console.warn(`[gift-card] SMTP not configured — skipping email for purchase ${purchaseId}`)
    return
  }

  const brandName = purchase.business_name
  const expiryStr = purchase.expiry_date
    ? new Date(purchase.expiry_date * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'No expiry'

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#0f172a;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="background:#0f172a;padding:28px 32px;text-align:center">
        <div style="font-size:1.4rem;font-weight:700;color:#f8fafc">${brandName}</div>
        <div style="color:#94a3b8;font-size:0.9rem;margin-top:4px">Gift Card</div>
      </div>
      <div style="padding:32px">
        ${purchase.recipient_name ? `<p style="margin-bottom:16px">Hi <strong>${purchase.recipient_name}</strong>,</p>` : ''}
        ${purchase.gift_message ? `<blockquote style="border-left:3px solid #d97706;padding:10px 16px;margin:0 0 20px;color:#374151;font-style:italic">${purchase.gift_message}</blockquote>` : ''}
        <p style="margin-bottom:20px">You've received a <strong>${purchase.label || `£${purchase.denomination} Gift Card`}</strong> for ${brandName}.</p>

        <div style="background:#f8fafc;border:2px dashed #e2e8f0;border-radius:8px;padding:24px;text-align:center;margin:24px 0">
          <div style="font-size:0.8rem;color:#64748b;font-weight:600;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">Your Gift Card Code</div>
          <div style="font-size:1.8rem;font-weight:700;letter-spacing:4px;color:#0f172a;font-family:monospace">${purchase.redemption_code}</div>
          <div style="font-size:1.1rem;font-weight:600;color:#d97706;margin-top:8px">£${purchase.amount.toFixed(2)}</div>
        </div>

        <p style="font-size:0.85rem;color:#64748b">Valid until: ${expiryStr}</p>
        <p style="font-size:0.85rem;color:#64748b;margin-top:8px">Present this code at any ${brandName} location when booking or at the reception desk.</p>
      </div>
    </div>
  `

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number(purchase.smtp_port || process.env.SMTP_PORT || 587),
    secure: Number(purchase.smtp_port || process.env.SMTP_PORT) === 465,
    auth: { user: smtpUser, pass: smtpPass },
  })

  await transporter.sendMail({
    from: smtpFrom,
    to: purchase.buyer_email,
    subject: `Your ${brandName} Gift Card — ${purchase.redemption_code}`,
    html,
  })
  console.log(`[gift-card] Email sent to ${purchase.buyer_email} for purchase ${purchaseId}`)
}

/** Return remaining balance on a gift card */
export function getRemainingBalance(purchaseId: string): number {
  const purchase = db.prepare('SELECT amount FROM shop_purchases WHERE id = ?').get(purchaseId) as any
  if (!purchase) return 0
  const redeemed = db.prepare(
    'SELECT COALESCE(SUM(value_redeemed), 0) as total FROM gift_card_redemptions WHERE purchase_id = ?'
  ).get(purchaseId) as any
  return Math.max(0, purchase.amount - (redeemed?.total || 0))
}

/** Process a redemption. Returns the updated remaining balance. */
export function markRedeemed(purchaseId: string, valueToRedeem: number, redeemedBy: string, notes = ''): number {
  const remaining = getRemainingBalance(purchaseId)
  if (valueToRedeem > remaining) throw new Error(`Cannot redeem £${valueToRedeem} — only £${remaining.toFixed(2)} remaining`)

  // Use crypto.randomUUID (Node 15+) for the redemption ID
  const redemptionId = crypto.randomUUID()
  db.prepare(`
    INSERT INTO gift_card_redemptions (id, purchase_id, value_redeemed, redeemed_by, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(redemptionId, purchaseId, valueToRedeem, redeemedBy, notes)

  const newBalance = getRemainingBalance(purchaseId)
  if (newBalance <= 0) {
    db.prepare(`UPDATE shop_purchases SET status = 'redeemed' WHERE id = ?`).run(purchaseId)
  }
  return newBalance
}
