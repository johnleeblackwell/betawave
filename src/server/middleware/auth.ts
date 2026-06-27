/**
 * Simple single-password auth guard.
 *
 * Set APP_PASSWORD in .env to enable. Leave blank to disable (βWave default).
 * Uses a signed HMAC cookie — no database, no sessions, no extra deps.
 */
import { Request, Response, NextFunction } from 'express'
import { createHmac } from 'crypto'
import { findByEmail, verifyPassword } from '../services/users.js'

// Read lazily so dotenv has time to load (ES module imports are hoisted before config() runs)
const getPassword = () => process.env.APP_PASSWORD || ''
const getSecret   = () => process.env.ANTHROPIC_API_KEY || 'inturn-dev-secret'
const COOKIE   = '_inturn_auth'   // owner (single-password) session
const USER_COOKIE = '_bw_user'    // per-user (role-scoped) session
const MAX_AGE  = 60 * 60 * 24 * 30   // 30 days

// ── Per-user signed-token sessions (operators etc.) ───────────────────────────
interface UserSession { uid: string; role: string; client_id: string | null; email: string; exp: number }

function makeUserToken(p: Omit<UserSession, 'exp'>): string {
  const payload = { ...p, exp: Math.floor(Date.now() / 1000) + MAX_AGE }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', getSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}
function verifyUserToken(tok: string | undefined): UserSession | null {
  if (!tok) return null
  const [body, sig] = tok.split('.')
  if (!body || !sig) return null
  const expected = createHmac('sha256', getSecret()).update(body).digest('base64url')
  if (sig !== expected) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as UserSession
    if (p.exp && p.exp < Math.floor(Date.now() / 1000)) return null
    return p
  } catch { return null }
}

/**
 * Operators get the FULL βWave workspace but isolated to ONE client: they can
 * use every client-scoped module for their own client, and nothing that belongs
 * to another tenant or to the platform owner. Enforced on every request — the UI
 * gate is cosmetic; this is the real boundary.
 *
 * Allowed:   /api/me · /api/clients/<own>/*  · /api/respond/accounts/<own> ·
 *            other global helpers (respond comments/convos, citations, reports,
 *            jobs, templates…) whose ids are only discoverable via this client's
 *            own scoped lists, with any client_id query forced to match.
 * Blocked:   the clients LIST, /api/admin, lead-generators, commissions,
 *            affiliates, and any path/param referencing a different client.
 */
function operatorGuard(user: UserSession, req: Request, res: Response, next: NextFunction) {
  const p = req.path
  const CID = (user.client_id || '').toLowerCase()
  const deny = () => res.status(403).json({ error: 'forbidden' })
  if (p === '/api/me') return next()
  if (!p.startsWith('/api/')) return next()   // SPA shell + static

  // ── DENY-BY-DEFAULT: an operator may reach only (a) their own client
  // workspace, and (b) an explicit allowlist of global helpers that workspace
  // needs. Everything else — including any NEW endpoint added later — is denied.

  // (a) Their own client workspace, EXCEPT owner/agency-only sub-tools.
  const m = p.match(/^\/api\/clients\/([^/]+)(\/.*)?$/)
  if (m) {
    if (m[1].toLowerCase() !== CID) return deny()
    if (/^\/(discovery|prospects)(\/|$)/.test(m[2] || '')) return deny()
    return next()
  }

  // (b) Global helpers the client workspace legitimately uses (verified against
  // the operator-visible tabs). Respond, Citations, Reports, Jobs, Templates,
  // RSS validation, Shop. NOT here ⇒ denied (settings, users, admin, snapshots,
  // lead-generators, commissions, affiliates, clients-list, and anything unlisted).
  const ALLOW_GLOBAL = /^\/api\/(respond|citation-tracker|reports|jobs|templates|validate-rss|shop)(\/|$)/
  if (!ALLOW_GLOBAL.test(p)) return deny()

  // Respond accounts carry the client id in the path — must be theirs.
  const ra = p.match(/^\/api\/respond\/accounts\/([^/]+)/)
  if (ra && ra[1].toLowerCase() !== CID) return deny()

  // Any explicit client_id/clientId query param must be theirs.
  const q = String((req.query.client_id || req.query.clientId) || '').toLowerCase()
  if (q && q !== CID) return deny()

  return next()
}

