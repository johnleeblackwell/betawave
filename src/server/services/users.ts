/**
 * App users — multi-user login with roles, layered ON TOP of the existing
 * single-password owner login (which stays the master/full-access key).
 *
 *   role 'operator'  → a client-scoped moderator (e.g. a client's social manager). Can ONLY
 *                      reach their own client's Respond queue + Content drafts.
 *                      Enforced server-side in middleware/auth.ts (operatorGuard).
 *
 * Passwords: scrypt with a per-user random salt, constant-time compare.
 */
import { v4 as uuid } from 'uuid'
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import db from '../db.js'

db.prepare(`
  CREATE TABLE IF NOT EXISTS app_users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'operator',
    client_id     TEXT,
    created_at    INTEGER DEFAULT (unixepoch())
  )
`).run()

export interface AppUser {
  id: string; email: string; password_hash: string; role: string; client_id: string | null
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(pw, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(stored: string, pw: string): boolean {
  const [salt, hash] = (stored || '').split(':')
  if (!salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  const actual = scryptSync(pw, salt, 64)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function findByEmail(email: string): AppUser | undefined {
  return db.prepare(`SELECT * FROM app_users WHERE email = ?`).get(String(email).trim().toLowerCase()) as AppUser | undefined
}

/** Create or update (by email) a user. Returns the row. */
export function upsertUser(email: string, password: string, role: string, clientId: string | null): AppUser {
  const e = String(email).trim().toLowerCase()
  const existing = findByEmail(e)
  const hash = hashPassword(password)
  if (existing) {
    db.prepare(`UPDATE app_users SET password_hash = ?, role = ?, client_id = ? WHERE id = ?`)
      .run(hash, role, clientId, existing.id)
    return { ...existing, password_hash: hash, role, client_id: clientId }
  }
  const id = uuid()
  db.prepare(`INSERT INTO app_users (id, email, password_hash, role, client_id) VALUES (?, ?, ?, ?, ?)`)
    .run(id, e, hash, role, clientId)
  return { id, email: e, password_hash: hash, role, client_id: clientId }
}
