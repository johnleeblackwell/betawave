// @ts-nocheck
// OpenAI engine wrapper for the Citation Tracker.
// Uses gpt-4o-search-preview — a search-grounded model that surfaces
// current web results, giving a more realistic picture of how ChatGPT
// with browsing would respond to a consumer query about our tracked brand.
// Uses plain fetch (no openai npm package needed).
import type { EngineResponse } from './types.js'

const MODEL = 'gpt-4o-search-preview'

// £ per 1K tokens. Update when OpenAI changes pricing.
const RATES = {
  input_per_1k_gbp: 0.002,   // ~$2.50/M at £0.80/$
  output_per_1k_gbp: 0.008,  // ~$10/M at £0.80/$
}

export async function query(text: string): Promise<EngineResponse> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')

  const start = Date.now()
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
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
    console.error(`[openai] HTTP ${res.status}: ${errText.slice(0, 200)}`)
    return { raw: '', model: MODEL, input_tokens: 0, output_tokens: 0, cost_gbp: 0, latency_ms, http_status: res.status }
  }

  const data = await res.json()
  const raw: string = data.choices?.[0]?.message?.content ?? ''
  const input_tokens: number = data.usage?.prompt_tokens ?? 0
  const output_tokens: number = data.usage?.completion_tokens ?? 0
  const cost_gbp =
    (input_tokens / 1000) * RATES.input_per_1k_gbp +
    (output_tokens / 1000) * RATES.output_per_1k_gbp

  return { raw, model: MODEL, input_tokens, output_tokens, cost_gbp, latency_ms, http_status: res.status }
}
