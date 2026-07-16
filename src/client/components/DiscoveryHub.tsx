import { useState, useEffect, useCallback } from 'react'
import { useToast } from '../App.tsx'

/**
 * Discovery Layer Hub — client-scoped (mounted as a client tab in PRRM Reach).
 *
 * Three modes:
 *   1. Empty state — pick a vertical template OR add a custom vertical
 *   2. Vertical list — see verticals with org/prospect counts; click to drill in
 *   3. Vertical detail — orgs / contacts / prospects sub-tabs
 *
 * Plus a Settings sub-screen for LLM provider config + outbound sender.
 */

interface Vertical {
  id: string
  client_id: string
  slug: string
  name: string
  description: string
  multi_unit_min_locations: number
  org_count?: number
  prospect_count?: number
}

interface Organization {
  id: string
  client_id: string
  vertical_id: string
  name: string
  website: string
  domain: string
  location_count: number
  hq_location: string
  hq_postcode: string
  sub_segment: string
  status: string
  contact_count?: number
}

interface Contact {
  id: string
  organization_id: string
  full_name: string
  role: string
  email: string
  linkedin_url: string
  source: string
  source_confidence: number
  status: string
  outreach_status?: string
  outreach_message?: string
  outreach_sent_at?: number | null
  contact_context?: string
  context_captured_at?: number | null
}

interface Prospect {
  id: string
  organization_id: string
  vertical_id: string
  visibility_score: number
  rank: number
  status: string
  org_name: string
  domain: string
  location_count: number
  contact_count: number
}

type View =
  | { type: 'home' }
  | { type: 'settings' }
  | { type: 'vertical'; verticalId: string; tab: 'orgs' | 'contacts' | 'prospects' }
  | { type: 'org'; orgId: string; verticalId: string }

