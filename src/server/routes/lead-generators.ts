/**
 * Admin routes for the global lead generator pool.
 * All routes here sit behind the existing APP_PASSWORD admin guard.
 *
 * POST   /api/lead-generators/invite          — invite a lead gen (sends email)
 * GET    /api/lead-generators                  — list all lead gens
 * GET    /api/lead-generators/:id              — get one
 * PATCH  /api/lead-generators/:id             — update name / status
 * POST   /api/lead-generators/:id/access      — grant client access
 * DELETE /api/lead-generators/:id/access/:cid — revoke client access
 * GET    /api/lead-generators/:id/access      — list authorized clients
 *
 * GET    /invite/:token                        — accept invite (no auth guard; public)
 * POST   /my/logout                            — clear lead gen session
 */
import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { createHmac, randomBytes } from 'crypto'
import nodemailer from 'nodemailer'
import db from '../db.js'
import { LG_COOKIE } from '../middleware/leadgen-auth.js'

const router = Router()

// ─── Helpers ─────────────────────────────────────────────────────────────────

const INVITE_TTL_S = 7 * 24 * 60 * 60 // 7 days

function getJwtSecret(): string {
  return process.env.INVITE_JWT_SECRET || process.env.ANTHROPIC_API_KEY || 'inturn-invite-secret'
}

/** Sign a token: HMAC-SHA256(secret, payload) — lightweight, no jwt dep needed */
function signToken(payload: string): string {
  return createHmac('sha256', getJwtSecret()).update(payload).digest('hex')
}

/** Generate and sign an invite token for a lead gen */
function makeInviteToken(leadGenId: string): string {
  const nonce = randomBytes(16).toString('hex')
  const raw = `${leadGenId}:${nonce}:${Date.now()}`
  const sig = signToken(raw)
  // Store raw in DB so we can verify sig on acceptance
  return Buffer.from(JSON.stringify({ raw, sig })).toString('base64url')
}

/** Verify invite token from URL; returns lead gen row or null */
function verifyInviteToken(tokenB64: string): { id: string; email: string; name: string; status: string; invite_token: string; invite_expires_at: number } | null {
  try {
    const { raw, sig } = JSON.parse(Buffer.from(tokenB64, 'base64url').toString())
    if (signToken(raw) !== sig) return null
    const leadGenId = raw.split(':')[0]
    const lg = db.prepare(
      `SELECT * FROM lead_generators WHERE id = ? AND invite_token = ? AND invite_expires_at > unixepoch()`
    ).get(leadGenId, tokenB64) as any
    return lg || null
  } catch { return null }
}

async function sendInviteEmail(to: string, name: string, inviteUrl: string) {
  const smtpHost = process.env.SMTP_HOST
  const smtpUser = process.env.SMTP_USER
  const smtpPass = process.env.SMTP_PASS
  const smtpFrom = process.env.SMTP_FROM || smtpUser
  const brandName = process.env.VITE_BRAND_NAME || 'βWave'

  if (!smtpHost || !smtpUser || !smtpPass) {
    console.warn('[lead-gen invite] SMTP not configured — invite URL:', inviteUrl)
    return
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: smtpUser, pass: smtpPass },
  })

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
      <h2 style="color:#d97706">${brandName} — You're invited</h2>
      <p>Hi ${name || 'there'},</p>
      <p>You've been invited to join the <strong>${brandName}</strong> affiliate platform as a lead generator.</p>
      <p>Click the link below to accept your invite and set up your account. The link expires in 7 days.</p>
      <p style="margin:28px 0">
        <a href="${inviteUrl}" style="background:#d97706;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
          Accept Invite →
        </a>
      </p>
      <p style="color:#64748b;font-size:0.85rem">If you weren't expecting this, you can safely ignore it.</p>
    </div>
  `

  await transporter.sendMail({ from: smtpFrom, to, subject: `You're invited to ${brandName}`, html })
}

// ─── Admin routes ─────────────────────────────────────────────────────────────

