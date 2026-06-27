/**
 * LLM provider abstraction (multi-tenant, multi-provider).
 *
 * Used for **content generation** (page copy, email drafts, PDF narrative).
 * NOT used for citation probes — those must hit the real consumer engines
 * (Anthropic/OpenAI/Perplexity/Gemini) directly so the data reflects what
 * actual users see. See services/citation-tracker.ts for that path.
 *
 * Each client can configure their own provider for cost control:
 *   - anthropic  (Claude Haiku 4.5 default — premium quality, ~£0.80/M tokens)
 *   - deepseek   (DeepSeek V3 — OpenAI-compatible, ~£0.15/M tokens, China-hosted)
 *   - qwen       (Qwen 2.5 72B via OpenRouter — ~£0.40/M tokens)
 *   - ollama     (local — zero API cost, requires base_url to local instance)
 *   - openai     (gpt-4o-mini default — ~£0.15/M tokens, US-hosted)
 *
 * If a client hasn't configured anything, falls back to env defaults.
 */

import { getClient } from './claude.js'
import type { TextBlock } from '@anthropic-ai/sdk/resources/messages.js'

export type LLMProvider = 'anthropic' | 'deepseek' | 'qwen' | 'ollama' | 'openai' | 'zen' | 'custom'

export interface ClientLLMConfig {
  llm_content_provider?: string
  llm_content_model?: string
  llm_content_api_key?: string
  llm_content_base_url?: string
}

export interface GenerateOpts {
  system?: string
  prompt: string
  max_tokens?: number
  temperature?: number
}

export interface GenerateResult {
  text: string
  tokens_in: number
  tokens_out: number
  provider: LLMProvider
  model: string
  cost_gbp: number
}

// Cost per million tokens (input, output) in GBP. Approximate Q2 2026.
const COST_PER_M: Record<LLMProvider, [number, number]> = {
  anthropic: [0.65, 3.20],     // Haiku 4.5
  deepseek:  [0.12, 0.18],     // V3
  qwen:      [0.30, 0.40],     // 2.5 72B via OpenRouter
  openai:    [0.12, 0.50],     // gpt-4o-mini
  ollama:    [0.00, 0.00],     // local
  zen:       [0.00, 0.00],     // opencode Big Pickle — free during stealth
  custom:    [0.00, 0.00],     // user-supplied — cost unknown
}

const DEFAULT_MODEL: Record<LLMProvider, string> = {
  anthropic: 'claude-haiku-4-5',
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

function resolveProvider(client: ClientLLMConfig | null | undefined): {
  provider: LLMProvider
  model: string
  apiKey: string
  baseURL: string
} {
  const provider = ((client?.llm_content_provider || process.env.LLM_CONTENT_PROVIDER || 'anthropic')
                    .toLowerCase() as LLMProvider)
  const model    = client?.llm_content_model    || process.env.LLM_CONTENT_MODEL    || DEFAULT_MODEL[provider]
  const baseURL  = client?.llm_content_base_url || process.env.LLM_CONTENT_BASE_URL || DEFAULT_BASE_URL[provider]
  const apiKey   = client?.llm_content_api_key  || providerEnvKey(provider)         || ''
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

/** True when the error looks like Anthropic's 529 overloaded response. */
function isAnthropicOverloaded(e: any): boolean {
  if (e?.status === 529) return true
  const msg: string = e?.message || ''
  return msg.includes('529') || msg.toLowerCase().includes('overloaded_error') || msg.toLowerCase().includes('overloaded')
}

/** One-shot completion. Returns text + token usage + estimated GBP cost. */
export async function generate(client: ClientLLMConfig | null, opts: GenerateOpts): Promise<GenerateResult> {
  const { provider, model, apiKey, baseURL } = resolveProvider(client)
  const max_tokens = opts.max_tokens ?? 2000
  const temperature = opts.temperature ?? 0.7

  if (provider === 'anthropic') {
    if (!apiKey) throw new Error('Anthropic API key not configured')
    try {
      const r = await getClient(apiKey).messages.create({
        model,
        max_tokens,
        temperature,
        system: opts.system,
        messages: [{ role: 'user', content: opts.prompt }],
      })
      const text = r.content.filter((b): b is TextBlock => b.type === 'text').map(b => b.text).join('')
      const ti = r.usage.input_tokens
      const to = r.usage.output_tokens
      return {
        text, tokens_in: ti, tokens_out: to, provider, model,
        cost_gbp: (ti * COST_PER_M.anthropic[0] + to * COST_PER_M.anthropic[1]) / 1_000_000,
      }
    } catch (e: any) {
      const zenKey = process.env.OPENCODE_ZEN_API_KEY
      if (isAnthropicOverloaded(e) && zenKey) {
        console.warn('[llm] Anthropic overloaded — falling back to Big Pickle (opencode zen)')
        return generateOpenAICompat({
          provider: 'zen',
          model: DEFAULT_MODEL.zen,
          apiKey: zenKey,
          baseURL: DEFAULT_BASE_URL.zen,
        }, opts, max_tokens, temperature)
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
  const [costIn, costOut] = COST_PER_M[provider]
  return {
    text, tokens_in: ti, tokens_out: to, provider, model,
    cost_gbp: (ti * costIn + to * costOut) / 1_000_000,
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
    })
    return { ok: true, latency_ms: Date.now() - start, result }
  } catch (e: any) {
    return { ok: false, latency_ms: Date.now() - start, error: e.message }
  }
}
