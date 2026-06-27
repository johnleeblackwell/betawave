import { useState, useEffect, useRef } from 'react'
import { Client, useToast } from '../App.tsx'

interface Template {
  id: string
  name: string
  kind: string
  variables: string[]
  prompt_template: string
}

interface Location {
  id: string
  name: string
  slug: string
  region: string
  active: number
}

interface Job {
  id: string
  type: string
  status: 'pending' | 'running' | 'complete' | 'failed' | 'cancelled'
  total: number
  completed: number
  failed: number
  params: any
  result: any
  error: string
  created_at: number
  started_at: number | null
  completed_at: number | null
}

interface Props {
  clientId: string
  client: Client
}

export default function PseoRunner({ clientId, client }: Props) {
  const { showToast } = useToast()
  const [templates, setTemplates] = useState<Template[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [templateId, setTemplateId] = useState<string>('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [wpPublish, setWpPublish] = useState(false)
  const [wpPostStatus, setWpPostStatus] = useState<'draft' | 'publish' | 'private'>('draft')
  const [wpCategoryId, setWpCategoryId] = useState(0)
  const [wpCategories, setWpCategories] = useState<{ id: number; name: string }[]>([])
  const [starting, setStarting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadAll = async () => {
    const [tRes, lRes, jRes] = await Promise.all([
      fetch(`/api/templates?kind=pseo&client_id=${clientId}`),
      fetch(`/api/clients/${clientId}/locations`),
      fetch(`/api/jobs?client_id=${clientId}&type=pseo_batch`),
    ])
    setTemplates(await tRes.json())
    setLocations(await lRes.json())
    setJobs(await jRes.json())
  }

  useEffect(() => { loadAll() }, [clientId])

  // Poll job progress every 4 seconds while any job is pending or running
  useEffect(() => {
    const hasLive = jobs.some(j => j.status === 'pending' || j.status === 'running')
    if (!hasLive) {
      if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null }
      return
    }
    pollRef.current = setTimeout(async () => {
      const res = await fetch(`/api/jobs?client_id=${clientId}&type=pseo_batch`)
      setJobs(await res.json())
    }, 4000)
    return () => { if (pollRef.current) clearTimeout(pollRef.current) }
  }, [jobs, clientId])

  // Fetch WP categories when WP publish is toggled on
  useEffect(() => {
    if (wpPublish && client.wp_url && wpCategories.length === 0) {
      fetch(`/api/clients/${clientId}/wordpress/categories`)
        .then(r => r.ok ? r.json() : [])
        .then(setWpCategories)
        .catch(() => {})
    }
  }, [wpPublish])

  const toggleAll = () => {
    const active = locations.filter(l => l.active)
    if (selectedIds.size === active.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(active.map(l => l.id)))
  }

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelectedIds(next)
  }

  const kickOff = async () => {
    if (!templateId) { showToast('Pick a template', 'error'); return }
    if (!selectedIds.size) { showToast('Pick at least one location', 'error'); return }
    setStarting(true)
    try {
      const res = await fetch('/api/jobs/pseo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          template_id: templateId,
          location_ids: [...selectedIds],
          wp_publish: wpPublish,
          wp_post_status: wpPostStatus,
          wp_category_id: wpCategoryId,
        })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        showToast(err.error || 'Failed to start job', 'error')
        return
      }
      showToast(`pSEO batch started — ${selectedIds.size} location${selectedIds.size === 1 ? '' : 's'}`)
      setSelectedIds(new Set())
      loadAll()
    } finally { setStarting(false) }
  }

  const cancelJob = async (id: string) => {
    if (!confirm('Cancel this job? In-flight pages finish first.')) return
    await fetch(`/api/jobs/${id}/cancel`, { method: 'POST' })
    showToast('Cancellation requested')
    loadAll()
  }

  const activeLocations = locations.filter(l => l.active)
  const selectedTemplate = templates.find(t => t.id === templateId)

  return (
    <div className="page-content">
      {/* Configuration card */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><span className="card-title">⚡ Run pSEO Batch</span></div>
        <div className="card-body">
          {templates.length === 0 ? (
            <div className="empty-state" style={{ padding: '20px 0' }}>
              <p style={{ color: '#64748b' }}>No pSEO templates yet. Head to the <strong>Templates</strong> tab to create one.</p>
            </div>
          ) : activeLocations.length === 0 ? (
            <div className="empty-state" style={{ padding: '20px 0' }}>
              <p style={{ color: '#64748b' }}>No active locations. Add some in the <strong>Locations</strong> tab.</p>
            </div>
          ) : (
            <>
              <div className="form-group">
                <label className="form-label">Template</label>
                <select className="form-input" value={templateId} onChange={e => setTemplateId(e.target.value)}>
                  <option value="">— pick one —</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                {selectedTemplate && selectedTemplate.variables.length > 0 && (
                  <div className="form-hint">
                    Variables: {selectedTemplate.variables.map(v => <code key={v} style={{ marginRight: 4 }}>{`{${v}}`}</code>)}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Locations ({selectedIds.size} of {activeLocations.length} selected)</span>
                  <button className="btn btn-ghost btn-sm" onClick={toggleAll} type="button">
                    {selectedIds.size === activeLocations.length ? 'Clear all' : 'Select all'}
                  </button>
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6, maxHeight: 260, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10 }}>
                  {activeLocations.map(loc => (
                    <label
                      key={loc.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', cursor: 'pointer',
                        borderRadius: 6,
                        background: selectedIds.has(loc.id) ? '#fef3c7' : 'transparent',
                        fontSize: '0.85rem'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(loc.id)}
                        onChange={() => toggleOne(loc.id)}
                      />
                      <span>{loc.name}{loc.region ? ` · ${loc.region}` : ''}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={wpPublish} onChange={e => setWpPublish(e.target.checked)} />
                  <span className="form-label" style={{ margin: 0 }}>Auto-publish each page to WordPress</span>
                </label>
              </div>

              {wpPublish && (
                <>
                  <div className="form-group">
                    <label className="form-label">Post status</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {(['draft', 'publish', 'private'] as const).map(s => (
                        <button
                          key={s}
                          type="button"
                          className={`btn btn-sm ${wpPostStatus === s ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={() => setWpPostStatus(s)}
                        >{s}</button>
                      ))}
                    </div>
                  </div>
                  {wpCategories.length > 0 && (
                    <div className="form-group">
                      <label className="form-label">WordPress category</label>
                      <select className="form-input" value={wpCategoryId} onChange={e => setWpCategoryId(Number(e.target.value))}>
                        <option value={0}>— none —</option>
                        {wpCategories.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}

              <button
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
                onClick={kickOff}
                disabled={starting || !templateId || !selectedIds.size}
              >
                {starting ? <><span className="loading" /> Starting…</> : `🚀 Generate ${selectedIds.size || ''} page${selectedIds.size === 1 ? '' : 's'}`}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Job history */}
      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#374151', marginBottom: 12 }}>Recent batches</div>
      {jobs.length === 0 ? (
        <div className="text-muted" style={{ fontSize: '0.85rem' }}>No batches run yet</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {jobs.map(j => (
            <JobCard key={j.id} job={j} onCancel={() => cancelJob(j.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function JobCard({ job, onCancel }: { job: Job; onCancel: () => void }) {
  const pct = job.total > 0 ? Math.round(((job.completed + job.failed) / job.total) * 100) : 0
  const statusColor: Record<Job['status'], string> = {
    pending: '#64748b', running: '#d97706', complete: '#22c55e', failed: '#ef4444', cancelled: '#94a3b8'
  }
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div>
          <span
            className="tag"
            style={{ background: statusColor[job.status] + '20', color: statusColor[job.status], fontWeight: 600, textTransform: 'uppercase', fontSize: '0.7rem' }}
          >{job.status}</span>
          <span style={{ marginLeft: 10, fontSize: '0.85rem', color: '#374151' }}>
            {job.completed} ok · {job.failed} failed · {job.total} total
          </span>
        </div>
        {(job.status === 'pending' || job.status === 'running') && (
          <button className="btn btn-sm btn-danger" onClick={onCancel}>⏹ Cancel</button>
        )}
      </div>
      <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: statusColor[job.status],
          transition: 'width 0.3s'
        }} />
      </div>
      {job.error && (
        <div style={{ marginTop: 8, fontSize: '0.8rem', color: '#ef4444' }}>Error: {job.error}</div>
      )}
      {job.result?.items && job.result.items.length > 0 && (
        <details style={{ marginTop: 8, fontSize: '0.8rem' }}>
          <summary style={{ cursor: 'pointer', color: '#64748b' }}>Show {job.result.items.length} result{job.result.items.length === 1 ? '' : 's'}</summary>
          <ul style={{ marginTop: 6, paddingLeft: 20, color: '#374151' }}>
            {job.result.items.map((r: any, i: number) => (
              <li key={i} style={{ marginBottom: 2 }}>
                {r.ok ? '✅' : '❌'} <strong>{r.location || '?'}</strong>
                {r.title ? ` — ${r.title}` : ''}
                {r.wp?.url ? <> · <a href={r.wp.url} target="_blank" rel="noopener noreferrer">view</a></> : ''}
                {r.error ? <span style={{ color: '#ef4444' }}> — {r.error}</span> : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
