/**
 * Lead-gen-scoped API routes — all require a valid _lg_auth session cookie.
 *
 * GET /my/dashboard          — server-rendered dashboard page (HTML)
 * GET /my/me                 — current lead gen profile (JSON)
 * GET /my/summary            — lifetime earnings, this month, inactivity status (JSON)
 * GET /my/accounts           — all clients they've sourced for (JSON)
 * GET /my/commissions        — full commission ledger (JSON)
 * GET /my/credentials        — notification credentials (JSON)
 * PUT /my/credentials        — save Slack webhook / WhatsApp phone (JSON)
 */
import { Router, Request, Response } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { leadGenAuthMiddleware } from '../middleware/leadgen-auth.js'

const router = Router()

// Dashboard HTML page — protected by leadgen cookie, rendered server-side
router.get('/dashboard', (req: Request, res: Response) => {
  // Check cookie manually (don't use middleware so we can redirect nicely)
  const cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').flatMap(p => {
      const [k, ...v] = p.trim().split('=')
      return k ? [[k.trim(), decodeURIComponent(v.join('='))]] : []
    })
  )
  const token = cookies['_lg_auth']
  if (!token) return res.redirect('/invite-required')

  const lg = db.prepare(
    `SELECT id, email, name FROM lead_generators WHERE session_token = ? AND status = 'active'`
  ).get(token) as { id: string; email: string; name: string } | undefined

  if (!lg) return res.redirect('/invite-required')

  const brandName = process.env.VITE_BRAND_NAME || 'βWave'
  const bg        = process.env.VITE_SIDEBAR_BG  || '#0f172a'
  const primary   = process.env.VITE_BRAND_PRIMARY || '#d97706'

  res.send(dashboardPage(lg.name || lg.email, brandName, bg, primary))
})

// All remaining /my/* routes require the middleware
router.use(leadGenAuthMiddleware)

const SIX_MONTHS_S = 6 * 30 * 24 * 60 * 60 // ≈ 180 days

// ─── Profile ──────────────────────────────────────────────────────────────────

router.get('/me', (req, res) => {
  const lg = db.prepare('SELECT id, email, name, status, last_new_sale_date, created_at FROM lead_generators WHERE id = ?')
    .get(req.leadGen!.id) as any
  if (!lg) return res.status(404).json({ error: 'Lead generator not found' })

  const now = Math.floor(Date.now() / 1000)
  const daysSinceLastSale = lg.last_new_sale_date
    ? Math.floor((now - lg.last_new_sale_date) / 86400)
    : null
  const daysUntilSuspension = lg.last_new_sale_date
    ? Math.max(0, 180 - daysSinceLastSale!)
    : null
  const isInactive = lg.last_new_sale_date
    ? (now - lg.last_new_sale_date) >= SIX_MONTHS_S
    : false

  res.json({ ...lg, days_since_last_sale: daysSinceLastSale, days_until_suspension: daysUntilSuspension, is_inactive: isInactive })
})

// ─── Summary cards ────────────────────────────────────────────────────────────

