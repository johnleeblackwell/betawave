import { useState, useEffect } from 'react'
import { useToast } from '../App.tsx'

interface Site {
  id: string
  client_id: string
  name: string
  slug: string
  custom_domain: string
  status: string
  stack: string
  site_dir: string
  pseo_collection: string
  last_deploy_url: string
  last_built_at: number | null
  last_deployed_at: number | null
  created_at: number
}

interface Deployment {
  id: string
  site_id: string
  type: string
  status: string
  log: string
  url: string
  created_at: number
}

interface PseoRow {
  id: string
  title: string
  excerpt: string
  status: string
  created_at: number
}

interface Props {
  clientId: string
}

export default function SiteBuilder({ clientId }: Props) {
  const { showToast } = useToast()
  const [site, setSite] = useState<Site | null>(null)
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [siteName, setSiteName] = useState('Website')
  const [customDomain, setCustomDomain] = useState('')
  const [building, setBuilding] = useState(false)
  const [buildLog, setBuildLog] = useState('')
  const [pseoRows, setPseoRows] = useState<PseoRow[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState<{ ok: boolean; message: string; url?: string } | null>(null)

  const loadSite = async () => {
    const res = await fetch(`/api/clients/${clientId}/sites`)
    const data = await res.json()
    if (data) {
      setSite(data)
      setSiteName(data.name)
      setCustomDomain(data.custom_domain)
    }
  }

  const loadDeployments = async () => {
    const res = await fetch(`/api/clients/${clientId}/sites/deployments`)
    const data = await res.json()
    setDeployments(data)
  }

  const loadPseoRows = async () => {
    const res = await fetch(`/api/clients/${clientId}/sites/pseo`)
    const data = await res.json()
    setPseoRows(data)
  }

  useEffect(() => {
    loadSite()
    loadDeployments()
    loadPseoRows()
  }, [clientId])

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handlePseoPublish = async (live: boolean) => {
    if (selectedIds.size === 0) return
    if (live && !confirm(`Publish ${selectedIds.size} page(s) LIVE to the real site? This updates the public domain.`)) return
    setPublishing(true)
    setPublishResult(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/sites/pseo-publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentIds: Array.from(selectedIds), live }),
      })
      const data = await res.json()
      if (data.ok) {
        setPublishResult({
          ok: true,
          message: data.production ? `Published ${data.written} page(s) LIVE` : `${data.written} page(s) deployed as a preview`,
          url: data.url,
        })
        showToast(data.production ? 'Published live!' : 'Preview deployed')
        setSelectedIds(new Set())
        loadPseoRows()
      } else {
        setPublishResult({ ok: false, message: data.error || 'Publish failed' })
        showToast('Publish failed', 'error')
      }
    } catch (e: any) {
      setPublishResult({ ok: false, message: e.message })
      showToast('Publish failed', 'error')
    } finally {
      setPublishing(false)
    }
  }

  const handleSave = async () => {
    await fetch(`/api/clients/${clientId}/sites`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: siteName, custom_domain: customDomain }),
    })
    loadSite()
    showToast('Site settings saved')
  }

  const handleBuild = async () => {
    setBuilding(true)
    setBuildLog('Building...')
    try {
      const res = await fetch(`/api/clients/${clientId}/sites/build`, { method: 'POST' })
      const data = await res.json()
      setBuildLog(data.log || 'Build completed')
      if (data.ok) {
        showToast('Site built successfully!')
        loadSite()
        loadDeployments()
      } else {
        showToast('Build failed — see build log for details', 'error')
      }
    } catch {
      setBuildLog('Build request failed')
      showToast('Build failed', 'error')
    } finally {
      setBuilding(false)
    }
  }

  const previewUrl = site ? `/site/${site.slug}` : null

  return (
    <div className="page-content" style={{ maxWidth: 760 }}>
      {!site && (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: 32 }}>
            <p style={{ color: '#64748b', marginBottom: 12 }}>
              Each client can have a static Jamstack website built from their generated content.
            </p>
            <button className="btn btn-primary" onClick={handleBuild}>
              Initialize Site
            </button>
          </div>
        </div>
      )}

      {site && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <span className="card-title">Site Settings</span>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="form-group">
                <div className="form-label">Site Name</div>
                <input
                  className="form-input"
                  value={siteName}
                  onChange={e => setSiteName(e.target.value)}
                  placeholder="Website"
                />
              </div>
              <div className="form-group">
                <div className="form-label">Custom Domain (optional)</div>
                <input
                  className="form-input"
                  value={customDomain}
                  onChange={e => setCustomDomain(e.target.value)}
                  placeholder="e.g. www.example.com"
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={handleSave}>Save Settings</button>
                <button
                  className={`btn btn-primary btn-sm ${building ? 'disabled' : ''}`}
                  onClick={handleBuild}
                  disabled={building}
                >
                  {building ? '⏳ Building...' : '⚡ Build Site'}
                </button>
              </div>
            </div>
          </div>

          {previewUrl && site.status !== 'draft' && (
            <div className="card" style={{ marginBottom: 16, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
              <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, color: '#166534' }}>✅ Site is built</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary btn-sm"
                  >
                    🔗 Preview Site
                  </a>
                </div>
              </div>
            </div>
          )}

          {site.stack === 'astro_netlify' && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <span className="card-title">Publish pSEO to Site</span>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p style={{ color: '#64748b', fontSize: '0.85rem', margin: 0 }}>
                  Writes selected pages into the <code>{site.pseo_collection || 'posts'}</code> collection.
                  Preview deploys never touch the live domain — Publish Live does.
                </p>
                {pseoRows.length === 0 ? (
                  <div style={{ padding: 16, color: '#94a3b8', textAlign: 'center' }}>
                    No generated pSEO pages yet
                  </div>
                ) : (
                  <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
                    {pseoRows.map(row => (
                      <label
                        key={row.id}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px',
                          borderBottom: '1px solid #f1f5f9', cursor: 'pointer', fontSize: '0.85rem',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(row.id)}
                          onChange={() => toggleSelected(row.id)}
                          style={{ marginTop: 2 }}
                        />
                        <span style={{ flex: 1 }}>
                          <span style={{ fontWeight: 600 }}>{row.title}</span>{' '}
                          <span className={`status-badge status-${row.status}`} style={{ marginLeft: 6 }}>{row.status}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={selectedIds.size === 0 || publishing}
                    onClick={() => handlePseoPublish(false)}
                  >
                    {publishing ? '⏳ Working...' : `👀 Preview (${selectedIds.size})`}
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={selectedIds.size === 0 || publishing}
                    onClick={() => handlePseoPublish(true)}
                    style={{ background: '#dc2626', borderColor: '#dc2626' }}
                  >
                    {publishing ? '⏳ Working...' : `🔴 Publish Live (${selectedIds.size})`}
                  </button>
                </div>
                {publishResult && (
                  <div style={{
                    padding: 10, borderRadius: 6, fontSize: '0.85rem',
                    background: publishResult.ok ? '#f0fdf4' : '#fef2f2',
                    color: publishResult.ok ? '#166534' : '#991b1b',
                  }}>
                    {publishResult.message}
                    {publishResult.url && (
                      <> — <a href={publishResult.url} target="_blank" rel="noopener noreferrer">{publishResult.url}</a></>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {buildLog && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <span className="card-title">Build Log</span>
              </div>
              <div className="card-body">
                <pre style={{
                  fontSize: '0.8rem', color: '#334155', background: '#f1f5f9',
                  padding: 12, borderRadius: 6, maxHeight: 300, overflowY: 'auto',
                  whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace',
                }}>
                  {buildLog}
                </pre>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header">
              <span className="card-title">Deployment History</span>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              {deployments.length === 0 ? (
                <div style={{ padding: 16, color: '#94a3b8', textAlign: 'center' }}>
                  No deployments yet
                </div>
              ) : (
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e2e8f0', fontSize: '0.8rem', color: '#64748b' }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left' }}>Type</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left' }}>Status</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left' }}>Date</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left' }}>URL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deployments.map(d => (
                      <tr key={d.id} style={{ borderBottom: '1px solid #f1f5f9', fontSize: '0.85rem' }}>
                        <td style={{ padding: '8px 12px' }}>{d.type}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span className={`status-badge status-${d.status}`}>{d.status}</span>
                        </td>
                        <td style={{ padding: '8px 12px', color: '#64748b' }}>
                          {new Date(d.created_at * 1000).toLocaleDateString()}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          {d.url ? (
                            <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>
                              {d.url}
                            </a>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
