import { useState, useEffect, useCallback } from 'react'
import { useToast } from '../App.tsx'

interface Source {
  id: string; label: string; source_type: string; url: string
  handle: string; api_token: string; active: number; last_polled: number | null
}
interface Destination {
  id: string; label: string; platform: string; handle: string; account_id?: string
  api_key: string; api_secret: string; access_token: string; access_secret: string; active: number
}
interface Route {
  id: string; source_id: string; destination_id: string
  source_label: string; source_handle: string; source_url: string
  dest_label: string; dest_handle: string; dest_platform: string
  rewrite_prompt: string; daily_cap: number; posts_today: number; active: number; posted_count: number
}
interface HistoryItem {
  id: string; source_label: string; source_handle: string; dest_handle: string; dest_platform: string
  source_url: string; source_text: string; rewritten_text: string; posted_url: string
  status: string; error: string; posted_at: number | null; created_at: number
}

const PLATFORM_META: Record<string, { icon: string; colour: string; name: string }> = {
  x:        { icon: '𝕏',  colour: '#000000', name: 'X / Twitter' },
  telegram: { icon: '✈️', colour: '#2AABEE', name: 'Telegram' },
  reddit:   { icon: '🔴', colour: '#FF4500', name: 'Reddit' },
  medium:   { icon: '📝', colour: '#000000', name: 'Medium' },
  linkedin: { icon: '🔗', colour: '#0a66c2', name: 'LinkedIn' },
  facebook: { icon: '👍', colour: '#1877F2', name: 'Facebook Page' },
  instagram:{ icon: '📸', colour: '#E4405F', name: 'Instagram' },
}