router.get('/summary', (req, res) => {
  const lgId = req.leadGen!.id

  // Will be populated fully in Commit 3 when commission_ledger exists.
  // For now, return the structural shape with zeroes so the UI can be built.
  const commissionTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='commission_ledger'`).get()

  let lifetimeEarned = 0
  let thisMonthEarned = 0
  let pendingBalance = 0

  if (commissionTable) {
    const lifetime = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM commission_ledger WHERE lead_gen_id = ? AND status = 'paid'`).get(lgId) as any
    lifetimeEarned = lifetime?.total || 0

    const thisMonth = new Date()
    const monthStr = `${thisMonth.getFullYear()}-${String(thisMonth.getMonth() + 1).padStart(2, '0')}`
    const month = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM commission_ledger WHERE lead_gen_id = ? AND month = ? AND status = 'paid'`).get(lgId, monthStr) as any
    thisMonthEarned = month?.total || 0

    const pending = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM commission_ledger WHERE lead_gen_id = ? AND status = 'pending'`).get(lgId) as any
    pendingBalance = pending?.total || 0
  }

  // Inactivity status
  const lg = db.prepare('SELECT last_new_sale_date FROM lead_generators WHERE id = ?').get(lgId) as any
  const now = Math.floor(Date.now() / 1000)
  const isInactive = lg?.last_new_sale_date ? (now - lg.last_new_sale_date) >= SIX_MONTHS_S : false
  const daysUntilSuspension = lg?.last_new_sale_date
    ? Math.max(0, 180 - Math.floor((now - lg.last_new_sale_date) / 86400))
    : null

  // Authorized clients + prospect counts
  const authorizedClients = db.prepare(`
    SELECT c.id, c.business_name, c.industry, lgca.status AS access_status, lgca.authorized_at
    FROM lead_gen_client_access lgca
    JOIN clients c ON c.id = lgca.client_id
    WHERE lgca.lead_gen_id = ? AND lgca.status = 'active'
  `).all(lgId)

  res.json({
    lifetime_earned: lifetimeEarned,
    this_month_earned: thisMonthEarned,
    pending_balance: pendingBalance,
    is_inactive: isInactive,
    days_until_suspension: daysUntilSuspension,
    authorized_client_count: (authorizedClients as any[]).length,
    authorized_clients: authorizedClients,
  })
})

// ─── Accounts (prospects + engagements sourced by this lead gen) ──────────────

router.get('/accounts', (req, res) => {
  const lgId = req.leadGen!.id

  const prospects = db.prepare(`
    SELECT p.*,
      c.business_name AS client_name,
      c.industry,
      e.id            AS engagement_id,
      e.type          AS engagement_type,
      e.value         AS engagement_value,
      e.payment_cadence,
      e.first_payment_amount,
      e.status        AS engagement_status,
      e.signed_at
    FROM prospects p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN engagements e ON e.prospect_id = p.id AND e.status != 'cancelled'
    WHERE p.source_lead_gen = ?
    ORDER BY p.created_at DESC
  `).all(lgId)

  res.json(prospects)
})

// ─── Commission ledger (populated in Commit 3) ────────────────────────────────

