import { Client } from '../App.tsx'
import { useTheme } from '../ThemeProvider.tsx'

interface Props {
  clients: Client[]
  onSelectClient: (id: string) => void
  onAddClient: () => void
}

export default function Dashboard({ clients, onSelectClient, onAddClient }: Props) {
  const theme = useTheme()
  const totalContent = clients.reduce((n, c) => n + (c.content_count || 0), 0)
  const totalSources = clients.reduce((n, c) => n + (c.source_count || 0), 0)
  const totalPendingComments = clients.reduce((n, c) => n + (c.pending_comments_count || 0), 0)
  const citationClients = clients.filter(c => (c.citation_run_count || 0) > 0)
  const avgShare = citationClients.length > 0
    ? Math.round(citationClients.reduce((n, c) => n + (c.citation_last_share || 0), 0) / citationClients.length)
    : null

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">Manage content for your clients</div>
        </div>
        {!theme.singleClient && (
          <button className="btn btn-primary" onClick={onAddClient}>
            ➕ Add Client
          </button>
        )}
      </div>

      <div className="page-content">
        {/* Module overview — Produce / Reach / Respond / Measure */}
        <div className="stats-grid">
          <div className="stat-card stat-card-produce">
            <div className="stat-label">🟠 Produce</div>
            <div className="stat-value">{totalContent}</div>
            <div className="stat-sub">pieces created from {totalSources} source{totalSources === 1 ? '' : 's'}</div>
          </div>
          <div className="stat-card stat-card-reach">
            <div className="stat-label">🔵 Reach</div>
            <div className="stat-value">{clients.length}</div>
            <div className="stat-sub">clients receiving scheduled content</div>
          </div>
          <div className="stat-card stat-card-respond">
            <div className="stat-label">⚪ Respond</div>
            <div className="stat-value">
              {totalPendingComments > 0 ? totalPendingComments : <span style={{ color: '#94a3b8' }}>—</span>}
            </div>
            <div className="stat-sub">{totalPendingComments > 0 ? 'awaiting your reply' : 'no comments yet'}</div>
          </div>
          <div className="stat-card stat-card-measure">
            <div className="stat-label">🟣 Measure</div>
            <div className="stat-value">
              {avgShare !== null ? `${avgShare}%` : <span style={{ color: '#94a3b8' }}>—</span>}
            </div>
            <div className="stat-sub">
              {citationClients.length > 0
                ? `avg citation share · ${citationClients.length} client${citationClients.length === 1 ? '' : 's'} tracked`
                : 'no citation runs yet'}
            </div>
          </div>
        </div>

        {/* Client grid */}
        {clients.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🏙️</div>
            <div className="empty-state-title">No clients yet</div>
            <p>Add your first client to get started</p>
            {/* Always show in single-client mode when there are no clients yet — needed for first-time setup */}
            <button className="btn btn-primary mt-16" onClick={onAddClient}>
              ➕ Add First Client
            </button>
          </div>
        ) : (
          <>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#374151', marginBottom: 12 }}>
              Your Clients
            </div>
            <div className="client-grid">
              {clients.map(client => (
                <div
                  key={client.id}
                  className="client-card"
                  onClick={() => onSelectClient(client.id)}
                >
                  <div className="client-card-name">{client.name}</div>
                  <div className="client-card-biz">{client.business_name}</div>
                  <div className="client-card-industry">{client.industry}</div>
                  <div className="client-card-meta">
                    <span className="client-card-badge">📝 {client.content_count || 0} pieces</span>
                    <span className="client-card-badge">📡 {client.source_count || 0} sources</span>
                    {client.contact_email && (
                      <span className="client-card-badge">✉️ Email set</span>
                    )}
                    {client.citation_last_share != null && (
                      <span className="client-card-badge" style={{ background: '#ede9fe', color: '#5b21b6' }}>
                        📡 {client.citation_last_share}% citations
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}
