import { useState, useEffect } from 'react'
import { Client, useToast } from '../App.tsx'
import LocationManager from './LocationManager.tsx'
import TemplateManager from './TemplateManager.tsx'
import PseoRunner from './PseoRunner.tsx'

interface Site {
  id: string
  client_id: string
  name: string
  slug: string
  custom_domain: string
  status: string
  stack: string
  site_dir: string
  netlify_site_id: string
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
  client: Client
  operator?: boolean   // client-scoped moderator — pSEO generation/publish is agency-only, hide those sub-tabs
}

type SubTab = 'settings' | 'generate' | 'locations' | 'templates' | 'publish'

export default function SiteBuilder({ clientId, client, operator = false }: Props) {
  const { showToast } = useToast()
  const [subTab, setSubTab] = useState<SubTab>('settings')
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

  // WordPress publishing (client's own existing site — no Netlify/Astro involved)
  const [wpUrl, setWpUrl] = useState(client.wp_url || '')
  const [wpUsername, setWpUsername] = useState(client.wp_username || '')
  const [wpAppPassword, setWpAppPassword] = useState(client.wp_app_password || '')
  const [wpSaving, setWpSaving] = useState(false)
  const [wpTesting, setWpTesting] = useState(false)
  const [wpTestResult, setWpTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  // Astro + Netlify managed site setup wizard
  const [netlifySiteName, setNetlifySiteName] = useState('')
  const [creatingNetlify, setCreatingNetlify] = useState(false)
  const [netlifyError, setNetlifyError] = useState('')
  const [materialising, setMaterialising] = useState(false)
  const [publishingLive, setPublishingLive] = useState(false)

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

  const handleWpSave = async () => {
    setWpSaving(true)
    try {
      await fetch(`/api/clients/${clientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wp_url: wpUrl, wp_username: wpUsername, wp_app_password: wpAppPassword }),
      })
      showToast('WordPress settings saved')
    } finally {
      setWpSaving(false)
    }
  }

  const handleWpTest = async () => {
    setWpTesting(true)
    setWpTestResult(null)
    try {
      await handleWpSave()
      const res = await fetch(`/api/clients/${clientId}/wordpress/categories`)
      const data = await res.json()
      if (res.ok) {
        setWpTestResult({ ok: true, message: `Connected — found ${data.length} categor${data.length === 1 ? 'y' : 'ies'}` })
      } else {
        setWpTestResult({ ok: false, message: data.error || 'Connection failed' })
      }
    } catch (e: any) {
      setWpTestResult({ ok: false, message: e.message })
    } finally {
      setWpTesting(false)
    }
  }

  const handleCreateNetlify = async () => {
    if (!netlifySiteName.trim()) return
    setCreatingNetlify(true)
    setNetlifyError('')
    try {
      const res = await fetch(`/api/clients/${clientId}/sites/netlify/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ netlifySiteName: netlifySiteName.trim(), customDomain: customDomain || undefined }),
      })
      const data = await res.json()
      if (res.ok) {
        showToast('Netlify site created')
        loadSite()
      } else {
        setNetlifyError(data.error || 'Failed to create Netlify site')
      }
    } catch (e: any) {
      setNetlifyError(e.message)
    } finally {
      setCreatingNetlify(false)
    }
  }

  const handleMaterialise = async () => {
    setMaterialising(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/sites/materialise`, { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        showToast('Site materialised — ready to build')
        loadSite()
      } else {
        showToast(data.log || data.error || 'Materialise failed', 'error')
      }
    } finally {
      setMaterialising(false)
    }
  }

  const handleAstroPublish = async (live: boolean) => {
    if (live && !confirm('Publish the site LIVE? This updates the public domain.')) return
    if (live) setPublishingLive(true); else setBuilding(true)
    setBuildLog(live ? 'Publishing live...' : 'Building preview...')
    try {
      const res = await fetch(`/api/clients/${clientId}/sites/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ live }),
      })
      const data = await res.json()
      if (data.ok) {
        setBuildLog(data.url ? `Deployed: ${data.url}` : 'Deployed')
        showToast(data.production ? 'Published live!' : 'Preview deployed')
        loadSite()
        loadDeployments()
      } else {
        setBuildLog(data.error || data.log || 'Publish failed')
        showToast('Publish failed', 'error')
      }
    } catch (e: any) {
      setBuildLog(e.message)
      showToast('Publish failed', 'error')
    } finally {
      if (live) setPublishingLive(false); else setBuilding(false)
    }
  }

  const previewUrl = site ? `/site/${site.slug}` : null

  return (
    <div className="page-content" style={{ maxWidth: 760 }}>
      <div className="sub-tabs">
        <button className={`sub-tab ${subTab === 'settings' ? 'active' : ''}`} onClick={() => setSubTab('settings')}>
          ⚙️ Settings
        </button>
        {!operator && (
          <>
            <button className={`sub-tab ${subTab === 'generate' ? 'active' : ''}`} onClick={() => setSubTab('generate')}>
              🚀 Generate
            </button>
            <button className={`sub-tab ${subTab === 'locations' ? 'active' : ''}`} onClick={() => setSubTab('locations')}>
              📍 Locations
            </button>
            <button className={`sub-tab ${subTab === 'templates' ? 'active' : ''}`} onClick={() => setSubTab('templates')}>
              📝 Templates
            </button>
            <button className={`sub-tab ${subTab === 'publish' ? 'active' : ''}`} onClick={() => setSubTab('publish')}>
              📤 Publish
            </button>
          </>
        )}
      </div>

      {subTab === 'generate' && !operator && <PseoRunner clientId={clientId} client={client} />}
      {subTab === 'locations' && !operator && <LocationManager clientId={clientId} />}
      {subTab === 'templates' && !operator && <TemplateManager clientId={clientId} kindFilter="pseo" />}

      {subTab === 'settings' && !site && (
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

      {subTab === 'settings' && site && (
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
                {site.stack !== 'astro_netlify' && (
                  <button
                    className={`btn btn-primary btn-sm ${building ? 'disabled' : ''}`}
                    onClick={handleBuild}
                    disabled={building}
                  >
                    {building ? '⏳ Building...' : '⚡ Build Site'}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <span className="card-title">WordPress Publishing</span>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ color: '#64748b', fontSize: '0.85rem', margin: 0 }}>
                If this client already has their own WordPress site, connect it here — generated
                content can then publish straight to it instead of (or alongside) a managed site.
              </p>
              <div className="form-group">
                <div className="form-label">Site URL</div>
                <input
                  className="form-input"
                  value={wpUrl}
                  onChange={e => setWpUrl(e.target.value)}
                  placeholder="https://example.com"
                />
              </div>
              <div className="form-group">
                <div className="form-label">Username</div>
                <input
                  className="form-input"
                  value={wpUsername}
                  onChange={e => setWpUsername(e.target.value)}
                  placeholder="admin"
                />
              </div>
              <div className="form-group">
                <div className="form-label">Application Password</div>
                <input
                  className="form-input"
                  type="password"
                  value={wpAppPassword}
                  onChange={e => setWpAppPassword(e.target.value)}
                  placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={handleWpSave} disabled={wpSaving}>
                  {wpSaving ? '⏳ Saving...' : 'Save'}
                </button>
                <button className="btn btn-primary btn-sm" onClick={handleWpTest} disabled={wpTesting || !wpUrl}>
                  {wpTesting ? '⏳ Testing...' : '🔌 Test Connection'}
                </button>
              </div>
              {wpTestResult && (
                <div style={{
                  padding: 10, borderRadius: 6, fontSize: '0.85rem',
                  background: wpTestResult.ok ? '#f0fdf4' : '#fef2f2',
                  color: wpTestResult.ok ? '#166534' : '#991b1b',
                }}>
                  {wpTestResult.message}
                </div>
              )}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <span className="card-title">Managed Site (Astro + Netlify)</span>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {!site.netlify_site_id ? (
                <>
                  <p style={{ color: '#64748b', fontSize: '0.85rem', margin: 0 }}>
                    Recommended, done-for-you route: βWave™ hosts a fast static site for this client
                    on Netlify. Pick a subdomain to start — the custom domain above gets pointed at
                    it once it's live.
                  </p>
                  <div className="form-group">
                    <div className="form-label">Netlify Site Name</div>
                    <input
                      className="form-input"
                      value={netlifySiteName}
                      onChange={e => setNetlifySiteName(e.target.value)}
                      placeholder="e.g. locatorink"
                    />
                    <div className="form-hint">Site will be reachable at {netlifySiteName || '<name>'}.netlify.app</div>
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleCreateNetlify}
                    disabled={creatingNetlify || !netlifySiteName.trim()}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    {creatingNetlify ? '⏳ Creating...' : '🌐 Create Netlify Site'}
                  </button>
                  {netlifyError && <div style={{ color: '#991b1b', fontSize: '0.85rem' }}>{netlifyError}</div>}
                </>
              ) : !site.site_dir ? (
                <>
                  <p style={{ color: '#64748b', fontSize: '0.85rem', margin: 0 }}>
                    Netlify site <strong>{site.netlify_site_id}</strong> is linked. Next, materialise
                    the site template so it can be built.
                  </p>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleMaterialise}
                    disabled={materialising}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    {materialising ? '⏳ Materialising...' : '📦 Materialise Site'}
                  </button>
                </>
              ) : (
                <>
                  <p style={{ color: '#64748b', fontSize: '0.85rem', margin: 0 }}>
                    Preview deploys never touch the live domain — Publish Live does.
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleAstroPublish(false)}
                      disabled={building || publishingLive}
                    >
                      {building ? '⏳ Working...' : '👀 Preview Build'}
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleAstroPublish(true)}
                      disabled={building || publishingLive}
                      style={{ background: '#dc2626', borderColor: '#dc2626' }}
                    >
                      {publishingLive ? '⏳ Working...' : '🔴 Publish Live'}
                    </button>
                  </div>
                </>
              )}
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
        </>
      )}

      {subTab === 'publish' && !operator && site && (
        <>
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
