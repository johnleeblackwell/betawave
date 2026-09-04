import { fmtMoney, fmtCost, CURRENCY_SYMBOL } from '../lib/money'
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
  contacts?: { full_name: string; role: string; linkedin_url: string }[]
  google_rating?: number | null
  google_reviews?: number | null
  search_status?: 'not_searched' | 'searched_no_match'
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
  priority_score?: number
  email_status?: string
  email_confidence?: number | null
  email_source?: string
  suppressed?: number
  suppressed_reason?: string
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
  | { type: 'today' }
  | { type: 'settings' }
  | { type: 'vertical'; verticalId: string; tab: 'orgs' | 'contacts' | 'prospects' }
  | { type: 'org'; orgId: string; verticalId: string }

export default function DiscoveryHub({ clientId, initialView }: { clientId: string; initialView?: string }) {
  // `?view=today` on the URL opens straight into the outreach queue, so a
  // browser side panel can sit on it beside a mail client. Read once on mount;
  // after that it's ordinary in-app state.
  const [view, setView] = useState<View>(
    initialView === 'today' ? { type: 'today' } : { type: 'home' },
  )
  const [verticals, setVerticals] = useState<Vertical[]>([])

  const loadVerticals = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/discovery/verticals`)
    setVerticals(await res.json())
  }, [clientId])

  useEffect(() => { loadVerticals() }, [loadVerticals])

  if (view.type === 'home') {
    return <HomeView clientId={clientId} verticals={verticals} reload={loadVerticals}
      onSelectVertical={vid => setView({ type: 'vertical', verticalId: vid, tab: 'orgs' })}
      onOpenToday={() => setView({ type: 'today' })}
      onOpenSettings={() => setView({ type: 'settings' })} />
  }
  if (view.type === 'today') {
    return <TodayView clientId={clientId} onBack={() => setView({ type: 'home' })} />
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
function HomeView({ clientId, verticals, reload, onSelectVertical, onOpenToday, onOpenSettings }: {
  clientId: string
  verticals: Vertical[]
  reload: () => void
  onSelectVertical: (id: string) => void
  onOpenToday: () => void
  onOpenSettings: () => void
}) {
  const { showToast } = useToast()
  const [showAddVertical, setShowAddVertical] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [seeding, setSeeding] = useState(false)

  const seed = async (template: 'local-sprint' | 'geo-bz' | 'vivid-ink') => {
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
          <button className="btn btn-secondary btn-sm" onClick={() => setShowAddVertical(!showAddVertical)}>+ Add vertical</button>
          <button className="btn btn-primary btn-sm" onClick={onOpenToday}>▶ Today's outreach</button>
        </div>
      </div>

      {showAddVertical && <AddVerticalForm clientId={clientId} onSaved={() => { reload(); setShowAddVertical(false) }} onCancel={() => setShowAddVertical(false)} />}

      {showTemplates && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="text-muted" style={{ fontSize: '0.85rem', marginRight: 4 }}>Seed a curated vertical set (skips any that already exist):</span>
            <button className="btn btn-primary btn-sm" disabled={seeding} onClick={() => seed('local-sprint')}>
              🏃 Local sprint (Dentists / Aesthetics / Home / Legal / Vets)
            </button>
            <button className="btn btn-secondary btn-sm" disabled={seeding} onClick={() => seed('geo-bz')}>
              Multi-unit (Home / Trades / Beauty)
            </button>
            <button className="btn btn-secondary btn-sm" disabled={seeding} onClick={() => seed('vivid-ink')}>
              Events &amp; culture
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
              <button className="btn btn-primary btn-sm" disabled={seeding} onClick={() => seed('geo-bz')}>
                Local services (Home / Trades / Beauty)
              </button>
              <button className="btn btn-secondary btn-sm" disabled={seeding} onClick={() => seed('vivid-ink')}>
                Events & culture (Conventions / Music / Editorial / Corporate)
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
              <label className="form-label">Daily citation-probe budget ({CURRENCY_SYMBOL})</label>
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
                      {pingResult.result?.provider} / {pingResult.result?.model} · {pingResult.result?.tokens_in}+{pingResult.result?.tokens_out} tok · {fmtMoney(pingResult.result?.cost_gbp, 6)}<br />
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
type SortKey = 'name' | 'domain' | 'location_count' | 'sub_segment' | 'hq_location' | 'contact_count' | 'google_rating' | 'google_reviews'

function OrgsTab({ clientId, verticalId, onSelectOrg }: { clientId: string; verticalId: string; onSelectOrg: (id: string) => void }) {
  const { showToast } = useToast()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [filter, setFilter] = useState('')
  const [needsSearchOnly, setNeedsSearchOnly] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/discovery/verticals/${verticalId}/organizations`)
    setOrgs(await res.json())
  }, [clientId, verticalId])

  useEffect(() => { load() }, [load])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'google_reviews' || key === 'google_rating' ? 'desc' : 'asc') }
  }

  const toggleNeedsSearch = () => {
    const next = !needsSearchOnly
    setNeedsSearchOnly(next)
    if (next) { setSortKey('google_reviews'); setSortDir('desc') }
  }

  const markSearched = async (org: Organization) => {
    const next = org.search_status === 'searched_no_match' ? 'not_searched' : 'searched_no_match'
    await fetch(`/api/clients/${clientId}/discovery/organizations/${org.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ search_status: next }),
    })
    load()
  }

  const sortArrow = (key: SortKey) => sortKey !== key ? '' : sortDir === 'asc' ? ' ▲' : ' ▼'

  const filtered = orgs.filter(o => {
    if (needsSearchOnly && (o.contact_count ?? 0) > 0) return false
    if (needsSearchOnly && o.search_status === 'searched_no_match') return false
    if (!filter.trim()) return true
    const q = filter.toLowerCase()
    return o.name.toLowerCase().includes(q)
      || o.domain?.toLowerCase().includes(q)
      || o.hq_location?.toLowerCase().includes(q)
      || o.sub_segment?.toLowerCase().includes(q)
      || (o.contacts || []).some(c => c.full_name.toLowerCase().includes(q))
  })

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey] ?? ''
    const bv = b[sortKey] ?? ''
    const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
    return sortDir === 'asc' ? cmp : -cmp
  })

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="text-muted">{filtered.length} of {orgs.length} organisations</div>
          <input className="form-input" placeholder="Filter by name, domain, HQ, contact…" value={filter}
            onChange={e => setFilter(e.target.value)} style={{ width: 260, fontSize: '0.82rem', padding: '4px 8px' }} />
          <button
            className={`btn btn-sm ${needsSearchOnly ? 'btn-primary' : 'btn-secondary'}`}
            onClick={toggleNeedsSearch}
            title="Show organisations with no contact yet, ranked by Google review count"
          >
            🎯 Needs Sales Nav search
          </button>
        </div>
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
            <tr>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('name')}>Name{sortArrow('name')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('domain')}>Domain{sortArrow('domain')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('location_count')}>Locations{sortArrow('location_count')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('sub_segment')}>Sub-segment{sortArrow('sub_segment')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('hq_location')}>HQ{sortArrow('hq_location')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('google_rating')}>★{sortArrow('google_rating')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('google_reviews')}>Reviews{sortArrow('google_reviews')}</th>
              <th>Contacts</th>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('contact_count')}># {sortArrow('contact_count')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(o => (
              <tr key={o.id}>
                <td><strong>{o.name}</strong></td>
                <td><span className="text-muted" style={{ fontSize: '0.82rem' }}>{o.domain}</span></td>
                <td>{o.location_count || '—'}</td>
                <td>{o.sub_segment ? <span className="tag">{o.sub_segment}</span> : '—'}</td>
                <td style={{ fontSize: '0.82rem', color: '#64748b' }}>{o.hq_location}</td>
                <td style={{ fontSize: '0.82rem' }}>{o.google_rating ?? '—'}</td>
                <td style={{ fontSize: '0.82rem' }}>{o.google_reviews ?? '—'}</td>
                <td>
                  {(o.contacts?.length ?? 0) === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {o.search_status === 'searched_no_match' ? (
                        <span className="text-muted" style={{ fontSize: '0.76rem' }}>searched, no match</span>
                      ) : (
                        <span className="text-muted" style={{ fontSize: '0.8rem' }}>—</span>
                      )}
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: '0.72rem', padding: '1px 6px' }}
                        onClick={() => markSearched(o)}
                        title={o.search_status === 'searched_no_match' ? 'Reset to not searched' : 'Mark as searched on Sales Navigator with no result'}
                      >
                        {o.search_status === 'searched_no_match' ? '↺ reset' : '✓ mark searched'}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {o.contacts!.map((c, i) => (
                        c.linkedin_url ? (
                          <a key={i} href={c.linkedin_url} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem' }}>
                            {c.full_name}{c.role ? <span className="text-muted"> · {c.role}</span> : null}
                          </a>
                        ) : (
                          <span key={i} style={{ fontSize: '0.8rem' }}>
                            {c.full_name}{c.role ? <span className="text-muted"> · {c.role}</span> : null}
                          </span>
                        )
                      ))}
                      {(o.contact_count ?? 0) > (o.contacts?.length ?? 0) && (
                        <span className="text-muted" style={{ fontSize: '0.74rem' }}>
                          +{(o.contact_count ?? 0) - (o.contacts?.length ?? 0)} more
                        </span>
                      )}
                    </div>
                  )}
                </td>
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
  const [csv, setCsv] = useState('')
  const [importing, setImporting] = useState(false)
  const [preview, setPreview] = useState<any>(null)

  // Parsing is server-side now. The old client-side split(',') destroyed any
  // row with a quoted comma — which is every row with an address.
  const send = async (dryRun: boolean) => {
    setImporting(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/discovery/verticals/${verticalId}/organizations/import-csv`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, dry_run: dryRun }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPreview(null)
        showToast(data.error || 'Import failed', 'error')
        return
      }
      if (dryRun) { setPreview(data); return }
      showToast(`Imported ${data.inserted} orgs · ${data.contacts} contacts · skipped ${data.skipped} duplicates`)
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
          Paste a lead-tool export exactly as it came out — LeadSwift, Apollo, a Google Sheet.
          Column names are matched loosely (<code>name / business_name / company</code>,
          <code> website / url</code>, <code>email</code>, <code>address</code>, <code>phone</code>,
          <code> category</code>, <code>rating</code>, <code>reviews</code>), so you shouldn't need to
          edit headers. Quoted commas inside addresses are handled. Emails become contacts on the
          business. Dedupes by domain within this client.
        </div>
        <textarea className="form-input" rows={10} value={csv} placeholder="Paste CSV including its header row…"
                  onChange={e => { setCsv(e.target.value); setPreview(null) }}
                  style={{ fontFamily: 'monospace', fontSize: '0.82rem' }} />

        {preview && (
          <div style={{ marginTop: 10, padding: 12, borderRadius: 8, background: 'var(--bg-elevated-2)', fontSize: '0.82rem' }}>
            <strong>{preview.rows} rows readable</strong> · {preview.with_email} with an email · {preview.with_domain} with a domain
            <div style={{ color: 'var(--text-tertiary)', marginTop: 6, wordBreak: 'break-word' }}>
              Columns seen: {(preview.headers_seen || []).join(', ')}
            </div>
            {preview.sample?.[0] && (
              <div style={{ color: 'var(--text-tertiary)', marginTop: 6 }}>
                First row reads as: <strong>{preview.sample[0].name}</strong>
                {preview.sample[0].hq_location && ` · ${preview.sample[0].hq_location}`}
                {preview.sample[0].email && ` · ${preview.sample[0].email}`}
              </div>
            )}
            <div style={{ marginTop: 6 }}>
              If a column landed in the wrong place, say so before importing.
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => send(true)} disabled={importing || !csv.trim()}>
            {importing ? 'Checking…' : '🔍 Check mapping first'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => send(false)} disabled={importing || !csv.trim()}>
            {importing ? 'Importing…' : 'Import'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onDone}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ─── Contacts tab (vertical-wide) ────────────────────────────────────────────
type ContactSortKey = 'name' | 'role' | 'org' | 'confidence' | 'outreach' | 'priority'
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
      case 'priority':   return ((a.c.priority_score ?? 50) - (b.c.priority_score ?? 50)) * dir
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
        <div style={{ display: 'flex', gap: 8 }}>
          <BulkFindEmails clientId={clientId} verticalId={verticalId} onDone={load} />
          <button className="btn btn-primary btn-sm" onClick={() => setShowBulk(!showBulk)}>📥 Leadswift CSV import</button>
        </div>
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
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('priority')}>Priority{arrow('priority')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('outreach')}>LinkedIn outreach{arrow('outreach')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, o }) => (
                <tr key={c.id}>
                  <td><strong>{c.full_name}</strong></td>
                  <td>{c.role}</td>
                  <td><EmailCell clientId={clientId} contact={c} onUpdated={load} /></td>
                  <td><span className="tag">{o.name}</span></td>
                  <td><span className="text-muted" style={{ fontSize: '0.78rem' }}>{c.source} ({c.source_confidence}%)</span></td>
                  <td>
                    <span className="tag" style={{
                      background: (c.priority_score ?? 50) >= 70 ? 'color-mix(in oklab, var(--accent, #22D3EE) 20%, transparent)' : undefined,
                    }}>{c.priority_score ?? 50}</span>
                  </td>
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

// Bulk lookup — capped and highest-priority-first, because these are paid,
// rate-limited APIs. Deliberately not a "do all 404" button: that's how people
// burn a month of credits on contacts they'll never actually message.
function BulkFindEmails({ clientId, verticalId, onDone }: { clientId: string; verticalId: string; onDone: () => void }) {
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!confirm('Look up emails for the top 25 un-searched contacts by priority?\n\nThis spends credits on your own Apollo/Hunter key.')) return
    setBusy(true)
    try {
      const r = await fetch(`/api/clients/${clientId}/discovery/verticals/${verticalId}/find-emails`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 25 }),
      })
      const data = await r.json()
      if (!r.ok) { showToast(data.error || 'Bulk lookup failed'); return }
      showToast(`${data.found} found, ${data.missed} no match (of ${data.attempted})${data.errors?.length ? ` — ${data.errors[0]}` : ''}`)
      onDone()
    } catch (e: any) {
      showToast(`Bulk lookup failed: ${e.message}`)
    } finally { setBusy(false) }
  }

  return (
    <button className="btn btn-ghost btn-sm" onClick={run} disabled={busy}>
      {busy ? 'Looking up…' : '🔍 Find emails (top 25)'}
    </button>
  )
}

