/**
 * Google Search Console — the client's OWN first-party search data.
 *
 * Why this sits in βWave at all: every other engine in Measure is queried from
 * the outside (ask ChatGPT a question, see whether you're in the answer). Search
 * Console is the opposite — it is the client's own account telling them what
 * Google actually showed and what people actually clicked. No scraping, no
 * third-party vendor, no terms-of-service grey area. For a product whose whole
 * argument is "own your data", pulling their real numbers from their own
 * property is the on-brand way to measure Google.
 *
 * ⚠️ WHAT THIS CANNOT DO — read before writing any marketing copy about it.
 * The Search Console **API** does not expose AI Overviews / AI Mode data. The
 * `type` field accepts only web | image | video | news | discover | googleNews;
 * there is no aiOverview/aiMode type and no searchAppearance value for it. The
 * Generative AI performance report exists in the Search Console **UI only**,
 * where it can be exported by hand as CSV. Google's usual pattern is UI first,
 * API months later — when it lands it will most likely appear as a new
 * searchAppearance value, which is why AI_SEARCH_APPEARANCES below is a list to
 * extend rather than a single constant.
 *
 * So: the API path gives real organic performance (queries, pages, clicks,
 * impressions, position). The AI numbers arrive via `parseGenAiCsv` from the
 * user's manual export. Both are first-party. Neither is guesswork.
 */
import { getStoredSecret } from './secrets.js'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API_BASE  = 'https://searchconsole.googleapis.com/webmasters/v3'

/** Read-only is deliberate — βWave never needs to modify a Search Console property. */
export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'

/** searchAppearance values that would indicate a generative surface. Empty of
 *  real values today; kept so the moment Google ships one, it's a one-line
 *  change here rather than a hunt through the codebase. */
export const AI_SEARCH_APPEARANCES: string[] = []

export interface GscCreds { clientId: string; clientSecret: string; refreshToken: string }

/** BYO credentials, same store as every other provider (encrypted at rest). */
export function gscCreds(): GscCreds | null {
  const clientId     = getStoredSecret('gsc_client_id')     || process.env.GSC_CLIENT_ID     || ''
  const clientSecret = getStoredSecret('gsc_client_secret') || process.env.GSC_CLIENT_SECRET || ''
  const refreshToken = getStoredSecret('gsc_refresh_token') || process.env.GSC_REFRESH_TOKEN || ''
  if (!clientId || !clientSecret || !refreshToken) return null
  return { clientId, clientSecret, refreshToken }
}

// Access tokens last an hour. Cached in memory rather than the DB on purpose —
// a restart just fetches a new one, and a short-lived credential is not worth
// persisting anywhere it could leak.
let cachedToken: { token: string; expiresAt: number } | null = null

export async function accessToken(force = false): Promise<string> {
  const creds = gscCreds()
  if (!creds) throw new Error('Search Console is not connected — add the OAuth client ID, secret and refresh token in Settings.')
  if (!force && cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token

  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: 'refresh_token',
  })
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await r.json().catch(() => ({})) as any
  if (!r.ok) {
    // Google's error bodies are genuinely useful here — a revoked token and a
    // wrong client secret fail identically at the HTTP level but differ in
    // `error`, and the user can act on the difference.
    const detail = data?.error_description || data?.error || `HTTP ${r.status}`
    throw new Error(`Search Console auth failed: ${detail}`)
  }
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000) }
  return cachedToken.token
}

async function gscFetch(path: string, init?: RequestInit): Promise<any> {
  const doCall = async (tok: string) => fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
  })
  let r = await doCall(await accessToken())
  // One retry on 401 with a forced refresh — covers a token revoked or expired
  // between the cache check and the call.
  if (r.status === 401) r = await doCall(await accessToken(true))
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const detail = data?.error?.message || `HTTP ${r.status}`
    throw new Error(`Search Console: ${detail}`)
  }
  return data
}

/** Properties this Google account can read. The user picks one per client. */
export async function listSites(): Promise<{ siteUrl: string; permissionLevel: string }[]> {
  const data = await gscFetch('/sites')
  return (data.siteEntry || []).map((s: any) => ({
    siteUrl: s.siteUrl, permissionLevel: s.permissionLevel,
  }))
}

export interface SearchAnalyticsRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface QueryOpts {
  siteUrl: string
  startDate: string           // YYYY-MM-DD
  endDate: string
  dimensions?: string[]       // query | page | country | device | date | searchAppearance
  rowLimit?: number
  type?: 'web' | 'image' | 'video' | 'news' | 'discover' | 'googleNews'
}

/**
 * Raw Search Analytics query. `type` is restricted to the values Google
 * actually accepts — passing 'aiOverview' would 400, and typing it here stops
 * anyone trying.
 */
