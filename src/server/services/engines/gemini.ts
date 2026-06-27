// @ts-nocheck
// Gemini engine wrapper for the Citation Tracker.
// Uses gemini-2.5-flash (stable v001) with Google Search grounding enabled.
// gemini-2.0-flash, gemini-2.0-flash-lite and gemini-1.5-flash are all
// unavailable to new API users as of May 2026. gemini-2.5-flash is the
// first model listed by ListModels for new accounts.
import type { EngineResponse } from './types.js'

const MODEL = 'gemini-2.5-flash'

// £ per 1K tokens. Gemini 2.5 Flash pricing at £0.80/$.
// Input: $0.15/M → £0.000120/1K. Output: $0.60/M → £0.000480/1K.
// Note: Google Search grounding adds a per-query charge (~$35/1K requests)
// which is not tracked per-token here. Monitor billing separately.
const RATES = {
  input_per_1k_gbp: 0.000120,
  output_per_1k_gbp: 0.000480,
}

export async function query(text: string): Promise<EngineResponse> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not set')

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`

  const start = Date.now()
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text }] }],
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: 1024 },
    }),
  })

  const latency_ms = Date.now() - start

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error(`[gemini] HTTP ${res.status}: ${errText.slice(0, 200)}`)
    return { raw: '', model: MODEL, input_tokens: 0, output_tokens: 0, cost_gbp: 0, latency_ms, http_status: res.status }
  }

  const data = await res.json()
  // Gemini returns content parts — join all text parts
  const raw: string = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p: any) => p.text ?? '')
    .join('')

  const input_tokens: number = data.usageMetadata?.promptTokenCount ?? 0
  const output_tokens: number = data.usageMetadata?.candidatesTokenCount ?? 0
  const cost_gbp =
    (input_tokens / 1000) * RATES.input_per_1k_gbp +
    (output_tokens / 1000) * RATES.output_per_1k_gbp

  return { raw, model: MODEL, input_tokens, output_tokens, cost_gbp, latency_ms, http_status: res.status }
}
