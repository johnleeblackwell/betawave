import { useState, useEffect } from 'react'
import { Client, useToast } from '../App.tsx'
import SourceManager from './SourceManager.tsx'
import ContentGenerator from './ContentGenerator.tsx'
import ContentLibrary from './ContentLibrary.tsx'
import ScheduleManager from './ScheduleManager.tsx'
import PseoHub from './PseoHub.tsx'
import ReportHub from './ReportHub.tsx'
import CitationHub from './CitationHub.tsx'
import RespondHub from './RespondHub.tsx'
import SocialHub from './SocialHub.tsx'
import ShopHub from './ShopHub.tsx'
import DiscoveryHub from './DiscoveryHub.tsx'
import SyndicationHub from './SyndicationHub.tsx'
import SiteBuilder from './SiteBuilder.tsx'

type Tab = 'overview' | 'sources' | 'content' | 'generate' | 'social' | 'pseo' | 'reports' | 'schedule' | 'respond' | 'citation' | 'shop' | 'discovery' | 'syndicate' | 'site'

type Module = 'profile' | 'produce' | 'reach' | 'respond' | 'measure'

const TAB_META: Record<Tab, { label: string; icon: string; module: Module; disabled?: boolean }> = {
  overview: { label: 'Overview',  icon: '👤', module: 'profile' },
  sources:  { label: 'Sources',   icon: '📡', module: 'produce' },
  generate: { label: 'Generate',  icon: '⚡', module: 'produce' },
  social:   { label: 'Social',    icon: '📱', module: 'produce' },
  syndicate:{ label: 'Syndicate', icon: '🔀', module: 'produce' },
  pseo:     { label: 'pSEO',      icon: '🌍', module: 'produce' },
  reports:  { label: 'Reports',   icon: '📊', module: 'produce' },
  content:  { label: 'Content',   icon: '📚', module: 'produce' },
  shop:     { label: 'Shop',       icon: '🎁', module: 'reach'   },
  schedule: { label: 'Schedule',  icon: '🗓️', module: 'reach'   },
  discovery:{ label: 'Discovery',  icon: '🎯', module: 'reach'   },
  site:     { label: 'Site',      icon: '🌐', module: 'reach' },
  respond:  { label: 'Respond',   icon: '💬', module: 'respond' },
  citation: { label: 'Citations', icon: '📡', module: 'measure' },
}

const TAB_ORDER: Tab[] = ['overview', 'sources', 'generate', 'social', 'syndicate', 'pseo', 'reports', 'content', 'site', 'shop', 'discovery', 'schedule', 'respond', 'citation']

// Owner/agency-only tabs — never shown to a client operator. Discovery is the
// B2B prospecting funnel (finding businesses to sell to), not a client
// marketing tool, so it must not appear in a client moderator's workspace.
const OPERATOR_HIDDEN_TABS: Tab[] = ['discovery']

// Map tabs → module key in clients.modules_enabled.
// 'profile' tabs (Overview) always show.
const TAB_TO_MODULE_KEY: Record<Module, keyof NonNullable<Client['modules_enabled']> | null> = {
  profile: null,
  produce: 'produce',
  reach:   'reach',     // Discovery + Schedule. Shop is special (gated separately).
  respond: 'respond',
  measure: 'measure',
}

interface Props {
  clientId: string
  tab: Tab
  operator?: boolean   // client-scoped moderator: Respond + Content only, no edit/delete
  onTabChange: (tab: Tab) => void
  onEdit: () => void
  onDelete: () => void
  onBack: () => void
}

