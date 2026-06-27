/**
 * MLM / direct-seller content compliance gate.
 *
 * Encodes a direct-selling company's advertising rules as (a) a generation guard
 * (system-prompt steer) and (b) a post-generation SCANNER that blocks violations and
 * reports the mandated disclaimers. Rules-based filter — there is no route-to-company
 * pre-approval step for ordinary marketing.
 *
 * Brand-agnostic by design. The `exampleRuleset` below is a GENERIC template that
 * demonstrates the common rules most direct-selling compliance regimes share (no
 * income claims, no medical/disease claims, no drug comparisons, mandated disclaimers).
 * To support a specific company, copy it into a new `Ruleset` object encoding that
 * company's own published advertising rules and register it in RULESETS below.
 */

export type Severity = 'block' | 'warn'

export interface BannedTerm { term: string; category: 'opportunity' | 'earnings' | 'product'; severity: Severity }
export interface ClaimPattern { id: string; re: RegExp; reason: string; severity: Severity }
export interface Disclaimer { id: string; text: string; when: string; triggers: RegExp }

export interface Ruleset {
  company: string
  bannedTerms: BannedTerm[]
  bannedHashtags: string[]
  claimPatterns: ClaimPattern[]
  disclaimers: Disclaimer[]
  /** domain/handle tokens a consultant may NOT register (typical brand-protection rule). */
  reservedBrandTokens: string[]
}

export interface Violation { kind: 'banned-term' | 'banned-hashtag' | 'claim'; severity: Severity; match: string; detail: string }
export interface ComplianceResult {
  ok: boolean                 // no 'block' violations
  blocks: Violation[]
  warnings: Violation[]
  requiredDisclaimers: Disclaimer[]
  missingDisclaimers: Disclaimer[]
}

// ── Generic direct-selling ruleset (UK-style strict) ──────────────────────────
// Industry-standard "don't say" lists. These are the red-flag phrases common to most
// direct-selling advertising codes — replace or extend for your specific company.
const DS_BANNED: BannedTerm[] = ([
  // opportunity
  ['uncapped opportunity', 'opportunity'], ['system for success', 'opportunity'], ['million-dollar business', 'opportunity'], ['million dollar business', 'opportunity'],
  ['this business is easy', 'opportunity'], ['no risk', 'opportunity'], ['anyone can do this', 'opportunity'], ['replace your salary', 'opportunity'],
  ['plan a or b', 'opportunity'], ['stay-at-home parent', 'opportunity'], ['retire from your job', 'opportunity'],
  // earnings
  ['financial freedom', 'earnings'], ['time freedom', 'earnings'], ['financial flexibility', 'earnings'], ['unlimited income', 'earnings'],
  ['full-time income', 'earnings'], ['full time income', 'earnings'], ['be set for life', 'earnings'], ['life-changing income', 'earnings'], ['life changing income', 'earnings'],
  ['replacement income', 'earnings'], ['career level income', 'earnings'], ['residual income', 'earnings'], ['passive income', 'earnings'],
  ['millionaire', 'earnings'], ['six figures', 'earnings'], ['six-figure', 'earnings'], ['all-expense paid', 'earnings'], ['all expenses paid', 'earnings'],
  ['luxury trip', 'earnings'], ['paid to recommend', 'earnings'], ['earn on your own purchases', 'earnings'], ['paycheque', 'earnings'], ['paycheck', 'earnings'],
  ['pay rise', 'earnings'], ['pay raise', 'earnings'], ['free car', 'earnings'],
  // product
  ['fast weight loss', 'product'], ['rapid weight loss', 'product'], ['detox programme', 'product'], ['detox program', 'product'], ['diet programme', 'product'], ['diet program', 'product'],
  ['improve gut health', 'product'], ['gut health', 'product'], ['anti-inflammatory', 'product'], ['eczema', 'product'], ['psoriasis', 'product'],
  ['cured', 'product'], ['healed', 'product'], ['makes your hair grow', 'product'], ['nontoxic', 'product'], ['non-toxic', 'product'],
  ['prevents disease', 'product'], ['fine lines and wrinkles', 'product'], ['dermatologist-approved', 'product'], ['dermatologist approved', 'product'],
  ['sunburn-proof', 'product'], ['sunburn proof', 'product'], ['miracle', 'product'],
] as [string, BannedTerm['category']][]).map(([term, category]) => ({ term, category, severity: 'block' as Severity }))

