// Citation Tracker — multi-engine orchestrator.
// Runs a query across one or more AI engines in parallel and returns partial
// results on per-engine failure rather than throwing. Retries 5xx errors
// once (2 s delay) before marking the engine as failed for this query.
import { query as anthropicQuery } from './anthropic.js'
import { query as openaiQuery } from './openai.js'
import { query as perplexityQuery } from './perplexity.js'
import { query as geminiQuery } from './gemini.js'
import type { EngineResponse } from './types.js'

export type { EngineResponse }
export type EngineName = 'anthropic' | 'openai' | 'perplexity' | 'gemini'

export interface EngineResult extends EngineResponse {
  engine: EngineName
  error?: string
}

const ENGINE_FNS: Record<EngineName, (text: string) => Promise<EngineResponse>> = {
  anthropic: anthropicQuery,
  openai: openaiQuery,
  perplexity: perplexityQuery,
  gemini: geminiQuery,
}

const ALL_ENGINES: EngineName[] = ['anthropic', 'openai', 'perplexity', 'gemini']

// Per-call ceiling. A hung engine fetch must not stall the whole (sequential) run —
// it gets rejected here, caught below, and recorded as a failed engine for this query.
const CALL_TIMEOUT_MS = 90_000

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ])
}

/**
 * Run `text` across the requested engines in parallel.
 * Returns one result per engine — failed engines get { error, raw: '', ... }
 * rather than rejecting the whole call. The caller decides what to do with
 * partial results (citation_runs.status = 'partial' when any engine fails).
 */
export async function runQueryAcrossEngines(
  text: string,
  engines: EngineName[] = ALL_ENGINES,
): Promise<EngineResult[]> {
  return Promise.all(
    engines.map(async (engine) => {
      try {
        const fn = ENGINE_FNS[engine]
        let result = await withTimeout(fn(text), CALL_TIMEOUT_MS, engine)

        // Retry once on server error
        if (result.http_status >= 500) {
          console.warn(`[engines] ${engine} returned ${result.http_status} — retrying in 2s`)
          await delay(2000)
          result = await withTimeout(fn(text), CALL_TIMEOUT_MS, engine)
        }

        return { ...result, engine }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[engines] ${engine} threw: ${message}`)
        return {
          engine,
          raw: '',
          model: engine,
          input_tokens: 0,
          output_tokens: 0,
          cost_gbp: 0,
          latency_ms: 0,
          http_status: 0,
          error: message,
        } satisfies EngineResult
      }
    }),
  )
}

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}