export default function DiscoveryHub({ clientId }: { clientId: string }) {
  const [view, setView] = useState<View>({ type: 'home' })
  const [verticals, setVerticals] = useState<Vertical[]>([])

  const loadVerticals = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/discovery/verticals`)
    setVerticals(await res.json())
  }, [clientId])

  useEffect(() => { loadVerticals() }, [loadVerticals])

  if (view.type === 'home') {
    return <HomeView clientId={clientId} verticals={verticals} reload={loadVerticals}
      onSelectVertical={vid => setView({ type: 'vertical', verticalId: vid, tab: 'orgs' })}
      onOpenSettings={() => setView({ type: 'settings' })} />
  }
  if (view.type === 'settings') {
    return <SettingsView clientId={clientId} onBack={() => setView({ type: 'home' })} />
  }
  if (view.type === 'vertical') {
    return <VerticalDetail clientId={clientId} verticalId={view.verticalId} tab={view.tab}
      onTabChange={tab => setView({ type: 'vertical', verticalId: view.verticalId, tab })}
      onSelectOrg={orgId => setView({ type: 'org', orgId, verticalId: view.verticalId })}
      onBack={() => { setView({ type: 'home' }); loadVerticals() }} />
  }
  if (view.type === 'org') {
    return <OrgDetail clientId={clientId} orgId={view.orgId}
      onBack={() => setView({ type: 'vertical', verticalId: view.verticalId, tab: 'orgs' })} />
  }
  return null
}

// ─── Home view ──────────────────────────────────────────────────────────────
function HomeView({ clientId, verticals, reload, onSelectVertical, onOpenSettings }: {
  clientId: string
  verticals: Vertical[]
  reload: () => void
  onSelectVertical: (id: string) => void
  onOpenSettings: () => void
}) {
  const { showToast } = useToast()
  const [showAddVertical, setShowAddVertical] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [seeding, setSeeding] = useState(false)

  const seed = async (template: 'owner-operated' | 'local-services' | 'professional-services') => {
    setSeeding(true)
    const res = await fetch(`/api/clients/${clientId}/discovery/verticals/seed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template }),
    })
    const data = await res.json()
    setSeeding(false)
    showToast(`Seeded ${data.inserted} verticals (${data.skipped} already existed)`)
    reload()
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0 }}>🎯 Discovery Layer</h2>
          <div className="text-muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
            5th Dimensional Funnel — invisible-prospect identification + autonomous outbound
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={onOpenSettings}>⚙️ Settings</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowTemplates(!showTemplates)}>📦 Templates</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddVertical(!showAddVertical)}>+ Add vertical</button>
        </div>
      </div>

      {showAddVertical && <AddVerticalForm clientId={clientId} onSaved={() => { reload(); setShowAddVertical(false) }} onCancel={() => setShowAddVertical(false)} />}

      {showTemplates && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="text-muted" style={{ fontSize: '0.85rem', marginRight: 4 }}>Seed a curated vertical set (skips any that already exist):</span>
            <button className="btn btn-primary btn-sm" disabled={seeding} onClick={() => seed('owner-operated')}>
              🏃 Owner-operated (Dentists / Aesthetics / Home / Legal / Vets)
            </button>
            <button className="btn btn-secondary btn-sm" disabled={seeding} onClick={() => seed('local-services')}>
              Multi-unit (Home / Trades / Beauty)
            </button>
            <button className="btn btn-secondary btn-sm" disabled={seeding} onClick={() => seed('professional-services')}>
              Professional services
            </button>
          </div>
        </div>
      )}

      {verticals.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: '2.4rem', marginBottom: 8 }}>🎯</div>
            <div style={{ fontWeight: 600, fontSize: '1.05rem', marginBottom: 6 }}>No verticals yet</div>
            <div className="text-muted" style={{ fontSize: '0.9rem', marginBottom: 18, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
              Verticals define the categories of organisations you'll target with the Discovery funnel. Start with a curated template or build from scratch.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" disabled={seeding} onClick={() => seed('local-services')}>
                Local services (Home / Trades / Beauty)
              </button>
              <button className="btn btn-secondary btn-sm" disabled={seeding} onClick={() => seed('professional-services')}>
                Professional services (Legal / Accountancy / Healthcare / Property)
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAddVertical(true)}>
                Or add custom →
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
          {verticals.map(v => (
            <div key={v.id} className="card" style={{ cursor: 'pointer' }} onClick={() => onSelectVertical(v.id)}>
              <div className="card-header">
                <span className="card-title">{v.name}</span>
                <span className="tag" style={{ fontSize: '0.7rem' }}>{v.multi_unit_min_locations}+</span>
              </div>
              <div className="card-body">
                <div style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: 12, lineHeight: 1.5 }}>
                  {v.description}
                </div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1.4rem' }}>{v.org_count ?? 0}</div>
                    <div style={{ color: '#64748b', fontSize: '0.72rem' }}>orgs</div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1.4rem', color: '#7c3aed' }}>{v.prospect_count ?? 0}</div>
                    <div style={{ color: '#64748b', fontSize: '0.72rem' }}>prospects</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AddVerticalForm({ clientId, onSaved, onCancel }: { clientId: string; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ slug: '', name: '', description: '', multi_unit_min_locations: '3' })
  const [saving, setSaving] = useState(false)
  const { showToast } = useToast()

  const submit = async () => {
    if (!form.name.trim() || !form.slug.trim()) return
    setSaving(true)
    const res = await fetch(`/api/clients/${clientId}/discovery/verticals`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, multi_unit_min_locations: Number(form.multi_unit_min_locations) || 3 }),
    })
    if (res.ok) { showToast('Vertical added'); onSaved() }
    else { const e = await res.json(); showToast(e.error || 'Failed', 'error') }
    setSaving(false)
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header"><span className="card-title">New vertical</span></div>
      <div className="card-body">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <input className="form-input" placeholder="Slug * (e.g. opticians)" value={form.slug}
            onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
          <input className="form-input" placeholder="Display name *" value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })} />
        </div>
        <textarea className="form-input" placeholder="Description" rows={2}
          value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
          style={{ marginBottom: 12 }} />
        <input className="form-input" type="number" placeholder="Multi-unit minimum locations"
          value={form.multi_unit_min_locations}
          onChange={e => setForm({ ...form, multi_unit_min_locations: e.target.value })}
          style={{ width: 220, marginBottom: 12 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" disabled={saving || !form.name.trim() || !form.slug.trim()} onClick={submit}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ─── Settings (LLM provider + outbound sender) ────────────────────────────────
function SettingsView({ clientId, onBack }: { clientId: string; onBack: () => void }) {
  const { showToast } = useToast()
  const [client, setClient] = useState<any>(null)
  const [pingResult, setPingResult] = useState<any>(null)
  const [pinging, setPinging] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}`)
    setClient(await res.json())
  }, [clientId])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true)
    const fields = {
      discovery_enabled: client.discovery_enabled ? 1 : 0,
      discovery_sender_email: client.discovery_sender_email || '',
      discovery_sender_name: client.discovery_sender_name || '',
      discovery_whatsapp_number: client.discovery_whatsapp_number || '',
      daily_citation_budget_gbp: Number(client.daily_citation_budget_gbp) || 1.0,
      llm_content_provider: client.llm_content_provider || 'anthropic',
      llm_content_model: client.llm_content_model || '',
      llm_content_api_key: client.llm_content_api_key || '',
      llm_content_base_url: client.llm_content_base_url || '',
    }
    await fetch(`/api/clients/${clientId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...client, ...fields }),
    })
    setSaving(false)
    showToast('Settings saved')
    load()
  }

  const testLLM = async () => {
    setPinging(true)
    setPingResult(null)
    const res = await fetch(`/api/clients/${clientId}/discovery/llm/test`)
    setPingResult(await res.json())
    setPinging(false)
  }

  if (!client) return <div style={{ padding: 32 }}><span className="loading" /> Loading…</div>

  return (
    <div className="page-content">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
        <h2 style={{ margin: 0 }}>⚙️ Discovery Settings</h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 920 }}>
        {/* Outbound */}
        <div className="card">
          <div className="card-header"><span className="card-title">Outbound</span></div>
          <div className="card-body">
            <div className="form-group">
              <label className="form-label">Sender email</label>
              <input className="form-input" placeholder="john@example.com"
                value={client.discovery_sender_email || ''}
                onChange={e => setClient({ ...client, discovery_sender_email: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Sender name</label>
              <input className="form-input" placeholder="John Blackwell"
                value={client.discovery_sender_name || ''}
                onChange={e => setClient({ ...client, discovery_sender_name: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Approval WhatsApp number</label>
              <input className="form-input" placeholder="+44 7… (intl format)"
                value={client.discovery_whatsapp_number || ''}
                onChange={e => setClient({ ...client, discovery_whatsapp_number: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Daily citation-probe budget (£)</label>
              <input className="form-input" type="number" step="0.10" min="0" max="50"
                value={client.daily_citation_budget_gbp ?? '1.00'}
                onChange={e => setClient({ ...client, daily_citation_budget_gbp: e.target.value })} />
              <div className="form-hint">Citation runs pause when daily spend exceeds this cap.</div>
            </div>
          </div>
        </div>

        {/* LLM provider */}
        <div className="card">
          <div className="card-header"><span className="card-title">LLM provider (content generation)</span></div>
          <div className="card-body">
            <div className="form-group">
              <label className="form-label">Provider</label>
              <select className="form-input" value={client.llm_content_provider || 'anthropic'}
                onChange={e => setClient({ ...client, llm_content_provider: e.target.value })}>
                <option value="anthropic">Anthropic (Claude Haiku 4.5) — premium</option>
                <option value="deepseek">DeepSeek V3 — cheapest, China-hosted</option>
                <option value="qwen">Qwen 2.5 72B (via OpenRouter)</option>
                <option value="openai">OpenAI (gpt-4o-mini)</option>
                <option value="ollama">Ollama (local)</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Model (optional override)</label>
              <input className="form-input" placeholder="e.g. claude-haiku-4-5"
                value={client.llm_content_model || ''}
                onChange={e => setClient({ ...client, llm_content_model: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">API key (optional — uses .env if blank)</label>
              <input className="form-input" type="password" placeholder="••••••••"
                value={client.llm_content_api_key || ''}
                onChange={e => setClient({ ...client, llm_content_api_key: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Base URL (Ollama / self-hosted)</label>
              <input className="form-input" placeholder="http://localhost:11434/v1"
                value={client.llm_content_base_url || ''}
                onChange={e => setClient({ ...client, llm_content_base_url: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-secondary btn-sm" onClick={testLLM} disabled={pinging}>
                {pinging ? 'Testing…' : '🔌 Test connection'}
              </button>
            </div>
            {pingResult && (
              <div style={{
                marginTop: 12,
                padding: '10px 12px',
                borderRadius: 6,
                background: pingResult.ok ? '#dcfce7' : '#fee2e2',
                border: `1px solid ${pingResult.ok ? '#86efac' : '#fca5a5'}`,
                fontSize: '0.82rem',
              }}>
                {pingResult.ok ? (
                  <>
                    <strong>✅ Connected</strong> · {pingResult.latency_ms}ms<br />
                    <span style={{ color: '#64748b' }}>
                      {pingResult.result?.provider} / {pingResult.result?.model} · {pingResult.result?.tokens_in}+{pingResult.result?.tokens_out} tok · £{pingResult.result?.cost_gbp.toFixed(6)}<br />
                      Response: <em>{pingResult.result?.text}</em>
                    </span>
                  </>
                ) : (
                  <>
                    <strong>❌ Failed</strong> · {pingResult.latency_ms}ms<br />
                    <span style={{ color: '#991b1b' }}>{pingResult.error}</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, maxWidth: 920 }}>
        <button className="btn btn-primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : '💾 Save settings'}
        </button>
      </div>
    </div>
  )
}

// ─── Vertical detail (orgs / contacts / prospects sub-tabs) ───────────────────
function VerticalDetail({ clientId, verticalId, tab, onTabChange, onSelectOrg, onBack }: {
  clientId: string
  verticalId: string
  tab: 'orgs' | 'contacts' | 'prospects'
  onTabChange: (t: 'orgs' | 'contacts' | 'prospects') => void
  onSelectOrg: (id: string) => void
  onBack: () => void
}) {
  const [vertical, setVertical] = useState<Vertical | null>(null)

  useEffect(() => {
    fetch(`/api/clients/${clientId}/discovery/verticals`).then(r => r.json()).then((all: Vertical[]) => {
      setVertical(all.find(v => v.id === verticalId) || null)
    })
  }, [clientId, verticalId, tab])

  if (!vertical) return <div style={{ padding: 32 }}><span className="loading" /> Loading…</div>

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
          <div>
            <div className="page-title">{vertical.name}</div>
            <div className="page-subtitle">{vertical.org_count ?? 0} orgs · {vertical.prospect_count ?? 0} prospects</div>
          </div>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'orgs' ? 'active' : ''}`} onClick={() => onTabChange('orgs')}>🏢 Organisations</button>
        <button className={`tab ${tab === 'contacts' ? 'active' : ''}`} onClick={() => onTabChange('contacts')}>👥 Contacts</button>
        <button className={`tab ${tab === 'prospects' ? 'active' : ''}`} onClick={() => onTabChange('prospects')}>🎯 Prospects</button>
      </div>

      {tab === 'orgs' && <OrgsTab clientId={clientId} verticalId={verticalId} onSelectOrg={onSelectOrg} />}
      {tab === 'contacts' && <ContactsTab clientId={clientId} verticalId={verticalId} />}
      {tab === 'prospects' && <ProspectsTab clientId={clientId} verticalId={verticalId} />}
    </>
  )
}

// ─── Orgs tab ────────────────────────────────────────────────────────────────
function OrgsTab({ clientId, verticalId, onSelectOrg }: { clientId: string; verticalId: string; onSelectOrg: (id: string) => void }) {
  const { showToast } = useToast()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [showBulk, setShowBulk] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/discovery/verticals/${verticalId}/organizations`)
    setOrgs(await res.json())
  }, [clientId, verticalId])

  useEffect(() => { load() }, [load])

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div className="text-muted">{orgs.length} organisations</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowBulk(!showBulk)}>📋 Bulk import</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(!showAdd)}>+ Add organisation</button>
        </div>
      </div>

      {showAdd && <AddOrgForm clientId={clientId} verticalId={verticalId} onSaved={() => { load(); setShowAdd(false); showToast('Organisation added') }} onCancel={() => setShowAdd(false)} />}
      {showBulk && <BulkImportOrgs clientId={clientId} verticalId={verticalId} onDone={() => { load(); setShowBulk(false) }} />}

      {orgs.length === 0 ? (
        <div className="empty-state" style={{ padding: '40px 20px' }}>
          <div className="empty-state-icon">🏢</div>
          <div className="empty-state-title">No organisations yet</div>
          <p>Add target organisations one at a time, or paste a CSV via Bulk import.</p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Domain</th><th>Locations</th><th>Sub-segment</th><th>HQ</th><th>Contacts</th><th></th></tr>
          </thead>
          <tbody>
            {orgs.map(o => (
              <tr key={o.id}>
                <td><strong>{o.name}</strong></td>
                <td><span className="text-muted" style={{ fontSize: '0.82rem' }}>{o.domain}</span></td>
                <td>{o.location_count || '—'}</td>
                <td>{o.sub_segment ? <span className="tag">{o.sub_segment}</span> : '—'}</td>
                <td style={{ fontSize: '0.82rem', color: '#64748b' }}>{o.hq_location}</td>
                <td>{o.contact_count}</td>
                <td><button className="btn btn-ghost btn-sm" onClick={() => onSelectOrg(o.id)}>View →</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function AddOrgForm({ clientId, verticalId, onSaved, onCancel }: { clientId: string; verticalId: string; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ name: '', website: '', location_count: '', hq_location: '', hq_postcode: '', sub_segment: '', notes: '' })
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    await fetch(`/api/clients/${clientId}/discovery/verticals/${verticalId}/organizations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, location_count: Number(form.location_count) || 0 }),
    })
    setSaving(false); onSaved()
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header"><span className="card-title">New organisation</span></div>
      <div className="card-body">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <input className="form-input" placeholder="Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input className="form-input" placeholder="Website (https://...)" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} />
          <input className="form-input" placeholder="Location count" type="number" value={form.location_count} onChange={e => setForm({ ...form, location_count: e.target.value })} />
          <input className="form-input" placeholder="Sub-segment (e.g. glazing, salon)" value={form.sub_segment} onChange={e => setForm({ ...form, sub_segment: e.target.value })} />
          <input className="form-input" placeholder="HQ city" value={form.hq_location} onChange={e => setForm({ ...form, hq_location: e.target.value })} />
          <input className="form-input" placeholder="HQ postcode" value={form.hq_postcode} onChange={e => setForm({ ...form, hq_postcode: e.target.value })} />
        </div>
        <textarea className="form-input" placeholder="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} style={{ marginBottom: 12 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={submit} disabled={saving || !form.name.trim()}>{saving ? 'Saving…' : 'Save'}</button>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function BulkImportOrgs({ clientId, verticalId, onDone }: { clientId: string; verticalId: string; onDone: () => void }) {
  const { showToast } = useToast()
  const [csv, setCsv] = useState('name,website,location_count,sub_segment,hq_location,hq_postcode\n')
  const [importing, setImporting] = useState(false)

  const submit = async () => {
    setImporting(true)
    try {
      const lines = csv.trim().split('\n')
      const headers = lines[0].split(',').map(h => h.trim())
      const rows = lines.slice(1).map(line => {
        const cells = line.split(',').map(c => c.trim())
        const row: any = {}
        headers.forEach((h, i) => row[h] = cells[i] ?? '')
        return row
      }).filter(r => r.name)

      const res = await fetch(`/api/clients/${clientId}/discovery/verticals/${verticalId}/organizations/bulk`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      const data = await res.json()
      showToast(`Imported ${data.inserted} · skipped ${data.skipped}`)
      onDone()
    } catch (e: any) {
      showToast(`Import failed: ${e.message}`, 'error')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header"><span className="card-title">Bulk import (CSV)</span></div>
      <div className="card-body">
        <div className="text-muted" style={{ fontSize: '0.8rem', marginBottom: 8 }}>
          Headers required on first line. Recognised columns: <code>name, website, domain, location_count, sub_segment, hq_location, hq_postcode, companies_house_number, notes</code>. Domain is auto-derived from website if blank. Dedupes by domain within this client.
        </div>
        <textarea className="form-input" rows={10} value={csv} onChange={e => setCsv(e.target.value)} style={{ fontFamily: 'monospace', fontSize: '0.82rem' }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn btn-primary btn-sm" onClick={submit} disabled={importing}>{importing ? 'Importing…' : 'Import'}</button>
          <button className="btn btn-ghost btn-sm" onClick={onDone}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ─── Contacts tab (vertical-wide) ────────────────────────────────────────────
type ContactSortKey = 'name' | 'role' | 'org' | 'confidence' | 'outreach'
type OutreachFilter = 'all' | 'not_contacted' | 'messaged'

function ContactsTab({ clientId, verticalId }: { clientId: string; verticalId: string }) {
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [contactsByOrg, setContactsByOrg] = useState<Record<string, Contact[]>>({})
  const [showBulk, setShowBulk] = useState(false)
  const [sortKey, setSortKey] = useState<ContactSortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [filter, setFilter] = useState('')
  const [outreachFilter, setOutreachFilter] = useState<OutreachFilter>('all')

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/discovery/verticals/${verticalId}/organizations`)
    const orgList: Organization[] = await res.json()
    setOrgs(orgList)
    const all = await Promise.all(orgList.map(async o => {
      const r = await fetch(`/api/clients/${clientId}/discovery/organizations/${o.id}/contacts`)
      return [o.id, await r.json()] as [string, Contact[]]
    }))
    setContactsByOrg(Object.fromEntries(all))
  }, [clientId, verticalId])

  useEffect(() => { load() }, [load])

  const totalContacts = Object.values(contactsByOrg).reduce((sum, arr) => sum + arr.length, 0)
  const messagedCount = Object.values(contactsByOrg).flat().filter(c => c.outreach_status === 'messaged').length

  const toggleSort = (key: ContactSortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }
  const arrow = (key: ContactSortKey) => (sortKey !== key ? '' : sortDir === 'asc' ? ' ↑' : ' ↓')

  let rows = orgs.flatMap(o => (contactsByOrg[o.id] || []).map(c => ({ c, o })))

  if (outreachFilter !== 'all') {
    rows = rows.filter(({ c }) => (c.outreach_status || 'not_contacted') === outreachFilter)
  }
  if (filter.trim()) {
    const f = filter.trim().toLowerCase()
    rows = rows.filter(({ c, o }) =>
      c.full_name.toLowerCase().includes(f) ||
      (c.role || '').toLowerCase().includes(f) ||
      o.name.toLowerCase().includes(f))
  }

  const dir = sortDir === 'asc' ? 1 : -1
  rows = [...rows].sort((a, b) => {
    switch (sortKey) {
      case 'name':       return a.c.full_name.localeCompare(b.c.full_name) * dir
      case 'role':       return (a.c.role || '').localeCompare(b.c.role || '') * dir
      case 'org':        return a.o.name.localeCompare(b.o.name) * dir
      case 'confidence': return ((a.c.source_confidence || 0) - (b.c.source_confidence || 0)) * dir
      case 'outreach': {
        const av = a.c.outreach_status === 'messaged' ? (a.c.outreach_sent_at || 0) : -1
        const bv = b.c.outreach_status === 'messaged' ? (b.c.outreach_sent_at || 0) : -1
        return (av - bv) * dir
      }
    }
  })

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div className="text-muted">
          {totalContacts} contacts across {orgs.length} organisations · <strong>{messagedCount} messaged</strong>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowBulk(!showBulk)}>📥 Leadswift CSV import</button>
      </div>

      {showBulk && <BulkImportContacts clientId={clientId} onDone={() => { load(); setShowBulk(false) }} />}

      {totalContacts === 0 ? (
        <div className="empty-state" style={{ padding: '40px 20px' }}>
          <div className="empty-state-icon">👥</div>
          <div className="empty-state-title">No contacts yet</div>
          <p>Import contacts from Leadswift via CSV. Match against existing organisations by domain.</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="form-input" style={{ maxWidth: 240 }} placeholder="Search name, role, org…"
              value={filter} onChange={e => setFilter(e.target.value)} />
            <div style={{ display: 'flex', gap: 6 }}>
              {(['all', 'not_contacted', 'messaged'] as OutreachFilter[]).map(f => (
                <button key={f}
                  className={`btn btn-sm ${outreachFilter === f ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setOutreachFilter(f)}>
                  {f === 'all' ? 'All' : f === 'messaged' ? '✓ Messaged' : 'Not contacted'}
                </button>
              ))}
            </div>
            <div className="text-muted" style={{ fontSize: '0.8rem' }}>{rows.length} shown</div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('name')}>Name{arrow('name')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('role')}>Role{arrow('role')}</th>
                <th>Email</th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('org')}>Org{arrow('org')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('confidence')}>Source{arrow('confidence')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('outreach')}>LinkedIn outreach{arrow('outreach')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, o }) => (
                <tr key={c.id}>
                  <td><strong>{c.full_name}</strong></td>
                  <td>{c.role}</td>
                  <td><span style={{ fontSize: '0.82rem' }}>{c.email}</span></td>
                  <td><span className="tag">{o.name}</span></td>
                  <td><span className="text-muted" style={{ fontSize: '0.78rem' }}>{c.source} ({c.source_confidence}%)</span></td>
                  <td><OutreachCell clientId={clientId} contact={c} onUpdated={load} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

// ─── LinkedIn outreach: generate / copy / open profile / mark sent ─────────────────────────────
// LinkedIn has no self-serve send API — this drafts a personalised message and
// gets it one click from being sent, but a human always clicks Send in LinkedIn
// itself. Never automates the actual send (that's a ToS/ban risk on a real account).
function relativeDays(unixSeconds: number): string {
  const days = Math.floor((Date.now() / 1000 - unixSeconds) / 86400)
  if (days <= 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

// Contact Magnetism — shows what real, captured context is grounding the draft,
// and how fresh it is. No context = an honest prompt to go capture some.
function ContextMagnetBanner({ contact }: { contact: Contact }) {
  let ctx: any = null
  try { ctx = contact.contact_context ? JSON.parse(contact.contact_context) : null } catch { /* malformed */ }
  const has = ctx && ((ctx.recent_posts?.length) || ctx.about || (ctx.mutual_connections?.length) || (ctx.shared?.length) || (ctx.featured?.length) || ctx.current_role || (ctx.certifications?.length))

  if (!has) {
    return (
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted, #94a3b8)', margin: '4px 0 10px', padding: '8px 10px', border: '1px dashed var(--border, #334155)', borderRadius: 8 }}>
        🧲 No captured context yet — view their LinkedIn profile with the βWave extension to ground this message in something real about them.
      </div>
    )
  }

  const ageDays = contact.context_captured_at ? Math.floor((Date.now() / 1000 - contact.context_captured_at) / 86400) : null
  const stale = ageDays !== null && ageDays > 14
  const bits: string[] = []
  if (ctx.recent_posts?.length) bits.push(`${ctx.recent_posts.length} recent post${ctx.recent_posts.length === 1 ? '' : 's'}`)
  if (ctx.about) bits.push('bio')
  if (ctx.mutual_connections?.length) bits.push(`${ctx.mutual_connections.length} mutual`)
  if (ctx.shared?.length) bits.push('shared context')
  if (ctx.current_role) bits.push('current role')
  if (ctx.featured?.length) bits.push('featured content')
  if (ctx.certifications?.length) bits.push(`${ctx.certifications.length} certification${ctx.certifications.length === 1 ? '' : 's'}`)

  return (
    <div style={{ fontSize: '0.78rem', margin: '4px 0 10px', padding: '8px 10px', background: 'color-mix(in oklab, var(--accent, #22D3EE) 10%, transparent)', border: '1px solid color-mix(in oklab, var(--accent, #22D3EE) 35%, transparent)', borderRadius: 8 }}>
      <strong>🧲 Grounded in real context</strong> — {bits.join(' · ')}
      {contact.context_captured_at && (
        <span style={{ color: stale ? 'var(--text-warning, #f59e0b)' : 'var(--text-muted, #94a3b8)' }}>
          {' '}· captured {relativeDays(contact.context_captured_at)}{stale ? ' (getting stale — re-capture for a fresher opener)' : ''}
        </span>
      )}
    </div>
  )
}

function OutreachCell({ clientId, contact, onUpdated }: { clientId: string; contact: Contact; onUpdated: () => void }) {
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(contact.outreach_message || '')
  const [loading, setLoading] = useState(false)

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/clients/${clientId}/discovery/contacts/${contact.id}/generate-message`, { method: 'POST' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'generate failed')
      setDraft(data.message)
    } catch (e: any) {
      showToast(`Couldn't generate message: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [clientId, contact.id, showToast])

  const openPanel = () => {
    setOpen(true)
    if (!draft) generate()
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft)
      showToast('Copied — paste it into LinkedIn and hit send')
    } catch {
      showToast('Copy failed — select the text manually')
    }
  }

  const markSent = async () => {
    const r = await fetch(`/api/clients/${clientId}/discovery/contacts/${contact.id}/mark-messaged`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: draft }),
    })
    if (r.ok) { showToast('Marked as messaged'); setOpen(false); onUpdated() }
  }

  if (contact.outreach_status === 'messaged') {
    return (
      <span className="tag" style={{ background: 'var(--accent-soft, #e6f7f0)' }}>
        ✓ messaged{contact.outreach_sent_at ? ` · ${relativeDays(contact.outreach_sent_at)}` : ''}
      </span>
    )
  }

  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={openPanel} disabled={!contact.linkedin_url}
        title={contact.linkedin_url ? '' : 'No LinkedIn URL on this contact'}>
        ✉️ Message
      </button>
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Message {contact.full_name}</h3>
            <p className="text-muted" style={{ fontSize: '0.85rem', marginTop: -8 }}>
              Draft it, copy it, open their profile, paste and send yourself — βWave never sends LinkedIn messages automatically.
            </p>
            <ContextMagnetBanner contact={contact} />
            <textarea className="form-input" rows={6} value={draft} onChange={e => setDraft(e.target.value)}
              placeholder={loading ? 'Generating…' : ''} disabled={loading} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost btn-sm" onClick={generate} disabled={loading}>↻ Regenerate</button>
              <button className="btn btn-primary btn-sm" onClick={copy} disabled={loading || !draft}>📋 Copy</button>
              <a className="btn btn-ghost btn-sm" href={contact.linkedin_url} target="_blank" rel="noopener noreferrer">Open LinkedIn →</a>
              <button className="btn btn-ghost btn-sm" onClick={markSent} disabled={loading || !draft}>✓ Mark as sent</button>
            </div>
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function BulkImportContacts({ clientId, onDone }: { clientId: string; onDone: () => void }) {
  const { showToast } = useToast()
  const [csv, setCsv] = useState('full_name,role,email,linkedin_url,organization_domain\n')
  const [importing, setImporting] = useState(false)

  const submit = async () => {
    setImporting(true)
    try {
      const lines = csv.trim().split('\n')
      const headers = lines[0].split(',').map(h => h.trim())
      const rows = lines.slice(1).map(line => {
        const cells = line.split(',').map(c => c.trim())
        const row: any = {}
        headers.forEach((h, i) => row[h] = cells[i] ?? '')
        return row
      }).filter(r => r.full_name)

      const res = await fetch(`/api/clients/${clientId}/discovery/contacts/bulk`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      const data = await res.json()
      showToast(`Imported ${data.inserted} · skipped ${data.skipped} · ${data.no_org_match} unmatched`)
      onDone()
    } catch (e: any) {
      showToast(`Import failed: ${e.message}`, 'error')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header"><span className="card-title">Leadswift CSV import</span></div>
      <div className="card-body">
        <div className="text-muted" style={{ fontSize: '0.8rem', marginBottom: 8 }}>
          Required column: <code>full_name</code>. Match column: <code>organization_domain</code> (links to existing org for THIS client). Other columns: <code>role, email, linkedin_url</code>. Rows without a domain match are skipped.
        </div>
        <textarea className="form-input" rows={10} value={csv} onChange={e => setCsv(e.target.value)} style={{ fontFamily: 'monospace', fontSize: '0.82rem' }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn btn-primary btn-sm" onClick={submit} disabled={importing}>{importing ? 'Importing…' : 'Import'}</button>
          <button className="btn btn-ghost btn-sm" onClick={onDone}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ─── Prospects tab ────────────────────────────────────────────────────────────
function ProspectsTab({ clientId, verticalId }: { clientId: string; verticalId: string }) {
  const [prospects, setProspects] = useState<Prospect[]>([])

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/discovery/verticals/${verticalId}/prospects`)
    setProspects(await res.json())
  }, [clientId, verticalId])

  useEffect(() => { load() }, [load])

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div className="text-muted">{prospects.length} ranked prospects (lowest visibility = highest pain)</div>
      </div>

      {prospects.length === 0 ? (
        <div className="empty-state" style={{ padding: '40px 20px' }}>
          <div className="empty-state-icon">🎯</div>
          <div className="empty-state-title">No prospects scored yet</div>
          <p>Prospects auto-promote from organisations after a citation run completes against this vertical's queries.</p>
        </div>
      ) : (
        <table className="table">
          <thead><tr><th>Rank</th><th>Organisation</th><th>Visibility</th><th>Locations</th><th>Contacts</th><th>Status</th></tr></thead>
          <tbody>
            {prospects.map(p => (
              <tr key={p.id}>
                <td><strong>#{p.rank}</strong></td>
                <td>
                  <div style={{ fontWeight: 600 }}>{p.org_name}</div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{p.domain}</div>
                </td>
                <td><ScoreBar score={p.visibility_score} /></td>
                <td>{p.location_count || '—'}</td>
                <td>{p.contact_count}</td>
                <td><StatusSelect clientId={clientId} prospect={p} onChanged={load} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const colour = score < 0.1 ? '#dc2626' : score < 0.25 ? '#f59e0b' : score < 0.5 ? '#3b82f6' : '#16a34a'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <div style={{ flex: 1, height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(pct, 4)}%`, height: '100%', background: colour }} />
      </div>
      <span style={{ fontSize: '0.78rem', color: '#64748b', minWidth: 36, textAlign: 'right' }}>{pct}%</span>
    </div>
  )
}

const PROSPECT_STATUSES = ['scored', 'approved', 'diagnostic', 'sent', 'engaged', 'hot', 'proposal', 'won', 'cold', 'skipped'] as const
// Statuses that get a timestamp column stamped when first set
const STATUS_STAMP: Record<string, string> = { approved: 'approved_at', sent: 'sent_at', hot: 'hot_at', won: 'won_at', cold: 'lost_at', skipped: 'lost_at' }

function StatusSelect({ clientId, prospect, onChanged }: { clientId: string; prospect: { id: string; status: string }; onChanged: () => void }) {
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)

  const change = async (status: string) => {
    if (status === prospect.status) return
    setSaving(true)
    const body: any = { status }
    if (STATUS_STAMP[status]) body[STATUS_STAMP[status]] = Math.floor(Date.now() / 1000)
    const res = await fetch(`/api/clients/${clientId}/discovery/prospects/${prospect.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    setSaving(false)
    if (res.ok) { showToast(`Status → ${status}`); onChanged() }
    else { const d = await res.json().catch(() => ({})); showToast(d.error || 'Update failed', 'error') }
  }

  const colour: Record<string, string> = {
    scored: '#94a3b8', approved: '#3b82f6', diagnostic: '#7c3aed', sent: '#0891b2',
    engaged: '#f59e0b', hot: '#dc2626', proposal: '#a855f7', won: '#16a34a',
    cold: '#64748b', skipped: '#64748b',
  }
  const c = colour[prospect.status] ?? '#64748b'

  return (
    <select
      value={prospect.status}
      disabled={saving}
      onChange={e => change(e.target.value)}
      style={{
        background: `${c}22`, color: c, border: `1px solid ${c}44`, borderRadius: 6,
        padding: '3px 6px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
      }}
    >
      {PROSPECT_STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
    </select>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    scored: '#94a3b8', approved: '#3b82f6', diagnostic: '#7c3aed', sent: '#0891b2',
    engaged: '#f59e0b', hot: '#dc2626', proposal: '#a855f7', won: '#16a34a',
    cold: '#64748b', skipped: '#64748b',
  }
  return <span className="tag" style={{ background: `${map[status] ?? '#94a3b8'}22`, color: map[status] ?? '#64748b' }}>{status}</span>
}

// ─── Org detail (drill-down with contacts) ───────────────────────────────────
function OrgDetail({ clientId, orgId, onBack }: { clientId: string; orgId: string; onBack: () => void }) {
  const { showToast } = useToast()
  const [org, setOrg] = useState<Organization | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [showAddContact, setShowAddContact] = useState(false)

  const load = useCallback(async () => {
    const c = await fetch(`/api/clients/${clientId}/discovery/organizations/${orgId}/contacts`).then(r => r.json())
    setContacts(c)

    // Find org via the verticals list (no GET-by-id endpoint; keep it tight)
    const verticals = await fetch(`/api/clients/${clientId}/discovery/verticals`).then(r => r.json()) as Vertical[]
    for (const v of verticals) {
      const list = await fetch(`/api/clients/${clientId}/discovery/verticals/${v.id}/organizations`).then(r => r.json()) as Organization[]
      const found = list.find(o => o.id === orgId)
      if (found) { setOrg(found); break }
    }
  }, [clientId, orgId])

  useEffect(() => { load() }, [load])

  if (!org) return <div style={{ padding: 32 }}><span className="loading" /> Loading…</div>

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
          <div>
            <div className="page-title">{org.name}</div>
            <div className="page-subtitle">{org.domain} · {org.location_count} locations · {org.hq_location}</div>
          </div>
        </div>
      </div>

      <div className="page-content">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <span className="card-title">Contacts ({contacts.length})</span>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddContact(!showAddContact)}>+ Add</button>
          </div>
          <div className="card-body">
            {showAddContact && <AddContactForm clientId={clientId} orgId={orgId} onSaved={() => { load(); setShowAddContact(false); showToast('Contact added') }} onCancel={() => setShowAddContact(false)} />}
            {contacts.length === 0 ? (
              <div className="text-muted">No contacts yet for this organisation.</div>
            ) : (
              <table className="table">
                <thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Source</th></tr></thead>
                <tbody>
                  {contacts.map(c => (
                    <tr key={c.id}>
                      <td><strong>{c.full_name}</strong></td>
                      <td>{c.role}</td>
                      <td>{c.email}</td>
                      <td><span className="text-muted" style={{ fontSize: '0.78rem' }}>{c.source} ({c.source_confidence}%)</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function AddContactForm({ clientId, orgId, onSaved, onCancel }: { clientId: string; orgId: string; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ full_name: '', role: '', email: '', linkedin_url: '' })
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!form.full_name.trim()) return
    setSaving(true)
    await fetch(`/api/clients/${clientId}/discovery/organizations/${orgId}/contacts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, source: 'manual' }),
    })
    setSaving(false); onSaved()
  }

  return (
    <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, marginBottom: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <input className="form-input" placeholder="Full name *" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
        <input className="form-input" placeholder="Role" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} />
        <input className="form-input" placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        <input className="form-input" placeholder="LinkedIn URL" value={form.linkedin_url} onChange={e => setForm({ ...form, linkedin_url: e.target.value })} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={submit} disabled={saving || !form.full_name.trim()}>Save</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
