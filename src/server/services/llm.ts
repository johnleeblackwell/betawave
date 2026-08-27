/**
 * LLM provider abstraction (multi-tenant, multi-provider).
 *
 * Used for **content generation** (page copy, email drafts, PDF narrative).
 * NOT used for citation probes — those must hit the real consumer engines
 * (Anthropic/OpenAI/Perplexity/Gemini) directly so the data reflects what
 * actual users see. See services/citation-tracker.ts for that path.
 *
 * Every completion is written to the `llm_usage` ledger (successes and failures
 * both) so spend is answerable from inside βWave rather than only from the
 * provider's dashboard. See routes/settings.ts for the summary endpoint.
 *
 * Each client can configure their own provider for cost control:
 *   - anthropic  (Claude Opus 4.8 default — top quality, ~£4/£20 per M tokens)
 *   - deepseek   (DeepSeek V3 — OpenAI-compatible, ~£0.15/M tokens, China-hosted)
 *   - qwen       (Qwen 2.5 72B via OpenRouter — ~£0.40/M tokens)
 *   - ollama     (local — zero API cost, requires base_url to local instance)
 *   - openai     (gpt-4o-mini default — ~£0.15/M tokens, US-hosted)
 *
 * If a client hasn't configured anything, falls back to env defaults.
 *
 * ⚠️ CHOOSING A PROVIDER IS A DATA-PROTECTION DECISION, NOT JUST A COST ONE.
 * Some calls carry third-party personal data (the pitch drafter sends prospect
 * names, headlines and their own post text). For those, only use providers you
 * can name in a privacy policy, contract with as a processor, and that do not
 * train on input. Anything free is usually paid for in data. See the `zen`
 * entry below for a worked example of what not to use.
 */

import db from '../db.js'
import { assertWithinBudget } from './spend-guard.js'
import { getClient } from './claude.js'
import type { TextBlock } from '@anthropic-ai/sdk/resources/messages.js'

export type LLMProvider = 'anthropic' | 'deepseek' | 'qwen' | 'ollama' | 'openai' | 'zen' | 'custom'

export interface ClientLLMConfig {
  /** Present on real client rows; used only to attribute usage. */
  id?: string
  llm_content_provider?: string
  llm_content_model?: string
  llm_content_api_key?: string
  llm_content_base_url?: string
}

export interface GenerateOpts {
  system?: string
  prompt: string
  max_tokens?: number
  /** Ignored on Claude Opus 4.7+ / Sonnet 5 / Fable 5 — see acceptsSampling(). */
  temperature?: number
  /** Free-text label for the usage ledger, e.g. 'pitch', 'content', 'syndication'. */
  purpose?: string
  /** Override the client's configured model for THIS call only.
   *
   *  Exists so one high-value, low-volume job can use a stronger (pricier)
   *  model without dragging every other call for that client onto it — the
   *  client-level setting applies to unattended jobs too (the syndication
   *  scheduler, respond drafts), several of which are tuned around tight
   *  max_tokens budgets that a reasoning model would blow straight through.
   *  Provider/key/baseURL still come from the client, so this only makes
   *  sense for a model the configured provider actually serves. */
  model?: string
  /** Links the usage row to the specific `content` row it produced, so its cost
   *  can be shown against that piece in the Content list. Omit when the call
   *  isn't producing one specific saved piece (e.g. the pitch drafter). */
  contentId?: string
}

export interface GenerateResult {
  text: string
  tokens_in: number
  tokens_out: number
  provider: LLMProvider
  model: string
  cost_gbp: number
  cost_usd: number
}

// Cost per million tokens (input, output) in GBP. Approximate Q3 2026.
export const USD_TO_GBP = 0.79

/** Published list price in USD per 1M tokens, [input, output]. Kept in USD
 *  because that's how the providers quote it — converting once, here, beats
 *  maintaining pre-converted numbers nobody can check against a price page. */
const COST_PER_M_USD: Record<LLMProvider, [number, number]> = {
  anthropic: [5.00, 25.00],    // Opus tier — see ANTHROPIC_MODEL_COST_USD
  deepseek:  [0.15, 0.23],     // V3
  qwen:      [0.38, 0.51],     // 2.5 72B via OpenRouter
  openai:    [0.15, 0.60],     // gpt-4o-mini
  ollama:    [0.00, 0.00],     // local
  // ⚠️ opencode zen "Big Pickle" — FREE BUT TRAINS ON YOUR INPUT. Their docs:
  // "collected data may be used to improve the model", and the sibling free
  // model warns "Do not submit personal or confidential data". Removed from the
  // automatic fallback cascade 2026-07-22. Still selectable for a self-hoster
  // who explicitly wants it on their OWN content — never for anything carrying
  // third-party personal data (pitch, enrich, outreach).
  zen:       [0.00, 0.00],
  custom:    [0.00, 0.00],     // user-supplied — cost unknown
}

