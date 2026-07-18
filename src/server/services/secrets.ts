/**
 * BYO-key secret store — lets a βWave install hold its OWN provider API keys
 * (entered in Settings) instead of relying on .env. Powers the "bring your own
 * keys" promise: install βWave, paste your keys, you pay the provider directly.
 *
 * SECURITY: keys are encrypted at rest (AES-256-GCM) with a master key derived
 * from a server secret that is NOT stored in the DB — so the DB (and its Google
 * Drive backups) never contain plaintext keys. At boot/save, the decrypted value
 * is pushed into process.env so every existing service picks it up unchanged
 * (DB value overrides .env; falls back to the original .env if unset/cleared).
 */
import crypto from 'crypto'
import db from '../db.js'

db.prepare(`CREATE TABLE IF NOT EXISTS app_secrets (
  name TEXT PRIMARY KEY, value_enc TEXT NOT NULL, updated_at INTEGER DEFAULT (unixepoch())
)`).run()

export const PROVIDERS: Record<string, { env: string; label: string; kind: 'key' | 'url' }> = {
  anthropic:       { env: 'ANTHROPIC_API_KEY',  label: 'Anthropic (Claude)',                     kind: 'key' },
  openai:          { env: 'OPENAI_API_KEY',     label: 'OpenAI (ChatGPT / DALL·E)',              kind: 'key' },
  perplexity:      { env: 'PERPLEXITY_API_KEY', label: 'Perplexity',                             kind: 'key' },
  gemini:          { env: 'GEMINI_API_KEY',     label: 'Google Gemini',                          kind: 'key' },
  ollama:          { env: 'OLLAMA_BASE_URL',    label: 'Ollama (local inference) URL',           kind: 'url' },
  custom_base_url: { env: 'CUSTOM_LLM_BASE_URL', label: 'Custom LLM — base URL',                kind: 'url' },
  custom_api_key:  { env: 'CUSTOM_LLM_API_KEY',  label: 'Custom LLM — API key',                 kind: 'key' },
  custom_model:    { env: 'CUSTOM_LLM_MODEL',    label: 'Custom LLM — model name (e.g. glm-4)', kind: 'url' },
  // Email finders — bring your own key, you pay the provider directly.
  // Apollo works from a LinkedIn URL (what Discovery captures); Hunter needs a
  // company domain + name, so it's the fallback when a domain is known.
  apollo:          { env: 'APOLLO_API_KEY',      label: 'Apollo.io — email finder (LinkedIn URL)', kind: 'key' },
  hunter:          { env: 'HUNTER_API_KEY',      label: 'Hunter.io — email finder + verifier (domain)', kind: 'key' },
}

// Capture .env defaults at module load so clearing a BYO key reverts to .env.
const ENV_DEFAULTS: Record<string, string | undefined> = {}
for (const p of Object.values(PROVIDERS)) ENV_DEFAULTS[p.env] = process.env[p.env]

function masterKey(): Buffer {
  const secret = process.env.BWAVE_SECRET || process.env.APP_PASSWORD || process.env.ANTHROPIC_API_KEY || 'bwave-dev-secret'
  return crypto.scryptSync(secret, 'bwave-secrets-v1', 32)
}
function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', masterKey(), iv)
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':')
}
function decrypt(blob: string): string | null {
  try {
    const [iv, tag, enc] = blob.split(':').map(x => Buffer.from(x, 'base64'))
    const d = crypto.createDecipheriv('aes-256-gcm', masterKey(), iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8')
  } catch { return null }
}

export function getStoredSecret(provider: string): string | null {
  const row = db.prepare(`SELECT value_enc FROM app_secrets WHERE name=?`).get(provider) as { value_enc?: string } | undefined
  return row?.value_enc ? decrypt(row.value_enc) : null
}

function applyToEnv(provider: string): void {
  const cfg = PROVIDERS[provider]; if (!cfg) return
  const stored = getStoredSecret(provider)
  if (stored) process.env[cfg.env] = stored
  else if (ENV_DEFAULTS[cfg.env] !== undefined) process.env[cfg.env] = ENV_DEFAULTS[cfg.env]
  else delete process.env[cfg.env]
}

export function setSecret(provider: string, value: string): void {
  if (!PROVIDERS[provider]) throw new Error('unknown provider')
  db.prepare(`INSERT INTO app_secrets (name, value_enc, updated_at) VALUES (?,?,unixepoch())
              ON CONFLICT(name) DO UPDATE SET value_enc=excluded.value_enc, updated_at=unixepoch()`)
    .run(provider, encrypt(value))
  applyToEnv(provider)   // live — no restart needed
}
export function deleteSecret(provider: string): void {
  db.prepare(`DELETE FROM app_secrets WHERE name=?`).run(provider)
  applyToEnv(provider)   // reverts to the .env default (or unsets)
}

/** Push all stored BYO keys into process.env. Call once at boot. */
export function loadKeysIntoEnv(): void {
  let n = 0
  for (const p of Object.keys(PROVIDERS)) { const s = getStoredSecret(p); if (s) { process.env[PROVIDERS[p].env] = s; n++ } }
  if (n) console.log(`[secrets] loaded ${n} BYO key(s) into env`)
}

const mask = (v: string) => !v ? '' : (v.length <= 8 ? '••••' : '••••' + v.slice(-4))

/** Masked status for the UI — never returns plaintext. */
export function statusAll() {
  return Object.entries(PROVIDERS).map(([provider, cfg]) => {
    const stored = getStoredSecret(provider)
    const envVal = ENV_DEFAULTS[cfg.env]
    if (stored) return { provider, label: cfg.label, kind: cfg.kind, set: true, source: 'byo', hint: mask(stored) }
    if (envVal)  return { provider, label: cfg.label, kind: cfg.kind, set: true, source: 'env', hint: mask(envVal) }
    return { provider, label: cfg.label, kind: cfg.kind, set: false, source: 'none', hint: '' }
  })
}