const DS_HASHTAGS = ['#timefreedom', '#financialfreedom', '#passiveincome', '#nomoreboss', '#retired', '#bossbabe', '#sixfigures', '#replaceyourincome', '#careerlevelincome', '#unlimitedincome', '#rapidweightloss', '#weightlossshake', '#miracleproduct']

const DS_CLAIMS_UK: ClaimPattern[] = [
  // Medical / disease claims
  { id: 'disease-claim', re: /\b(cure[sd]?|heal[sed]*|treat(?:s|ed|ment)?|prevent[s]?|diagnos\w+|mitigat\w+)\b[^.?!]{0,40}\b(disease|condition|illness|eczema|psoriasis|acne|diabetes|cancer|arthritis|depression|anxiety|inflammation|ibs|menopause)\b/i, reason: 'Implies medical/disease treatment — prohibited (medical claim; needs a licence)', severity: 'block' },
  { id: 'medication-replace', re: /\b(no longer need|stop(?:ped)? taking|replace[sd]?|instead of|off (?:my|your))\b[^.?!]{0,25}\b(medication|medicine|prescription|drug|tablets|pills)\b/i, reason: 'Implies replacing medication — prohibited medical claim', severity: 'block' },
  // GLP-1 / weight-loss drug comparison — treat as medical claim
  { id: 'glp1-comparison', re: /\b(glp-?\s?1|ozempic|wegovy|semaglutide|tirzepatide|mounjaro|zepbound|weight[-\s]?loss (?:drug|injection|jab|medication))\b/i, reason: 'Weight-loss-drug comparison — prohibited (medical claim)', severity: 'block' },
  // Weight-loss rate or amount
  { id: 'weight-loss-amount', re: /\b(lost|lose|losing|dropped|shed|down)\b[^.?!]{0,18}\b\d+\s?(kg|kgs|kilos?|lb|lbs|pounds?|stone|st|%)\b/i, reason: 'States rate/amount of weight loss — prohibited', severity: 'block' },
  { id: 'weight-loss-amount-2', re: /\b\d+\s?(kg|kgs|kilos?|lb|lbs|pounds?|stone|st)\b[^.?!]{0,18}\b(in|over)\b[^.?!]{0,12}\b(days?|weeks?|months?)\b/i, reason: 'States rate/amount of weight loss — prohibited', severity: 'block' },
  // Income guarantee phrasing not caught by the term list
  { id: 'income-guarantee', re: /\b(guarantee[sd]?|guaranteed)\b[^.?!]{0,25}\b(income|earnings|results|success|money)\b/i, reason: 'Guaranteed earnings/results — prohibited', severity: 'block' },
  { id: 'third-party-endorse', re: /\b(approved|endorsed|recommended)\b[^.?!]{0,20}\b(by|by the)\b[^.?!]{0,20}\b(nhs|fda|mhra|doctors?|dermatologists?)\b/i, reason: 'Implies third-party/official endorsement — prohibited', severity: 'block' },
]

// Required disclaimers — generic placeholders. Replace the bracketed tokens with your
// company's actual mandated wording and income-disclosure / product-info URLs.
const D_IC = 'THIS IS INDEPENDENT CONSULTANT CONTENT; IT IS NOT OFFICIAL COMPANY MATERIAL.'
const D_EARN = 'EARNINGS VARY AND ARE NOT GUARANTEED. SEE THE COMPANY INCOME DISCLOSURE FOR TYPICAL RESULTS.'
const D_PRODUCT = 'FOR PRODUCT AND INGREDIENT INFORMATION, VISIT THE OFFICIAL COMPANY WEBSITE.'
const D_FDA = '◊ These statements have not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure or prevent any disease.'