/** Anthropic prices vary sharply BY MODEL — Fable 5 is double Opus, Haiku is a
 *  fifth of it. Pricing per-provider alone silently under-reported every Fable 5
 *  call by 2x, which matters now that one route deliberately runs a pricier
 *  model. Prefix-matched so dated variants (…-20260514) resolve too; first
 *  match wins, so keep the more specific patterns above the general ones. */
const ANTHROPIC_MODEL_COST_USD: [RegExp, [number, number]][] = [
  [/^claude-(fable|mythos)-5/, [10.00, 50.00]],
  [/^claude-opus/,             [ 5.00, 25.00]],
  [/^claude-sonnet/,           [ 3.00, 15.00]],
  [/^claude-haiku/,            [ 1.00,  5.00]],
]

function ratesUsd(provider: LLMProvider, model?: string): [number, number] {
  if (provider === 'anthropic' && model) {
    const hit = ANTHROPIC_MODEL_COST_USD.find(([re]) => re.test(model))
    if (hit) return hit[1]
  }
  return COST_PER_M_USD[provider] ?? COST_PER_M_USD.custom
}

const DEFAULT_MODEL: Record<LLMProvider, string> = {
  anthropic: 'claude-opus-4-8',
  deepseek:  'deepseek-chat',
  qwen:      'qwen/qwen-2.5-72b-instruct',
  openai:    'gpt-4o-mini',
  ollama:    'llama3.3',
  zen:       'big-pickle',
  custom:    process.env.CUSTOM_LLM_MODEL || 'gpt-3.5-turbo',
}

const DEFAULT_BASE_URL: Record<LLMProvider, string> = {
  anthropic: '',                                   // SDK handles
  deepseek:  'https://api.deepseek.com/v1',
  qwen:      'https://openrouter.ai/api/v1',
  openai:    'https://api.openai.com/v1',
  ollama:    'http://localhost:11434/v1',
  zen:       'https://opencode.ai/zen/v1',
  custom:    process.env.CUSTOM_LLM_BASE_URL || '',
}

/** Which provider owns a model name. Undefined when the name is unfamiliar. */
function providerForModel (model: string): LLMProvider | undefined {
  if (/^claude/i.test(model)) return 'anthropic'
  if (/^(gpt|o[1345])[-.]?/i.test(model)) return 'openai'
  if (/^deepseek/i.test(model)) return 'deepseek'
  if (/^qwen/i.test(model)) return 'qwen'
  return undefined
}

function resolveProvider(client: ClientLLMConfig | null | undefined, modelOverride?: string): {
  provider: LLMProvider
  model: string
  apiKey: string
  baseURL: string
} {
  const clientProvider = ((client?.llm_content_provider || process.env.LLM_CONTENT_PROVIDER || 'anthropic')
                    .toLowerCase() as LLMProvider)

  /**
   * A model override implies its provider.
   *
   * Callers could previously override the MODEL but not the PROVIDER, so asking
   * an Anthropic-configured client for 'gpt-4o-mini' sent that name to
   * Anthropic and got an unknown-model error. That made per-call model choice
   * useless for anything but staying inside one vendor — and the pitch split
   * needs to move between two.
   *
   * The model name already says who owns it, so infer rather than thread a
   * second parameter through every call site. An unrecognised name changes
   * nothing and falls through to the client's own provider, which keeps
   * self-hosters on Ollama and custom endpoints working untouched.
   */
  const implied = modelOverride ? providerForModel(modelOverride) : undefined
  const provider = implied || clientProvider

  const model    = modelOverride || client?.llm_content_model || process.env.LLM_CONTENT_MODEL || DEFAULT_MODEL[provider]
  // Client-level key/URL belong to the CLIENT's provider. When the model has
  // moved us elsewhere, they are the wrong credentials for the wrong host.
  const sameProvider = provider === clientProvider
  const baseURL  = (sameProvider ? client?.llm_content_base_url : '') || (sameProvider ? process.env.LLM_CONTENT_BASE_URL : '') || DEFAULT_BASE_URL[provider]
  const apiKey   = (sameProvider ? client?.llm_content_api_key : '')  || providerEnvKey(provider) || ''
  return { provider, model, apiKey, baseURL }
}

