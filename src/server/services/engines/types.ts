// Shared return shape for all citation-tracker engine wrappers.
// Every wrapper returns one of these regardless of which provider it calls.
export interface EngineResponse {
  raw: string           // Full text of the AI response
  model: string         // Exact model identifier used
  input_tokens: number
  output_tokens: number
  cost_gbp: number      // Calculated from RATES constant in each wrapper
  latency_ms: number    // Wall-clock time for the API round trip
  http_status: number   // HTTP status code (0 if a non-HTTP error occurred)
  sources?: string[]    // Cited source URLs the engine returned (Perplexity etc.) — the off-domain footprint
}
