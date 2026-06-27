import { useState, useEffect, useRef } from 'react'
import { useToast } from '../App.tsx'

interface Report {
  id: string
  client_id: string | null
  niche: string
  title: string
  subtitle: string
  hero_copy: string
  template_id: string | null
  status: 'draft' | 'published'
  created_at: number
  updated_at: number
}

interface Template { id: string; name: string; kind: string; variables: string[] }

interface Job {
  id: string
  type: string
  status: 'pending' | 'running' | 'complete' | 'failed' | 'cancelled'
  total: number
  completed: number
  failed: number
  params: any
  error: string
}

interface Props { clientId: string }

// Reports (niche lead-magnets) — create, generate, preview, publish, view leads.
export default function ReportManager({ clientId }: Props) {
  const { showToast } = useToast()
  const [reports, setReports] = useState<Report[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [newNiche, setNewNiche] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newSubtitle, setNewSubtitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [leads, setLeads] = useState<Record<string, any[]>>({})
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadAll = async () => {
    const [rRes, tRes, jRes] = await Promise.all([
      fetch(`/api/reports?client_id=${clientId}`),
      fetch(`/api/templates?kind=report&client_id=${clientId}`),
      fetch(`/api/jobs?client_id=${clientId}&type=report_generate`),
    ])
    setReports(await rRes.json())
    setTemplates(await tRes.json())
    setJobs(await jRes.json())
  }

  useEffect(() => { loadAll() }, [clientId])

  // Live-poll while any report_generate job is in-flight.
  useEffect(() => {
    const hasLive = jobs.some(j => j.status === 'pending' || j.status === 'running')
    if (!hasLive) {
      if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null }
      return
    }
    pollRef.current = setTimeout(async () => {
      const [jRes, rRes] = await Promise.all([
        fetch(`/api/jobs?client_id=${clientId}&type=report_generate`),
        fetch(`/api/reports?client_id=${clientId}`),
      ])
      setJobs(await jRes.json())
      setReports(await rRes.json())
    }, 4000)
    return () => { if (pollRef.current) clearTimeout(pollRef.current) }
  }, [jobs, clientId])

  const create = async () => {
    if (!newNiche.trim() || !newTitle.trim()) {
      showToast('Niche and title required', 'error'); return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          niche: newNiche.trim(),
          title: newTitle.trim(),
          subtitle: newSubtitle.trim(),
        })
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || 'Failed to create', 'error'); return }
      showToast('Report created')
      setShowCreate(false); setNewNiche(''); setNewTitle(''); setNewSubtitle('')
      loadAll()
    } finally { setCreating(false) }
  }

  const generate = async (reportId: string, templateId: string) => {
    if (!templateId) { showToast('Pick a template first', 'error'); return }
    const res = await fetch(`/api/reports/${reportId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: templateId })
    })
    if (!res.ok) { showToast('Failed to start generation', 'error'); return }
    showToast('Generation started — watch the progress')
    loadAll()
  }

  const togglePublish = async (reportId: string) => {
    const res = await fetch(`/api/reports/${reportId}/publish`, { method: 'PATCH' })
    const data = await res.json()
    if (!res.ok) { showToast(data.error || 'Failed', 'error'); return }
    showToast(`Report ${data.status}`)
    loadAll()
  }

  const remove = async (reportId: string) => {
    if (!confirm('Delete this report and all its leads?')) return
    await fetch(`/api/reports/${reportId}`, { method: 'DELETE' })
    showToast('Report deleted')
    loadAll()
  }

  const toggleExpand = async (reportId: string) => {
    if (expanded === reportId) { setExpanded(null); return }
    setExpanded(reportId)
    if (!leads[reportId]) {
      const res = await fetch(`/api/reports/${reportId}/leads`)
      const data = await res.json()
      setLeads(l => ({ ...l, [reportId]: data }))
    }
  }

  // Find the latest job for a given report (for inline progress display).
  const jobFor = (reportId: string): Job | undefined => {
    return jobs.find(j => j.params?.report_id === reportId && (j.status === 'pending' || j.status === 'running'))
      || jobs.find(j => j.params?.report_id === reportId)
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#374151' }}>Niche Reports</div>
          <div className="text-muted mt-4">Lead-magnet reports published at <code>aim.report/&#123;niche&#125;</code></div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>➕ New Report</button>
      </div>

      {reports.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📊</div>
          <div className="empty-state-title">No reports yet</div>
          <p>Create a niche report — it'll get its own landing page at <code>/r/&#123;niche&#125;</code></p>
          <button className="btn btn-primary mt-16" onClick={() => setShowCreate(true)}>➕ Create First Report</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {reports.map(r => {
            const activeJob = jobFor(r.id)
            const isLive = activeJob && (activeJob.status === 'pending' || activeJob.status === 'running')
            return (
              <div key={r.id} className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '1rem', fontWeight: 600 }}>{r.title}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                      <span
                        className="tag"
                        style={{
                          background: r.status === 'published' ? '#dcfce7' : '#f1f5f9',
                          color: r.status === 'published' ? '#166534' : '#64748b',
                          fontWeight: 600, textTransform: 'uppercase', fontSize: '0.7rem',
                        }}
                      >{r.status}</span>
                      <span className="tag">/r/{r.niche}</span>
                      {r.subtitle && <span style={{ fontSize: '0.8rem', color: '#64748b' }}>· {r.subtitle}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <a
                      href={`/r/${r.niche}${r.status === 'draft' ? '?preview=1' : ''}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-sm btn-secondary"
                    >👁 {r.status === 'draft' ? 'Preview' : 'View'}</a>
                    <button
                      className={`btn btn-sm ${r.status === 'published' ? 'btn-secondary' : 'btn-primary'}`}
                      onClick={() => togglePublish(r.id)}
                    >
                      {r.status === 'published' ? 'Unpublish' : 'Publish'}
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(r.id)}>🗑</button>
                  </div>
                </div>

                {/* Generate controls */}
                <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
                  {templates.length === 0 ? (
                    <span style={{ fontSize: '0.8rem', color: '#ef4444' }}>
                      No report templates — create one in the Templates tab first.
                    </span>
                  ) : (
                    <GenerateControls
                      report={r}
                      templates={templates}
                      onGenerate={templateId => generate(r.id, templateId)}
                      disabled={!!isLive}
                    />
                  )}
                </div>

                {/* Live progress */}
                {activeJob && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: 4, fontFamily: 'system-ui, sans-serif' }}>
                      Last job: <strong style={{ textTransform: 'uppercase' }}>{activeJob.status}</strong>
                      {activeJob.error && <span style={{ color: '#ef4444' }}> — {activeJob.error}</span>}
                    </div>
                    {isLive && (
                      <div style={{ height: 4, background: '#f1f5f9', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: activeJob.status === 'running' ? '60%' : '10%',
                          background: '#d97706',
                          transition: 'width 0.3s',
                          animation: 'pulse 1.5s ease-in-out infinite'
                        }} />
                      </div>
                    )}
                  </div>
                )}

                {/* Leads section */}
                <div style={{ marginTop: 14, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => toggleExpand(r.id)}
                    style={{ padding: 0, fontSize: '0.8rem' }}
                  >
                    {expanded === r.id ? '▾' : '▸'} Leads ({leads[r.id]?.length ?? '…'})
                  </button>
                  {expanded === r.id && (
                    <LeadsPanel reportId={r.id} rows={leads[r.id] || []} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create report modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowCreate(false)}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">New Report</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Niche slug *</label>
                <input
                  className="form-input"
                  value={newNiche}
                  onChange={e => setNewNiche(e.target.value)}
                  placeholder="e.g. dental-clinics"
                />
                <div className="form-hint">Used in the public URL: <code>aim.report/{newNiche.trim() || 'your-niche'}</code></div>
              </div>
              <div className="form-group">
                <label className="form-label">Title *</label>
                <input
                  className="form-input"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="e.g. The 2026 UK Dental Care Report"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Subtitle <span className="text-muted">(optional)</span></label>
                <input
                  className="form-input"
                  value={newSubtitle}
                  onChange={e => setNewSubtitle(e.target.value)}
                  placeholder="One-line pitch shown under the title"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={create} disabled={creating}>
                {creating ? <><span className="loading" /> Creating…</> : '✅ Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function GenerateControls({
  report, templates, onGenerate, disabled
}: {
  report: Report
  templates: Template[]
  onGenerate: (templateId: string) => void
  disabled: boolean
}) {
  const [tplId, setTplId] = useState(report.template_id || templates[0]?.id || '')
  return (
    <>
      <select
        className="form-input"
        value={tplId}
        onChange={e => setTplId(e.target.value)}
        style={{ flex: 1, maxWidth: 300 }}
      >
        {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <button
        className="btn btn-primary btn-sm"
        onClick={() => onGenerate(tplId)}
        disabled={disabled || !tplId}
      >
        ✨ {report.hero_copy ? 'Regenerate' : 'Generate'}
      </button>
    </>
  )
}

function LeadsPanel({ reportId, rows }: { reportId: string; rows: any[] }) {
  if (!rows.length) {
    return <div style={{ fontSize: '0.85rem', color: '#64748b', padding: '8px 0' }}>No leads yet.</div>
  }
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{rows.length} lead{rows.length === 1 ? '' : 's'}</span>
        <a href={`/api/reports/${reportId}/leads.csv`} className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem' }}>⬇ Export CSV</a>
      </div>
      <div style={{ maxHeight: 200, overflowY: 'auto', fontSize: '0.82rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b', fontWeight: 500, textAlign: 'left' }}>
              <th style={{ padding: '6px 8px' }}>Email</th>
              <th style={{ padding: '6px 8px' }}>Name</th>
              <th style={{ padding: '6px 8px' }}>Source</th>
              <th style={{ padding: '6px 8px' }}>Kit</th>
              <th style={{ padding: '6px 8px' }}>Captured</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '6px 8px' }}>{r.email}</td>
                <td style={{ padding: '6px 8px' }}>{r.name || '—'}</td>
                <td style={{ padding: '6px 8px', color: '#64748b' }}>{r.source}</td>
                <td style={{ padding: '6px 8px' }}>{r.kit_synced ? '✅' : '—'}</td>
                <td style={{ padding: '6px 8px', color: '#94a3b8' }}>
                  {new Date(r.created_at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