// ─── Email discovery (BYO key) ───────────────────────────────────────────────
// Shows provenance, not just an address: a provider-verified email and a
// pattern-guessed one look different on purpose, because sending to guesses is
// what gets a domain blacklisted. Never displays an address we didn't get back
// from a provider.
function EmailCell({ clientId, contact, onUpdated }: { clientId: string; contact: Contact; onUpdated: () => void }) {
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)

  const find = async () => {
    setBusy(true)
    try {
      const r = await fetch(`/api/clients/${clientId}/discovery/contacts/${contact.id}/find-email`, { method: 'POST' })
      const data = await r.json()
      if (!r.ok) { showToast(data.error || 'No email found'); return }
      showToast(`Found ${data.email} (${data.source}, ${data.confidence ?? '?'}% confidence)`)
      onUpdated()
    } catch (e: any) {
      showToast(`Lookup failed: ${e.message}`)
    } finally { setBusy(false); }
  }

  const verify = async () => {
    setBusy(true)
    try {
      const r = await fetch(`/api/clients/${clientId}/discovery/contacts/${contact.id}/verify-email`, { method: 'POST' })
      const data = await r.json()
      if (!r.ok) { showToast(data.error || 'Verify failed'); return }
      showToast(data.status === 'verified' ? 'Verified — safe to send'
        : data.status === 'invalid' ? 'Invalid — do NOT send, it will bounce'
        : 'Unproven (accept-all server) — send with care')
      onUpdated()
    } catch (e: any) {
      showToast(`Verify failed: ${e.message}`)
    } finally { setBusy(false) }
  }

  if (contact.suppressed) {
    return <span className="text-muted" style={{ fontSize: '0.78rem' }}>🚫 suppressed</span>
  }

  if (contact.email) {
    const verified = contact.email_status === 'verified'
    const invalid = contact.email_status === 'invalid'
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: '0.8rem', textDecoration: invalid ? 'line-through' : undefined }}>{contact.email}</span>
        <span style={{ fontSize: '0.7rem', color: invalid ? '#f87171' : verified ? '#10b981' : 'var(--text-muted, #94a3b8)' }}>
          {invalid ? '✗ invalid — will bounce'
            : verified ? '✓ verified'
            : `~ unverified${contact.email_confidence != null ? ` (${contact.email_confidence}%)` : ''}`}
          {contact.email_source ? ` · ${contact.email_source}` : ''}
          {!verified && !invalid && (
            <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.68rem', padding: '0 4px', marginLeft: 4 }}
              onClick={verify} disabled={busy}>verify</button>
          )}
        </span>
      </div>
    )
  }

  if (contact.email_status === 'not_found') {
    return (
      <span className="text-muted" style={{ fontSize: '0.76rem' }}>
        no match
        <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.68rem', padding: '0 4px', marginLeft: 4 }}
          onClick={find} disabled={busy}>retry</button>
      </span>
    )
  }

  return (
    <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.72rem', padding: '2px 6px' }}
      onClick={find} disabled={busy}>{busy ? '…' : '🔍 Find'}</button>
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
        🧲 No captured context yet — view their LinkedIn profile with the βWave™ extension to ground this message in something real about them.
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

  const suppress = async () => {
    if (!confirm(`Mark ${contact.full_name} as do-not-contact?\n\nThey'll be excluded from messaging and email lookup on every channel.`)) return
    await fetch(`/api/clients/${clientId}/discovery/contacts/${contact.id}/suppress`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'manual' }),
    })
    showToast(`${contact.full_name} suppressed`)
    onUpdated()
  }

  // Suppression wins over everything — no drafting, no lookup, no send.
  if (contact.suppressed) {
    return (
      <span className="text-muted" style={{ fontSize: '0.76rem' }}>
        🚫 do not contact
        <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.68rem', padding: '0 4px', marginLeft: 4 }}
          onClick={async () => {
            await fetch(`/api/clients/${clientId}/discovery/contacts/${contact.id}/suppress`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ undo: true }),
            })
            onUpdated()
          }}>undo</button>
      </span>
    )
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
      <button className="btn btn-ghost btn-sm" onClick={suppress}
        style={{ fontSize: '0.7rem', padding: '2px 5px', marginLeft: 4, opacity: 0.6 }}
        title="Mark do-not-contact — excludes them from messaging and email lookup everywhere">
        🚫
      </button>
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Message {contact.full_name}</h3>
            <p className="text-muted" style={{ fontSize: '0.85rem', marginTop: -8 }}>
              Draft it, copy it, open their profile, paste and send yourself — βWave™ never sends LinkedIn messages automatically.
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