export default function ClientView({ clientId, tab, operator = false, onTabChange, onEdit, onDelete, onBack }: Props) {
  const { showToast } = useToast()
  const [client, setClient] = useState<Client | null>(null)
  const [contentRefresh, setContentRefresh] = useState(0)

  useEffect(() => {
    fetch(`/api/clients/${clientId}`).then(r => r.json()).then(setClient)
  }, [clientId])

  const handleDelete = async () => {
    if (!confirm(`Delete ${client?.business_name} and all their content?`)) return
    await fetch(`/api/clients/${clientId}`, { method: 'DELETE' })
    showToast('Client deleted')
    onDelete()
  }

  if (!client) {
    return <div style={{ padding: 32 }}><span className="loading" /> Loading…</div>
  }

  return (
    <>
      {/* Page header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {!operator && <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>}
          <div>
            <div className="page-title">{client.business_name}</div>
            <div className="page-subtitle">{client.industry} · {client.tone_of_voice} tone</div>
          </div>
        </div>
        {!operator && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={onEdit}>✏️ Edit Profile</button>
            <button className="btn btn-danger btn-sm" onClick={handleDelete}>🗑 Delete</button>
          </div>
        )}
      </div>

      {/* Tabs — grouped by module, only shown if the module is enabled for this client */}
      {(() => {
        const me = client.modules_enabled
        // Operators get the full module set for their client (just isolated to it).
        const visibleTabs = TAB_ORDER.filter(t => {
          if (operator && OPERATOR_HIDDEN_TABS.includes(t)) return false
          const meta = TAB_META[t]
          if (meta.module === 'profile') return true
          // Shop tab requires the 'shop' module specifically, not the umbrella reach toggle
          if (t === 'shop') return me ? !!me.shop : true
          const key = TAB_TO_MODULE_KEY[meta.module]
          if (!key) return true
          return me ? !!me[key] : true
        })
        return (
      <div className="tabs tabs-modular">
        {visibleTabs.map((t, idx) => {
          const meta = TAB_META[t]
          const prev = idx > 0 ? TAB_META[visibleTabs[idx - 1]] : null
          const moduleChanged = !prev || prev.module !== meta.module
          // Only show the group label when the module contains multiple tabs —
          // single-tab modules (Reach, Respond, Measure) don't need a label
          // because the tab itself already names the module.
          const moduleTabCount = TAB_ORDER.filter(x => TAB_META[x].module === meta.module).length
          const showGroupLabel = moduleChanged && meta.module !== 'profile' && moduleTabCount > 1
          return (
            <div key={t} className="tab-group-wrap">
              {moduleChanged && idx > 0 && <span className="tab-divider" aria-hidden />}
              {showGroupLabel && (
                <span className={`tab-group-label tab-group-${meta.module}`}>
                  {meta.module === 'produce' && 'Produce'}
                  {meta.module === 'reach' && 'Reach'}
                  {meta.module === 'respond' && 'Respond'}
                  {meta.module === 'measure' && 'Measure'}
                </span>
              )}
              <button
                className={`tab tab-${meta.module} ${tab === t ? 'active' : ''} ${meta.disabled ? 'tab-disabled' : ''}`}
                onClick={() => !meta.disabled && onTabChange(t)}
                disabled={meta.disabled}
                title={meta.disabled ? 'Coming soon' : undefined}
              >
                {meta.icon} {meta.label}
                {meta.disabled && <span className="tab-soon">soon</span>}
              </button>
            </div>
          )
        })}
      </div>
        )
      })()}

      {/* Tab content */}
      {tab === 'overview' && (
        <div className="page-content">
          {client.mission && (
            <div style={{
              padding: '14px 18px', background: '#eef2ff', border: '1px solid #c7d2fe',
              borderRadius: 10, marginBottom: 16, maxWidth: 760,
              fontSize: '0.95rem', fontStyle: 'italic', color: '#3730a3',
            }}>
              ✦ {client.mission}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 760 }}>
            <div className="card">
              <div className="card-header"><span className="card-title">Identity</span></div>
              <div className="card-body">
                <InfoRow label="Contact" value={client.name} />
                <InfoRow label="Business" value={client.business_name} />
                <InfoRow label="Industry" value={client.industry} />
                {client.primary_domain && <InfoRow label="Domain" value={client.primary_domain} />}
                {client.geography && <InfoRow label="Geography" value={client.geography} />}
                {client.contact_email && <InfoRow label="Email" value={client.contact_email} />}
              </div>
            </div>
            <div className="card">
              <div className="card-header"><span className="card-title">Mission & Voice</span></div>
              <div className="card-body">
                <div className="form-group" style={{ marginBottom: 12 }}>
                  <div className="form-label">Who they serve (ICP)</div>
                  <div style={{ fontSize: '0.875rem', color: '#374151' }}>
                    {client.icp || client.target_audience || <span className="text-muted">Not set</span>}
                  </div>
                </div>
                {(client.offerings || client.expertise_areas.length > 0) && (
                  <div className="form-group" style={{ marginBottom: 12 }}>
                    <div className="form-label">What they sell / do</div>
                    <div style={{ fontSize: '0.875rem', color: '#374151' }}>
                      {client.offerings || (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {client.expertise_areas.map(a => <span key={a} className="tag">{a}</span>)}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {(client.brand_voice || client.tone_of_voice) && (
                  <div className="form-group" style={{ marginBottom: 12 }}>
                    <div className="form-label">Brand voice</div>
                    <div style={{ fontSize: '0.8rem', color: '#475569' }}>
                      {client.brand_voice || `${client.tone_of_voice} tone`}
                    </div>
                  </div>
                )}
                {client.style_notes && (
                  <div className="form-group">
                    <div className="form-label">Style notes</div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', background: '#f8fafc', padding: '8px 10px', borderRadius: 6 }}>
                      {client.style_notes}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#374151', marginBottom: 12 }}>Quick Actions</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" onClick={() => onTabChange('generate')}>⚡ Generate Blog Post</button>
              <button className="btn btn-secondary" onClick={() => onTabChange('generate')}>📧 Generate Newsletter</button>
              <button className="btn btn-secondary" onClick={() => onTabChange('sources')}>📡 Manage Sources</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'sources' && <SourceManager clientId={clientId} />}

      {tab === 'generate' && (
        <ContentGenerator
          clientId={clientId}
          onContentSaved={() => setContentRefresh(n => n + 1)}
        />
      )}

      {tab === 'content' && <ContentLibrary key={contentRefresh} clientId={clientId} wpConfigured={!!(client?.wp_url)} />}

      {tab === 'social' && <SocialHub clientId={clientId} />}

      {tab === 'syndicate' && <SyndicationHub clientId={clientId} />}

      {tab === 'shop' && <ShopHub clientId={clientId} client={client} />}

      {tab === 'discovery' && <DiscoveryHub clientId={clientId} />}

      {tab === 'pseo' && <PseoHub clientId={clientId} client={client} />}

      {tab === 'reports' && <ReportHub clientId={clientId} />}

      {tab === 'schedule' && <ScheduleManager clientId={clientId} client={client} />}

      {tab === 'site' && <SiteBuilder clientId={clientId} />}

      {tab === 'citation' && <CitationHub clientId={clientId} clientName={client.business_name} clientDomain={client.primary_domain} />}

      {tab === 'respond' && <RespondHub clientId={clientId} />}
    </>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.875rem' }}>
      <span style={{ color: '#64748b', fontWeight: 500 }}>{label}</span>
      <span style={{ color: '#0f172a' }}>{value}</span>
    </div>
  )
}
