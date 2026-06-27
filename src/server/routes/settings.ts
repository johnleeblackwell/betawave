/**
 * Instance settings — BYO API keys. Owner-only (operators are blocked from
 * non-client /api paths by operatorGuard). Never returns plaintext keys.
 */
import { Router } from 'express'
import { PROVIDERS, statusAll, setSecret, deleteSecret, getStoredSecret } from '../services/secrets.js'

export const settingsRouter = Router()

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