// File extensions that must always be accessible (login page needs the logo)
const STATIC_RE = /\.(png|jpg|jpeg|gif|svg|ico|webp|css|js|woff2?|ttf|map)$/i

function makeToken(): string {
  return createHmac('sha256', getSecret()).update(getPassword()).digest('hex')
}

function parseCookies(header: string): Record<string, string> {
  return Object.fromEntries(
    (header || '').split(';').flatMap(part => {
      const [k, ...v] = part.trim().split('=')
      return k ? [[k.trim(), decodeURIComponent(v.join('='))]] : []
    })
  )
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!getPassword()) return next()                        // auth disabled
  if (req.path === '/login') return next()                  // login page itself
  if (STATIC_RE.test(req.path)) return next()              // static assets
  if (req.path === '/logout') return next()
  // Lead gen invite acceptance and dashboard use their own _lg_auth session cookie
  if (req.path.startsWith('/invite/')) return next()
  if (req.path.startsWith('/my/'))     return next()
  // Public gift card storefront
  if (req.path.startsWith('/shop/'))   return next()

  // MCP service token — lets the βWave MCP server (HttpClient / remote mode)
  // reach /api/* without the browser cookie. Set MCP_SERVICE_TOKEN to enable.
  const mcpToken = process.env.MCP_SERVICE_TOKEN?.trim()
  if (mcpToken) {
    const auth = req.headers.authorization || ''
    if (auth === `Bearer ${mcpToken}`) return next()
  }

  const cookies = parseCookies(req.headers.cookie || '')
  if (cookies[COOKIE] === makeToken()) {                    // owner — full access
    ;(req as any).auth = { role: 'owner' }
    return next()
  }

  const user = verifyUserToken(cookies[USER_COOKIE])        // per-user session
  if (user) {
    ;(req as any).auth = { role: user.role, client_id: user.client_id, email: user.email }
    if (user.role === 'operator') return operatorGuard(user, req, res, next)
    return next()                                           // (future full-access roles)
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  res.redirect(`/login?from=${encodeURIComponent(req.originalUrl)}`)
}

/** GET /api/me — who am I? Powers the UI role gate. */
export function meHandler(req: Request, res: Response) {
  const a = (req as any).auth
  if (!a) return res.status(401).json({ error: 'Unauthorized' })
  res.json(a)
}

export function loginHandler(req: Request, res: Response) {
  const from = (req.query.from as string) || '/'

  if (req.method === 'GET') {
    return res.send(loginPage(from))
  }

  // POST — email present ⇒ per-user login; email blank ⇒ owner password login.
  const email = (req.body?.email || '').trim()
  if (email) {
    const u = findByEmail(email)
    if (u && verifyPassword(u.password_hash, req.body?.password || '')) {
      const tok = makeUserToken({ uid: u.id, role: u.role, client_id: u.client_id, email: u.email })
      // Set the user session AND clear any lingering owner session, so a user
      // login always wins (owner cookie is checked first in authMiddleware).
      res.setHeader('Set-Cookie', [
        `${USER_COOKIE}=${tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE}`,
        `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`,
      ] as any)
      return res.redirect(from)
    }
    return res.send(loginPage(from, 'Incorrect email or password — try again'))
  }

  if (req.body?.password === getPassword()) {
    // Owner login — clear any user session so owner access is clean.
    res.setHeader('Set-Cookie', [
      `${COOKIE}=${makeToken()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE}`,
      `${USER_COOKIE}=; Path=/; HttpOnly; Max-Age=0`,
    ] as any)
    return res.redirect(from)
  }

  res.send(loginPage(from, 'Incorrect password — try again'))
}

