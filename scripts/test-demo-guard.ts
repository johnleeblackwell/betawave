/**
 * Authorisation matrix for the scoped roles.
 *
 *   npx tsx scripts/test-demo-guard.ts
 *
 * The demo login is handed to prospects, so what it can and cannot reach is a
 * security boundary, not a preference — and it is easy to get wrong, because
 * demoGuard delegates its scoping to operatorGuard and the two roles want
 * DIFFERENT answers for exactly one area. Discovery was hidden from the demo
 * for months as a side effect of that sharing: the tab existed, the data
 * existed, and every request 403'd.
 *
 * Asserting it here rather than by logging in means the boundary is checked
 * without anyone handling the shared demo password, and a future edit that
 * quietly re-closes Reach — or worse, opens a write path — fails loudly.
 */
import { operatorGuard, demoGuard } from '../src/server/middleware/auth.js'

const CID = '35e8b43e-ca1c-4f5f-a2a6-2aac138c3c43'
const OTHER = '11111111-2222-3333-4444-555555555555'

type Role = 'operator' | 'demo'
const session = (role: Role) => ({ uid: 'u1', role, client_id: CID, email: `${role}@example.com`, exp: 0 })

/** Run one path through the guard; returns 'allow' or the refusal status. */
function check(role: Role, method: string, path: string, query: any = {}): string {
  let outcome = 'allow'
  const req: any = { path, method, query }
  const res: any = {
    status(code: number) { outcome = `deny(${code})`; return this },
    json() { return this },
  }
  const next = () => { outcome = 'allow' }
  const guard = role === 'demo' ? demoGuard : operatorGuard
  guard(session(role) as any, req, res, next)
  return outcome
}

interface Case { label: string; method: string; path: string; query?: any; demo: string; operator: string }

const CASES: Case[] = [
  // ── the regression this file exists for ──
  { label: 'Discovery verticals (the pipeline)', method: 'GET', path: `/api/clients/${CID}/discovery/verticals`, demo: 'allow', operator: 'deny' },
  { label: 'Discovery orgs',                     method: 'GET', path: `/api/clients/${CID}/discovery/organizations/x/contacts`, demo: 'allow', operator: 'deny' },
  { label: "Today's work queue",                 method: 'GET', path: '/api/leads/today', query: { clientId: CID }, demo: 'allow', operator: 'deny' },
  { label: 'Lead search',                        method: 'GET', path: '/api/leads/search', demo: 'allow', operator: 'deny' },

  // ── the demo must stay read-only ──
  { label: 'WRITE: mark a lead replied',   method: 'POST', path: '/api/leads/abc/replied', demo: 'deny', operator: 'deny' },
  { label: 'WRITE: change a stage',        method: 'POST', path: '/api/leads/abc/stage', demo: 'deny', operator: 'deny' },
  { label: 'WRITE: generate a message',    method: 'POST', path: `/api/clients/${CID}/discovery/contacts/x/generate-message`, demo: 'deny', operator: 'deny' },
  { label: 'WRITE: send an email',         method: 'POST', path: '/api/email/send', demo: 'deny', operator: 'deny' },
  { label: 'WRITE: edit the client',       method: 'PUT',  path: `/api/clients/${CID}`, demo: 'deny', operator: 'allow' },
  { label: 'WRITE: generate content',      method: 'POST', path: `/api/clients/${CID}/content`, demo: 'deny', operator: 'allow' },

  // ── tenant isolation must hold for both ──
  { label: "another tenant's workspace",   method: 'GET', path: `/api/clients/${OTHER}/discovery/verticals`, demo: 'deny', operator: 'deny' },
  { label: "another tenant via query",     method: 'GET', path: '/api/leads/today', query: { clientId: OTHER }, demo: 'deny', operator: 'deny' },
  { label: 'the clients LIST',             method: 'GET', path: '/api/clients', demo: 'deny', operator: 'deny' },
  { label: 'platform settings',            method: 'GET', path: '/api/settings/keys', demo: 'deny', operator: 'deny' },
  { label: 'admin users',                  method: 'GET', path: '/api/admin/users', demo: 'deny', operator: 'deny' },

  // ── agency-only capability stays shut for both ──
  { label: 'pSEO (agency only)',           method: 'GET', path: `/api/clients/${CID}/pseo/runs`, demo: 'deny', operator: 'deny' },

  // ── ordinary client workspace still works ──
  { label: 'own client profile',           method: 'GET', path: `/api/clients/${CID}`, demo: 'allow', operator: 'allow' },
  { label: 'own overview dashboard',       method: 'GET', path: `/api/clients/${CID}/overview`, demo: 'allow', operator: 'allow' },
  { label: 'citations',                    method: 'GET', path: '/api/citation-tracker/brands', demo: 'allow', operator: 'allow' },
]

let failed = 0
const pad = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n)
console.log(`${pad('CASE', 40)} ${pad('METHOD', 7)} ${pad('DEMO', 16)} OPERATOR`)
console.log('─'.repeat(84))
for (const c of CASES) {
  const got = { demo: check('demo', c.method, c.path, c.query), operator: check('operator', c.method, c.path, c.query) }
  const ok = (want: string, g: string) => want === 'allow' ? g === 'allow' : g.startsWith('deny')
  const dOk = ok(c.demo, got.demo), oOk = ok(c.operator, got.operator)
  if (!dOk || !oOk) failed++
  console.log(`${pad(c.label, 40)} ${pad(c.method, 7)} ${pad(`${got.demo} ${dOk ? '✓' : `✗ want ${c.demo}`}`, 16)} ${got.operator} ${oOk ? '✓' : `✗ want ${c.operator}`}`)
}
console.log('─'.repeat(84))
console.log(failed === 0 ? `PASS — all ${CASES.length} cases behave as intended` : `FAIL — ${failed} of ${CASES.length} cases wrong`)
process.exit(failed === 0 ? 0 : 1)