// ─── Today's outreach queue ─────────────────────────────────────────────────
// The surface you open each morning. Serves the highest-priority uncontacted
// leads split by the channel that can actually reach them, and tracks progress
// against the daily cap — going over gets the LinkedIn account restricted,
// which ends a campaign rather than slowing it.
//
// Status is written back from the capture extension ON LinkedIn (see
// /api/leads/mark-contacted), not here — asking someone to come back and tick a
// box is the step everyone skips. This view just re-reads on focus, so
// returning from a LinkedIn tab shows the list already shortened.

interface QueueRow {
  id: string
  full_name: string
  role: string
  company: string
  linkedin_url: string
  priority_score: number
}
interface TodayQueue {
  caps: { dms: number; connects: number }
  sent_today: { connect: number; inmail: number; dm: number; email: number; people: number; total: number }
  /** Whole LinkedIn account, every segment — the connect cap lives here. */
  account_today: { connect: number; dm: number; people: number; connects_left: number; connect_cap_hit: boolean }
  remaining_in_list: number
  /** Already contacted, follow-up now due. Worked BEFORE new contacts. */
  due: (QueueRow & { stage: string; touches: number; next_action_at: number; outreach_channel: string })[]
  queue: (QueueRow & { senior: number })[]
}

const STAGE_LABEL: Record<string, string> = {
  new: 'Not contacted', touch_1: 'Touch 1', touch_2: 'Touch 2', touch_3: 'Touch 3',
  replied: 'Replied', call_booked: 'Call booked', trial: 'Trialling',
  won: 'Won', lost: 'Lost', nurture: 'Nurture',
}