export default function SyndicationHub({ clientId }: { clientId: string }) {
  const { showToast } = useToast()
  const [tab, setTab] = useState<'routes' | 'sources' | 'destinations' | 'history'>('routes')
  const [sources, setSources] = useState<Source[]>([])
  const [destinations, setDestinations] = useState<Destination[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [history, setHistory] = useState<HistoryItem[]>([])

  const load = useCallback(async () => {
    const [s, d, r, h] = await Promise.all([
      fetch(`/api/clients/${clientId}/syndication/sources`).then(x => x.json()),
      fetch(`/api/clients/${clientId}/syndication/destinations`).then(x => x.json()),
      fetch(`/api/clients/${clientId}/syndication/routes`).then(x => x.json()),
      fetch(`/api/clients/${clientId}/syndication/history`).then(x => x.json()),
    ])
    setSources(s); setDestinations(d); setRoutes(r); setHistory(h)
  }, [clientId])

  useEffect(() => { load() }, [load])

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>🔀 Syndicate</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Auto-flow content from RSS sources to connected social accounts — rewritten on-voice, no approval queue.
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['routes','sources','destinations','history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-secondary'}`}>
            {{ routes: '🔗 Routes', sources: '📡 Sources', destinations: '📤 Destinations', history: '📜 History' }[t]}
          </button>
        ))}
      </div>

      {tab === 'routes'       && <RoutesTab clientId={clientId} routes={routes} sources={sources} destinations={destinations} onChange={load} />}
      {tab === 'sources'      && <SourcesTab clientId={clientId} sources={sources} onChange={load} />}
      {tab === 'destinations' && <DestinationsTab clientId={clientId} destinations={destinations} onChange={load} />}
      {tab === 'history'      && <HistoryTab history={history} />}
    </div>
  )
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────
function RoutesTab({ clientId, routes, sources, destinations, onChange }: {
  clientId: string; routes: Route[]; sources: Source[]; destinations: Destination[]; onChange: () => void
}) {
  const { showToast } = useToast()
  const [showAdd, setShowAdd] = useState(false)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [previewResult, setPreviewResult] = useState<any>(null)
  const [previewRouteId, setPreviewRouteId] = useState<string | null>(null)
  const [editableDraft, setEditableDraft] = useState('')
  const [approving, setApproving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ source_id: '', destination_id: '', daily_cap: '10', rewrite_prompt: '' })
  const [saving, setSaving] = useState(false)

  const previewRoute = async (routeId: string) => {
    setPreviewing(routeId); setPreviewResult(null); setPreviewRouteId(routeId)
    const res = await fetch(`/api/clients/${clientId}/syndication/routes/${routeId}/preview`, { method: 'POST' })
    const data = await res.json()
    setPreviewResult(data)
    setEditableDraft(data?.rewritten || '')   // seed the editable box with the generated draft
    setPreviewing(null)
  }
  const runNow = async (routeId: string) => {
    const res = await fetch(`/api/clients/${clientId}/syndication/routes/${routeId}/run-now`, { method: 'POST' })
    const data = await res.json()
    showToast(`Tick complete: posted ${data.posted}, failed ${data.failed}, skipped ${data.skipped}`)
    onChange()
  }
  const toggleRoute = async (r: Route) => {
    await fetch(`/api/clients/${clientId}/syndication/routes/${r.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: r.active ? 0 : 1 }),
    }); onChange()
  }
  const deleteRoute = async (id: string) => {
    if (!confirm('Delete this syndication route?')) return
    await fetch(`/api/clients/${clientId}/syndication/routes/${id}`, { method: 'DELETE' }); onChange()
  }
  const startEdit = (r: Route) => {
    setEditingId(r.id)
    setEditForm({ source_id: r.source_id, destination_id: r.destination_id, daily_cap: String(r.daily_cap), rewrite_prompt: r.rewrite_prompt || '' })
    setShowAdd(false)
  }
  const saveEdit = async () => {
    if (!editingId || !editForm.source_id || !editForm.destination_id) return showToast('Pick source + destination', 'error')
    setSaving(true)
    const res = await fetch(`/api/clients/${clientId}/syndication/routes/${editingId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_id: editForm.source_id, destination_id: editForm.destination_id, daily_cap: Number(editForm.daily_cap) || 10, rewrite_prompt: editForm.rewrite_prompt }),
    })
    setSaving(false)
    if (res.ok) { setEditingId(null); onChange(); showToast('Route updated') }
    else { const d = await res.json(); showToast(d.error || 'Failed', 'error') }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary btn-sm" onClick={() => { setShowAdd(!showAdd); setEditingId(null) }}>
          {showAdd ? '× Cancel' : '+ New route'}
        </button>
      </div>

      {showAdd && <AddRouteForm clientId={clientId} sources={sources} destinations={destinations}
        onSaved={() => { setShowAdd(false); onChange() }} />}

      {routes.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>
          No routes yet. Add a source and a destination, then link them here.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {routes.map(r => {
            const pm = PLATFORM_META[r.dest_platform] || PLATFORM_META.x
            return (
              <div key={r.id} className="card">
                <div style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.95rem', fontWeight: 600 }}>
                      <span>{r.source_handle || r.source_label}</span>
                      <span style={{ color: 'var(--text-tertiary)' }}>→</span>
                      <span style={{ color: pm.colour }}>{pm.icon} {r.dest_handle || r.dest_label}</span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                      Today: <strong>{r.posts_today}/{r.daily_cap}</strong> · All-time: <strong>{r.posted_count}</strong>
                      {!r.active && <span style={{ marginLeft: 8, color: 'var(--danger)' }}>· Paused</span>}
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => previewRoute(r.id)} disabled={previewing === r.id}>
                    {previewing === r.id ? <span className="loading" /> : '👁 Preview'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => runNow(r.id)}>▶ Run now</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => startEdit(r)}>✏️ Edit</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => toggleRoute(r)}>{r.active ? '⏸' : '▶'}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => deleteRoute(r.id)}>🗑</button>
                </div>

                {editingId === r.id && (
                  <div style={{ padding: 14, borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-elevated-2)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                      <div>
                        <label className="form-label">Source</label>
                        <select className="form-input" value={editForm.source_id} onChange={e => setEditForm({ ...editForm, source_id: e.target.value })}>
                          {sources.map(s => <option key={s.id} value={s.id}>{s.label} ({s.handle || s.url.slice(0, 40)})</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="form-label">Destination</label>
                        <select className="form-input" value={editForm.destination_id} onChange={e => setEditForm({ ...editForm, destination_id: e.target.value })}>
                          {destinations.map(d => <option key={d.id} value={d.id}>{PLATFORM_META[d.platform]?.icon} {d.label} ({d.handle || d.platform})</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12, marginBottom: 12 }}>
                      <div>
                        <label className="form-label">Daily cap</label>
                        <input className="form-input" type="number" min="1" value={editForm.daily_cap} onChange={e => setEditForm({ ...editForm, daily_cap: e.target.value })} />
                      </div>
                      <div>
                        <label className="form-label">Rewrite prompt (optional)</label>
                        <textarea className="form-input" rows={3} value={editForm.rewrite_prompt} onChange={e => setEditForm({ ...editForm, rewrite_prompt: e.target.value })}
                          placeholder="Leave blank to use default rewriter (uses client brand voice)." />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-primary btn-sm" disabled={saving} onClick={saveEdit}>{saving ? <span className="loading" /> : '💾 Save'}</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {previewResult && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <span className="card-title">Preview</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setPreviewResult(null)}>×</button>
          </div>
          <div className="card-body">
            {previewResult.ok ? (
              <>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginBottom: 6 }}>Source:</div>
                <div style={{ padding: 10, background: 'var(--bg-elevated-2)', borderRadius: 6, marginBottom: 12, fontSize: '0.85rem' }}>
                  <strong>{previewResult.source_item?.title}</strong>
                  <div style={{ marginTop: 4, color: 'var(--text-secondary)' }}>{previewResult.source_item?.content}</div>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginBottom: 6 }}>
                  Rewritten ({editableDraft.length} chars) — edit freely before approving:
                </div>
                <textarea
                  className="form-input"
                  style={{ width: '100%', minHeight: 180, fontSize: '0.95rem', lineHeight: 1.5, fontFamily: 'inherit' }}
                  value={editableDraft}
                  onChange={e => setEditableDraft(e.target.value)}
                />
                <div style={{ background: 'var(--bg-elevated-2)', borderRadius: 6, padding: 10, fontSize: '0.8rem', margin: '10px 0', color: 'var(--text-secondary)' }}>
                  ⚠️ Without approval this is only a <strong>sample</strong> — the next tick generates fresh text and posts
                  that instead. <strong>Approve</strong> to lock this exact wording: it posts verbatim next run, once.
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-primary btn-sm" disabled={approving || !editableDraft.trim()}
                    onClick={async () => {
                      setApproving(true)
                      try {
                        const r = await fetch(`/api/clients/${clientId}/syndication/routes/${previewRouteId}/approve`, {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            text: editableDraft,
                            source_item_id: previewResult.source_item?.id,
                            source_url: previewResult.source_item?.url,
                            source_title: previewResult.source_item?.title,
                          }),
                        })
                        if (!r.ok) { const d = await r.json(); showToast(d.error || 'Approve failed', 'error'); return }
                        showToast('Approved — this exact text posts on the next run')
                        setPreviewResult(null)
                      } finally { setApproving(false) }
                    }}>
                    {approving ? <span className="loading" /> : '✓ Approve this exact text'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditableDraft(previewResult.rewritten || '')}>
                    ↺ Reset edits
                  </button>
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--danger)' }}>❌ {previewResult.error}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AddRouteForm({ clientId, sources, destinations, onSaved }: {
  clientId: string; sources: Source[]; destinations: Destination[]; onSaved: () => void
}) {
  const { showToast } = useToast()
  const [sourceId, setSourceId] = useState(sources[0]?.id || '')
  const [destId, setDestId] = useState(destinations[0]?.id || '')
  const [dailyCap, setDailyCap] = useState('10')
  const [rewritePrompt, setRewritePrompt] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!sourceId || !destId) return showToast('Pick source + destination', 'error')
    setSaving(true)
    const res = await fetch(`/api/clients/${clientId}/syndication/routes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_id: sourceId, destination_id: destId, daily_cap: Number(dailyCap) || 10, rewrite_prompt: rewritePrompt }),
    })
    setSaving(false)
    if (res.ok) { showToast('Route created'); onSaved() }
    else { const d = await res.json(); showToast(d.error || 'Failed', 'error') }
  }

  if (!sources.length || !destinations.length) {
    return (
      <div className="card" style={{ padding: 16, marginBottom: 12, background: '#fefce8', border: '1px solid #fde68a' }}>
        💡 Add at least one <strong>source</strong> and one <strong>destination</strong> first, then link them here.
      </div>
    )
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-header"><span className="card-title">New route</span></div>
      <div className="card-body">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label className="form-label">Source</label>
            <select className="form-input" value={sourceId} onChange={e => setSourceId(e.target.value)}>
              {sources.map(s => <option key={s.id} value={s.id}>{s.label} ({s.handle || s.url.slice(0, 40)})</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Destination</label>
            <select className="form-input" value={destId} onChange={e => setDestId(e.target.value)}>
              {destinations.map(d => <option key={d.id} value={d.id}>{PLATFORM_META[d.platform]?.icon} {d.label} ({d.handle || d.platform})</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label className="form-label">Daily cap</label>
            <input className="form-input" type="number" min="1" value={dailyCap} onChange={e => setDailyCap(e.target.value)} />
          </div>
          <div>
            <label className="form-label">Rewrite prompt (optional)</label>
            <textarea className="form-input" rows={2} value={rewritePrompt} onChange={e => setRewritePrompt(e.target.value)}
              placeholder="Leave blank to use default rewriter." />
          </div>
        </div>
        <button className="btn btn-primary" onClick={submit} disabled={saving}>
          {saving ? <span className="loading" /> : 'Create route'}
        </button>
      </div>
    </div>
  )
}

// ─── SOURCES ─────────────────────────────────────────────────────────────────
type SourceFormState = { label: string; url: string; handle: string; source_type: string; api_token: string }
const blankSource: SourceFormState = { label: '', url: '', handle: '', source_type: 'rss', api_token: '' }

function SourcesTab({ clientId, sources, onChange }: { clientId: string; sources: Source[]; onChange: () => void }) {
  const { showToast } = useToast()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<SourceFormState>(blankSource)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<SourceFormState>(blankSource)

  const submit = async () => {
    if (form.source_type === 'apify_instagram' && !form.api_token) return showToast('Apify API token required', 'error')
    if (form.source_type === 'ig_graph' && !form.api_token) return showToast('Page access token required', 'error')
    setSaving(true)
    const res = await fetch(`/api/clients/${clientId}/syndication/sources`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    })
    setSaving(false)
    if (res.ok) { setForm(blankSource); setShowAdd(false); onChange(); showToast('Source added') }
    else { const d = await res.json(); showToast(d.error || 'Failed', 'error') }
  }
  const saveEdit = async () => {
    if (!editingId) return
    setSaving(true)
    const payload: any = { label: editForm.label, url: editForm.url, handle: editForm.handle, source_type: editForm.source_type }
    if (editForm.api_token) payload.api_token = editForm.api_token
    const res = await fetch(`/api/clients/${clientId}/syndication/sources/${editingId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    setSaving(false)
    if (res.ok) { setEditingId(null); onChange(); showToast('Source updated') }
    else { const d = await res.json(); showToast(d.error || 'Failed', 'error') }
  }
  const toggleActive = async (s: Source) => {
    await fetch(`/api/clients/${clientId}/syndication/sources/${s.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: s.active ? 0 : 1 }),
    }); onChange()
  }
  const remove = async (id: string) => {
    if (!confirm('Delete source? Linked routes will also be deleted.')) return
    await fetch(`/api/clients/${clientId}/syndication/sources/${id}`, { method: 'DELETE' }); onChange()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary btn-sm" onClick={() => { setShowAdd(!showAdd); setEditingId(null) }}>
          {showAdd ? '× Cancel' : '+ Add source'}
        </button>
      </div>
      {showAdd && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-body">
            <SourceFields form={form} onChange={setForm} />
            <button className="btn btn-primary" disabled={saving || !form.label || !form.url} onClick={submit}>
              {saving ? <span className="loading" /> : 'Add source'}
            </button>
          </div>
        </div>
      )}
      {sources.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>No sources yet.</div>
      ) : (
        <table className="table">
          <thead><tr><th>Type</th><th>Label</th><th>Handle</th><th>URL</th><th>Last polled</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {sources.map(s => editingId === s.id ? (
              <tr key={s.id}><td colSpan={7} style={{ padding: 14, background: 'var(--bg-elevated-2)' }}>
                <SourceFields form={editForm} onChange={setEditForm} editMode />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary btn-sm" disabled={saving || !editForm.label || !editForm.url} onClick={saveEdit}>
                    {saving ? <span className="loading" /> : '💾 Save'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </td></tr>
            ) : (
              <tr key={s.id}>
                <td><span className="tag" style={{ fontSize: '0.68rem' }}>{s.source_type === 'apify_instagram' ? '🎯 Apify IG' : s.source_type === 'ig_graph' ? '📘 IG Graph (free)' : '📡 RSS'}</span></td>
                <td><strong>{s.label}</strong></td>
                <td>{s.handle || '—'}</td>
                <td style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.url}</td>
                <td style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>{s.last_polled ? new Date(s.last_polled * 1000).toLocaleString('en-GB') : 'never'}</td>
                <td>{s.active ? <span className="tag" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>active</span> : <span className="tag">paused</span>}</td>
                <td style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setEditingId(s.id); setEditForm({ label: s.label, url: s.url, handle: s.handle, source_type: s.source_type || 'rss', api_token: '' }); setShowAdd(false) }}>✏️</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(s)}>{s.active ? '⏸' : '▶'}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => remove(s.id)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function SourceFields({ form, onChange, editMode = false }: { form: SourceFormState; onChange: (f: SourceFormState) => void; editMode?: boolean }) {
  const isApify = form.source_type === 'apify_instagram'
  const isIgGraph = form.source_type === 'ig_graph'
  const urlLabel = isApify ? 'Instagram handle *' : isIgGraph ? 'IG Business user ID *' : 'RSS feed URL *'
  const urlPlaceholder = isApify ? 'myhandle (no @)' : isIgGraph ? '17841400000000000' : 'https://example.com/feed/'
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label className="form-label">Source type</label>
          <select className="form-input" value={form.source_type} onChange={e => onChange({ ...form, source_type: e.target.value })}>
            <option value="rss">📡 RSS feed (WordPress, Substack, blog)</option>
            <option value="ig_graph">📘 Instagram Graph API — your own account, free</option>
            <option value="apify_instagram">🎯 Apify · Instagram Profile Scraper (any public account, paid)</option>
          </select>
        </div>
        <div>
          <label className="form-label">Label *</label>
          <input className="form-input" value={form.label} onChange={e => onChange({ ...form, label: e.target.value })}
            placeholder={isApify || isIgGraph ? 'My brand IG' : 'My blog feed'} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label className="form-label">{urlLabel}</label>
          <input className="form-input" value={form.url} onChange={e => onChange({ ...form, url: e.target.value })}
            placeholder={urlPlaceholder} />
        </div>
        <div>
          <label className="form-label">Display handle (optional)</label>
          <input className="form-input" value={form.handle} onChange={e => onChange({ ...form, handle: e.target.value })} placeholder="@myhandle" />
        </div>
      </div>
      {isApify && (
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label className="form-label">Apify API token {editMode ? '(leave blank to keep existing)' : '*'}</label>
          <input className="form-input" type="password" value={form.api_token} onChange={e => onChange({ ...form, api_token: e.target.value })} placeholder="apify_api_..." />
          <div className="form-hint">From <a href="https://apify.com" target="_blank" rel="noreferrer">apify.com</a> → Settings → Integrations → API tokens</div>
        </div>
      )}
      {isIgGraph && (
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label className="form-label">Page access token {editMode ? '(leave blank to keep existing)' : '*'}</label>
          <input className="form-input" type="password" value={form.api_token} onChange={e => onChange({ ...form, api_token: e.target.value })} placeholder="EAAG..." />
          <div className="form-hint">Only works for accounts you administratively control (Business/Creator, linked to a Facebook Page). Same long-lived Page token used for an Instagram destination — free, no per-call cost.</div>
        </div>
      )}
    </>
  )
}

// ─── DESTINATIONS ────────────────────────────────────────────────────────────
type DestForm = { label: string; platform: string; handle: string; api_key: string; api_secret: string; access_token: string; access_secret: string; account_id: string }
const blankDest: DestForm = { label: '', platform: 'x', handle: '', api_key: '', api_secret: '', access_token: '', access_secret: '', account_id: '' }

function DestinationsTab({ clientId, destinations, onChange }: { clientId: string; destinations: Destination[]; onChange: () => void }) {
  const { showToast } = useToast()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<DestForm>(blankDest)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, any>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<DestForm>(blankDest)

  const submit = async () => {
    setSaving(true)
    const res = await fetch(`/api/clients/${clientId}/syndication/destinations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    })
    setSaving(false)
    if (res.ok) { setForm(blankDest); setShowAdd(false); onChange(); showToast('Destination added — test the connection!') }
    else { const d = await res.json(); showToast(d.error || 'Failed', 'error') }
  }
  const test = async (id: string) => {
    setTesting(id)
    const res = await fetch(`/api/clients/${clientId}/syndication/destinations/${id}/test`, { method: 'POST' })
    const data = await res.json()
    setTestResult(r => ({ ...r, [id]: data })); setTesting(null)
  }
  const remove = async (id: string) => {
    if (!confirm('Delete destination? Linked routes will also be deleted.')) return
    await fetch(`/api/clients/${clientId}/syndication/destinations/${id}`, { method: 'DELETE' }); onChange()
  }
  const startEdit = (d: Destination) => {
    setEditingId(d.id)
    setEditForm({ label: d.label, platform: d.platform, handle: d.handle, api_key: '', api_secret: '', access_token: '', access_secret: '', account_id: d.account_id || '' })
    setShowAdd(false)
  }
  const saveEdit = async () => {
    if (!editingId) return
    setSaving(true)
    const payload: any = { label: editForm.label, handle: editForm.handle, account_id: editForm.account_id }
    if (editForm.api_key)       payload.api_key       = editForm.api_key
    if (editForm.api_secret)    payload.api_secret    = editForm.api_secret
    if (editForm.access_token)  payload.access_token  = editForm.access_token
    if (editForm.access_secret) payload.access_secret = editForm.access_secret
    const res = await fetch(`/api/clients/${clientId}/syndication/destinations/${editingId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    setSaving(false)
    if (res.ok) { setEditingId(null); onChange(); showToast('Destination updated') }
    else { const d = await res.json(); showToast(d.error || 'Failed', 'error') }
  }

  // Group destinations by platform for display
  const byPlatform = destinations.reduce<Record<string, Destination[]>>((acc, d) => {
    (acc[d.platform] = acc[d.platform] || []).push(d); return acc
  }, {})

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary btn-sm" onClick={() => { setShowAdd(!showAdd); setEditingId(null) }}>
          {showAdd ? '× Cancel' : '+ Connect account'}
        </button>
      </div>

      {showAdd && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><span className="card-title">Connect a social account</span></div>
          <div className="card-body">
            <DestinationFields form={form} onChange={setForm} editMode={false} />
            <button className="btn btn-primary" disabled={saving || !form.label} onClick={submit}>
              {saving ? <span className="loading" /> : 'Connect account'}
            </button>
          </div>
        </div>
      )}

      {destinations.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>
          No accounts connected yet. Hit "+ Connect account" to add X, Telegram, Reddit, or Medium.
        </div>
      ) : (
        Object.entries(byPlatform).map(([platform, dests]) => {
          const pm = PLATFORM_META[platform] || { icon: '📤', colour: '#6366f1', name: platform }
          return (
            <div key={platform} style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontWeight: 600, color: pm.colour }}>
                <span style={{ fontSize: '1.1rem' }}>{pm.icon}</span> {pm.name}
              </div>
              <table className="table">
                <thead><tr><th>Label</th><th>Handle</th><th>Credentials</th><th>Test</th><th></th></tr></thead>
                <tbody>
                  {dests.map(d => editingId === d.id ? (
                    <tr key={d.id}><td colSpan={5} style={{ padding: 14, background: 'var(--bg-elevated-2)' }}>
                      <DestinationFields form={editForm} onChange={setEditForm} editMode={true} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-primary btn-sm" disabled={saving || !editForm.label} onClick={saveEdit}>
                          {saving ? <span className="loading" /> : '💾 Save'}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    </td></tr>
                  ) : (
                    <tr key={d.id}>
                      <td><strong>{d.label}</strong></td>
                      <td>{d.handle || '—'}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                        {d.api_key || d.access_token ? '••••••••' : <span style={{ color: 'var(--danger)' }}>missing</span>}
                      </td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={() => test(d.id)} disabled={testing === d.id}>
                          {testing === d.id ? <span className="loading" /> : '🔌 Test'}
                        </button>
                        {testResult[d.id] && (
                          <span style={{ marginLeft: 8, fontSize: '0.78rem', color: testResult[d.id].ok ? '#10b981' : '#ef4444' }}>
                            {testResult[d.id].ok ? `✅ ${testResult[d.id].handle}` : `❌ ${testResult[d.id].error?.slice(0, 60)}`}
                          </span>
                        )}
                      </td>
                      <td style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => startEdit(d)}>✏️</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => remove(d.id)}>🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })
      )}
    </div>
  )
}