function providerEnvKey(p: LLMProvider): string {
  switch (p) {
    case 'anthropic': return process.env.ANTHROPIC_API_KEY || ''
    case 'deepseek':  return process.env.DEEPSEEK_API_KEY  || ''
    case 'qwen':      return process.env.OPENROUTER_API_KEY || process.env.QWEN_API_KEY || ''
    case 'openai':    return process.env.OPENAI_API_KEY    || ''
    case 'ollama':    return 'ollama'  // any non-empty string; ollama doesn't auth
    case 'zen':       return process.env.OPENCODE_ZEN_API_KEY || ''
    case 'custom':    return process.env.CUSTOM_LLM_API_KEY || 'custom'
  }
}

/** True when Anthropic is temporarily unusable — either overloaded (529) or the
 *  configured key has hit its usage/quota limit (400 invalid_request_error).
 *  Either way the right move is the same: try the fallback rather than fail. */
function isAnthropicUnavailable(e: any): boolean {
  if (e?.status === 529 || e?.status === 400) {
    const msg: string = e?.message || ''
    const lower = msg.toLowerCase()
    if (lower.includes('529') || lower.includes('overloaded')) return true
    if (lower.includes('usage limit') || lower.includes('quota') || lower.includes('rate limit')) return true
  }
  return false
}

/**
 * Claude Opus 4.7+, Sonnet 5 and Fable 5 REMOVED temperature/top_p/top_k — a
 * request carrying any of them returns 400, it is not silently ignored. Steering
 * on those models is via the prompt. Older Claude models still accept it, as do
 * all the OpenAI-compatible providers, so this is a per-model decision rather
 * than a blanket removal.
 */
function acceptsSampling(model: string): boolean {
  // opus-5 was missing here, so switching the defaults to it turned every
  // draft into a 400 ("`temperature` is deprecated for this model") — the
  // request is rejected outright rather than the parameter being ignored, so
  // the whole pitch route returned an empty message with no obvious cause.
  return !/^claude-(opus-5|opus-4-[678]|sonnet-5|fable-5|mythos-5)/.test(model)
}