router.get('/commissions', (req, res) => {
  const lgId = req.leadGen!.id
  const commissionTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='commission_ledger'`).get()
  if (!commissionTable) return res.json([])

  const { status, client_id, month } = req.query as { status?: string; client_id?: string; month?: string }
  let query = `
    SELECT cl.*, c.business_name AS client_name
    FROM commission_ledger cl
    JOIN clients c ON c.id = cl.client_id
    WHERE cl.lead_gen_id = ?
  `
  const params: any[] = [lgId]
  if (status)    { query += ` AND cl.status = ?`;    params.push(status) }
  if (client_id) { query += ` AND cl.client_id = ?`; params.push(client_id) }
  if (month)     { query += ` AND cl.month = ?`;     params.push(month) }
  query += ` ORDER BY cl.created_at DESC`

  res.json(db.prepare(query).all(...params))
})

// ─── Notification credentials ────────────────────────────────────────────────

router.get('/credentials', (req, res) => {
  const rows = db.prepare('SELECT * FROM lead_gen_credentials WHERE lead_gen_id = ?').all(req.leadGen!.id)
  res.json(rows)
})

router.put('/credentials', (req, res) => {
  const lgId = req.leadGen!.id
  const { slack_webhook_url, whatsapp_phone } = req.body as { slack_webhook_url?: string; whatsapp_phone?: string }

  if (slack_webhook_url !== undefined) {
    const existing = db.prepare(`SELECT id FROM lead_gen_credentials WHERE lead_gen_id = ? AND channel = 'slack'`).get(lgId) as any
    if (existing) {
      db.prepare(`UPDATE lead_gen_credentials SET slack_webhook_url = ? WHERE id = ?`).run(slack_webhook_url, existing.id)
    } else {
      db.prepare(`INSERT INTO lead_gen_credentials (id, lead_gen_id, channel, slack_webhook_url) VALUES (?, ?, 'slack', ?)`).run(uuid(), lgId, slack_webhook_url)
    }
  }

  if (whatsapp_phone !== undefined) {
    const existing = db.prepare(`SELECT id FROM lead_gen_credentials WHERE lead_gen_id = ? AND channel = 'whatsapp'`).get(lgId) as any
    if (existing) {
      db.prepare(`UPDATE lead_gen_credentials SET whatsapp_phone = ? WHERE id = ?`).run(whatsapp_phone, existing.id)
    } else {
      db.prepare(`INSERT INTO lead_gen_credentials (id, lead_gen_id, channel, whatsapp_phone) VALUES (?, ?, 'whatsapp', ?)`).run(uuid(), lgId, whatsapp_phone)
    }
  }

  const rows = db.prepare('SELECT * FROM lead_gen_credentials WHERE lead_gen_id = ?').all(lgId)
  res.json({ ok: true, credentials: rows })
})

// ─── Dashboard page HTML ──────────────────────────────────────────────────────
function dashboardPage(displayName: string, brandName: string, bg: string, primary: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${brandName} — My Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           background: #f1f5f9; color: #0f172a; min-height: 100vh }
    header { background: ${bg}; padding: 16px 32px; display: flex; justify-content: space-between; align-items: center }
    header .brand { color: #f8fafc; font-weight: 700; font-size: 1rem }
    header .sub   { color: #94a3b8; font-size: 0.8rem; margin-top: 2px }
    header button { background: transparent; border: 1px solid #475569; color: #94a3b8;
                    padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 0.82rem }
    .main  { max-width: 900px; margin: 0 auto; padding: 32px 24px }
    h2     { font-size: 1.2rem; font-weight: 700; margin-bottom: 16px; color: #0f172a }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 28px }
    .card  { background: #fff; border-radius: 10px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08) }
    .card .label { font-size: 0.75rem; color: #64748b; font-weight: 600; margin-bottom: 6px }
    .card .value { font-size: 1.6rem; font-weight: 700 }
    .alert { border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; font-size: 0.875rem }
    .alert-warn { background: #fffbeb; border: 1px solid #fde68a; color: #92400e }
    .alert-danger { background: #fef2f2; border: 1px solid #fecaca; color: #dc2626 }
    .alert-ok    { background: #f0fdf4; border: 1px solid #86efac; color: #166534 }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px;
            overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); font-size: 0.85rem }
    th { background: #f8fafc; padding: 10px 14px; text-align: left; color: #64748b;
         font-weight: 600; font-size: 0.75rem }
    td { padding: 10px 14px; border-bottom: 1px solid #f1f5f9 }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.75rem; font-weight: 600 }
    .badge-green { background: #dcfce7; color: #16a34a }
    .badge-amber { background: #fef3c7; color: #d97706 }
    .badge-red   { background: #fee2e2; color: #dc2626 }
    .loading { display: inline-block; width: 14px; height: 14px; border: 2px solid #e2e8f0;
               border-top-color: ${primary}; border-radius: 50%; animation: spin 0.7s linear infinite }
    @keyframes spin { to { transform: rotate(360deg) } }
  </style>
</head>
<body>
<header>
  <div>
    <div class="brand">${brandName} — Affiliate Dashboard</div>
    <div class="sub">Welcome back, ${displayName}</div>
  </div>
  <button onclick="logout()">Sign out</button>
</header>
<div class="main" id="app">
  <div style="text-align:center;padding:60px"><span class="loading"></span></div>
</div>

<script>
async function logout() {
  await fetch('/my/logout', { method: 'POST' })
  location.href = '/'
}

function fmt(n) { return '£' + Number(n || 0).toFixed(2) }
function fmtDate(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

async function load() {
  const [me, summary, accounts, commissions] = await Promise.all([
    fetch('/my/me').then(r => r.json()),
    fetch('/my/summary').then(r => r.json()),
    fetch('/my/accounts').then(r => r.json()),
    fetch('/my/commissions').then(r => r.json()),
  ])

  let alertHtml = ''
  if (summary.is_inactive) {
    alertHtml = '<div class="alert alert-danger">⚠️ <strong>Inactivity gate active.</strong> Recurring commissions are suspended. Source a new sale to resume all recurring earnings.</div>'
  } else if (summary.days_until_suspension !== null && summary.days_until_suspension <= 30) {
    alertHtml = '<div class="alert alert-warn">⏳ <strong>' + summary.days_until_suspension + ' days until inactivity suspension.</strong> Source a new sale soon to avoid losing recurring commissions.</div>'
  } else if (summary.days_until_suspension !== null) {
    alertHtml = '<div class="alert alert-ok">✅ Active — ' + summary.days_until_suspension + ' days remaining before inactivity gate.</div>'
  }

  const statusBadge = (s) => {
    const cls = { pending: 'amber', paid: 'green', suspended: 'red' }[s] || 'amber'
    return '<span class="badge badge-' + cls + '">' + s + '</span>'
  }

  const commRows = (commissions.length === 0)
    ? '<tr><td colspan="6" style="color:#94a3b8;text-align:center;padding:24px">No commissions yet</td></tr>'
    : commissions.map(c => '<tr>' +
        '<td>' + c.month + '</td>' +
        '<td>' + (c.commission_type === 'first_20' ? '20% First' : '10% Recurring') + '</td>' +
        '<td>' + (c.client_name || '—') + '</td>' +
        '<td style="font-weight:600">' + fmt(c.amount) + '</td>' +
        '<td>' + statusBadge(c.status) + '</td>' +
        '<td style="color:#64748b">' + fmtDate(c.paid_date) + '</td>' +
      '</tr>').join('')

  const accRows = (accounts.length === 0)
    ? '<tr><td colspan="5" style="color:#94a3b8;text-align:center;padding:24px">No prospects sourced yet</td></tr>'
    : accounts.map(a => '<tr>' +
        '<td>' + a.name + '</td>' +
        '<td>' + (a.client_name || '—') + '</td>' +
        '<td>' + (a.status || '—') + '</td>' +
        '<td>' + (a.engagement_status ? a.engagement_status : '—') + '</td>' +
        '<td style="color:#64748b">' + fmtDate(a.signed_at) + '</td>' +
      '</tr>').join('')

  document.getElementById('app').innerHTML = '<h2>Your Performance</h2>' + alertHtml +
    '<div class="cards">' +
      '<div class="card"><div class="label">💰 Lifetime Earned</div><div class="value" style="color:#16a34a">' + fmt(summary.lifetime_earned) + '</div></div>' +
      '<div class="card"><div class="label">📅 This Month</div><div class="value" style="color:#d97706">' + fmt(summary.this_month_earned) + '</div></div>' +
      '<div class="card"><div class="label">⏳ Pending Balance</div><div class="value">' + fmt(summary.pending_balance) + '</div></div>' +
      '<div class="card"><div class="label">🏢 Authorized Clients</div><div class="value">' + (summary.authorized_client_count || 0) + '</div></div>' +
    '</div>' +

    '<h2 style="margin-top:28px">Your Prospects</h2>' +
    '<table style="margin-bottom:28px"><thead><tr><th>Name</th><th>Client</th><th>Stage</th><th>Deal Status</th><th>Signed</th></tr></thead>' +
    '<tbody>' + accRows + '</tbody></table>' +

    '<h2>Commission History</h2>' +
    '<table><thead><tr><th>Month</th><th>Type</th><th>Client</th><th>Amount</th><th>Status</th><th>Paid</th></tr></thead>' +
    '<tbody>' + commRows + '</tbody></table>'
}

load()
</script>
</body>
</html>`
}

export default router
