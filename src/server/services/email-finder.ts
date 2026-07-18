/**
 * Email finder — provider-agnostic, bring-your-own-key.
 *
 * Keys come from the encrypted BYO store (Settings 🔑 → apollo / hunter), loaded
 * into process.env by services/secrets.ts. βWave never proxies these calls or
 * holds a shared account: you use your key, you pay the provider directly.
 *
 * Provider choice is driven by the identifier we actually hold:
 *   • Apollo  — matches on a LinkedIn URL, which is what Discovery captures from
 *               Sales Navigator. First choice for role-based leads.
 *   • Hunter  — needs company domain + first/last name. Used when we have a
 *               domain (e.g. LeadSwift-sourced orgs) or Apollo found nothing.
 *
 * HARD RULE: never invent, pattern-guess, or infer an address. We only ever
 * store something a provider actually returned. A missing email is a correct
 * answer — a plausible-looking guess is a bounce, and bounces burn the sending
 * domain. Everything is recorded with its source and confidence so a guessed
 * address is never mistaken for a verified one.
 */

export type EmailStatus = 'found' | 'not_found' | 'verified' | 'invalid'

export interface EmailResult {
  ok: boolean
  email?: string
  /** 0-100. Provider-reported where available, conservative default otherwise. */
  confidence?: number
  source?: 'apollo' | 'hunter'
  status?: EmailStatus
  error?: string
  /**
   * True when the lookup couldn't even be attempted (no key, key rejected, out
   * of credits). Callers MUST NOT record this as 'not_found' — that would mark
   * the contact as searched and permanently exclude them from bulk lookup once
   * a working key is added. A config problem is not an answer about the person.
   */
  configError?: boolean
}

export interface FindEmailInput {
  full_name: string
  linkedin_url?: string
  /** Company domain, when known — required for Hunter. */
  domain?: string
  company?: string
}

/** Apollo hands back this placeholder when the address wasn't actually revealed. */
function isPlaceholderEmail(email: string): boolean {
  const e = (email || '').toLowerCase()
  return !e || e.startsWith('email_not_unlocked') || e.includes('not_unlocked')
}

function splitName(full: string): { first: string; last: string } {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return { first: parts[0] || '', last: '' }
  return { first: parts[0], last: parts[parts.length - 1] }
}

/** Apollo — people/match, keyed on LinkedIn URL where possible. */
async function findViaApollo(input: FindEmailInput, apiKey: string): Promise<EmailResult> {
  const body: Record<string, unknown> = { reveal_personal_emails: true }
  if (input.linkedin_url) body.linkedin_url = input.linkedin_url
  else {
    const { first, last } = splitName(input.full_name)
    if (!first || !last) return { ok: false, error: 'need a full name or LinkedIn URL for Apollo' }
    body.first_name = first
    body.last_name = last
    if (input.domain) body.domain = input.domain
    else if (input.company) body.organization_name = input.company
  }

  const res = await fetch('https://api.apollo.io/api/v1/people/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(body),
  })

  if (res.status === 401 || res.status === 403) return { ok: false, error: 'Apollo key rejected (401/403)', configError: true }
  if (res.status === 429) return { ok: false, error: 'Apollo rate limit / out of credits', configError: true }
  if (!res.ok) return { ok: false, error: `Apollo error ${res.status}` }

  const data = await res.json() as any
  const person = data?.person
  const email: string = person?.email || ''

  // No address, or the "you haven't spent a credit" placeholder — both are a
  // genuine miss. Never store either.
  if (!email || isPlaceholderEmail(email)) return { ok: false, error: 'no email available from Apollo' }

  // Apollo's own assessment: 'verified' is trustworthy, 'guessed' explicitly isn't.
  const apolloStatus = String(person?.email_status || '').toLowerCase()
  const verified = apolloStatus === 'verified'
  if (apolloStatus === 'bounced' || apolloStatus === 'invalid') {
    return { ok: false, error: 'Apollo reports this address bounces' }
  }

  return {
    ok: true,
    email,
    source: 'apollo',
    status: verified ? 'verified' : 'found',
    confidence: verified ? 95 : 60,
  }
}

