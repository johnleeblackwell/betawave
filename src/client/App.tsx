import { useState, useEffect, createContext, useContext, useCallback } from 'react'
import Dashboard from './components/Dashboard.tsx'
import ClientView from './components/ClientView.tsx'
import ClientForm from './components/ClientForm.tsx'
import AffiliatesHub from './components/AffiliatesHub.tsx'
import SettingsHub from './components/SettingsHub.tsx'
import ThemeProvider, { useTheme } from './ThemeProvider.tsx'

// --- Types ---
export interface ModulesEnabled {
  produce: 0 | 1
  reach: 0 | 1
  respond: 0 | 1
  measure: 0 | 1
  affiliates: 0 | 1
  shop: 0 | 1
}

export interface Client {
  id: string
  // Identity
  name: string
  business_name: string
  industry: string
  primary_domain?: string
  logo_url?: string
  geography?: 'UK' | 'US' | 'EU' | 'GLOBAL' | string
  time_zone?: string
  location?: string
  contact_email: string
  // Mission
  mission?: string
  icp?: string
  offerings?: string
  brand_voice?: string
  never_say?: string
  always_say?: string
  // Module activation
  modules_enabled?: ModulesEnabled
  // Legacy content-tool fields
  expertise_areas: string[]
  tone_of_voice: string
  target_audience: string
  style_notes: string
  blocked_topics?: string[]
  // Connectors
  smtp_host?: string
  smtp_port?: number
  smtp_user?: string
  smtp_pass?: string
  smtp_from?: string
  wp_url?: string
  wp_username?: string
  wp_app_password?: string
  wp_post_status?: string
  image_source?: string
  image_keywords?: string
  // Discovery + LLM
  discovery_enabled?: 0 | 1
  discovery_sender_email?: string
  discovery_sender_name?: string
  discovery_whatsapp_number?: string
  daily_citation_budget_gbp?: number
  llm_content_provider?: string
  llm_content_model?: string
  llm_content_api_key?: string
  llm_content_base_url?: string
  // Computed
  created_at: number
  content_count?: number
  source_count?: number
  citation_run_count?: number
  citation_last_share?: number | null
}

export type View =
  | { type: 'dashboard' }
  | { type: 'affiliates' }
  | { type: 'settings' }
  | { type: 'client'; id: string; tab: 'overview' | 'sources' | 'content' | 'generate' | 'social' | 'syndicate' | 'reports' | 'site' | 'shop' | 'schedule' | 'respond' | 'citation' | 'discovery' }
  | { type: 'new-client' }
  | { type: 'edit-client'; id: string }

// --- Toast context ---
interface Toast { id: string; message: string; kind: 'success' | 'error' }
interface ToastCtx { showToast: (msg: string, kind?: 'success' | 'error') => void }
const ToastContext = createContext<ToastCtx>({ showToast: () => {} })
export const useToast = () => useContext(ToastContext)

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  )
}

type ColorMode = 'dark' | 'light'