const DS_DISCLAIMERS: Disclaimer[] = [
  { id: 'ic-identification', text: D_IC, when: 'All consultant-created marketing materials', triggers: /.*/ },
  { id: 'earnings', text: D_EARN, when: 'Any opportunity/earnings/recognition/your-story content', triggers: /\b(income|earn(?:ings)?|opportunity|business|join (?:my|our) team|sign up|recruit|success ?plan|recognition|promotion|residual|commission)\b/i },
  { id: 'product-info', text: D_PRODUCT, when: 'Product love statements, testimonials, or tutorials', triggers: /\b(product|skincare|protein|shake|serum|cleanser|spf|results|testimonial|before|after)\b/i },
]

export const exampleUK: Ruleset = {
  company: 'Example Direct-Selling Co (UK)',
  bannedTerms: DS_BANNED,
  bannedHashtags: DS_HASHTAGS,
  claimPatterns: DS_CLAIMS_UK,
  disclaimers: DS_DISCLAIMERS,
  reservedBrandTokens: [],
}

// ── Generic direct-selling ruleset (US-style) ─────────────────────────────────
// US codes typically permit contextual weight-loss claims WITH a structure/function
// (FDA) disclaimer, but still bar prescription drug names and drug-equivalence framing.
const DS_US_CLAIMS: ClaimPattern[] = [
  { id: 'disease-claim', re: /\b(cure[sd]?|heal[sed]*|treat(?:s|ed|ment)?|prevent[s]?|diagnos\w+|mitigat\w+)\b[^.?!]{0,40}\b(disease|condition|illness|eczema|psoriasis|acne|diabetes|cancer|obesity|arthritis|depression|anxiety|inflammation|ibs|menopause)\b/i, reason: 'Medical/disease claim — prohibited (FDA)', severity: 'block' },
  { id: 'medication-replace', re: /\b(no longer need|stop(?:ped)? taking|replace[sd]?|instead of|get away from|off (?:my|your))\b[^.?!]{0,25}\b(medication|medicine|prescription|injection|drug|tablets|pills|jab)\b/i, reason: 'Implies replacing medication — prohibited', severity: 'block' },
  { id: 'rx-drug-name', re: /\b(ozempic|wegovy|semaglutide|tirzepatide|mounjaro|zepbound|saxenda|victoza|rybelsus)\b/i, reason: 'Names a prescription drug — prohibited; use compliant, non-drug wording', severity: 'block' },
  { id: 'drug-equivalence', re: /\b(works?|acts?|functions?|same)\b[^.?!]{0,22}\b(just )?(like|the same(?: way)? as|equivalent to)\b[^.?!]{0,28}\b(prescription|medication|injection|drug|jab|shot)\b/i, reason: 'Implies prescription-drug equivalence — prohibited', severity: 'block' },
  { id: 'natural-ozempic', re: /\bnatural\s+ozempic\b|\b(ozempic|wegovy|glp-?1)\s+(replacement|alternative|in a (?:bottle|powder|shake))\b/i, reason: 'Drug-replacement/alternative framing — prohibited', severity: 'block' },
  { id: 'wl-alone', re: /\b(product|shake|powder)\s+alone\b|\bonly\s+(drinking|using|taking)\b[^.?!]{0,15}\b(this|the)\b/i, reason: 'Implies the product alone caused weight loss — prohibited', severity: 'block' },
  { id: 'wl-amount', re: /\b(lost|lose|losing|dropped|shed)\b[^.?!]{0,15}\b\d+\s?(lb|lbs|pounds?|kg|stone)\b/i, reason: 'Numeric weight-loss claim — permitted only with diet/exercise context + disclaimer; human review', severity: 'warn' },
  { id: 'no-side-effects', re: /\bno\s+side[-\s]?effects\b|\bguaranteed\s+(results|weight\s*loss|success)\b|\bmiracle\b/i, reason: 'Guaranteed / no-side-effects / miracle claim — prohibited', severity: 'block' },
  { id: 'income-guarantee', re: /\b(guarantee[sd]?|guaranteed)\b[^.?!]{0,25}\b(income|earnings|results|success|money)\b/i, reason: 'Guaranteed earnings — prohibited', severity: 'block' },
  { id: 'third-party-endorse', re: /\b(approved|endorsed|recommended)\b[^.?!]{0,20}\b(by)\b[^.?!]{0,20}\b(fda|doctors?|physicians?|clinics?|government|agenc)/i, reason: 'Implies third-party/official endorsement — prohibited', severity: 'block' },
]