/** Hunter — email-finder, needs a domain. */
async function findViaHunter(input: FindEmailInput, apiKey: string): Promise<EmailResult> {
  if (!input.domain) return { ok: false, error: 'Hunter needs a company domain' }
  const { first, last } = splitName(input.full_name)
  if (!first || !last) return { ok: false, error: 'Hunter needs a first and last name' }

  const url = new URL('https://api.hunter.io/v2/email-finder')
  url.searchParams.set('domain', input.domain)
  url.searchParams.set('first_name', first)
  url.searchParams.set('last_name', last)
  url.searchParams.set('api_key', apiKey)

  const res = await fetch(url)
  if (res.status === 401) return { ok: false, error: 'Hunter key rejected (401)', configError: true }
  if (res.status === 429) return { ok: false, error: 'Hunter rate limit / quota exhausted', configError: true }
  if (!res.ok) return { ok: false, error: `Hunter error ${res.status}` }

  const data = await res.json() as any
  const email: string = data?.data?.email || ''
  if (!email) return { ok: false, error: 'no email available from Hunter' }

  // Hunter's score is a 0-100 confidence in the pattern match, not proof.
  const score = Number(data?.data?.score)
  return {
    ok: true,
    email,
    source: 'hunter',
    status: 'found',
    confidence: Number.isFinite(score) ? score : 50,
  }
}

/**
 * Find an email using whichever provider suits the identifiers we hold.
 * Apollo first (LinkedIn-URL native), Hunter as fallback when a domain exists.
 */
export async function findEmail(input: FindEmailInput): Promise<EmailResult> {
  const apollo = process.env.APOLLO_API_KEY?.trim()
  const hunter = process.env.HUNTER_API_KEY?.trim()
  if (!apollo && !hunter) {
    return { ok: false, error: 'No email-finder key set — add Apollo or Hunter in Settings 🔑', configError: true }
  }

  const errors: string[] = []
  let configError = false

  if (apollo && (input.linkedin_url || input.full_name)) {
    try {
      const r = await findViaApollo(input, apollo)
      if (r.ok) return r
      if (r.configError) configError = true
      errors.push(r.error || 'Apollo: no match')
    } catch (e: any) {
      errors.push(`Apollo: ${e.message}`)
    }
  }

  if (hunter && input.domain) {
    try {
      const r = await findViaHunter(input, hunter)
      if (r.ok) return r
      if (r.configError) configError = true
      errors.push(r.error || 'Hunter: no match')
    } catch (e: any) {
      errors.push(`Hunter: ${e.message}`)
    }
  }

  return { ok: false, error: errors.join(' · ') || 'no provider could match this contact', configError }
}

/**
 * Verify an address via Hunter. Worth doing before any send — bounces are what
 * get a sending domain blacklisted. `accept_all` is deliberately NOT treated as
 * verified: the server accepts everything, so it proves nothing.
 */
export async function verifyEmail(email: string): Promise<{ ok: boolean; status?: EmailStatus; confidence?: number; error?: string }> {
  const hunter = process.env.HUNTER_API_KEY?.trim()
  if (!hunter) return { ok: false, error: 'Hunter key required for verification' }

  const url = new URL('https://api.hunter.io/v2/email-verifier')
  url.searchParams.set('email', email)
  url.searchParams.set('api_key', hunter)

  const res = await fetch(url)
  if (!res.ok) return { ok: false, error: `Hunter verify error ${res.status}` }

  const data = await res.json() as any
  const status = String(data?.data?.status || '').toLowerCase()
  const score = Number(data?.data?.score)
  const confidence = Number.isFinite(score) ? score : undefined

  if (status === 'invalid' || status === 'disposable') return { ok: true, status: 'invalid', confidence }
  if (status === 'valid') return { ok: true, status: 'verified', confidence }
  // accept_all / webmail / unknown — deliverable-ish but unproven. Leave as found.
  return { ok: true, status: 'found', confidence }
}
