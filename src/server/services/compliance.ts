/**
 * Compliance filter — hard-block list for content topics.
 *
 * Per MASTER_PLAN.md, these topics are principled constraints, not limitations.
 * The filter is configurable per client; if a client has no custom list,
 * the default list (from .env or DEFAULT_BLOCKED_TOPICS below) applies.
 */

export const DEFAULT_BLOCKED_TOPICS = [
  'alcohol',
  'pornography',
  'adult content',
  'music',
  'banking',
  'insurance',
  'interest-bearing financial products',
]

/**
 * Return the effective block list for a client: client-specific if set,
 * otherwise the default.
 */
export function effectiveBlockList(clientBlockedTopics: string[] | null | undefined): string[] {
  if (Array.isArray(clientBlockedTopics) && clientBlockedTopics.length > 0) {
    return clientBlockedTopics.map(t => t.trim().toLowerCase()).filter(Boolean)
  }
  return DEFAULT_BLOCKED_TOPICS
}

/**
 * Check a free-text string (industry, expertise area, style note) against the
 * block list. Returns the first matching topic, or null if clean.
 *
 * Matching is case-insensitive WORD-BOUNDARY matching + a small synonyms table
 * so that "real ale pub" trips "alcohol" but "engineering" does not trip "gin"
 * and "barometer" does not trip "bar".
 */
const SYNONYMS: Record<string, string[]> = {
  alcohol: ['beer', 'wine', 'spirits', 'brewery', 'pub', 'ale', 'cocktail', 'distillery', 'vodka', 'whisky', 'whiskey', 'rum', 'gin', 'lager', 'bourbon'],
  pornography: ['porn', 'xxx', 'nsfw', 'erotic'],
  'adult content': ['escort', 'adult entertainment', 'strip club'],
  music: ['band', 'musician', 'record label', 'concert promoter', 'dj'],
  banking: ['bank', 'mortgage', 'loan', 'credit card', 'lending', 'lender'],
  insurance: ['insurer', 'underwriter', 'broker', 'policy', 'premium'],
  'interest-bearing financial products': ['bond', 'savings account', 'cd', 'certificate of deposit', 'dividend'],
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Case-insensitive word-boundary match. Multi-word terms keep their inner spaces. */
function matchesWord(haystack: string, term: string): boolean {
  const t = term.trim()
  if (!t) return false
  return new RegExp(`\\b${escapeRegex(t)}\\b`, 'i').test(haystack)
}

export function checkCompliance(text: string, blockList: string[]): string | null {
  if (!text) return null
  for (const topic of blockList) {
    if (matchesWord(text, topic)) return topic
    const syns = SYNONYMS[topic.toLowerCase()]
    if (syns) {
      for (const s of syns) {
        if (matchesWord(text, s)) return `${topic} (matched "${s.trim()}")`
      }
    }
  }
  return null
}

/**
 * Check the full client payload (industry + expertise + style notes +
 * target audience) against the block list. Returns { ok: true } or
 * { ok: false, field, topic } on first hit.
 */
export function checkClientPayload(
  payload: { industry?: string; expertise_areas?: string[]; style_notes?: string; target_audience?: string; business_name?: string },
  blockList: string[]
): { ok: true } | { ok: false; field: string; topic: string } {
  const checks: [string, string][] = [
    ['industry', payload.industry || ''],
    ['business_name', payload.business_name || ''],
    ['target_audience', payload.target_audience || ''],
    ['style_notes', payload.style_notes || ''],
    ['expertise_areas', (payload.expertise_areas || []).join(' ')],
  ]
  for (const [field, value] of checks) {
    const hit = checkCompliance(value, blockList)
    if (hit) return { ok: false, field, topic: hit }
  }
  return { ok: true }
}

/**
 * System-prompt guard injected into every Claude generation call.
 * Claude is instructed to refuse or redirect if the draft would cover
 * a blocked topic.
 */
export function complianceGuardPrompt(blockList: string[]): string {
  if (!blockList.length) return ''
  return `

COMPLIANCE CONSTRAINTS (non-negotiable):
Do not produce content that promotes, endorses, or provides advice on the following topics: ${blockList.join(', ')}. If the brief or source material touches these topics, pivot the angle so the draft does not promote them. If no compliant angle is possible, respond with a single line: COMPLIANCE_BLOCK: <reason>.`
}
