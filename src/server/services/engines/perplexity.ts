// @ts-nocheck
// Perplexity engine wrapper for the Citation Tracker.
// Uses sonar-pro — Perplexity's flagship online model. Always grounded in
// current web search, so this reflects what Perplexity would tell a consumer
// right now, including recent reviews, rankings, and news about the brand.
// API is OpenAI-compatible, so the request shape is identical to openai.ts.
import type { EngineResponse } from './types.js'

const MODEL = 'sonar-pro'

// £ per 1K tokens. Perplexity sonar-pro pricing at £0.80/$.
// Input: $3/M → £0.0024/1K. Output: $15/M → £0.012/1K.
const RATES = {
  input_per_1k_gbp: 0.0024,
  output_per_1k_gbp: 0.012,
}

export async function query(text: string): Promise<EngineResponse> {
  const apiKey = process.env.PERPLEXITY_API_KEY
  if (!apiKey) throw new Error('PERPLEXITY_API_KEY not set')

  const start = Date.now()
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: text }],
      max_tokens: 1024,
    }),
  })

  const latency_ms = Date.now() - start

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error(`[perplexity] HTTP ${res.status}: ${errText.slice(0, 200)}`)
    return { raw: '', model: MODEL, input_tokens: 0, output_tokens: 0, cost_gbp: 0, latency_ms, http_status: res.status }
  }

  const data = await res.json()
  const raw: string = data.choices?.[0]?.message?.content ?? ''
  const input_tokens: number = data.usage?.prompt_tokens ?? 0
  const output_tokens: number = data.usage?.completion_tokens ?? 0
  const cost_gbp =
    (input_tokens / 1000) * RATES.input_per_1k_gbp +
    (output_tokens / 1000) * RATES.output_per_1k_gbp

  // Cited sources — sonar-pro returns `citations` (URL strings) and/or `search_results` [{url}].
  const sources: string[] = Array.isArray(data.citations) && data.citations.length
    ? data.citations.filter((u: any) => typeof u === 'string')
    : (Array.isArray(data.search_results) ? data.search_results.map((s: any) => s?.url).filter(Boolean) : [])

  return { raw, model: MODEL, input_tokens, output_tokens, cost_gbp, latency_ms, http_status: res.status, sources }
}