const DS_US_DISCLAIMERS: Disclaimer[] = [
  { id: 'ic-identification', text: D_IC, when: 'All consultant-created marketing materials', triggers: /.*/ },
  { id: 'earnings', text: D_EARN, when: 'Opportunity/earnings/recognition/your-story content', triggers: /\b(income|earn(?:ings)?|opportunity|business|join (?:my|our) team|sign up|recruit|success ?plan|recognition|promotion|residual|commission)\b/i },
  { id: 'product-info', text: D_PRODUCT, when: 'Product love statements, testimonials, tutorials', triggers: /\b(product|skincare|protein|shake|serum|cleanser|spf|results|testimonial|before|after)\b/i },
  { id: 'fda-supplement', text: D_FDA, when: 'Structure/function claim about a dietary supplement', triggers: /\b(supplement|metabolic|metabolism|satiety|appetite|energy balance|fullness|nutrition support)\b/i },
]

export const exampleUS: Ruleset = {
  company: 'Example Direct-Selling Co (US)',
  bannedTerms: [...DS_BANNED, { term: "on the company's dime", category: 'earnings', severity: 'block' }],
  bannedHashtags: [...DS_HASHTAGS, '#ozempicreplacement', '#naturalglp-1', '#naturalglp1', '#wegovyalternative', '#ozempicalternative'],
  claimPatterns: DS_US_CLAIMS,
  disclaimers: DS_US_DISCLAIMERS,
  reservedBrandTokens: [],
}

/** Default ruleset (UK = strictest). */
export const defaultRuleset = exampleUK

/** Registry of company rulesets, keyed by the lowercase token stored on `clients.mlm_company`.
 *  Add your own company here: RULESETS['yourcompany'] = { uk: yourUK, us: yourUS }. */
const RULESETS: Record<string, { uk: Ruleset; us: Ruleset }> = {
  example: { uk: exampleUK, us: exampleUS },
}

// ── Checker ──────────────────────────────────────────────────────────────────
function wordRe(term: string): RegExp {
  // phrase match with word-ish boundaries; escape regex chars
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, 'i')
}

/** Scan generated content against a ruleset. Returns blocks/warnings + which mandated
 *  disclaimers are required and which are missing. */
export function checkMlmContent(text: string, ruleset: Ruleset = defaultRuleset): ComplianceResult {
  const blocks: Violation[] = [], warnings: Violation[] = []
  const push = (v: Violation) => (v.severity === 'block' ? blocks : warnings).push(v)

  for (const bt of ruleset.bannedTerms) {
    if (wordRe(bt.term).test(text)) push({ kind: 'banned-term', severity: bt.severity, match: bt.term, detail: `Banned ${bt.category} term` })
  }
  const lower = text.toLowerCase()
  for (const h of ruleset.bannedHashtags) {
    if (lower.includes(h.toLowerCase())) push({ kind: 'banned-hashtag', severity: 'block', match: h, detail: 'Non-compliant hashtag' })
  }
  for (const c of ruleset.claimPatterns) {
    const m = text.match(c.re)
    if (m) push({ kind: 'claim', severity: c.severity, match: m[0].trim(), detail: c.reason })
  }

  const requiredDisclaimers = ruleset.disclaimers.filter(d => d.triggers.test(text))
  const missingDisclaimers = requiredDisclaimers.filter(d => !text.toUpperCase().includes(d.text.toUpperCase().slice(0, 28)))

  return { ok: blocks.length === 0, blocks, warnings, requiredDisclaimers, missingDisclaimers }
}