function DestinationFields({ form, onChange, editMode }: { form: DestForm; onChange: (f: DestForm) => void; editMode: boolean }) {
  const p = form.platform
  const blank = editMode ? 'leave blank to keep existing' : ''

  return (
    <div>
      {/* Platform selector + label row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <label className="form-label">Platform</label>
          <select className="form-input" value={p} onChange={e => onChange({ ...form, platform: e.target.value })} disabled={editMode}>
            <option value="x">𝕏  X / Twitter</option>
            <option value="linkedin">💼  LinkedIn (personal profile)</option>
            <option value="telegram">✈️  Telegram</option>
            <option value="reddit">🔴  Reddit</option>
            <option value="medium">📝  Medium</option>
            <option value="facebook">👍  Facebook Page</option>
            <option value="instagram">📸  Instagram</option>
          </select>
        </div>
        <div>
          <label className="form-label">Label *</label>
          <input className="form-input" value={form.label} onChange={e => onChange({ ...form, label: e.target.value })}
            placeholder={{ x: 'My X account', linkedin: 'My LinkedIn profile', telegram: 'My Telegram channel', reddit: 'My Reddit account', medium: 'My Medium blog', facebook: 'My Facebook Page', instagram: 'My Instagram account' }[p] || 'Account label'} />
        </div>
      </div>

      {/* Platform-specific credential fields */}
      {p === 'x' && (
        <>
          <div style={{ background: 'var(--accent-soft)', padding: 10, borderRadius: 6, fontSize: '0.82rem', marginBottom: 12 }}>
            Get these from <a href="https://developer.x.com" target="_blank" rel="noreferrer">developer.x.com</a> → Your App → Keys and tokens.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label className="form-label">Handle</label>
              <input className="form-input" value={form.handle} onChange={e => onChange({ ...form, handle: e.target.value })} placeholder="@myhandle" />
            </div>
            <div>
              <label className="form-label">API Key {editMode && <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(leave blank to keep)</span>}</label>
              <input className="form-input" type="password" value={form.api_key} onChange={e => onChange({ ...form, api_key: e.target.value })} placeholder={editMode ? blank : 'Consumer key'} />
            </div>
            <div>
              <label className="form-label">API Secret</label>
              <input className="form-input" type="password" value={form.api_secret} onChange={e => onChange({ ...form, api_secret: e.target.value })} placeholder={editMode ? blank : 'Consumer secret'} />
            </div>
            <div>
              <label className="form-label">Access Token</label>
              <input className="form-input" type="password" value={form.access_token} onChange={e => onChange({ ...form, access_token: e.target.value })} placeholder={editMode ? blank : 'Access token'} />
            </div>
            <div>
              <label className="form-label">Access Token Secret</label>
              <input className="form-input" type="password" value={form.access_secret} onChange={e => onChange({ ...form, access_secret: e.target.value })} placeholder={editMode ? blank : 'Access token secret'} />
            </div>
          </div>
        </>
      )}

      {p === 'linkedin' && (
        <>
          <div style={{ background: 'var(--accent-soft)', padding: 10, borderRadius: 6, fontSize: '0.82rem', marginBottom: 12 }}>
            1. Create an app at <a href="https://developer.linkedin.com" target="_blank" rel="noreferrer">developer.linkedin.com</a>, request the <strong>Share on LinkedIn</strong> + <strong>Sign In with OpenID Connect</strong> products (both instant).<br />
            2. <strong>Docs and tools → OAuth Token Tools → Create token</strong>, scopes <code>openid profile w_member_social</code> → copy the access token.<br />
            3. <strong>Person URN:</strong> call <code>GET api.linkedin.com/v2/userinfo</code> with that token — your URN is <code>urn:li:person:&lt;sub&gt;</code>.<br />
            ⚠️ LinkedIn tokens expire after ~60 days — refresh before then or posting silently stops.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label className="form-label">Handle (cosmetic)</label>
              <input className="form-input" value={form.handle} onChange={e => onChange({ ...form, handle: e.target.value })} placeholder="in/yourname" />
            </div>
            <div>
              <label className="form-label">Person URN *</label>
              <input className="form-input" value={form.account_id} onChange={e => onChange({ ...form, account_id: e.target.value })} placeholder="urn:li:person:XXXX" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Access token {editMode && <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(leave blank to keep)</span>}</label>
              <input className="form-input" type="password" value={form.access_token} onChange={e => onChange({ ...form, access_token: e.target.value })} placeholder={editMode ? blank : 'OAuth token with w_member_social'} />
            </div>
          </div>
        </>
      )}

      {p === 'telegram' && (
        <>
          <div style={{ background: 'var(--accent-soft)', padding: 10, borderRadius: 6, fontSize: '0.82rem', marginBottom: 12 }}>
            1. Message <strong>@BotFather</strong> on Telegram → /newbot → copy the token.<br />
            2. Add the bot to your channel as admin.<br />
            3. Get your channel ID from <a href="https://t.me/getidsbot" target="_blank" rel="noreferrer">@getidsbot</a> or use the channel username (e.g. <code>@mychannel</code>).
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label className="form-label">Channel ID or username *</label>
              <input className="form-input" value={form.handle} onChange={e => onChange({ ...form, handle: e.target.value })}
                placeholder="-1001234567890 or @mychannel" />
            </div>
            <div>
              <label className="form-label">Bot token {editMode && <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(leave blank to keep)</span>}</label>
              <input className="form-input" type="password" value={form.access_token} onChange={e => onChange({ ...form, access_token: e.target.value })}
                placeholder={editMode ? blank : '123456789:ABC-...'} />
            </div>
          </div>
        </>
      )}

      {(p === 'facebook' || p === 'instagram') && (
        <>
          <div style={{ background: 'var(--accent-soft)', padding: 10, borderRadius: 6, fontSize: '0.82rem', marginBottom: 12 }}>
            {p === 'facebook' ? (
              <>1. Create an app at <a href="https://developers.facebook.com" target="_blank" rel="noreferrer">developers.facebook.com</a> and link your Page.<br />
              2. Get a long-lived <strong>Page access token</strong> (Graph API Explorer → Page token, or via your app).<br />
              3. Page ID: on your Page → About → Page transparency (or Graph Explorer <code>me/accounts</code>).</>
            ) : (
              <>1. Your Instagram must be a <strong>Business/Creator account linked to a Facebook Page</strong>.<br />
              2. Use the same Meta app + long-lived Page token (needs <code>instagram_content_publish</code>).<br />
              3. IG user ID: Graph Explorer → <code>me/accounts?fields=instagram_business_account</code>.<br />
              ⚠️ Instagram posts <strong>require an image</strong> — βWave auto-sources one per post if the article has none.</>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label className="form-label">Handle</label>
              <input className="form-input" value={form.handle} onChange={e => onChange({ ...form, handle: e.target.value })} placeholder={p === 'facebook' ? 'Page name' : '@myhandle'} />
            </div>
            <div>
              <label className="form-label">{p === 'facebook' ? 'Page ID *' : 'IG Business user ID *'}</label>
              <input className="form-input" value={form.account_id} onChange={e => onChange({ ...form, account_id: e.target.value })} placeholder="17841400000000000" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Page access token {editMode && <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(leave blank to keep)</span>}</label>
              <input className="form-input" type="password" value={form.access_token} onChange={e => onChange({ ...form, access_token: e.target.value })} placeholder={editMode ? blank : 'EAAG...'} />
            </div>
          </div>
        </>
      )}

      {p === 'reddit' && (
        <>
          <div style={{ background: 'var(--accent-soft)', padding: 10, borderRadius: 6, fontSize: '0.82rem', marginBottom: 12 }}>
            1. Go to <a href="https://www.reddit.com/prefs/apps" target="_blank" rel="noreferrer">reddit.com/prefs/apps</a> → create a <strong>script</strong> app.<br />
            2. Client ID is the string below the app name. Client Secret is the secret field.<br />
            3. Use your Reddit username &amp; password (account must be verified).
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label className="form-label">Target subreddit</label>
              <input className="form-input" value={form.handle} onChange={e => onChange({ ...form, handle: e.target.value })} placeholder="r/mysubreddit" />
            </div>
            <div>
              <label className="form-label">Client ID {editMode && <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(leave blank to keep)</span>}</label>
              <input className="form-input" type="password" value={form.api_key} onChange={e => onChange({ ...form, api_key: e.target.value })} placeholder={editMode ? blank : 'App client_id'} />
            </div>
            <div>
              <label className="form-label">Client Secret</label>
              <input className="form-input" type="password" value={form.api_secret} onChange={e => onChange({ ...form, api_secret: e.target.value })} placeholder={editMode ? blank : 'App client_secret'} />
            </div>
            <div>
              <label className="form-label">Reddit Username</label>
              <input className="form-input" value={form.access_token} onChange={e => onChange({ ...form, access_token: e.target.value })} placeholder="u/myusername" />
            </div>
            <div>
              <label className="form-label">Reddit Password</label>
              <input className="form-input" type="password" value={form.access_secret} onChange={e => onChange({ ...form, access_secret: e.target.value })} placeholder={editMode ? blank : 'Account password'} />
            </div>
          </div>
        </>
      )}

      {p === 'medium' && (
        <>
          <div style={{ background: 'var(--accent-soft)', padding: 10, borderRadius: 6, fontSize: '0.82rem', marginBottom: 12 }}>
            Go to <a href="https://medium.com/me/settings/security" target="_blank" rel="noreferrer">medium.com/me/settings/security</a> → Integration tokens → Generate token. Posts are created as <strong>drafts</strong> for your review.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label className="form-label">Medium handle (cosmetic)</label>
              <input className="form-input" value={form.handle} onChange={e => onChange({ ...form, handle: e.target.value })} placeholder="@myprofile" />
            </div>
            <div>
              <label className="form-label">Integration token {editMode && <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(leave blank to keep)</span>}</label>
              <input className="form-input" type="password" value={form.access_token} onChange={e => onChange({ ...form, access_token: e.target.value })}
                placeholder={editMode ? blank : 'Your Medium integration token'} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── HISTORY ─────────────────────────────────────────────────────────────────
function HistoryTab({ history }: { history: HistoryItem[] }) {
  if (history.length === 0) {
    return <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>No syndication activity yet.</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {history.map(h => {
        const pm = PLATFORM_META[h.dest_platform] || { icon: '📤', colour: '#6366f1' }
        return (
          <div key={h.id} className="card">
            <div style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: '0.85rem' }}>
                  <strong>{h.source_handle || h.source_label}</strong>
                  <span style={{ color: 'var(--text-tertiary)', margin: '0 6px' }}>→</span>
                  <span style={{ color: pm.colour }}>{pm.icon} <strong>{h.dest_handle}</strong></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="tag" style={{
                    background: h.status === 'posted' ? '#dcfce7' : h.status === 'failed' ? '#fee2e2' : '#fef3c7',
                    color:      h.status === 'posted' ? '#16a34a' : h.status === 'failed' ? '#dc2626' : '#92400e',
                  }}>{h.status}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{new Date(h.created_at * 1000).toLocaleString('en-GB')}</span>
                </div>
              </div>
              <div style={{ padding: 8, background: 'var(--accent-soft)', borderRadius: 4, fontSize: '0.85rem', lineHeight: 1.5 }}>{h.rewritten_text}</div>
              <div style={{ marginTop: 6, fontSize: '0.72rem', color: '#64748b', display: 'flex', gap: 12 }}>
                {h.source_url && <a href={h.source_url} target="_blank" rel="noreferrer">↗ source</a>}
                {h.posted_url && <a href={h.posted_url} target="_blank" rel="noreferrer">↗ posted</a>}
                {h.error && <span style={{ color: '#dc2626' }}>error: {h.error}</span>}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
