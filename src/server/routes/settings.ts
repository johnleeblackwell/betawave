/**
 * Instance settings — BYO API keys. Owner-only (operators are blocked from
 * non-client /api paths by operatorGuard). Never returns plaintext keys.
 */
import { Router } from 'express'
import db from '../db.js'
import { PROVIDERS, statusAll, setSecret, deleteSecret, getStoredSecret } from '../services/secrets.js'

export const settingsRouter = Router()

/**
 * GET /api/settings/llm-usage?days=30 — what generation actually cost.
 *
 * Reads the `llm_usage` ledger written by services/llm.ts. Failures are counted
 * separately rather than dropped: a spike in `failed` is how a provider hitting
 * its spend cap shows up here before anyone notices the output got worse.
 */
settingsRouter.get('/llm-usage', (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? '30'), 10) || 30, 1), 365)
  const since = Math.floor(Date.now() / 1000) - days * 86400

  const totals = db.prepare(`
    SELECT COUNT(*) AS calls,
           SUM(ok = 0) AS failed,
           COALESCE(SUM(tokens_in), 0)  AS tokens_in,
           COALESCE(SUM(tokens_out), 0) AS tokens_out,
           COALESCE(SUM(cost_gbp), 0)   AS cost_gbp
    FROM llm_usage WHERE created_at >= ?
  `).get(since)

  const group = (col: string) => db.prepare(`
    SELECT ${col} AS key, COUNT(*) AS calls, SUM(ok = 0) AS failed,
           COALESCE(SUM(cost_gbp), 0) AS cost_gbp
    FROM llm_usage WHERE created_at >= ?
    GROUP BY ${col} ORDER BY cost_gbp DESC
  `).all(since)

  res.json({
    days,
    totals,
    by_model:   group('model'),
    by_purpose: group('purpose'),
    by_client:  group('client_id'),
    by_day: db.prepare(`
      SELECT date(created_at, 'unixepoch') AS day, COUNT(*) AS calls,
             COALESCE(SUM(cost_gbp), 0) AS cost_gbp
      FROM llm_usage WHERE created_at >= ?
      GROUP BY day ORDER BY day DESC
    `).all(since),
    recent_errors: db.prepare(`
      SELECT created_at, purpose, requested_provider, error
      FROM llm_usage WHERE ok = 0 AND created_at >= ?
      ORDER BY created_at DESC LIMIT 10
    `).all(since),
  })
})

/** GET /api/settings/keys — masked status of every provider */
settingsRouter.get('/keys', (_req, res) => res.json({ providers: statusAll() }))

/** PUT /api/settings/keys/:provider — set/replace a BYO key (live) */
settingsRouter.put('/keys/:provider', (req, res) => {
  const { provider } = req.params
  const value = (req.body?.value ?? '').toString().trim()
  if (!PROVIDERS[provider]) return res.status(400).json({ error: 'unknown provider' })
  if (!value) return res.status(400).json({ error: 'value required' })
  setSecret(provider, value)
  res.json({ ok: true })
})

/** DELETE /api/settings/keys/:provider — clear BYO key (revert to .env) */
settingsRouter.delete('/keys/:provider', (req, res) => {
  if (!PROVIDERS[req.params.provider]) return res.status(400).json({ error: 'unknown provider' })
  deleteSecret(req.params.provider)
  res.json({ ok: true })
})

/** POST /api/settings/keys/:provider/test — validate the active key with a cheap call */
settingsRouter.post('/keys/:provider/test', async (req, res) => {
  const { provider } = req.params
  const cfg = PROVIDERS[provider]
  if (!cfg) return res.status(400).json({ error: 'unknown provider' })
  const key = getStoredSecret(provider) ?? process.env[cfg.env]
  if (!key) return res.json({ ok: false, message: 'No key set' })
  try { res.json(await testProvider(provider, key)) }
  catch (e: any) { res.json({ ok: false, message: e.message }) }
})

async function testProvider(provider: string, key: string): Promise<{ ok: boolean; message: string }> {
  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } })
    return { ok: r.ok, message: r.ok ? 'Anthropic key valid ✓' : (r.status === 401 ? 'Invalid key' : `HTTP ${r.status}`) }
  }
  if (provider === 'openai') {
    const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } })
    return { ok: r.ok, message: r.ok ? 'OpenAI key valid ✓' : (r.status === 401 ? 'Invalid key' : `HTTP ${r.status}`) }
  }
  if (provider === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`)
    return { ok: r.ok, message: r.ok ? 'Gemini key valid ✓' : (r.status === 400 || r.status === 403 ? 'Invalid key' : `HTTP ${r.status}`) }
  }
  if (provider === 'perplexity') {
    const r = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
    })
    return { ok: r.ok, message: r.ok ? 'Perplexity key valid ✓' : (r.status === 401 ? 'Invalid key' : `HTTP ${r.status}`) }
  }
  if (provider === 'ollama') {
    const base = key.replace(/\/+$/, '')
    const r = await fetch(`${base}/api/tags`)
    return { ok: r.ok, message: r.ok ? 'Ollama reachable ✓' : `HTTP ${r.status}` }
  }
  return { ok: false, message: 'No test available' }
}
