/**
 * Lead generator auth middleware.
 *
 * Separate from the admin APP_PASSWORD guard. Lead gens get a session cookie
 * (_lg_auth) set when they accept their invite link. The cookie value is an
 * HMAC of (lead_gen_id + invite_token_secret) stored in lead_generators.session_token.
 *
 * On each request to /my/* routes, we look up the lead gen by session_token.
 * If found and status = 'active', we attach req.leadGen = { id, email, name }.
 */
import { Request, Response, NextFunction } from 'express'
import db from '../db.js'

export const LG_COOKIE = '_lg_auth'

declare global {
  namespace Express {
    interface Request {
      leadGen?: { id: string; email: string; name: string }
    }
  }
}

function parseCookies(header: string): Record<string, string> {
  return Object.fromEntries(
    (header || '').split(';').flatMap(part => {
      const [k, ...v] = part.trim().split('=')
      return k ? [[k.trim(), decodeURIComponent(v.join('='))]] : []
    })
  )
}

export function leadGenAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie || '')
  const token = cookies[LG_COOKIE]
  if (!token) return res.status(401).json({ error: 'Not authenticated as lead generator' })

  const lg = db.prepare(
    `SELECT id, email, name FROM lead_generators WHERE session_token = ? AND status = 'active'`
  ).get(token) as { id: string; email: string; name: string } | undefined

  if (!lg) return res.status(401).json({ error: 'Invalid or expired session' })

  req.leadGen = lg
  next()
}
