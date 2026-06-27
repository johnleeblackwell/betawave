/**
 * Shop routes — multi-product-type catalog (gift_card | service | subscription | product).
 *
 * Admin (under APP_PASSWORD guard):
 *   GET    /api/clients/:clientId/shop/skus          — list SKUs (filter ?type=service etc.)
 *   POST   /api/clients/:clientId/shop/skus          — create SKU (any product_type)
 *   PATCH  /api/clients/:clientId/shop/skus/:id      — update SKU
 *   GET    /api/clients/:clientId/shop/purchases     — sales list + reporting
 *   POST   /api/clients/:clientId/shop/purchases/:id/redeem    — gift card redemption
 *   POST   /api/clients/:clientId/shop/purchases/:id/fulfilled — mark service/product delivered
 *
 * Public (no auth):
 *   GET  /shop/:clientSlug                           — public storefront HTML
 *   POST /api/shop/checkout                          — create Stripe Checkout session (all types)
 *   POST /api/shop/webhook                           — Stripe webhook (fulfils orders by type)
 *   GET  /api/shop/check/:code                       — validate gift card code + remaining balance
 */
import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { generateRedemptionCode, sendGiftCardEmail, getRemainingBalance, markRedeemed } from '../services/gift-card.js'

const router = Router({ mergeParams: true })

// Resolve a SKU's price in pence regardless of type.
// gift_card uses `denomination` (GBP); other types use `price_gbp` (GBP).
function priceInPence(sku: any): number {
  const gbp = sku.product_type === 'gift_card' ? Number(sku.denomination) : Number(sku.price_gbp)
  if (!gbp || isNaN(gbp)) return 0
  return Math.round(gbp * 100)
}

function priceLabel(sku: any): string {
  const gbp = sku.product_type === 'gift_card' ? sku.denomination : sku.price_gbp
  if (!gbp) return ''
  if (sku.product_type === 'subscription' && sku.billing_interval) {
    return `£${Number(gbp).toFixed(2)} / ${sku.billing_interval}`
  }
  return `£${Number(gbp).toFixed(2)}`
}

// ─── SKU management (admin) ───────────────────────────────────────────────────

router.get('/skus', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const { type } = req.query as { type?: string }

  let query = `
    SELECT s.*,
      (SELECT COUNT(*) FROM shop_purchases WHERE sku_id = s.id AND status != 'refunded') AS sold_count
    FROM shop_skus s
    WHERE s.client_id = ?
  `
  const params: any[] = [clientId]
  if (type) { query += ` AND s.product_type = ?`; params.push(type) }
  query += ` ORDER BY s.product_type, COALESCE(s.denomination, s.price_gbp) ASC`

  res.json(db.prepare(query).all(...params))
})

