// Anthropic engine wrapper for the Citation Tracker.
// Uses claude-opus-4-6 — the most capable model for surfacing brand knowledge
// from training data. Queries are sent as plain user messages with no
// system prompt, so the response reflects the model's natural "consumer" voice.
import { getClient } from '../claude.js'
import type { EngineResponse } from './types.js'
import type { TextBlock } from '@anthropic-ai/sdk/resources/messages.js'

const MODEL = 'claude-opus-4-6'

// £ per 1K tokens. Update when Anthropic changes pricing.
const RATES = {
  input_per_1k_gbp: 0.012,
  output_per_1k_gbp: 0.012,
}

export async function query(text: string): Promise<EngineResponse> {
  const start = Date.now()

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: text }],
  })

  const latency_ms = Date.now() - start
  const raw = response.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')

  const input_tokens = response.usage.input_tokens
  const output_tokens = response.usage.output_tokens
  const cost_gbp =
    (input_tokens / 1000) * RATES.input_per_1k_gbp +
    (output_tokens / 1000) * RATES.output_per_1k_gbp

  return { raw, model: MODEL, input_tokens, output_tokens, cost_gbp, latency_ms, http_status: 200 }
}