// List all lead generators
router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT lg.*,
      (SELECT COUNT(*) FROM lead_gen_client_access WHERE lead_gen_id = lg.id AND status = 'active') AS authorized_client_count,
      (SELECT COUNT(*) FROM prospects WHERE source_lead_gen = lg.id) AS total_prospects
    FROM lead_generators lg
    ORDER BY lg.created_at DESC
  `).all()
  res.json(rows)
})

// Get single lead gen
router.get('/:id', (req, res) => {
  const { id } = req.params
  const lg = db.prepare('SELECT * FROM lead_generators WHERE id = ?').get(id)
  if (!lg) return res.status(404).json({ error: 'Lead generator not found' })
  res.json(lg)
})

// Invite a lead generator
router.post('/invite', async (req, res) => {
  const { email, name = '' } = req.body as { email: string; name?: string }
  if (!email?.includes('@')) return res.status(400).json({ error: 'Valid email required' })

  // Upsert — if they already exist, re-send the invite
  let lg = db.prepare('SELECT * FROM lead_generators WHERE email = ?').get(email) as any

  const id = lg?.id || uuid()
  const inviteToken = makeInviteToken(id)
  const inviteExpiresAt = Math.floor(Date.now() / 1000) + INVITE_TTL_S

  if (lg) {
    db.prepare(`
      UPDATE lead_generators SET name = ?, invite_token = ?, invite_expires_at = ?, invited_at = unixepoch()
      WHERE id = ?
    `).run(name || lg.name, inviteToken, inviteExpiresAt, id)
  } else {
    db.prepare(`
      INSERT INTO lead_generators (id, email, name, status, invite_token, invite_expires_at)
      VALUES (?, ?, ?, 'invited', ?, ?)
    `).run(id, email, name, inviteToken, inviteExpiresAt)
  }

  // Build invite URL
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3001'
  const inviteUrl = `${baseUrl}/invite/${encodeURIComponent(inviteToken)}`

  try {
    await sendInviteEmail(email, name, inviteUrl)
    console.log(`[lead-gen] Invite sent to ${email}`)
  } catch (err: any) {
    console.error(`[lead-gen] Email failed: ${err.message}`)
    // Still return success with the URL so admin can share manually
  }

  const row = db.prepare('SELECT * FROM lead_generators WHERE id = ?').get(id)
  res.status(201).json({ ok: true, lead_generator: row, invite_url: inviteUrl })
})

// Update lead gen (name, status)
router.patch('/:id', (req, res) => {
  const { id } = req.params
  const { name, status } = req.body as { name?: string; status?: string }
  const lg = db.prepare('SELECT id FROM lead_generators WHERE id = ?').get(id)
  if (!lg) return res.status(404).json({ error: 'Lead generator not found' })

  if (status && !['active', 'inactive'].includes(status))
    return res.status(400).json({ error: 'status must be active or inactive' })

  db.prepare(`
    UPDATE lead_generators SET
      name   = COALESCE(?, name),
      status = COALESCE(?, status)
    WHERE id = ?
  `).run(name ?? null, status ?? null, id)

  res.json(db.prepare('SELECT * FROM lead_generators WHERE id = ?').get(id))
})

// Grant client access
router.post('/:id/access', (req, res) => {
  const { id } = req.params
  const { client_id } = req.body as { client_id: string }

  const lg = db.prepare('SELECT id FROM lead_generators WHERE id = ?').get(id)
  if (!lg) return res.status(404).json({ error: 'Lead generator not found' })
  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(client_id)
  if (!client) return res.status(404).json({ error: 'Client not found' })

  // Upsert
  db.prepare(`
    INSERT INTO lead_gen_client_access (id, lead_gen_id, client_id, status)
    VALUES (?, ?, ?, 'active')
    ON CONFLICT (lead_gen_id, client_id) DO UPDATE SET status = 'active', authorized_at = unixepoch()
  `).run(uuid(), id, client_id)

  res.json({ ok: true })
})

// Revoke client access
router.delete('/:id/access/:clientId', (req, res) => {
  const { id, clientId } = req.params
  db.prepare(`
    UPDATE lead_gen_client_access SET status = 'revoked'
    WHERE lead_gen_id = ? AND client_id = ?
  `).run(id, clientId)
  res.json({ ok: true })
})

// List authorized clients for a lead gen
router.get('/:id/access', (req, res) => {
  const { id } = req.params
  const rows = db.prepare(`
    SELECT lgca.*, c.business_name, c.industry
    FROM lead_gen_client_access lgca
    JOIN clients c ON c.id = lgca.client_id
    WHERE lgca.lead_gen_id = ?
    ORDER BY lgca.authorized_at DESC
  `).all(id)
  res.json(rows)
})

export default router

// ─── Invite acceptance (public route, no admin guard) ─────────────────────────
export const inviteRouter = Router()

inviteRouter.get('/:token', (req, res) => {
  const { token } = req.params
  const lg = verifyInviteToken(decodeURIComponent(token))

  const brandName = process.env.VITE_BRAND_NAME || 'βWave'
  const bg        = process.env.VITE_SIDEBAR_BG || '#0f172a'
  const primary   = process.env.VITE_BRAND_PRIMARY || '#d97706'

  if (!lg) {
    return res.send(invitePage({ brandName, bg, primary, error: 'This invite link is invalid or has expired. Please ask for a new one.' }))
  }

  if (lg.status === 'active') {
    // Already accepted — redirect to their dashboard
    return res.redirect('/my/dashboard')
  }

  res.send(invitePage({ brandName, bg, primary, email: lg.email, token: decodeURIComponent(token) }))
})

inviteRouter.post('/:token', (req, res) => {
  const { token } = req.params
  const { name = '' } = req.body as { name?: string }

  const lg = verifyInviteToken(decodeURIComponent(token)) as any
  if (!lg) return res.status(400).send('Invalid or expired invite link.')

  // Create session token
  const sessionToken = signToken(`${lg.id}:${Date.now()}:${randomBytes(8).toString('hex')}`)

  db.prepare(`
    UPDATE lead_generators SET
      name          = COALESCE(NULLIF(?, ''), name),
      status        = 'active',
      invite_token  = '',
      session_token = ?
    WHERE id = ?
  `).run(name, sessionToken, lg.id)

  const MAX_AGE = 60 * 60 * 24 * 90 // 90 days
  res.setHeader('Set-Cookie',
    `${LG_COOKIE}=${sessionToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE}`)
  res.redirect('/my/dashboard')
})

// ─── Lead gen session logout ──────────────────────────────────────────────────
export const myRouter = Router()

myRouter.post('/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `${LG_COOKIE}=; Path=/; HttpOnly; Max-Age=0`)
  res.json({ ok: true })
})

// ─── Invite page HTML ─────────────────────────────────────────────────────────
function invitePage({ brandName, bg, primary, email = '', token = '', error = '' }: {
  brandName: string; bg: string; primary: string; email?: string; token?: string; error?: string
}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${brandName} — Accept Invite</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           background: ${bg}; display: flex; align-items: center; justify-content: center; min-height: 100vh }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px;
            padding: 40px 36px; width: 100%; max-width: 400px; box-shadow: 0 20px 60px rgba(0,0,0,0.4) }
    .title { font-size: 1.2rem; font-weight: 700; color: #f8fafc; margin-bottom: 8px }
    .sub   { font-size: 0.875rem; color: #94a3b8; margin-bottom: 28px }
    .error { background: rgba(220,38,38,0.15); border: 1px solid rgba(220,38,38,0.3);
             color: #fca5a5; font-size: 0.82rem; padding: 10px 14px; border-radius: 6px; margin-bottom: 20px }
    label  { display: block; font-size: 0.8rem; font-weight: 600; color: #94a3b8; margin-bottom: 6px }
    input  { width: 100%; padding: 10px 14px; border: 1px solid #334155; border-radius: 6px;
             background: ${bg}; color: #f8fafc; font-size: 0.9rem; margin-bottom: 16px; outline: none }
    input:focus { border-color: ${primary} }
    button { width: 100%; padding: 11px; background: ${primary}; color: #fff; border: none;
             border-radius: 6px; font-size: 0.95rem; font-weight: 600; cursor: pointer }
    button:hover { opacity: 0.9 }
    .email-display { background: #0f172a; padding: 8px 12px; border-radius: 6px;
                     font-size: 0.85rem; color: #94a3b8; margin-bottom: 16px }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">${brandName} — Accept Invite</div>
    ${error
      ? `<div class="error">${error}</div>`
      : `<div class="sub">You've been invited as a lead generator. Confirm your name below to activate your account.</div>
         ${email ? `<div class="email-display">📧 ${email}</div>` : ''}
         <form method="POST" action="/invite/${encodeURIComponent(token)}">
           <label>Your name</label>
           <input type="text" name="name" placeholder="Jane Smith" required autofocus autocomplete="name">
           <button type="submit">Activate Account →</button>
         </form>`
    }
  </div>
</body>
</html>`
}