router.post('/skus', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const {
    product_type = 'gift_card',
    label = '',
    description = '',
    denomination,
    price_gbp,
    expiry_months = 24,
    personalization_enabled = 1,
    max_stock = null,
    signature_required = 0,
    delivery_terms = '',
    billing_interval = '',
    trial_days = 0,
  } = req.body

  if (!['gift_card', 'service', 'subscription', 'product'].includes(product_type)) {
    return res.status(400).json({ error: 'product_type must be gift_card | service | subscription | product' })
  }

  // Type-specific validation
  if (product_type === 'gift_card') {
    if (!denomination || isNaN(Number(denomination))) return res.status(400).json({ error: 'denomination required for gift_card' })
  } else {
    if (!price_gbp || isNaN(Number(price_gbp))) return res.status(400).json({ error: 'price_gbp required for non-gift-card SKU' })
    if (!label?.trim()) return res.status(400).json({ error: 'label required' })
  }
  if (product_type === 'subscription' && !['week', 'month', 'year'].includes(billing_interval)) {
    return res.status(400).json({ error: 'billing_interval must be week|month|year for subscription' })
  }

  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId)
  if (!client) return res.status(404).json({ error: 'Client not found' })

  const id = uuid()
  const skuLabel = label || (product_type === 'gift_card'
    ? `£${Number(denomination).toFixed(0)} Gift Card`
    : `£${Number(price_gbp).toFixed(0)} ${product_type}`)

  db.prepare(`
    INSERT INTO shop_skus
      (id, client_id, product_type, denomination, price_gbp, label, description,
       expiry_months, personalization_enabled, max_stock,
       signature_required, delivery_terms,
       billing_interval, trial_days)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, clientId, product_type,
    product_type === 'gift_card' ? Number(denomination) : null,
    product_type === 'gift_card' ? null : Number(price_gbp),
    skuLabel, description,
    expiry_months, personalization_enabled ? 1 : 0, max_stock,
    signature_required ? 1 : 0, delivery_terms,
    billing_interval, Number(trial_days) || 0,
  )

  res.status(201).json(db.prepare('SELECT * FROM shop_skus WHERE id = ?').get(id))
})

router.patch('/skus/:skuId', (req, res) => {
  const { clientId, skuId } = req.params as { clientId: string; skuId: string }
  const sku = db.prepare('SELECT * FROM shop_skus WHERE id = ? AND client_id = ?').get(skuId, clientId)
  if (!sku) return res.status(404).json({ error: 'SKU not found' })

  const updatable = [
    'label', 'description', 'denomination', 'price_gbp', 'expiry_months',
    'personalization_enabled', 'max_stock', 'active',
    'signature_required', 'delivery_terms', 'billing_interval', 'trial_days',
  ]
  const updates: string[] = []
  const values: any[] = []
  for (const f of updatable) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`)
      values.push(req.body[f])
    }
  }
  if (updates.length === 0) return res.json(sku)
  values.push(skuId)
  db.prepare(`UPDATE shop_skus SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  res.json(db.prepare('SELECT * FROM shop_skus WHERE id = ?').get(skuId))
})

// ─── Purchase / sales reporting (admin) ──────────────────────────────────────

router.get('/purchases', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const { status, type } = req.query as { status?: string; type?: string }

  let query = `
    SELECT p.*, s.label AS sku_label, s.denomination, s.price_gbp,
      COALESCE((SELECT SUM(r.value_redeemed) FROM gift_card_redemptions r WHERE r.purchase_id = p.id), 0) AS redeemed_total
    FROM shop_purchases p
    JOIN shop_skus s ON s.id = p.sku_id
    WHERE p.client_id = ?
  `
  const params: any[] = [clientId]
  if (status) { query += ` AND p.status = ?`; params.push(status) }
  if (type)   { query += ` AND p.product_type = ?`; params.push(type) }
  query += ` ORDER BY p.purchase_date DESC`

  res.json(db.prepare(query).all(...params))
})

// Gift card redemption (staff endpoint — only valid for gift_card product type)
router.post('/purchases/:purchaseId/redeem', (req, res) => {
  const { clientId, purchaseId } = req.params as { clientId: string; purchaseId: string }
  const { value_redeemed, redeemed_by = '', notes = '' } = req.body

  const purchase = db.prepare('SELECT * FROM shop_purchases WHERE id = ? AND client_id = ?').get(purchaseId, clientId) as any
  if (!purchase) return res.status(404).json({ error: 'Purchase not found' })
  if (purchase.product_type !== 'gift_card') return res.status(400).json({ error: 'Redemption only applies to gift cards' })
  if (purchase.status === 'redeemed') return res.status(400).json({ error: 'Gift card fully redeemed' })
  if (purchase.status === 'expired')  return res.status(400).json({ error: 'Gift card expired' })
  if (!value_redeemed || isNaN(Number(value_redeemed))) return res.status(400).json({ error: 'value_redeemed required' })

  try {
    const remaining = markRedeemed(purchaseId, Number(value_redeemed), redeemed_by, notes)
    res.json({ ok: true, remaining_balance: remaining })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// Mark a service/product purchase as fulfilled (manual admin action)
router.post('/purchases/:purchaseId/fulfilled', (req, res) => {
  const { clientId, purchaseId } = req.params as { clientId: string; purchaseId: string }
  const { notes = '' } = req.body

  const purchase = db.prepare('SELECT * FROM shop_purchases WHERE id = ? AND client_id = ?').get(purchaseId, clientId) as any
  if (!purchase) return res.status(404).json({ error: 'Purchase not found' })
  if (purchase.product_type === 'gift_card') return res.status(400).json({ error: 'Use redeem endpoint for gift cards' })
  if (purchase.fulfilled_at) return res.status(400).json({ error: 'Already marked fulfilled' })

  const now = Math.floor(Date.now() / 1000)
  db.prepare(`UPDATE shop_purchases SET fulfilled_at = ?, status = 'fulfilled' WHERE id = ?`).run(now, purchaseId)
  if (notes) {
    // Append to existing notes if any
    const existing = (purchase.notes || '').trim()
    const merged = existing ? `${existing}\n\nFulfilled: ${notes}` : `Fulfilled: ${notes}`
    db.prepare(`UPDATE shop_purchases SET notes = ? WHERE id = ?`).run(merged, purchaseId)
  }
  res.json({ ok: true, fulfilled_at: now })
})

export default router

// ─────────────────────────────────────────────────────────────────────────────
// Public storefront (server-rendered HTML)
// ─────────────────────────────────────────────────────────────────────────────
export const storefrontRouter = Router()

storefrontRouter.get('/:clientId', (req, res) => {
  const { clientId } = req.params
  const success   = req.query.success === '1'
  const cancelled = req.query.cancelled === '1'

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId) as any
  if (!client) return res.status(404).send('Shop not found')

  // Group SKUs by product type
  const skus = db.prepare(`SELECT * FROM shop_skus WHERE client_id = ? AND active = 1 ORDER BY product_type, COALESCE(denomination, price_gbp) ASC`).all(clientId) as any[]
  const brandName = client.business_name

  const giftCards = skus.filter(s => s.product_type === 'gift_card')
  const services  = skus.filter(s => s.product_type === 'service')
  const subs      = skus.filter(s => s.product_type === 'subscription')
  const products  = skus.filter(s => s.product_type === 'product')

  const renderSku = (s: any) => `
    <button class="sku-btn" data-sku="${s.id}" data-type="${s.product_type}" data-personalize="${s.personalization_enabled}">
      <div class="sku-label">${escape(s.label)}</div>
      ${s.description ? `<div class="sku-desc">${escape(s.description)}</div>` : ''}
      <div class="sku-price">${priceLabel(s)}</div>
      ${s.signature_required ? `<div class="sku-tag">Async signature required</div>` : ''}
      ${s.product_type === 'subscription' && s.trial_days ? `<div class="sku-tag">${s.trial_days}-day trial</div>` : ''}
    </button>`

  const section = (title: string, items: any[]) => items.length === 0 ? '' : `
    <h2>${title}</h2>
    <div class="skus">${items.map(renderSku).join('')}</div>
  `

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escape(brandName)} — Shop</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           background: #f1f5f9; color: #0f172a; min-height: 100vh }
    header { background: #0f172a; padding: 20px 32px; text-align: center }
    header .brand { color: #f8fafc; font-weight: 700; font-size: 1.2rem }
    header .sub   { color: #94a3b8; font-size: 0.85rem; margin-top: 4px }
    .main  { max-width: 760px; margin: 0 auto; padding: 32px 24px }
    h2     { font-size: 1.1rem; font-weight: 700; margin: 24px 0 12px; color: #475569; text-transform: uppercase; letter-spacing: 0.04em }
    h2:first-child { margin-top: 0 }
    .skus  { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px }
    .sku-btn { background: #fff; border: 2px solid #e2e8f0; border-radius: 10px; padding: 16px;
               cursor: pointer; text-align: left; transition: all 0.15s; min-height: 110px; display: flex; flex-direction: column; gap: 6px }
    .sku-btn:hover, .sku-btn.selected { border-color: #d97706; background: #fffbeb }
    .sku-label { font-size: 0.95rem; font-weight: 600; color: #0f172a }
    .sku-desc  { font-size: 0.78rem; color: #64748b; line-height: 1.4 }
    .sku-price { font-size: 1.2rem; font-weight: 700; color: #0f172a; margin-top: auto }
    .sku-tag   { font-size: 0.7rem; color: #d97706; font-weight: 600 }
    .form  { background: #fff; border-radius: 12px; padding: 24px; display: none; margin-top: 24px }
    .form.show { display: block }
    label  { display: block; font-size: 0.8rem; font-weight: 600; color: #64748b; margin-bottom: 6px; margin-top: 14px }
    input, textarea { width: 100%; padding: 10px 14px; border: 1px solid #e2e8f0; border-radius: 6px;
                      font-size: 0.9rem; margin-bottom: 4px; outline: none }
    input:focus, textarea:focus { border-color: #d97706 }
    .btn { width: 100%; padding: 12px; background: #d97706; color: #fff; border: none;
           border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; margin-top: 16px }
    .btn:hover { opacity: 0.9 }
    .btn:disabled { opacity: 0.5; cursor: not-allowed }
    .alert { border-radius: 8px; padding: 14px 16px; margin-bottom: 20px; text-align: center; font-weight: 600 }
    .alert-ok { background: #f0fdf4; color: #16a34a; border: 1px solid #86efac }
    .alert-warn { background: #fffbeb; color: #92400e; border: 1px solid #fde68a }
    .loading { display: inline-block; width: 16px; height: 16px; border: 2px solid #fff;
               border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; vertical-align: middle }
    @keyframes spin { to { transform: rotate(360deg) } }
  </style>
</head>
<body>
<header>
  <div class="brand">${escape(brandName)}</div>
  <div class="sub">Shop</div>
</header>
<div class="main">
  ${success ? `<div class="alert alert-ok">🎉 Purchase complete — check your email.</div>` : ''}
  ${cancelled ? `<div class="alert alert-warn">Purchase cancelled — no charge was made.</div>` : ''}

  ${skus.length === 0
    ? `<p style="text-align:center;color:#94a3b8;padding:40px 0">No products available right now.</p>`
    : `${section('🎁 Gift Cards',     giftCards)}
       ${section('💼 Services',       services)}
       ${section('🔁 Subscriptions',  subs)}
       ${section('📦 Products',       products)}
       <div class="form" id="form">
         <div style="font-weight:700;font-size:1rem;margin-bottom:4px">Your details</div>
         <label>Your email *</label>
         <input type="email" id="buyer_email" placeholder="you@email.com" required>
         <label>Your name</label>
         <input type="text" id="buyer_name" placeholder="Jane Smith">
         <div id="personalize-fields" style="display:none">
           <label>Recipient's name (optional)</label>
           <input type="text" id="recipient_name" placeholder="Gift recipient">
           <label>Gift message (optional)</label>
           <textarea id="gift_message" rows="3" placeholder="Happy birthday! Enjoy your treatment…"></textarea>
         </div>
         <button class="btn" id="buy-btn" onclick="checkout()">Continue to payment →</button>
       </div>`
  }
</div>

<script>
let selectedSkuId = null
let selectedType = null
let selectedPersonalize = false

document.querySelectorAll('.sku-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sku-btn').forEach(b => b.classList.remove('selected'))
    btn.classList.add('selected')
    selectedSkuId = btn.dataset.sku
    selectedType  = btn.dataset.type
    selectedPersonalize = btn.dataset.personalize === '1' && selectedType === 'gift_card'
    document.getElementById('form').classList.add('show')
    document.getElementById('personalize-fields').style.display = selectedPersonalize ? 'block' : 'none'
    document.getElementById('form').scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
})

async function checkout() {
  const email = document.getElementById('buyer_email').value.trim()
  if (!email || !selectedSkuId) return alert('Please enter your email address')
  const btn = document.getElementById('buy-btn')
  btn.disabled = true
  btn.innerHTML = '<span class="loading"></span> Please wait…'
  const res = await fetch('/api/shop/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sku_id: selectedSkuId,
      buyer_email: email,
      buyer_name: document.getElementById('buyer_name').value,
      recipient_name: document.getElementById('recipient_name').value,
      gift_message: document.getElementById('gift_message').value,
    })
  })
  const data = await res.json()
  if (data.url) window.location.href = data.url
  else { alert(data.error || 'Something went wrong.'); btn.disabled = false; btn.innerHTML = 'Continue to payment →' }
}
</script>
</body>
</html>`)
})