function getInitialColorMode(): ColorMode {
  if (typeof window === 'undefined') return 'dark'
  const stored = localStorage.getItem('bw-theme')
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function AppInner() {
  const [view, setView] = useState<View>({ type: 'dashboard' })
  const [clients, setClients] = useState<Client[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [colorMode, setColorMode] = useState<ColorMode>(getInitialColorMode)
  // Who's logged in. Owner (single-password) = full access; 'operator' = a
  // client-scoped moderator (e.g. a client's social manager) locked to Respond + Content.
  const [me, setMe] = useState<{ role: string; client_id?: string; email?: string } | null>(null)
  useEffect(() => {
    fetch('/api/me').then(r => (r.ok ? r.json() : { role: 'owner' })).then(setMe).catch(() => setMe({ role: 'owner' }))
  }, [])
  const isOperator = me?.role === 'operator'

  // Apply the theme to <html data-theme="..."> and persist on every change
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', colorMode)
    localStorage.setItem('bw-theme', colorMode)
  }, [colorMode])

  const toggleColorMode = useCallback(() => {
    setColorMode(m => (m === 'dark' ? 'light' : 'dark'))
  }, [])

  const showToast = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(t => [...t, { id, message, kind }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
  }, [])

  const loadClients = useCallback(async () => {
    // Operators can only read their own client (the /api/clients list is blocked).
    if (me?.role === 'operator' && me.client_id) {
      const r = await fetch(`/api/clients/${me.client_id}`)
      if (r.ok) { const c = await r.json(); setClients(Array.isArray(c) ? c : [c]) }
      return
    }
    const res = await fetch('/api/clients')
    const data = await res.json()
    setClients(data)
  }, [me])

  useEffect(() => { if (me) loadClients() }, [me, loadClients])
  // Drop operators straight into their (only) client's full workspace.
  useEffect(() => {
    if (isOperator && me?.client_id) setView({ type: 'client', id: me.client_id, tab: 'overview' })
  }, [isOperator, me?.client_id])

  const navigate = (v: View) => setView(v)

  const currentClient =
    view.type === 'client' ? clients.find(c => c.id === view.id)
    : view.type === 'edit-client' ? clients.find(c => c.id === view.id)
    : null

  const theme = useTheme()

  return (
    <ToastContext.Provider value={{ showToast }}>
      <div className="layout">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="sidebar-logo">
              {theme.logoUrl && theme.logoUrl !== '/bwave-logo.png'
                ? <img src={theme.logoUrl} alt={theme.brandName} />
                : <BetaWaveWordmark />}
            </div>
          </div>
          <nav className="sidebar-nav">
            {!isOperator && <>
            <div className="sidebar-section-label">Platform</div>
            <button
              className={`nav-item ${view.type === 'dashboard' ? 'active' : ''}`}
              onClick={() => navigate({ type: 'dashboard' })}
            >
              <span className="nav-item-icon">📊</span> Dashboard
            </button>
            {!theme.singleClient && (
              <button
                className="nav-item"
                onClick={() => navigate({ type: 'new-client' })}
              >
                <span className="nav-item-icon">➕</span> Add Client
              </button>
            )}

            <button
              className={`nav-item ${view.type === 'affiliates' ? 'active' : ''}`}
              onClick={() => navigate({ type: 'affiliates' })}
            >
              <span className="nav-item-icon">🤝</span> Affiliates
            </button>

            <button
              className={`nav-item ${view.type === 'settings' ? 'active' : ''}`}
              onClick={() => navigate({ type: 'settings' })}
            >
              <span className="nav-item-icon">🔑</span> Settings
            </button>
            </>}

            {!isOperator && <>
            <div className="sidebar-section-label" style={{ marginTop: 16 }}>Modules</div>
            <div className="module-legend">
              <div className="module-legend-item"><span className="module-dot module-dot-produce" /> Produce <span className="module-legend-hint">create</span></div>
              <div className="module-legend-item"><span className="module-dot module-dot-reach" /> Reach <span className="module-legend-hint">distribute</span></div>
              <div className="module-legend-item"><span className="module-dot module-dot-respond" /> Respond <span className="module-legend-hint">soon</span></div>
              <div className="module-legend-item"><span className="module-dot module-dot-measure" /> Measure <span className="module-legend-hint">citations</span></div>
            </div>
            </>}

            {clients.length > 0 && (
              <>
                <div className="sidebar-section-label" style={{ marginTop: 16 }}>{isOperator ? 'Client' : 'Clients'}</div>
                <ul className="client-nav-list">
                  {clients.map(c => (
                    <li
                      key={c.id}
                      className={`client-nav-item ${view.type === 'client' && view.id === c.id ? 'active' : ''}`}
                      onClick={() => navigate({ type: 'client', id: c.id, tab: 'overview' })}
                    >
                      {c.business_name}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </nav>
          <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <a
              href="/logout"
              title="Log out"
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '9px 12px', borderRadius: 8, textDecoration: 'none',
                border: '1px solid var(--sidebar-border, rgba(148,163,184,.3))',
                color: 'var(--sidebar-text, #cbd5e1)', fontSize: '.88rem', fontWeight: 600,
              }}
              onMouseOver={e => { e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.color = '#f87171' }}
              onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--sidebar-border, rgba(148,163,184,.3))'; e.currentTarget.style.color = 'var(--sidebar-text, #cbd5e1)' }}
            >
              <span>⎋</span> Log out
            </a>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span>{theme.brandName} v{__APP_VERSION__}</span>
              <button
                type="button"
                className="theme-toggle"
                onClick={toggleColorMode}
                title={`Switch to ${colorMode === 'dark' ? 'light' : 'dark'} theme`}
                aria-label={`Switch to ${colorMode === 'dark' ? 'light' : 'dark'} theme`}
              >
                {colorMode === 'dark' ? '☀' : '☾'}
              </button>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="main">
          {view.type === 'dashboard' && (
            <Dashboard clients={clients} onSelectClient={id => navigate({ type: 'client', id, tab: 'overview' })} onAddClient={() => navigate({ type: 'new-client' })} />
          )}
          {view.type === 'affiliates' && <AffiliatesHub />}
          {view.type === 'settings' && <SettingsHub />}
          {view.type === 'new-client' && (
            <ClientForm
              onSave={async () => { await loadClients(); navigate({ type: 'dashboard' }) }}
              onCancel={() => navigate({ type: 'dashboard' })}
            />
          )}
          {view.type === 'edit-client' && currentClient && (
            <ClientForm
              client={currentClient}
              onSave={async () => { await loadClients(); navigate({ type: 'client', id: currentClient.id, tab: 'overview' }) }}
              onCancel={() => navigate({ type: 'client', id: currentClient.id, tab: 'overview' })}
            />
          )}
          {view.type === 'client' && (
            <ClientView
              clientId={view.id}
              tab={view.tab}
              operator={isOperator}
              onTabChange={tab => navigate({ type: 'client', id: view.id, tab })}
              onEdit={() => navigate({ type: 'edit-client', id: view.id })}
              onDelete={async () => { await loadClients(); navigate({ type: 'dashboard' }) }}
              onBack={() => navigate({ type: 'dashboard' })}
            />
          )}
        </main>
      </div>

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span>{t.kind === 'success' ? '✅' : '❌'}</span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/** β logo mark — Inter 900 italic with animated cyan→blue→violet gradient,
 *  matching betawave.co.uk exactly. Sidebar-only; favicon uses the same style. */
function BetaWaveWordmark() {
  return (
    <svg
      viewBox="0 0 72 72"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="βWave"
      style={{ width: 72, height: 72, flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="bwGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%">
            <animate attributeName="stop-color"
              values="#22D3EE;#06b6d4;#3b82f6;#8b5cf6;#22D3EE"
              dur="5s" repeatCount="indefinite" />
          </stop>
          <stop offset="100%">
            <animate attributeName="stop-color"
              values="#3b82f6;#8b5cf6;#22D3EE;#06b6d4;#3b82f6"
              dur="5s" repeatCount="indefinite" />
          </stop>
        </linearGradient>
        <filter id="bwGlow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <text
        x="36"
        y="60"
        textAnchor="middle"
        fontFamily="Inter, system-ui, sans-serif"
        fontSize="64"
        fontWeight="900"
        fontStyle="italic"
        fill="url(#bwGrad)"
        filter="url(#bwGlow)"
      >β</text>
    </svg>
  )
}

