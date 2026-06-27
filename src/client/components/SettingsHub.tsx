import { useState, useEffect } from 'react'
import { useToast } from '../App.tsx'

interface ProviderStatus {
  provider: string; label: string; kind: 'key' | 'url'
  set: boolean; source: 'byo' | 'env' | 'none'; hint: string
}

export default function SettingsHub() {
  const { showToast } = useToast()
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [tested, setTested] = useState<Record<string, { ok: boolean; message: string }>>({})

  const load = async () => {
    const r = await fetch('/api/settings/keys')
    if (r.ok) setProviders((await r.json()).providers || [])
  }
  useEffect(() => { load() }, [])

  const save = async (p: string) => {
    const value = (drafts[p] || '').trim()
    if (!value) { showToast('Enter a value first', 'error'); return }
    setBusy(p)
    try {
      const r = await fetch(`/api/settings/keys/${p}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) })
      if (!r.ok) { showToast('Save failed', 'error'); return }
      showToast('Saved — live now, no restart needed')
      setDrafts(d => ({ ...d, [p]: '' })); setTested(t => ({ ...t, [p]: undefined as any })); load()
    } finally { setBusy(null) }
  }
  const clear = async (p: string) => {
    if (!confirm(`Clear your ${p} key? It will fall back to the server default (if any).`)) return
    await fetch(`/api/settings/keys/${p}`, { method: 'DELETE' })
    showToast('Cleared'); setTested(t => ({ ...t, [p]: undefined as any })); load()
  }
  const test = async (p: string) => {
    setBusy(p)
    try {
      const r = await fetch(`/api/settings/keys/${p}/test`, { method: 'POST' })
      const d = await r.json()
      setTested(t => ({ ...t, [p]: d }))
    } finally { setBusy(null) }
  }

  const badge = (s: ProviderStatus) => {
    if (s.source === 'byo') return <span style={{ background: 'rgba(124,58,237,.15)', color: '#a78bfa', padding: '2px 9px', borderRadius: 999, fontSize: '.72rem', fontWeight: 700 }}>Your key · {s.hint}</span>
    if (s.source === 'env') return <span style={{ background: 'rgba(148,163,184,.15)', color: '#94a3b8', padding: '2px 9px', borderRadius: 999, fontSize: '.72rem', fontWeight: 600 }}>Server default · {s.hint}</span>
    return <span style={{ background: 'rgba(239,68,68,.12)', color: '#f87171', padding: '2px 9px', borderRadius: 999, fontSize: '.72rem', fontWeight: 600 }}>Not set</span>
  }

  return (
    <div className="page-content" style={{ maxWidth: 760 }}>
      <div className="page-header" style={{ paddingLeft: 0 }}>
        <div>
          <div className="page-title">Settings · API keys</div>
          <div className="page-subtitle">Bring your own keys — βWave uses these and you pay the provider directly. Stored encrypted; takes effect immediately.</div>
        </div>
      </div>

      {providers.map(s => (
        <div key={s.provider} style={{ border: '1px solid var(--border, #e5e7eb)', borderRadius: 12, padding: 18, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '1.02rem' }}>{s.label}</strong>
            {badge(s)}
            {tested[s.provider] && (
              <span style={{ marginLeft: 'auto', fontSize: '.8rem', fontWeight: 600, color: tested[s.provider].ok ? '#10b981' : '#f87171' }}>
                {tested[s.provider].message}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              type={s.kind === 'url' ? 'text' : 'password'}
              autoComplete="off"
              placeholder={s.kind === 'url' ? 'http://localhost:11434' : `Paste your ${s.label} key…`}
              value={drafts[s.provider] || ''}
              onChange={e => setDrafts(d => ({ ...d, [s.provider]: e.target.value }))}
              style={{ flex: 1, minWidth: 220, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #d1d5db)' }}
            />
            <button className="btn btn-primary btn-sm" disabled={busy === s.provider} onClick={() => save(s.provider)}>
              {busy === s.provider ? '…' : s.source === 'byo' ? 'Replace' : 'Save'}
            </button>
            <button className="btn btn-secondary btn-sm" disabled={busy === s.provider || !s.set} onClick={() => test(s.provider)}>Test</button>
            {s.source === 'byo' && <button className="btn btn-ghost btn-sm" onClick={() => clear(s.provider)}>Clear</button>}
          </div>
        </div>
      ))}

      <p style={{ color: '#94a3b8', fontSize: '.82rem', marginTop: 18 }}>
        Keys are encrypted at rest and never displayed in full. “Server default” means a key from the install’s <code>.env</code> is in use; saving your own overrides it.
      </p>
    </div>
  )
}