/** Append any mandated disclaimers that aren't already present. */
export function injectDisclaimers(text: string, result: ComplianceResult): string {
  if (!result.missingDisclaimers.length) return text
  const block = result.missingDisclaimers.map(d => d.text).join('\n')
  return `${text.trim()}\n\n— — —\n${block}`
}

/** Resolve the applicable ruleset for a client (null = not an MLM/consultant client).
 *  `clients.mlm_company` selects the registered company; `clients.mlm_market` ('uk'|'us')
 *  picks the variant and defaults to UK (strictest) when unset. */
export function rulesetForClient(client: any): Ruleset | null {
  const c = String(client?.mlm_company || '').toLowerCase().trim()
  const entry = RULESETS[c]
  if (!entry) return null
  const market = String(client?.mlm_market || 'uk').toLowerCase().trim()
  return market === 'us' ? entry.us : entry.uk
}

export interface CompliantResult { text: string; blocked: boolean; reason?: string; compliance: ComplianceResult | null; attempts: number }

/** Generate content through the compliance gate: guard the prompt, scan the output,
 *  retry once feeding the violations back, then inject any mandated disclaimers.
 *  Non-MLM clients pass straight through. Import is local to avoid a cycle. */
export async function generateCompliant(client: any, opts: { system?: string; prompt: string; max_tokens?: number; temperature?: number }): Promise<CompliantResult> {
  const { generate } = await import('./llm.js')
  const ruleset = rulesetForClient(client)
  if (!ruleset) { const r = await generate(client, opts); return { text: r.text.trim(), blocked: false, compliance: null, attempts: 1 } }

  const system = `${opts.system || ''}${mlmGuardPrompt(ruleset)}`
  let prompt = opts.prompt
  let text = '', compliance: ComplianceResult | null = null, attempts = 0
  for (attempts = 1; attempts <= 2; attempts++) {
    const r = await generate(client, { ...opts, system, prompt })
    text = r.text.trim()
    if (/^\s*COMPLIANCE_BLOCK:/i.test(text)) return { text, blocked: true, reason: text, compliance: null, attempts }
    compliance = checkMlmContent(text, ruleset)
    if (compliance.ok) break
    const issues = compliance.blocks.map(b => `- "${b.match}" — ${b.detail}`).join('\n')
    prompt = `${opts.prompt}\n\nYour previous draft was BLOCKED for these compliance violations:\n${issues}\n\nRewrite it FULLY COMPLIANT — remove every flagged phrase and any similar claim, keep it natural and on-topic. Output only the rewritten post.`
  }
  if (compliance && !compliance.ok) return { text, blocked: true, compliance, attempts } // still failing after retry → human review
  text = injectDisclaimers(text, compliance!)
  compliance = checkMlmContent(text, ruleset) // re-scan final text so the report reflects the injected disclaimers
  return { text, blocked: false, compliance, attempts }
}

/** System-prompt guard injected into generation so the model self-censors up front. */
export function mlmGuardPrompt(ruleset: Ruleset = defaultRuleset): string {
  return `

${ruleset.company.toUpperCase()} COMPLIANCE — NON-NEGOTIABLE (this is direct-selling marketing; these rules override all else):
- You are writing for an Independent Consultant. NEVER make income/earnings/lifestyle claims (no "financial freedom", "passive income", "replace your salary", "six figures", guaranteed or typical earnings).
- NEVER make medical/health claims: no treating/curing/preventing any disease or condition; no implying a product replaces medication.
- NEVER compare to or mention weight-loss drugs (GLP-1, Ozempic, Wegovy, semaglutide, tirzepatide, Mounjaro). In the UK this is prohibited.
- NEVER state a rate or amount of weight loss (no "lost X kg / in Y weeks").
- NEVER imply third-party endorsement (NHS/FDA/MHRA/doctors/dermatologists).
- Do NOT use the company's trademarks/logos beyond identifying the consultant; do NOT imply you are "official" or speaking on behalf of the company.
- Write genuinely helpful, honest, non-hyped wellness/lifestyle content in the consultant's own voice.
If you cannot write a compliant version, reply with exactly: COMPLIANCE_BLOCK: <reason>.`
}