export async function searchAnalytics(o: QueryOpts): Promise<SearchAnalyticsRow[]> {
  const body: any = {
    startDate: o.startDate,
    endDate: o.endDate,
    dimensions: o.dimensions ?? ['query'],
    rowLimit: Math.min(Math.max(o.rowLimit ?? 100, 1), 25_000),
  }
  if (o.type) body.type = o.type
  const data = await gscFetch(
    `/sites/${encodeURIComponent(o.siteUrl)}/searchAnalytics/query`,
    { method: 'POST', body: JSON.stringify(body) },
  )
  return (data.rows || []).map((r: any) => ({
    keys: r.keys || [],
    clicks: r.clicks || 0,
    impressions: r.impressions || 0,
    ctr: r.ctr || 0,
    position: r.position || 0,
  }))
}

/** Inclusive day-count helper — Search Console dates are YYYY-MM-DD in UTC. */
function isoDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000)
  return d.toISOString().slice(0, 10)
}

export interface GscSummary {
  site: string
  range: { start: string; end: string }
  totals: { clicks: number; impressions: number; ctr: number; position: number }
  top_queries: SearchAnalyticsRow[]
  top_pages: SearchAnalyticsRow[]
  /** Present only if Google has shipped a generative searchAppearance value —
   *  see AI_SEARCH_APPEARANCES. Absent is the honest, expected state today. */
  ai_appearances?: SearchAnalyticsRow[]
}

/**
 * One call for the Measure panel. Search Console data lags ~2 days, so the
 * window ends there rather than today — otherwise the last two rows always
 * read as a cliff and look like a bug.
 */
export async function summary(siteUrl: string, days = 28): Promise<GscSummary> {
  const endDate = isoDaysAgo(2)
  const startDate = isoDaysAgo(2 + days)

  const [byQuery, byPage] = await Promise.all([
    searchAnalytics({ siteUrl, startDate, endDate, dimensions: ['query'], rowLimit: 25 }),
    searchAnalytics({ siteUrl, startDate, endDate, dimensions: ['page'],  rowLimit: 25 }),
  ])

  const clicks      = byQuery.reduce((s, r) => s + r.clicks, 0)
  const impressions = byQuery.reduce((s, r) => s + r.impressions, 0)
  const weightedPos = impressions
    ? byQuery.reduce((s, r) => s + r.position * r.impressions, 0) / impressions
    : 0

  const out: GscSummary = {
    site: siteUrl,
    range: { start: startDate, end: endDate },
    totals: {
      clicks, impressions,
      ctr: impressions ? clicks / impressions : 0,
      position: weightedPos,
    },
    top_queries: byQuery,
    top_pages: byPage,
  }

  // Only attempt this once Google actually ships a generative appearance value;
  // asking for an unknown dimension filter today just wastes a call.
  if (AI_SEARCH_APPEARANCES.length) {
    try {
      out.ai_appearances = await searchAnalytics({
        siteUrl, startDate, endDate, dimensions: ['searchAppearance'], rowLimit: 25,
      })
    } catch { /* non-fatal — the rest of the summary is still good */ }
  }
  return out
}

export interface GenAiCsvRow { query: string; clicks: number; impressions: number; ctr: number; position: number }

/**
 * Parse a Generative AI performance report exported by hand from the Search
 * Console UI — currently the ONLY way to get AI Mode / AI Overview numbers out
 * of Google (see the file header).
 *
 * Deliberately tolerant: Google localises these headers, renames columns
 * between report versions, and exports CTR as "12.3%" in some locales and
 * "0.123" in others. A strict parser would break silently on someone else's
 * account, and this is a self-hosted product — it has to survive exports we
 * have never seen.
 */
export function parseGenAiCsv(csv: string): GenAiCsvRow[] {
  const lines = csv.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  const split = (line: string): string[] => {
    // Minimal CSV: handles quoted fields containing commas, which queries do have.
    const out: string[] = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++ } else inQ = !inQ
      } else if (c === ',' && !inQ) { out.push(cur); cur = '' }
      else cur += c
    }
    out.push(cur)
    return out.map(s => s.trim())
  }

  const header = split(lines[0]).map(h => h.toLowerCase().replace(/^﻿/, ''))
  const find = (...names: string[]) => header.findIndex(h => names.some(n => h.includes(n)))
  const iQ   = find('query', 'search term', 'top queries')
  const iCl  = find('click')
  const iImp = find('impression')
  const iCtr = find('ctr')
  const iPos = find('position')
  if (iQ === -1) return []

  const num = (s: string | undefined): number => {
    if (!s) return 0
    const pct = s.includes('%')
    // Strip thousands separators and the percent sign; comma-decimal locales
    // (1,23) are handled by treating a lone trailing comma-group as decimal.
    const cleaned = s.replace(/%/g, '').replace(/\s/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.')
    const n = parseFloat(cleaned)
    if (!isFinite(n)) return 0
    return pct ? n / 100 : n
  }

  return lines.slice(1).map(l => {
    const c = split(l)
    return {
      query: c[iQ] || '',
      clicks: num(c[iCl]),
      impressions: num(c[iImp]),
      ctr: num(c[iCtr]),
      position: num(c[iPos]),
    }
  }).filter(r => r.query)
}