export function logoutHandler(_req: Request, res: Response) {
  res.setHeader('Set-Cookie', [
    `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`,
    `${USER_COOKIE}=; Path=/; HttpOnly; Max-Age=0`,
  ] as any)
  res.redirect('/login')
}

// ── Login page HTML — branded from env vars ───────────────────────────────────

function loginPage(from: string, error?: string): string {
  const name = process.env.VITE_BRAND_NAME || 'βWave™'
  const logo = process.env.VITE_BRAND_LOGO_URL || ''
  const year = new Date().getFullYear()

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name} — Sign in</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    :root{ --accent:#22D3EE; --accent-2:#3B82F6; --text:#e8edf4; --muted:#99a7bd; --line:#23304d; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      color: var(--text); min-height: 100vh;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; padding: 24px;
      background:
        radial-gradient(1200px 700px at 80% -10%, rgba(59,130,246,.16), transparent 60%),
        radial-gradient(900px 600px at -10% 25%, rgba(34,211,238,.13), transparent 55%),
        linear-gradient(180deg, #0B0F14 0%, #06090D 100%);
    }
    .brand { font-weight: 900; font-size: 1.9rem; letter-spacing: -.03em; }
    .brand .beta { font-style: italic; background: linear-gradient(90deg, var(--accent), var(--accent-2));
      -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 0 12px rgba(34,211,238,.5)); }
    .brand img { max-height: 64px; width: auto; }
    .card {
      background: rgba(15,20,27,.72); backdrop-filter: blur(8px);
      border: 1px solid var(--line); border-radius: 18px; padding: 36px 34px;
      width: 100%; max-width: 380px;
      box-shadow: 0 24px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(34,211,238,.16);
    }
    .title { text-align: center; font-size: 1.05rem; font-weight: 700; color: var(--text); margin-bottom: 24px; letter-spacing: -.2px; }
    .error { background: rgba(239,68,68,.14); border: 1px solid rgba(239,68,68,.35); color: #fca5a5;
      font-size: .82rem; text-align: center; padding: 9px 12px; border-radius: 10px; margin-bottom: 16px; }
    input[type="email"], input[type="password"] {
      width: 100%; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px;
      background: #080d18; color: var(--text); font-size: .95rem; margin-bottom: 13px; outline: none;
      transition: border-color .15s, box-shadow .15s;
    }
    input::placeholder { color: #5b6b86; }
    input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(34,211,238,.18); }
    button {
      width: 100%; padding: 12px; border: none; border-radius: 999px; cursor: pointer;
      background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #05121a;
      font-family: 'Inter', sans-serif; font-size: .97rem; font-weight: 800;
      box-shadow: 0 8px 28px rgba(34,211,238,.3); transition: transform .12s, box-shadow .15s;
    }
    button:hover { transform: translateY(-1px); box-shadow: 0 12px 36px rgba(34,211,238,.45); }
    footer { color: var(--muted); font-size: .8rem; text-align: center; }
    footer a { color: var(--accent); text-decoration: none; }
  </style>
</head>
<body>
  <div class="brand">${logo ? `<img src="${logo}" alt="${name}" onerror="this.outerHTML='<span class=&quot;beta&quot;>β</span>Wave™'">` : `<span class="beta">β</span>Wave™`}</div>
  <div class="card">
    <div class="title">Sign in</div>
    ${error ? `<div class="error">${error}</div>` : ''}
    <form method="POST" action="/login">
      <input type="hidden" name="from" value="${from}">
      <input type="email" name="email" placeholder="Email (leave blank for owner)" autocomplete="username">
      <input type="password" name="password" placeholder="Password" autofocus required autocomplete="current-password">
      <button type="submit">Sign in →</button>
    </form>
  </div>
  <footer>© ${year} ${name} · pronounced “be wave” · <a href="https://betawave.co.uk">betawave.co.uk</a></footer>
</body>
</html>`
}
