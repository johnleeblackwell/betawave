/**
 * Auth for the βWave MCP server (HTTP transport only — stdio is trusted-local).
 *
 * Two layers:
 *   1. Service token (Phase 1.5) — a shared bearer token. Enabled when
 *      MCP_SERVICE_TOKEN is set. Good enough for a private remote deploy.
 *   2. OAuth 2.1 (Phase 2 / marketplace) — SKELETON. Verifies a JWT bearer
 *      against an authorization server's JWKS. Wired but inert until you set
 *      MCP_OAUTH_ISSUER + MCP_OAUTH_AUDIENCE.
 *
 * Express middleware `requireAuth` enforces whichever layer(s) are configured.
 * If neither is configured, the HTTP endpoint is OPEN — fine for localhost,
 * NOT for public deploy (the README calls this out).
 */
import type { Request, Response, NextFunction } from 'express'
import { createRemoteJWKSet, jwtVerify } from 'jose'

function bearer(req: Request): string | null {
  const h = req.headers.authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null
}

// ─── Layer 1: shared service token ───────────────────────────────────────────
function checkServiceToken(token: string | null): boolean {
  const expected = process.env.MCP_SERVICE_TOKEN?.trim()
  if (!expected) return false
  return token === expected
}

// ─── Layer 2: OAuth 2.1 JWT (skeleton) ───────────────────────────────────────
// Lazily build the JWKS only if an issuer is configured.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null
function getJwks() {
  const issuer = process.env.MCP_OAUTH_ISSUER?.trim()
  if (!issuer) return null
  if (!jwks) {
    // Convention: OIDC JWKS lives at {issuer}/.well-known/jwks.json. Override
    // with MCP_OAUTH_JWKS_URL if your IdP differs.
    const jwksUrl = process.env.MCP_OAUTH_JWKS_URL?.trim() || `${issuer.replace(/\/$/, '')}/.well-known/jwks.json`
    jwks = createRemoteJWKSet(new URL(jwksUrl))
  }
  return jwks
}

async function checkOAuth(token: string | null): Promise<boolean> {
  if (!token) return false
  const keySet = getJwks()
  if (!keySet) return false // OAuth not configured
  try {
    await jwtVerify(token, keySet, {
      issuer: process.env.MCP_OAUTH_ISSUER?.trim(),
      audience: process.env.MCP_OAUTH_AUDIENCE?.trim() || undefined,
    })
    // TODO marketplace: enforce required scopes here, e.g.
    //   if (!String(payload.scope).split(' ').includes('bwave:invoke')) return false
    return true
  } catch {
    return false
  }
}

export function authConfigured(): boolean {
  return !!(process.env.MCP_SERVICE_TOKEN?.trim() || process.env.MCP_OAUTH_ISSUER?.trim())
}

export function requireAuth() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!authConfigured()) return next() // open mode (localhost only — see README)
    const token = bearer(req)
    if (checkServiceToken(token)) return next()
    if (await checkOAuth(token)) return next()
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized: valid bearer token required' },
      id: null,
    })
  }
}