const recordUsage = db.prepare(`
  INSERT INTO llm_usage
    (client_id, purpose, requested_provider, provider, model,
     tokens_in, tokens_out, cost_gbp, latency_ms, ok, error, content_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

/** USD cost estimate. Pass `model` on Anthropic — without it every model is
 *  priced as Opus, which under-reports Fable 5 by half. */
export function estimateCostUsd(
  provider: LLMProvider, tokensIn: number, tokensOut: number, model?: string,
): number {
  const [pIn, pOut] = ratesUsd(provider, model)
  return (tokensIn * pIn + tokensOut * pOut) / 1_000_000
}

/** GBP cost estimate for a provider's per-token pricing. Exported so callers
 *  that generate OUTSIDE `generate()` (streaming routes, the agent) can price
 *  their own token counts consistently with the rest of the ledger. */
export function estimateCostGbp(
  provider: LLMProvider, tokensIn: number, tokensOut: number, model?: string,
): number {
  return estimateCostUsd(provider, tokensIn, tokensOut, model) * USD_TO_GBP
}

export interface LogUsageInput {
  clientId?: string
  purpose: string
  provider: LLMProvider
  model: string
  tokensIn: number
  tokensOut: number
  latencyMs?: number
  /** Links this usage row to the `content` row it produced — see GenerateOpts.contentId. */
  contentId?: string
  ok?: boolean
  error?: string
  /**
   * Pre-computed cost, used when the caller knows something this function
   * cannot infer from token counts alone — specifically prompt caching, where
   * cache reads bill at a tenth of the input rate and cache writes at 1.25x.
   * Without this the ledger recomputes from raw tokens and over-reports every
   * cached call, which trips the daily spend guard on money never spent.
   */
  costGbpOverride?: number
}

/** Write one ledger row and return its estimated cost in GBP. For generation
 *  paths that don't go through `generate()` below (the streaming SSE routes,
 *  the in-app agent) — same ledger, same cost math, so every generated piece
 *  of content is accounted for the same way regardless of which code path
 *  produced it. Best-effort: a bookkeeping failure never takes down the
 *  generation that already succeeded. */
export function logUsage(input: LogUsageInput): number {
  const ok = input.ok !== false
  const cost = !ok ? 0
    : input.costGbpOverride != null ? input.costGbpOverride
    : estimateCostGbp(input.provider, input.tokensIn, input.tokensOut, input.model)
  try {
    recordUsage.run(
      input.clientId || '', input.purpose, input.provider, input.provider, input.model,
      input.tokensIn, input.tokensOut, cost, input.latencyMs || 0, ok ? 1 : 0, input.error || '',
      input.contentId || '',
    )
  } catch (logErr: any) {
    console.warn('[llm] usage ledger write failed:', logErr?.message || logErr)
  }
  return cost
}

/**
 * One-shot completion. Returns text + token usage + estimated GBP cost, and
 * writes a row to `llm_usage` either way — a failed call is the most valuable
 * row in the table when a key hits its cap.
 *
 * Ledger writes are best-effort: a bookkeeping failure must never take down
 * the generation that succeeded.
 */
export async function generate(client: ClientLLMConfig | null, opts: GenerateOpts): Promise<GenerateResult> {
  const started = Date.now()
  const requested = resolveProvider(client).provider

  // Checked before spending, not after. A job that stops gets noticed; one that
  // quietly switches to a cheaper model does not — which is exactly how a
  // premium pitch model ran for a day and a half on the wrong provider without
  // anyone knowing. Deliberately throws rather than degrading.
  assertWithinBudget()

  try {
    const result = await generateInner(client, opts)
    logUsage({
      clientId: client?.id, purpose: opts.purpose || '', provider: result.provider, model: result.model,
      tokensIn: result.tokens_in, tokensOut: result.tokens_out, latencyMs: Date.now() - started,
      contentId: opts.contentId, ok: true,
      // generateInner already priced this correctly, including any cache
      // discount. Recomputing from raw tokens would ignore it.
      costGbpOverride: result.cost_gbp,
    })
    return result
  } catch (e: any) {
    logUsage({
      clientId: client?.id, purpose: opts.purpose || '', provider: requested, model: '',
      tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - started,
      contentId: opts.contentId, ok: false, error: String(e?.message || e).slice(0, 500),
    })
    throw e
  }
}

/**
 * Mark a long system prompt as cacheable.
 *
 * The pitch drafter sends roughly 9,600 input tokens per call, almost all of it
 * the same instructions every time — the rules, the voice guidance, the
 * reference section. At 270 drafts a day that is the same 9,000 tokens
 * transmitted and charged 5,670 times a month.
 *
 * Anthropic bills cache reads at a tenth of the input rate, so marking the
 * system block takes the outreach line from about £326 a month to £96 with no
 * change whatsoever to what the model produces.
 *
 * Two details that matter:
 *   · There is a minimum cacheable prefix (1,024 tokens on this model family).
 *     Below it the marker is ignored and the write costs 1.25x for nothing, so
 *     short prompts are left alone.
 *   · The prompt varies by branch — first touch or follow-up, UK or abroad,
 *     note or DM. Each variant caches separately, which is fine: at this volume
 *     every variant is hit many times inside the cache window.
 */
const CACHE_MIN_CHARS = 1024 * 3.5   // ~1,024 tokens, conservatively

function cacheableSystem (system?: string): any {
  if (!system || system.length < CACHE_MIN_CHARS) return system
  return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
}

async function generateInner(client: ClientLLMConfig | null, opts: GenerateOpts): Promise<GenerateResult> {
  const { provider, model, apiKey, baseURL } = resolveProvider(client, opts.model)
  const max_tokens = opts.max_tokens ?? 2000
  const temperature = opts.temperature ?? 0.7

  if (provider === 'anthropic') {
    if (!apiKey) throw new Error('Anthropic API key not configured')
    try {
      const req: any = {
        model,
        max_tokens,
        system: cacheableSystem(opts.system),
        messages: [{ role: 'user', content: opts.prompt }],
      }
      if (acceptsSampling(model)) req.temperature = temperature
      const r = await getClient(apiKey).messages.create(req)
      const text = r.content.filter((b): b is TextBlock => b.type === 'text').map(b => b.text).join('')

      /**
       * TRUNCATION MUST NOT BE SILENT.
       *
       * A reasoning model spends most of its output budget thinking before it
       * writes, so a long deliberation leaves nothing for the answer and the
       * reply stops mid-word. On 26 August a pitch ran to exactly 2000 output
       * tokens and the message that went to a real prospect ended "My money's
       * on the one with a" — sent, to a stranger, as an advertisement for a
       * marketing product.
       *
       * The API says so plainly in stop_reason and nobody was reading it. A
       * half-written message is not a cheaper message, it is a worse outcome
       * than an error, because an error gets retried and this got sent.
       */
      if ((r as any).stop_reason === 'max_tokens') {
        throw new Error(
          `TRUNCATED: hit the ${max_tokens}-token output ceiling before finishing. ` +
          `Raise max_tokens for this call — the reply was cut off mid-sentence.`)
      }

      /**
       * Cost accounting with caching on.
       *
       * `input_tokens` EXCLUDES anything served from or written to the cache, so
       * costing on it alone would silently under-report every cached call and
       * make the ledger — which is the only spend record that exists — wrong in
       * the flattering direction. Cache writes cost 1.25x input, reads 0.1x.
       */
      const ti = r.usage.input_tokens
      const to = r.usage.output_tokens
      const cWrite = (r.usage as any).cache_creation_input_tokens || 0
      const cRead = (r.usage as any).cache_read_input_tokens || 0
      const billableIn = Math.round(ti + cWrite * 1.25 + cRead * 0.10)

      return {
        text, tokens_in: ti + cWrite + cRead, tokens_out: to, provider, model,
        cost_gbp: estimateCostGbp(provider, billableIn, to, model),
        cost_usd: estimateCostUsd(provider, billableIn, to, model),
      }
    } catch (e: any) {
      // Fallback is OpenAI only, and deliberately so. opencode zen's free
      // "Big Pickle" was removed from this cascade on 2026-07-22: it is a
      // *stealth* model (the operator does not disclose which lab or model it
      // is) whose own docs state "collected data may be used to improve the
      // model". You cannot name an anonymous sub-processor in a privacy policy,
      // cannot sign a processor contract with a codename, and cannot honour an
      // erasure request against training data. This path carries third-party
      // personal data — prospect names, headlines, About text — so a
      // trains-on-input provider is not an acceptable fallback at any price.
      // Do not re-add it here. See STATE.md.
      const openaiKey = process.env.OPENAI_API_KEY
      if (isAnthropicUnavailable(e) && openaiKey) {
        console.warn(`[llm] Anthropic unavailable (${e?.status}) — falling back to OpenAI: ${e?.message || ''}`)
        const fallback = await generateOpenAICompat({
          provider: 'openai',
          model: DEFAULT_MODEL.openai,
          apiKey: openaiKey,
          baseURL: DEFAULT_BASE_URL.openai,
        }, opts, max_tokens, temperature)

        // Never hand back a silent blank — that renders as an empty draft and
        // looks like a bug in the caller rather than a provider failure.
        if (!fallback.text?.trim()) {
          throw new Error('Anthropic unavailable and the OpenAI fallback returned an empty response')
        }
        return fallback
      }
      throw e
    }
  }

  // OpenAI-compatible providers (deepseek, qwen, ollama, openai, zen)
  return generateOpenAICompat({ provider, model, apiKey, baseURL }, opts, max_tokens, temperature)
}

async function generateOpenAICompat(
  cfg: { provider: LLMProvider; model: string; apiKey: string; baseURL: string },
  opts: GenerateOpts,
  max_tokens: number,
  temperature: number,
): Promise<GenerateResult> {
  const { provider, model, apiKey, baseURL } = cfg
  const messages: any[] = []
  if (opts.system) messages.push({ role: 'system', content: opts.system })
  messages.push({ role: 'user', content: opts.prompt })

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey && provider !== 'ollama') headers['Authorization'] = `Bearer ${apiKey}`

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages, max_tokens, temperature }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`${provider} HTTP ${res.status}: ${errText.slice(0, 300)}`)
  }
  const data = await res.json() as any
  const text = data.choices?.[0]?.message?.content || ''
  const ti = data.usage?.prompt_tokens     ?? 0
  const to = data.usage?.completion_tokens ?? 0
  return {
    text, tokens_in: ti, tokens_out: to, provider, model,
    cost_gbp: estimateCostGbp(provider, ti, to, model),
    cost_usd: estimateCostUsd(provider, ti, to, model),
  }
}

/**
 * Simple ping/health check — sends a 5-token prompt and returns latency + cost.
 * Used by the LLM settings UI to verify a provider config works.
 */
export async function ping(client: ClientLLMConfig): Promise<{
  ok: boolean
  latency_ms: number
  result?: GenerateResult
  error?: string
}> {
  const start = Date.now()
  try {
    const result = await generate(client, {
      prompt: 'Say "ok" in one word.',
      max_tokens: 10,
      temperature: 0,
      purpose: 'ping',
    })
    return { ok: true, latency_ms: Date.now() - start, result }
  } catch (e: any) {
    return { ok: false, latency_ms: Date.now() - start, error: e.message }
  }
}