// ─────────────────────────────────────────────────────────────────────────────
// Public Stripe checkout + webhook
// ─────────────────────────────────────────────────────────────────────────────
export const shopPublicRouter = Router()

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Stripe = require('stripe')
  return new Stripe(key, { apiVersion: '2024-04-10' })
}

shopPublicRouter.post('/checkout', async (req, res) => {
  const { sku_id, buyer_email, buyer_name = '', recipient_name = '', gift_message = '' } = req.body

  if (!sku_id || !buyer_email) return res.status(400).json({ error: 'sku_id and buyer_email required' })

  const sku = db.prepare('SELECT * FROM shop_skus WHERE id = ? AND active = 1').get(sku_id) as any
  if (!sku) return res.status(404).json({ error: 'Product not available' })

  if (sku.max_stock !== null) {
    const sold = (db.prepare('SELECT COUNT(*) as n FROM shop_purchases WHERE sku_id = ? AND status != ?').get(sku_id, 'refunded') as any).n
    if (sold >= sku.max_stock) return res.status(400).json({ error: 'Sold out' })
  }

  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3001'
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(sku.client_id) as any

  try {
    const stripe = getStripe()
    const isSub = sku.product_type === 'subscription'

    const session = await stripe.checkout.sessions.create({
      mode: isSub ? 'subscription' : 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'gbp',
          product_data: {
            name: sku.label,
            description: sku.description || `${client.business_name} — ${sku.product_type}`,
          },
          unit_amount: priceInPence(sku),
          ...(isSub && {
            recurring: { interval: sku.billing_interval || 'month' },
          }),
        },
        quantity: 1,
      }],
      ...(isSub && sku.trial_days > 0 && {
        subscription_data: { trial_period_days: sku.trial_days },
      }),
      customer_email: buyer_email,
      metadata: {
        sku_id,
        product_type: sku.product_type,
        buyer_email,
        buyer_name,
        recipient_name,
        gift_message: gift_message.slice(0, 500),
        client_id: sku.client_id,
      },
      success_url: `${baseUrl}/shop/${sku.client_id}?success=1`,
      cancel_url:  `${baseUrl}/shop/${sku.client_id}?cancelled=1`,
    })

    res.json({ url: session.url, session_id: session.id })
  } catch (err: any) {
    console.error('[shop/checkout]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Stripe webhook — fulfil order based on product_type
shopPublicRouter.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'] as string
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  let event: any
  try {
    const stripe = getStripe()
    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret)
    } else {
      event = req.body
    }
  } catch (err: any) {
    return res.status(400).json({ error: `Webhook error: ${err.message}` })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const md = session.metadata || {}
    const sku = db.prepare('SELECT * FROM shop_skus WHERE id = ?').get(md.sku_id) as any
    if (!sku) { console.error('[shop/webhook] SKU not found:', md.sku_id); return res.json({ received: true }) }

    const purchaseId = uuid()
    const productType = sku.product_type || 'gift_card'

    // Type-specific fulfilment
    if (productType === 'gift_card') {
      const code = generateRedemptionCode()
      const expiryDate = sku.expiry_months
        ? Math.floor(Date.now() / 1000) + sku.expiry_months * 30 * 24 * 60 * 60
        : null

      db.prepare(`
        INSERT INTO shop_purchases
          (id, sku_id, client_id, product_type, buyer_email, buyer_name, recipient_name, gift_message,
           redemption_code, amount, expiry_date, status, stripe_session_id, stripe_payment_intent)
        VALUES (?, ?, ?, 'gift_card', ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).run(
        purchaseId, md.sku_id, md.client_id,
        md.buyer_email, md.buyer_name, md.recipient_name, md.gift_message,
        code, sku.denomination, expiryDate,
        session.id, session.payment_intent || ''
      )

      sendGiftCardEmail(purchaseId).catch(err => console.error('[shop/webhook] Email failed:', err.message))
      console.log(`[shop/webhook] Gift card fulfilled: ${code} for ${md.buyer_email}`)

    } else if (productType === 'service' || productType === 'product') {
      // Record purchase as paid; admin manually fulfils via /purchases/:id/fulfilled
      const amount = Number(session.amount_total) / 100
      const signatureToken = sku.signature_required ? generateSignatureToken() : ''

      db.prepare(`
        INSERT INTO shop_purchases
          (id, sku_id, client_id, product_type, buyer_email, buyer_name,
           amount, status, stripe_session_id, stripe_payment_intent, signature_token)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?)
      `).run(
        purchaseId, md.sku_id, md.client_id, productType,
        md.buyer_email, md.buyer_name,
        amount,
        session.id, session.payment_intent || '', signatureToken
      )
      console.log(`[shop/webhook] ${productType} purchased: ${md.buyer_email} (£${amount.toFixed(2)})`)

    } else if (productType === 'subscription') {
      const amount = Number(session.amount_total || 0) / 100
      db.prepare(`
        INSERT INTO shop_purchases
          (id, sku_id, client_id, product_type, buyer_email, buyer_name,
           amount, status, stripe_session_id, stripe_subscription_id)
        VALUES (?, ?, ?, 'subscription', ?, ?, ?, 'active', ?, ?)
      `).run(
        purchaseId, md.sku_id, md.client_id,
        md.buyer_email, md.buyer_name,
        amount,
        session.id, session.subscription || ''
      )
      console.log(`[shop/webhook] Subscription started: ${md.buyer_email}`)
    }
  }

  res.json({ received: true })
})

// Validate a redemption code (gift cards only)
shopPublicRouter.get('/check/:code', (req, res) => {
  const { code } = req.params
  const purchase = db.prepare(`
    SELECT p.*, s.denomination, s.label
    FROM shop_purchases p
    JOIN shop_skus s ON s.id = p.sku_id
    WHERE p.redemption_code = ? AND p.product_type = 'gift_card'
  `).get(code.toUpperCase()) as any

  if (!purchase) return res.status(404).json({ error: 'Code not found' })

  const remaining = getRemainingBalance(purchase.id)
  const expired = purchase.expiry_date && Math.floor(Date.now() / 1000) > purchase.expiry_date

  res.json({
    valid: purchase.status === 'active' && !expired,
    code: purchase.redemption_code,
    original_amount: purchase.amount,
    remaining_balance: remaining,
    status: expired ? 'expired' : purchase.status,
    expiry_date: purchase.expiry_date,
  })
})

// ─── Helpers ─────────────────────────────────────────────────────────────────
function escape(s: string): string {
  if (!s) return ''
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!))
}

function generateSignatureToken(): string {
  // 24-byte URL-safe random token for signature flow
  return [...Array(24)].map(() => Math.floor(Math.random() * 36).toString(36)).join('')
}