/**
 * Outcomes rarer than the three on the row itself. Kept in a menu so the common
 * path stays one click, without the uncommon path being impossible — which is
 * what "no way of saying they want a call" actually was.
 */
const MORE_OUTCOMES: { stage: string; label: string }[] = [
  // Deliberately unbranded: this file is shared verbatim with the public
  // self-hosted build, where the product carries the installer's own name.
  { stage: 'trial', label: '🧪 Trialling' },
  { stage: 'won', label: '🏆 Won — signed client' },
  { stage: 'lost', label: '✕ Dead — never resurface' },
  { stage: 'new', label: '↩ Reset to not contacted' },
]

/**
 * Say what the outcome actually did, including the date it takes effect.
 * Re-marking someone who is already at that stage looks like nothing happened
 * — the badge and the date are unchanged — so the confirmation has to state
 * the resulting position rather than merely that a click was received.
 */
function outcomeMsg(stage: string, next: number | null): string {
  const label = STAGE_LABEL[stage] || stage
  if (!next) return `${label} — no further action scheduled`
  const d = new Date(next * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  if (stage === 'nurture') return `${label} — resurfaces ${d}`
  return `${label} — next action ${d}`
}

function overdueBy(ts: number): string {
  const days = Math.floor((Date.now() / 1000 - ts) / 86400)
  if (days <= 0) return 'due today'
  return `${days}d overdue`
}

interface SearchRow {
  id: string; full_name: string; role: string; email: string; linkedin_url: string
  stage: string; touches: number; outreach_channel: string; next_action_at: number | null
  last_reply_at: number | null; suppressed: number; company: string; segment: string
}

function TodayView({ clientId, onBack }: { clientId: string; onBack: () => void }) {
  const { showToast } = useToast()
  const [q, setQ] = useState<TodayQueue | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchRow[] | null>(null)
  const [searching, setSearching] = useState(false)
  // The last outcome recorded, shown as a banner. Deliberately not per-row:
  // the row it refers to has usually just left the list.
  const [lastAction, setLastAction] = useState<{ name: string; msg: string; tone: 'ok' | 'err' } | null>(null)

  const runSearch = useCallback(async (text: string) => {
    if (text.trim().length < 2) { setResults(null); return }
    setSearching(true)
    const r = await fetch(`/api/leads/search?q=${encodeURIComponent(text.trim())}`)
    setSearching(false)
    if (r.ok) setResults((await r.json()).results || [])
  }, [])

  // Debounced — searching on every keystroke would hammer the box for nothing.
  useEffect(() => {
    const t = setTimeout(() => runSearch(query), 300)
    return () => clearTimeout(t)
  }, [query, runSearch])

  const load = useCallback(async () => {
    const res = await fetch(`/api/leads/today?clientId=${clientId}`)
    if (res.ok) setQ(await res.json())
    setLoading(false)
  }, [clientId])

  useEffect(() => { load() }, [load])
  // Re-read when the tab regains focus — you've just come back from LinkedIn.
  useEffect(() => {
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  // A reply is the highest-signal event here and nothing else can see it —
  // the extension reads a page, not an inbox. One click, then reload so the
  // person drops out of today's follow-ups immediately.
  // "Not at this time" is neither a reply to chase tomorrow nor a dead lead —
  // it is a soft no with an expiry date, and collapsing it into either one
  // loses a real prospect. The stages beyond those live in MORE_OUTCOMES.
  //
  // Two things this has to get right, both of which it previously got wrong:
  //   - A failed request used to `return` in silence, so a lost update was
  //     indistinguishable from a saved one.
  //   - Marking someone already at that stage changes nothing on screen, which
  //     reads as a dead button. The banner states the resulting position, so a
  //     no-op still confirms where the person now stands.
  const mark = async (id: string, what: string) => {
    const r = what === 'replied'
      ? await fetch(`/api/leads/${id}/replied`, { method: 'POST' })
      : await fetch(`/api/leads/${id}/stage`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: what }),
        })
    const d = await r.json().catch(() => ({} as any))
    if (!r.ok) {
      setLastAction({ name: d?.name || 'That contact', msg: d?.error || `couldn't be saved (${r.status})`, tone: 'err' })
      return
    }
    // Patch in place as well as refetching: marking a follow-up removes it from
    // the due list, and a row that vanishes with no other signal is exactly the
    // ambiguity being fixed here. The banner outlives the row.
    const patch = <T extends { id: string }>(row: T): T =>
      row.id === id ? { ...row, stage: d.stage, next_action_at: d.next_action_at } : row
    setResults(rs => (rs ? rs.map(patch) : rs))
    setQ(cur => (cur ? { ...cur, due: cur.due.map(patch), queue: cur.queue.map(patch) } : cur))
    setLastAction({ name: d.name, msg: outcomeMsg(d.stage, d.next_action_at), tone: 'ok' })
    load(); if (query.trim().length > 1) runSearch(query)
  }
  const snooze = async (id: string, days: number) => {
    const r = await fetch(`/api/leads/${id}/snooze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days }),
    })
    const d = await r.json().catch(() => ({} as any))
    if (!r.ok) {
      setLastAction({ name: d?.name || 'That contact', msg: d?.error || `couldn't be snoozed (${r.status})`, tone: 'err' })
      return
    }
    setLastAction({
      name: d.name,
      msg: `snoozed ${days} day${days === 1 ? '' : 's'} — back ${new Date(d.next_action_at * 1000)
        .toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`,
      tone: 'ok',
    })
    load()
  }

  /**
   * The disposition control, identical on a search hit and a due follow-up so
   * the same person is dealt with the same way wherever they turn up.
   */
  const Outcomes = ({ id }: { id: string }) => (
    <>
      <button className="btn btn-primary btn-sm" onClick={() => mark(id, 'replied')}>💬 Replied</button>
      <button className="btn btn-primary btn-sm" title="They want a call or video meeting"
              onClick={() => mark(id, 'call_booked')}>📞 Call booked</button>
      <button className="btn btn-ghost btn-sm" title="Soft no — back in 90 days"
              onClick={() => mark(id, 'nurture')}>🕰 Not now</button>
      <select
        className="form-input"
        style={{ width: 'auto', fontSize: '0.78rem', padding: '4px 8px' }}
        value=""
        onChange={e => { if (e.target.value) mark(id, e.target.value) }}
      >
        <option value="">More…</option>
        {MORE_OUTCOMES.map(o => <option key={o.stage} value={o.stage}>{o.label}</option>)}
      </select>
    </>
  )

  /**
   * Draft a message, and record that you sent it — both from inside the app.
   *
   * WHY IT IS A PASTE BOX AND NOT A FETCHER
   *
   * A good opener is grounded in one true detail about the person, and the
   * obvious way to get that detail is to read their profile automatically.
   * Don't. Platforms detect and act on automated profile collection, and the
   * account it costs you is the one your whole pipeline runs through.
   *
   * A human reading a page and pasting a paragraph makes no request to anyone's
   * server, needs no extension installed, and cannot be fingerprinted. It is
   * slower per contact and it is the version that still works next year.
   *
   * It is also more general than a scraper could be. Nothing in /api/pitch is
   * platform-specific except the profile URL: `about`, `headline`, `company`
   * and `recent_posts` are just text about a person, so a homepage, a bio, a
   * conference abstract or a podcast transcript all work as the source.
   *
   * State lives in TodayView rather than in the panel because `Row` is defined
   * inside this component and gets a fresh identity on every render — a panel
   * holding its own draft would lose it whenever the queue reloaded.
   */
  interface DraftState {
    loading?: boolean; pitch?: string; classification?: string
    reason?: string; cost?: number; model?: string; error?: string
  }
  const [openDraft, setOpenDraft] = useState<string | null>(null)
  const [srcText, setSrcText] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({})

  const draftFor = async (r: QueueRow, format: 'dm' | 'note') => {
    setDrafts(d => ({ ...d, [r.id]: { loading: true } }))
    try {
      const res = await fetch('/api/pitch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          name: r.full_name,
          current_role: r.role,
          headline: r.role,
          company: r.company && r.company !== 'Unknown company' ? r.company : '',
          // Whatever the human pasted. Capped because the point is a paragraph
          // or two, not a dossier.
          about: (srcText[r.id] || '').slice(0, 6000),
          linkedin_url: r.linkedin_url,
          format,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Draft failed')
      setDrafts(d => ({ ...d, [r.id]: {
        pitch: data.pitch, classification: data.classification, reason: data.reason,
        cost: data.cost_usd, model: data.model,
      } }))
    } catch (e: any) {
      setDrafts(d => ({ ...d, [r.id]: { error: e?.message || 'Draft failed' } }))
    }
  }

  /**
   * Write-back, so the queue shortens as you work.
   *
   * `found: false` comes back as a 200, not an error — it means this person is
   * not in the imported list, which is information rather than a failure.
   */
  const markSent = async (r: QueueRow, channel: 'connect' | 'dm' | 'email') => {
    try {
      const res = await fetch('/api/leads/mark-contacted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          linkedin_url: r.linkedin_url,
          channel,
          message: drafts[r.id]?.pitch || '',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { showToast(data.error || 'Could not record that', 'error'); return }
      if (!data.found) { showToast(`${r.full_name} is not in this list`, 'error'); return }
      showToast(`${r.full_name} — ${channel} recorded`)
      setOpenDraft(null)
      load()
    } catch (e: any) {
      showToast(e?.message || 'Could not record that', 'error')
    }
  }

  const Row = ({ r, tier }: { r: QueueRow; tier?: string }) => {
    const d = drafts[r.id]
    const open = openDraft === r.id
    return (
      <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
          flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
              {r.full_name}
              {tier && <span className="badge" style={{ marginLeft: 8, fontSize: '0.65rem' }}>{tier}</span>}
            </div>
            <div className="text-muted" style={{ fontSize: '0.78rem' }}>
              {r.role}{r.company && r.company !== 'Unknown company' ? ` · ${r.company}` : ''}
            </div>
          </div>
          <span className="text-muted" style={{ fontSize: '0.72rem', fontVariantNumeric: 'tabular-nums' }}>{r.priority_score}</span>
          <a className="btn btn-secondary btn-sm" href={r.linkedin_url} target="_blank" rel="noreferrer">Open ↗</a>
          <button className={`btn btn-sm ${open ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setOpenDraft(open ? null : r.id)}>
            ⚡ Draft
          </button>
        </div>

        {open && (
          <div style={{ padding: '4px 12px 14px', background: 'var(--bg-elevated-2)' }}>
            <textarea
              rows={4}
              className="input"
              style={{ width: '100%', fontSize: '0.82rem', fontFamily: 'inherit' }}
              placeholder="Optional — paste their About section, a recent post, or copy from their website. Anything you'd have read before writing to them."
              value={srcText[r.id] || ''}
              onChange={e => setSrcText(v => ({ ...v, [r.id]: e.target.value }))}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn btn-primary btn-sm" disabled={!!d?.loading}
                      onClick={() => draftFor(r, 'dm')}>
                {d?.loading ? 'Drafting…' : '⚡ Draft message'}
              </button>
              <button className="btn btn-secondary btn-sm" disabled={!!d?.loading}
                      onClick={() => draftFor(r, 'note')}>
                Connection note
              </button>
              <span className="text-muted" style={{ fontSize: '0.72rem' }}>
                Works with nothing pasted — a grounded draft reads better.
              </span>
            </div>

            {d?.error && (
              <div style={{ marginTop: 10, fontSize: '0.82rem', color: 'var(--danger)' }}>{d.error}</div>
            )}

            {/* A skip is a real answer, not a failure — the drafter classifies
                before it writes, so an obvious non-fit does not get a pitch
                pretending they were read properly. */}
            {d?.classification === 'skip' && (
              <div style={{ marginTop: 10, fontSize: '0.82rem' }}>
                <span className="badge" style={{ background: 'rgba(249,115,22,.16)', color: '#f97316' }}>skip</span>
                <span style={{ marginLeft: 8 }}>{d.reason || 'Not a fit for this campaign.'}</span>
              </div>
            )}

            {!!d?.pitch && d.classification !== 'skip' && (
              <div style={{ marginTop: 10 }}>
                <div style={{
                  whiteSpace: 'pre-wrap', fontSize: '0.86rem', lineHeight: 1.5,
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                  borderRadius: 8, padding: '10px 12px',
                }}>{d.pitch}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button className="btn btn-secondary btn-sm"
                          onClick={() => { navigator.clipboard?.writeText(d.pitch || ''); showToast('Copied') }}>
                    Copy
                  </button>
                  {/* Model and cost on the row, not buried in a ledger: a
                      silent downgrade or an unexpected bill should be visible
                      where the spending happens. */}
                  <span className="text-muted" style={{ fontSize: '0.72rem' }}>
                    {d.pitch.length} chars
                    {d.classification ? ` · ${d.classification}` : ''}
                    {typeof d.cost === 'number' ? ` · $${d.cost.toFixed(4)}` : ''}
                    {d.model ? ` · ${d.model}` : ''}
                  </span>
                </div>
              </div>
            )}

            {/* Deliberately separate from drafting: you might send something you
                wrote yourself, and the queue still has to shorten. */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="text-muted" style={{ fontSize: '0.72rem' }}>Once you've sent it:</span>
              <button className="btn btn-ghost btn-sm" onClick={() => markSent(r, 'dm')}>✅ Message sent</button>
              <button className="btn btn-ghost btn-sm" onClick={() => markSent(r, 'connect')}>✅ Connect sent</button>
              <button className="btn btn-ghost btn-sm" onClick={() => markSent(r, 'email')}>✅ Email sent</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (loading) return <div className="page-content"><span className="loading" /> Loading today's queue…</div>

  const done = q ? q.sent_today.people : 0
  const target = q ? q.caps.dms : 0

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>← Discovery</button>
          <h2 style={{ margin: '8px 0 0' }}>▶ Today's outreach</h2>
          <div className="text-muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
            {q?.remaining_in_list ?? 0} uncontacted left in the list
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {/* Progress against the daily cap */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {done} <span className="text-muted" style={{ fontSize: '1rem', fontWeight: 400 }}>/ {target}</span>
            </div>
            <div className="text-muted" style={{ fontSize: '0.78rem' }}>sent today</div>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ height: 8, background: 'var(--bg-hover)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                width: `${target ? Math.min(100, (done / target) * 100) : 0}%`, height: '100%',
                background: 'linear-gradient(90deg,#22D3EE,#3B82F6)', transition: 'width .3s',
              }} />
            </div>
            <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: 6 }}>
              this segment: {q?.sent_today.dm ?? 0} DM · {q?.sent_today.connect ?? 0} connect
              {!!q?.sent_today.email && ` · ${q.sent_today.email} email`}
              {done >= target && target > 0 && ' — segment quota done'}
            </div>
          </div>
        </div>
      </div>

      {/* ⚠️ Account-wide connect budget. DMs are uncapped; connection requests
          are NOT, and LinkedIn counts the account rather than the campaign —
          so four segments each showing their own "0/20" would quietly invite
          80 requests in a day and get the account restricted. */}
      {q && (
        <div className="card" style={{
          marginBottom: 16,
          borderColor: q.account_today.connect_cap_hit ? 'var(--danger)' : 'var(--border-default)',
        }}>
          <div className="card-body" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{
                fontSize: '1.3rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                color: q.account_today.connect_cap_hit ? 'var(--danger)' : 'inherit',
              }}>
                {q.account_today.connect} <span className="text-muted" style={{ fontSize: '0.9rem', fontWeight: 400 }}>/ {q.caps.connects}</span>
              </div>
              <div className="text-muted" style={{ fontSize: '0.72rem' }}>connection requests — WHOLE ACCOUNT, all segments</div>
            </div>
            <div style={{ flex: 1, minWidth: 200, fontSize: '0.8rem' }}>
              {q.account_today.connect_cap_hit ? (
                <strong style={{ color: 'var(--danger)' }}>
                  Connect cap reached. DM only for the rest of today — another request risks a restriction,
                  which ends every campaign at once.
                </strong>
              ) : (
                <>
                  <strong>{q.account_today.connects_left} connects left today</strong> across all four segments.
                  {' '}DMs are uncapped — {q.account_today.dm} sent, keep going.
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation of the last outcome recorded. Sits above both lists
          because the row it describes has usually just left one of them —
          previously the only feedback was a row silently disappearing, or,
          when the stage was already set, nothing at all. */}
      {lastAction && (
        <div
          className="card"
          style={{
            marginBottom: 16,
            borderColor: lastAction.tone === 'err' ? 'var(--danger)' : 'var(--accent)',
          }}
        >
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
            <span style={{ fontSize: '0.9rem', flex: 1 }}>
              {lastAction.tone === 'err' ? '⚠️ ' : '✓ '}
              <strong>{lastAction.name}</strong> — {lastAction.msg}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setLastAction(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {/* ── Find anyone ──────────────────────────────────────────────────────
          The queue only shows who is due. Someone who REPLIED is the most
          important person in the pipeline and is almost never due today — so
          without this there was no way to record the reply against them. */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ paddingBottom: results ? 0 : undefined }}>
          <input
            className="form-input"
            placeholder="Find anyone — name, company or email (e.g. someone who just replied)"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {searching && <div className="text-muted" style={{ fontSize: '0.78rem', marginTop: 6 }}>searching…</div>}
          {results && !searching && (
            <div style={{ marginTop: 10 }}>
              {!results.length && (
                <div className="text-muted" style={{ fontSize: '0.85rem', paddingBottom: 12 }}>
                  Nobody matching “{query}”.
                </div>
              )}
              {results.map(r => (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0',
                  borderTop: '1px solid var(--border-subtle)', flexWrap: 'wrap',
                }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                      {r.full_name}
                      <span className="badge" style={{ marginLeft: 8, fontSize: '0.65rem' }}>
                        {STAGE_LABEL[r.stage] || r.stage}
                      </span>
                      {!!r.suppressed && (
                        <span className="badge" style={{ marginLeft: 6, fontSize: '0.65rem', color: 'var(--danger)' }}>
                          opted out
                        </span>
                      )}
                    </div>
                    <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                      {r.role}{r.company ? ` · ${r.company}` : ''}{r.segment ? ` · ${r.segment}` : ''}
                      {r.touches > 0 && ` · ${r.touches} touch${r.touches === 1 ? '' : 'es'}`}
                      {r.outreach_channel && ` by ${r.outreach_channel.replace(/,/g, ' + ')}`}
                      {r.next_action_at && ` · next ${new Date(r.next_action_at * 1000).toLocaleDateString()}`}
                    </div>
                  </div>
                  {r.linkedin_url && (
                    <a className="btn btn-secondary btn-sm" href={r.linkedin_url} target="_blank" rel="noreferrer">Open ↗</a>
                  )}
                  <Outcomes id={r.id} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Follow-ups, worked FIRST ────────────────────────────────────────
          Replies cluster at touches 3-5. Returning to people already contacted
          beats adding new ones, so this sits above the new-contact list and is
          ordered most-overdue-first. */}
      {!!q?.due.length && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
          <div className="card-header">
            <span className="card-title">🔁 Follow-ups due — {q.due.length}</span>
            <span className="text-muted" style={{ fontSize: '0.78rem' }}>
              do these before any new contacts — this is where replies come from
            </span>
          </div>
          <div>
            {q.due.map(r => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap',
              }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                    {r.full_name}
                    <span className="badge" style={{ marginLeft: 8, fontSize: '0.65rem' }}>
                      {STAGE_LABEL[r.stage] || r.stage}
                    </span>
                  </div>
                  <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                    {r.role}{r.company && r.company !== 'Unknown company' ? ` · ${r.company}` : ''}
                    {' · '}<strong>{overdueBy(r.next_action_at)}</strong>
                    {r.outreach_channel && ` · sent by ${r.outreach_channel.replace(/,/g, ' + ')}`}
                  </div>
                </div>
                <a className="btn btn-secondary btn-sm" href={r.linkedin_url} target="_blank" rel="noreferrer">Open ↗</a>
                <Outcomes id={r.id} />
                <button className="btn btn-ghost btn-sm" onClick={() => snooze(r.id, 7)}>😴 7d</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New contacts — only top up the day once follow-ups are clear. */}
      {!!q?.queue.length && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">✉️ Today — {q.queue.length}</span>
            <span className="text-muted" style={{ fontSize: '0.78rem' }}>
              DM every one (⚡ Draft pitch → Copy). Add a connection request only to the top few,
              while connects remain.
            </span>
          </div>
          <div>
            {q.queue.map((r, i) => (
              <Row
                key={r.id}
                r={r}
                tier={
                  r.senior ? 'senior'
                    : i < Math.min(5, q.account_today.connects_left) ? '+ connect'
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      )}

      {!q?.queue.length && !q?.due.length && (
        <div className="empty-state">
          <div className="empty-state-icon">✅</div>
          <div className="empty-state-title">Nothing due</div>
          <p>No follow-ups owed today and no uncontacted leads left in this segment.</p>
        </div>
      )}
    </div>
  )
}
