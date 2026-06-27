import { useState, useEffect, useRef } from 'react'
import { useToast } from '../App.tsx'
import CitationChart from './CitationChart.tsx'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrackedBrand {
  id: string
  client_id: string
  name: string
  primary_url: string
  industry: string
  weekly_budget_gbp: number
  status: 'active' | 'paused'
  last_run_at: number | null
  next_run_at: number | null
  query_count?: number
  competitor_count?: number
  last_run?: CitationRun | null
  created_at: number
}

interface TrackedQuery {
  id: string
  brand_id: string
  text: string
  category: string
  priority: number
  active: number
  created_at: number
}

interface TrackedCompetitor {
  id: string
  brand_id: string
  name: string
  url: string
  aliases_json: string
  active: number
  created_at: number
}

interface CitationRun {
  id: string
  brand_id: string
  job_id: string | null
  run_at: number
  status: 'pending' | 'running' | 'complete' | 'failed' | 'partial'
  total_calls: number
  completed: number
  failed: number
  cost_gbp: number
  budget_gbp: number
  engines_json: string
  notes: string
}

interface CitationResult {
  id: string
  run_id: string
  query_id: string | null
  engine: string
  raw_response: string
  input_tokens: number
  output_tokens: number
  cost_gbp: number
  latency_ms: number
  http_status: number
  brand_mentioned: number | null
  brand_position: string | null
  brand_quote: string
  sentiment: string | null
  competitor_mentions_json: string
  error: string
  query_text?: string
  category?: string
}

type SubTab = 'overview' | 'queries' | 'competitors' | 'runs' | 'reports' | 'settings'

const ENGINE_LABEL: Record<string, string> = {
  anthropic: '🟠 Anthropic',
  openai: '🟢 OpenAI',
  perplexity: '🔵 Perplexity',
  gemini: '🔷 Gemini',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CitationHub({ clientId, clientName = '', clientDomain = '' }: { clientId: string; clientName?: string; clientDomain?: string }) {
  const { showToast } = useToast()

  // undefined = loading, null = not set up yet
  const [brand, setBrand] = useState<TrackedBrand | null | undefined>(undefined)
  const [subTab, setSubTab] = useState<SubTab>('overview')

  // Setup form — pre-populated from client profile
  const [setupName, setSetupName] = useState(clientName)
  const [setupUrl, setSetupUrl] = useState(clientDomain)
  const [settingUp, setSettingUp] = useState(false)

  // Queries
  const [queries, setQueries] = useState<TrackedQuery[]>([])
  const [newQueryText, setNewQueryText] = useState('')
  const [newQueryCategory, setNewQueryCategory] = useState('')
  const [newQueryPriority, setNewQueryPriority] = useState('1')
  const [addingQuery, setAddingQuery] = useState(false)

  // Competitors
  const [competitors, setCompetitors] = useState<TrackedCompetitor[]>([])
  const [newCompName, setNewCompName] = useState('')
  const [newCompUrl, setNewCompUrl] = useState('')
  const [newCompAliases, setNewCompAliases] = useState('')
  const [addingComp, setAddingComp] = useState(false)

  // Runs
  const [runs, setRuns] = useState<CitationRun[]>([])
  const [triggering, setTriggering] = useState(false)
  const [pendingJobId, setPendingJobId] = useState<string | null>(null)
  const [expandedRun, setExpandedRun] = useState<string | null>(null)
  const [runResults, setRunResults] = useState<Record<string, CitationResult[]>>({})
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reports
  const [reports, setReports] = useState<any[]>([])
  const [previewReport, setPreviewReport] = useState<string | null>(null) // html string
  const [generatingReport, setGeneratingReport] = useState(false)

  // Settings
  const [budget, setBudget] = useState('30')
  const [brandStatus, setBrandStatus] = useState<'active' | 'paused'>('active')
  const [savingSettings, setSavingSettings] = useState(false)

  // AI suggestions
  const [suggesting, setSuggesting] = useState(false)
  const [suggestions, setSuggestions] = useState<{ queries: { text: string; category: string }[]; competitors: { name: string; url: string }[] } | null>(null)
  const [selQ, setSelQ] = useState<Set<number>>(new Set())
  const [selC, setSelC] = useState<Set<number>>(new Set())
  const [addingQSug, setAddingQSug] = useState(false)
  const [addingCSug, setAddingCSug] = useState(false)

  // ── Load ─────────────────────────────────────────────────────────────────

  const loadBrand = async () => {
    const res = await fetch(`/api/clients/${clientId}/citation-tracker`)
    if (res.status === 404) { setBrand(null); return }
    const data = await res.json()
    setBrand(data)
    setBudget(String(data.weekly_budget_gbp ?? 30))
    setBrandStatus(data.status ?? 'active')
  }

  const loadQueries = async (brandId: string) => {
    const res = await fetch(`/api/citation-tracker/${brandId}/queries`)
    setQueries(await res.json())
  }

  const loadCompetitors = async (brandId: string) => {
    const res = await fetch(`/api/citation-tracker/${brandId}/competitors`)
    setCompetitors(await res.json())
  }

  const loadRuns = async (brandId: string) => {
    const res = await fetch(`/api/citation-tracker/${brandId}/runs`)
    const data: CitationRun[] = await res.json()
    setRuns(data)
    // Clear pending once we see the corresponding run appear
    if (pendingJobId && data.some(r => r.job_id === pendingJobId)) {
      setPendingJobId(null)
    }
    return data
  }

  useEffect(() => { loadBrand() }, [clientId])

  const loadReports = async (brandId: string) => {
    const res = await fetch(`/api/citation-tracker/${brandId}/reports`)
    setReports(await res.json())
  }

  useEffect(() => {
    if (!brand) return
    loadQueries(brand.id)
    loadCompetitors(brand.id)
    loadRuns(brand.id)
    loadReports(brand.id)
  }, [brand?.id])

  // ── Polling ───────────────────────────────────────────────────────────────
  // Poll while any run is in-flight or we're waiting for job-runner pick-up.

  useEffect(() => {
    if (!brand) return
    const isActive = pendingJobId !== null || runs.some(r => r.status === 'running' || r.status === 'pending')
    if (!isActive) {
      if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null }
      return
    }
    pollRef.current = setTimeout(async () => {
      await loadRuns(brand.id)
      await loadBrand()
    }, 4000)
    return () => { if (pollRef.current) clearTimeout(pollRef.current) }
  }, [runs, pendingJobId, brand?.id])

  // ── AI suggest ────────────────────────────────────────────────────────────

  const fetchSuggestions = async () => {
    if (suggesting) return
    setSuggesting(true)
    try {
      const r = await fetch(`/api/clients/${clientId}/citation-tracker/suggest`, { method: 'POST' })
      const data = await r.json()
      if (!r.ok) { showToast(data.error || 'Generation failed', 'error'); return }
      const existingQ = new Set(queries.map(q => q.text.toLowerCase()))
      const existingC = new Set(competitors.map(c => c.name.toLowerCase()))
      const freshQ = (data.queries || []).filter((q: any) => !existingQ.has(q.text.toLowerCase()))
      const freshC = (data.competitors || []).filter((c: any) => !existingC.has(c.name.toLowerCase()))
      setSuggestions({ queries: freshQ, competitors: freshC })
      setSelQ(new Set(freshQ.map((_: any, i: number) => i)))
      setSelC(new Set(freshC.map((_: any, i: number) => i)))
    } catch { showToast('Failed to generate suggestions', 'error') }
    finally { setSuggesting(false) }
  }

  const addSuggestedQueries = async () => {
    if (!suggestions || !brand) return
    const toAdd = suggestions.queries.filter((_, i) => selQ.has(i))
    if (!toAdd.length) return
    setAddingQSug(true)
    try {
      for (const q of toAdd) {
        await fetch(`/api/citation-tracker/${brand.id}/queries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: q.text, category: q.category || '', priority: 1 }),
        })
      }
      await loadQueries(brand.id)
      setSuggestions(s => s ? { ...s, queries: [] } : null)
      showToast(`Added ${toAdd.length} queries`)
    } finally { setAddingQSug(false) }
  }

  const addSuggestedCompetitors = async () => {
    if (!suggestions || !brand) return
    const toAdd = suggestions.competitors.filter((_, i) => selC.has(i))
    if (!toAdd.length) return
    setAddingCSug(true)
    try {
      for (const c of toAdd) {
        await fetch(`/api/citation-tracker/${brand.id}/competitors`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: c.name, url: c.url || '', aliases: '' }),
        })
      }
      await loadCompetitors(brand.id)
      setSuggestions(s => s ? { ...s, competitors: [] } : null)
      showToast(`Added ${toAdd.length} competitors`)
    } finally { setAddingCSug(false) }
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  const handleSetup = async () => {
    if (!setupName.trim()) { showToast('Brand name is required', 'error'); return }
    setSettingUp(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/citation-tracker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: setupName.trim(), primary_url: setupUrl.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || 'Setup failed', 'error'); return }
      showToast('Citation Tracker created!')
      setBrand({ ...data, query_count: 0, competitor_count: 0, last_run: null })
      setBudget(String(data.weekly_budget_gbp ?? 30))
    } finally { setSettingUp(false) }
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  const addQuery = async () => {
    if (!newQueryText.trim() || !brand) return
    setAddingQuery(true)
    try {
      const res = await fetch(`/api/citation-tracker/${brand.id}/queries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newQueryText.trim(), category: newQueryCategory.trim(), priority: Number(newQueryPriority) }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || 'Failed', 'error'); return }
      showToast('Query added')
      setNewQueryText(''); setNewQueryCategory(''); setNewQueryPriority('1')
      loadQueries(brand.id)
    } finally { setAddingQuery(false) }
  }

  const deleteQuery = async (id: string) => {
    if (!brand || !confirm('Remove this query?')) return
    await fetch(`/api/citation-tracker/${brand.id}/queries/${id}`, { method: 'DELETE' })
    loadQueries(brand.id)
  }

  const toggleQuery = async (q: TrackedQuery) => {
    if (!brand) return
    await fetch(`/api/citation-tracker/${brand.id}/queries/${q.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: q.active ? 0 : 1 }),
    })
    loadQueries(brand.id)
  }

  // ── Competitors ───────────────────────────────────────────────────────────

  const addCompetitor = async () => {
    if (!newCompName.trim() || !brand) return
    setAddingComp(true)
    try {
      const aliases = newCompAliases.split(',').map(s => s.trim()).filter(Boolean)
      const res = await fetch(`/api/citation-tracker/${brand.id}/competitors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCompName.trim(), url: newCompUrl.trim(), aliases }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || 'Failed', 'error'); return }
      showToast('Competitor added')
      setNewCompName(''); setNewCompUrl(''); setNewCompAliases('')
      loadCompetitors(brand.id)
    } finally { setAddingComp(false) }
  }

  const deleteCompetitor = async (id: string) => {
    if (!brand || !confirm('Remove this competitor?')) return
    await fetch(`/api/citation-tracker/${brand.id}/competitors/${id}`, { method: 'DELETE' })
    loadCompetitors(brand.id)
  }

  // ── Runs ──────────────────────────────────────────────────────────────────

  const triggerRun = async () => {
    if (!brand) return
    setTriggering(true)
    try {
      const res = await fetch(`/api/citation-tracker/${brand.id}/runs`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || 'Failed to trigger', 'error'); return }
      setPendingJobId(data.job_id)
      showToast('Run queued — starting in ~15 seconds')
      setSubTab('runs')
    } finally { setTriggering(false) }
  }

  const loadRunResults = async (runId: string) => {
    if (!brand) return
    const res = await fetch(`/api/citation-tracker/${brand.id}/runs/${runId}`)
    const data = await res.json()
    setRunResults(r => ({ ...r, [runId]: data.results || [] }))
  }

  const reClassifyRun = async (runId: string, reset = false) => {
    if (!brand) return
    const res = await fetch(`/api/citation-tracker/${brand.id}/runs/${runId}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset }),
    })
    const data = await res.json()
    if (!res.ok) { showToast(data.error || 'Failed', 'error'); return }
    showToast('Classification job queued')
    // Clear cached results so they reload after classification
    setRunResults(r => { const copy = { ...r }; delete copy[runId]; return copy })
  }

  const generateReport = async (runId: string) => {
    if (!brand) return
    setGeneratingReport(true)
    try {
      const res = await fetch(`/api/citation-tracker/${brand.id}/runs/${runId}/report`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || 'Failed to queue report', 'error'); return }
      showToast('Report generation queued — takes ~30 seconds')
      // Poll for the new report
      const poll = setInterval(async () => {
        await loadReports(brand.id)
        const fresh = await fetch(`/api/citation-tracker/${brand.id}/reports`).then(r => r.json())
        if (fresh.some((r: any) => r.run_id === runId)) {
          clearInterval(poll)
          setReports(fresh)
          setSubTab('reports')
        }
      }, 4000)
      setTimeout(() => clearInterval(poll), 120_000) // give up after 2 min
    } finally { setGeneratingReport(false) }
  }

  const viewReport = async (reportId: string) => {
    const res = await fetch(`/api/citation-tracker/${brand!.id}/reports/${reportId}`)
    const data = await res.json()
    setPreviewReport(data.html)
  }

  const toggleExpandRun = (runId: string) => {
    if (expandedRun === runId) { setExpandedRun(null); return }
    setExpandedRun(runId)
    loadRunResults(runId)  // always fetches fresh — shows latest classification
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  const saveSettings = async () => {
    if (!brand) return
    setSavingSettings(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/citation-tracker`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekly_budget_gbp: Number(budget), status: brandStatus }),
      })
      if (!res.ok) { showToast('Save failed', 'error'); return }
      showToast('Settings saved')
      loadBrand()
    } finally { setSavingSettings(false) }
  }

  // ── Render: loading ───────────────────────────────────────────────────────

  if (brand === undefined) {
    return <div className="page-content"><span className="loading" /> Loading…</div>
  }

  // ── Render: setup ─────────────────────────────────────────────────────────

  if (brand === null) {
    return (
      <div className="page-content">
        <div style={{ maxWidth: 540, margin: '0 auto' }}>
          <div className="card" style={{ padding: 32 }}>
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>📡</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Set up Citation Tracker</div>
              <div style={{ fontSize: '0.875rem', color: '#64748b', lineHeight: 1.6 }}>
                Track how often this brand is mentioned by Anthropic, OpenAI, Perplexity, and Gemini
                across your category queries. Weekly runs, automatic classification, and trend reporting.
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Brand name *</label>
              <input
                className="form-input"
                value={setupName}
                onChange={e => setSetupName(e.target.value)}
                placeholder="e.g. Riverside Dental"
                onKeyDown={e => e.key === 'Enter' && handleSetup()}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Primary website <span className="text-muted">(optional)</span></label>
              <input
                className="form-input"
                value={setupUrl}
                onChange={e => setSetupUrl(e.target.value)}
                placeholder="https://example.co.uk"
              />
            </div>
            <button
              className="btn btn-measure"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={handleSetup}
              disabled={settingUp || !setupName.trim()}
            >
              {settingUp ? <><span className="loading" /> Setting up…</> : '🚀 Create Citation Tracker'}
            </button>
          </div>

          <div style={{ marginTop: 20, padding: '16px 20px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: '0.8rem', color: '#64748b' }}>
            <div style={{ fontWeight: 600, color: '#374151', marginBottom: 6 }}>What this does</div>
            <ul style={{ paddingLeft: 16, lineHeight: 2 }}>
              <li>Sends your queries to 4 AI engines weekly (Sunday 23:00)</li>
              <li>Classifies each response: mentioned? where? positive/negative?</li>
              <li>Tracks competitor mentions in the same answers</li>
              <li>Generates a weekly Citation Health HTML report</li>
              <li>Budget cap: £30/week default (adjustable in Settings)</li>
            </ul>
          </div>
        </div>
      </div>
    )
  }

  // ── Render: active hub ────────────────────────────────────────────────────

  const activeQueries = queries.filter(q => q.active)
  const activeCompetitors = competitors.filter(c => c.active)
  const latestRun = runs[0] ?? null
  const isRunInFlight = pendingJobId !== null || runs.some(r => r.status === 'running' || r.status === 'pending')

  return (
    <>
      {/* Sub-tabs */}
      <div className="sub-tabs">
        {(['overview', 'queries', 'competitors', 'runs', 'reports', 'settings'] as SubTab[]).map(t => (
          <button
            key={t}
            className={`sub-tab sub-tab-measure ${subTab === t ? 'active' : ''}`}
            onClick={() => setSubTab(t)}
          >
            {t === 'overview' && '🔭 '}
            {t === 'queries' && `📋 `}
            {t === 'competitors' && `🥊 `}
            {t === 'runs' && `▶️ `}
            {t === 'reports' && `📄 `}
            {t === 'settings' && `⚙️ `}
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === 'queries' && <span style={{ marginLeft: 4, fontSize: '0.65rem', background: activeQueries.length >= 20 ? '#fee2e2' : '#ede9fe', color: activeQueries.length >= 20 ? '#991b1b' : '#5b21b6', borderRadius: 8, padding: '1px 6px' }}>{activeQueries.length}/20</span>}
            {t === 'competitors' && <span style={{ marginLeft: 4, fontSize: '0.65rem', background: activeCompetitors.length >= 10 ? '#fee2e2' : '#ede9fe', color: activeCompetitors.length >= 10 ? '#991b1b' : '#5b21b6', borderRadius: 8, padding: '1px 6px' }}>{activeCompetitors.length}/10</span>}
            {t === 'runs' && isRunInFlight && <span style={{ marginLeft: 4, width: 7, height: 7, borderRadius: '50%', background: '#4f46e5', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite' }} />}
          </button>
        ))}
      </div>

      <div className="page-content">

        {/* ── Overview ── */}
        {subTab === 'overview' && (
          <div style={{ maxWidth: 720 }}>
            {/* Brand header */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#0f172a' }}>{brand.name}</div>
                  {brand.primary_url && <a href={brand.primary_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8rem', color: '#4f46e5' }}>{brand.primary_url}</a>}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{
                    fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
                    padding: '3px 10px', borderRadius: 100,
                    background: brand.status === 'active' ? '#d1fae5' : '#f1f5f9',
                    color: brand.status === 'active' ? '#065f46' : '#64748b',
                  }}>{brand.status}</span>
                  <button
                    className="btn btn-measure btn-sm"
                    onClick={triggerRun}
                    disabled={triggering || isRunInFlight || brand.status === 'paused'}
                  >
                    {isRunInFlight ? <><span className="loading" /> Running…</> : '▶ Run now'}
                  </button>
                </div>
              </div>
            </div>

            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
              <StatCard label="Active Queries" value={String(activeQueries.length)} sub="of 20 max" accent="#4f46e5" />
              <StatCard label="Competitors" value={String(activeCompetitors.length)} sub="of 10 max" accent="#4f46e5" />
              <StatCard label="Total Runs" value={String(runs.length)} sub="all time" accent="#4f46e5" />
              <StatCard
                label="Last Cost"
                value={latestRun ? `£${latestRun.cost_gbp.toFixed(3)}` : '—'}
                sub={latestRun ? runStatusLabel(latestRun.status) : 'no runs yet'}
                accent="#4f46e5"
              />
            </div>

            {/* Last run card */}
            {latestRun ? (
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-header">
                  <span className="card-title">Latest run</span>
                  <RunStatusBadge status={latestRun.status} />
                </div>
                <div className="card-body" style={{ fontSize: '0.875rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
                    <div><div style={{ color: '#64748b', fontSize: '0.75rem' }}>Date</div><div style={{ fontWeight: 600 }}>{fmtDate(latestRun.run_at)}</div></div>
                    <div><div style={{ color: '#64748b', fontSize: '0.75rem' }}>Completed</div><div style={{ fontWeight: 600 }}>{latestRun.completed} / {latestRun.total_calls}</div></div>
                    <div><div style={{ color: '#64748b', fontSize: '0.75rem' }}>Failed</div><div style={{ fontWeight: 600, color: latestRun.failed > 0 ? '#dc2626' : '#64748b' }}>{latestRun.failed}</div></div>
                    <div><div style={{ color: '#64748b', fontSize: '0.75rem' }}>Cost</div><div style={{ fontWeight: 600 }}>£{latestRun.cost_gbp.toFixed(4)}</div></div>
                  </div>
                  {latestRun.notes && <div style={{ marginTop: 12, fontSize: '0.78rem', color: '#92400e', background: '#fef3c7', padding: '6px 10px', borderRadius: 6 }}>{latestRun.notes}</div>}
                  <button className="btn btn-ghost btn-sm" style={{ marginTop: 12, paddingLeft: 0, color: '#4f46e5' }} onClick={() => { setSubTab('runs'); toggleExpandRun(latestRun.id) }}>
                    View results →
                  </button>
                </div>
              </div>
            ) : (
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-body" style={{ textAlign: 'center', padding: '32px 20px', color: '#64748b' }}>
                  <div style={{ fontSize: '2rem', marginBottom: 8 }}>🏁</div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>No runs yet</div>
                  <div style={{ fontSize: '0.85rem', marginBottom: 16 }}>
                    {activeQueries.length === 0
                      ? 'Add at least one query in the Queries tab, then trigger a run.'
                      : 'Ready to run — all engines will be queried in parallel.'}
                  </div>
                  {activeQueries.length > 0 && (
                    <button className="btn btn-measure" onClick={triggerRun} disabled={triggering || brand.status === 'paused'}>
                      ▶ Trigger first run
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Citation share trend chart */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <span className="card-title">Citation share trend</span>
                <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Last 12 runs</span>
              </div>
              <div className="card-body" style={{ paddingTop: 8 }}>
                <CitationChart brandId={brand.id} />
              </div>
            </div>

            {/* Next run */}
            {brand.next_run_at && (
              <div style={{ fontSize: '0.78rem', color: '#64748b', textAlign: 'right' }}>
                Next scheduled run: <strong>{fmtDateTime(brand.next_run_at)}</strong> (Sunday 23:00)
              </div>
            )}
          </div>
        )}

        {/* ── Queries ── */}
        {subTab === 'queries' && (
          <div style={{ maxWidth: 680 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 600, color: '#374151' }}>Category queries</div>
                <div className="text-muted mt-4">These are sent to all four AI engines on each run.</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{activeQueries.length} / 20 active</span>
                {activeQueries.length < 20 && (
                  <button className="btn btn-ghost btn-sm" onClick={fetchSuggestions} disabled={suggesting}>
                    {suggesting ? <><span className="loading" /> Generating…</> : '✨ Auto-generate'}
                  </button>
                )}
              </div>
            </div>

            {/* Suggestion checklist */}
            {suggestions && suggestions.queries.length > 0 && (
              <div className="card" style={{ padding: 16, marginBottom: 16, border: '1px solid #c4b5fd', background: '#faf5ff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#5b21b6' }}>✨ AI-suggested queries — tick to add</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem' }} onClick={() => setSelQ(new Set(suggestions.queries.map((_, i) => i)))}>All</button>
                    <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem' }} onClick={() => setSelQ(new Set())}>None</button>
                    <button className="btn btn-sm" style={{ background: '#7c3aed', color: '#fff', fontSize: '0.8rem' }} onClick={addSuggestedQueries} disabled={addingQSug || selQ.size === 0}>
                      {addingQSug ? <><span className="loading" /> Adding…</> : `Add ${selQ.size} selected`}
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
                  {suggestions.queries.map((q, i) => (
                    <label key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', fontSize: '0.85rem', padding: '6px 8px', borderRadius: 6, background: selQ.has(i) ? '#ede9fe' : 'transparent' }}>
                      <input type="checkbox" checked={selQ.has(i)} onChange={e => { const s = new Set(selQ); e.target.checked ? s.add(i) : s.delete(i); setSelQ(s) }} style={{ marginTop: 2, flexShrink: 0 }} />
                      <span style={{ flex: 1 }}>{q.text}</span>
                      {q.category && <span style={{ fontSize: '0.68rem', background: '#ddd6fe', color: '#5b21b6', borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>{q.category}</span>}
                    </label>
                  ))}
                </div>
              </div>
            )}


            {/* Add query form */}
            {activeQueries.length < 20 && (
              <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'end' }}>
                  <div>
                    <label className="form-label">Query text *</label>
                    <input
                      className="form-input"
                      value={newQueryText}
                      onChange={e => setNewQueryText(e.target.value)}
                      placeholder="e.g. What are the best dentists in Manchester?"
                      onKeyDown={e => e.key === 'Enter' && addQuery()}
                    />
                  </div>
                  <div style={{ minWidth: 130 }}>
                    <label className="form-label">Category</label>
                    <input
                      className="form-input"
                      value={newQueryCategory}
                      onChange={e => setNewQueryCategory(e.target.value)}
                      placeholder="best-of, location…"
                    />
                  </div>
                  <div>
                    <label className="form-label">&nbsp;</label>
                    <button
                      className="btn btn-measure btn-sm"
                      onClick={addQuery}
                      disabled={addingQuery || !newQueryText.trim()}
                    >
                      {addingQuery ? <span className="loading" /> : '+ Add'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {queries.length === 0 ? (
              <div className="empty-state" style={{ padding: '40px 20px' }}>
                <div className="empty-state-icon">📋</div>
                <div className="empty-state-title">No queries yet</div>
                <p>Add the questions consumers ask when looking for this brand's category.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {queries.map(q => (
                  <div key={q.id} className="card" style={{ padding: '12px 16px', opacity: q.active ? 1 : 0.5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.875rem', color: '#0f172a', fontWeight: 500 }}>{q.text}</div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                          {q.category && <span className="badge" style={{ background: '#ede9fe', color: '#5b21b6', fontSize: '0.68rem' }}>{q.category}</span>}
                          <span className="badge" style={{ background: '#f1f5f9', color: '#64748b', fontSize: '0.68rem' }}>P{q.priority}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => toggleQuery(q)}
                          title={q.active ? 'Deactivate' : 'Activate'}
                          style={{ color: q.active ? '#4f46e5' : '#94a3b8' }}
                        >
                          {q.active ? '✓' : '○'}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => deleteQuery(q.id)} style={{ color: '#dc2626' }}>🗑</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Competitors ── */}
        {subTab === 'competitors' && (
          <div style={{ maxWidth: 680 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 600, color: '#374151' }}>Tracked competitors</div>
                <div className="text-muted mt-4">The classifier will detect these brands in engine responses.</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{activeCompetitors.length} / 10 active</span>
                {activeCompetitors.length < 10 && (
                  <button className="btn btn-ghost btn-sm" onClick={fetchSuggestions} disabled={suggesting}>
                    {suggesting ? <><span className="loading" /> Generating…</> : '✨ Auto-generate'}
                  </button>
                )}
              </div>
            </div>

            {/* Suggestion checklist */}
            {suggestions && suggestions.competitors.length > 0 && (
              <div className="card" style={{ padding: 16, marginBottom: 16, border: '1px solid #c4b5fd', background: '#faf5ff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#5b21b6' }}>✨ AI-suggested competitors — tick to add</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem' }} onClick={() => setSelC(new Set(suggestions.competitors.map((_, i) => i)))}>All</button>
                    <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem' }} onClick={() => setSelC(new Set())}>None</button>
                    <button className="btn btn-sm" style={{ background: '#7c3aed', color: '#fff', fontSize: '0.8rem' }} onClick={addSuggestedCompetitors} disabled={addingCSug || selC.size === 0}>
                      {addingCSug ? <><span className="loading" /> Adding…</> : `Add ${selC.size} selected`}
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
                  {suggestions.competitors.map((c, i) => (
                    <label key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', fontSize: '0.85rem', padding: '6px 8px', borderRadius: 6, background: selC.has(i) ? '#ede9fe' : 'transparent' }}>
                      <input type="checkbox" checked={selC.has(i)} onChange={e => { const s = new Set(selC); e.target.checked ? s.add(i) : s.delete(i); setSelC(s) }} style={{ flexShrink: 0 }} />
                      <span style={{ flex: 1, fontWeight: 500 }}>{c.name}</span>
                      {c.url && <span style={{ fontSize: '0.75rem', color: '#7c3aed' }}>{c.url}</span>}
                    </label>
                  ))}
                </div>
              </div>
            )}


            {activeCompetitors.length < 10 && (
              <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label className="form-label">Competitor name *</label>
                    <input className="form-input" value={newCompName} onChange={e => setNewCompName(e.target.value)} placeholder="e.g. Ink Factory" />
                  </div>
                  <div>
                    <label className="form-label">Website <span className="text-muted">(optional)</span></label>
                    <input className="form-input" value={newCompUrl} onChange={e => setNewCompUrl(e.target.value)} placeholder="https://…" />
                  </div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <label className="form-label">Aliases <span className="text-muted">(comma-separated name variants the classifier should match)</span></label>
                  <input className="form-input" value={newCompAliases} onChange={e => setNewCompAliases(e.target.value)} placeholder="e.g. The Ink Factory, Ink Factory UK" />
                </div>
                <button
                  className="btn btn-measure btn-sm"
                  style={{ marginTop: 10 }}
                  onClick={addCompetitor}
                  disabled={addingComp || !newCompName.trim()}
                >
                  {addingComp ? <span className="loading" /> : '+ Add Competitor'}
                </button>
              </div>
            )}

            {competitors.length === 0 ? (
              <div className="empty-state" style={{ padding: '40px 20px' }}>
                <div className="empty-state-icon">🥊</div>
                <div className="empty-state-title">No competitors yet</div>
                <p>Add the brands you want to track alongside yours in AI responses.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {competitors.map(c => {
                  const aliases = JSON.parse(c.aliases_json || '[]') as string[]
                  return (
                    <div key={c.id} className="card" style={{ padding: '12px 16px', opacity: c.active ? 1 : 0.5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#0f172a' }}>{c.name}</div>
                          {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: '#4f46e5' }}>{c.url}</a>}
                          {aliases.length > 0 && (
                            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 3 }}>
                              Also matches: {aliases.join(', ')}
                            </div>
                          )}
                        </div>
                        <button className="btn btn-ghost btn-sm" onClick={() => deleteCompetitor(c.id)} style={{ color: '#dc2626' }}>🗑</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Runs ── */}
        {subTab === 'runs' && (
          <div style={{ maxWidth: 800 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 600, color: '#374151' }}>Run history</div>
                <div className="text-muted mt-4">Each run queries all active queries × 4 engines.</div>
              </div>
              <button
                className="btn btn-measure"
                onClick={triggerRun}
                disabled={triggering || isRunInFlight || brand.status === 'paused' || activeQueries.length === 0}
              >
                {isRunInFlight ? <><span className="loading" /> In progress…</> : '▶ Trigger run'}
              </button>
            </div>

            {/* In-flight banner */}
            {isRunInFlight && (
              <div style={{ background: '#ede9fe', border: '1px solid #c4b5fd', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="loading" style={{ borderTopColor: '#4f46e5' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#4c1d95' }}>
                    {pendingJobId && runs.every(r => r.job_id !== pendingJobId) ? 'Queued — job-runner picks up in ~15s' : 'Running — querying engines…'}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#6d28d9', marginTop: 2 }}>This page updates automatically.</div>
                </div>
              </div>
            )}

            {activeQueries.length === 0 && (
              <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: '0.85rem', color: '#92400e' }}>
                ⚠️ No active queries — add queries in the Queries tab before triggering a run.
              </div>
            )}

            {runs.length === 0 ? (
              <div className="empty-state" style={{ padding: '40px 20px' }}>
                <div className="empty-state-icon">▶️</div>
                <div className="empty-state-title">No runs yet</div>
                <p>Trigger the first run to see your brand's AI citation position across all four engines.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {runs.map(run => (
                  <div key={run.id} className="card">
                    <div
                      style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                      onClick={() => toggleExpandRun(run.id)}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{fmtDate(run.run_at)}</span>
                          <RunStatusBadge status={run.status} />
                          {(run.status === 'running' || run.status === 'pending') && <span className="loading" style={{ borderTopColor: '#4f46e5' }} />}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 3, display: 'flex', gap: 12 }}>
                          <span>{run.completed}/{run.total_calls} completed</span>
                          {run.failed > 0 && <span style={{ color: '#dc2626' }}>{run.failed} failed</span>}
                          <span>£{run.cost_gbp.toFixed(4)}</span>
                          {JSON.parse(run.engines_json || '[]').length > 0 && (
                            <span>Engines: {JSON.parse(run.engines_json).join(', ')}</span>
                          )}
                        </div>
                        {run.notes && <div style={{ fontSize: '0.72rem', color: '#92400e', marginTop: 4 }}>{run.notes}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {(run.status === 'complete' || run.status === 'partial') && (
                          <>
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ fontSize: '0.72rem', color: '#4f46e5', padding: '2px 8px' }}
                              title="Re-run mention detection on this run's results"
                              onClick={e => { e.stopPropagation(); reClassifyRun(run.id) }}
                            >
                              🔍 Classify
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ fontSize: '0.72rem', color: '#7c3aed', padding: '2px 8px' }}
                              title="Generate a Claude Sonnet narrative report for this run"
                              onClick={e => { e.stopPropagation(); generateReport(run.id) }}
                              disabled={generatingReport}
                            >
                              📄 Report
                            </button>
                          </>
                        )}
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: '0.72rem', color: '#dc2626', padding: '2px 8px' }}
                          title="Delete this run and all its results"
                          onClick={async e => {
                            e.stopPropagation()
                            if (!confirm('Delete this run and all its results?')) return
                            await fetch(`/api/citation-tracker/${brand!.id}/runs/${run.id}`, { method: 'DELETE' })
                            setRuns(rs => rs.filter(r => r.id !== run.id))
                          }}
                        >
                          🗑
                        </button>
                        <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{expandedRun === run.id ? '▾' : '▸'}</span>
                      </div>
                    </div>

                    {/* Expanded results */}
                    {expandedRun === run.id && (
                      <div style={{ borderTop: '1px solid #f1f5f9' }}>
                        {!runResults[run.id] ? (
                          <div style={{ padding: '16px 20px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                            <span className="loading" /> Loading results…
                          </div>
                        ) : runResults[run.id].length === 0 ? (
                          <div style={{ padding: '16px 20px', color: '#94a3b8', fontSize: '0.85rem', textAlign: 'center' }}>No results recorded.</div>
                        ) : (
                          <ResultsTable results={runResults[run.id]} />
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Reports ── */}
        {subTab === 'reports' && (
          <div style={{ maxWidth: 800 }}>
            {/* Report preview modal */}
            {previewReport && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
                onClick={() => setPreviewReport(null)}>
                <div style={{ background: 'white', borderRadius: 12, width: '100%', maxWidth: 700, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
                  onClick={e => e.stopPropagation()}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Report preview</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => setPreviewReport(null)}>✕ Close</button>
                  </div>
                  <iframe
                    srcDoc={previewReport}
                    style={{ flex: 1, border: 'none', width: '100%' }}
                    title="Citation report preview"
                  />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 600, color: '#374151' }}>Citation reports</div>
                <div className="text-muted mt-4">Claude Sonnet narrative — headline, wins, concerns, actions.</div>
              </div>
              {/* Generate from latest completed run */}
              {runs.find(r => r.status === 'complete' || r.status === 'partial') && (
                <button
                  className="btn btn-measure"
                  onClick={() => {
                    const run = runs.find(r => r.status === 'complete' || r.status === 'partial')
                    if (run) generateReport(run.id)
                  }}
                  disabled={generatingReport}
                >
                  {generatingReport ? <><span className="loading" /> Generating…</> : '📄 Generate report'}
                </button>
              )}
            </div>

            {reports.length === 0 ? (
              <div className="empty-state" style={{ padding: '40px 20px' }}>
                <div className="empty-state-icon">📄</div>
                <div className="empty-state-title">No reports yet</div>
                <p>
                  {runs.some(r => r.status === 'complete' || r.status === 'partial')
                    ? 'Click "Generate report" to create a Claude Sonnet narrative from the latest run.'
                    : 'Complete a run first, then generate a report.'}
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {reports.map(report => (
                  <div key={report.id} className="card" style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#0f172a' }}>
                          Report — {fmtDate(report.created_at)}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 3, display: 'flex', gap: 10 }}>
                          <span>Run: {report.run_id.slice(0, 8)}…</span>
                          {report.emailed_at
                            ? <span style={{ color: '#16a34a' }}>✉ Emailed {fmtDate(report.emailed_at)}</span>
                            : <span style={{ color: '#94a3b8' }}>Not emailed — configure client SMTP to enable</span>}
                        </div>
                      </div>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: '#4f46e5' }}
                        onClick={() => viewReport(report.id)}
                      >
                        View →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Settings ── */}
        {subTab === 'settings' && (
          <div style={{ maxWidth: 480 }}>
            <div className="card" style={{ padding: 24 }}>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a', marginBottom: 20 }}>Citation Tracker settings</div>

              <div className="form-group">
                <label className="form-label">Weekly budget cap (£)</label>
                <input
                  className="form-input"
                  type="number"
                  min="1"
                  step="5"
                  value={budget}
                  onChange={e => setBudget(e.target.value)}
                />
                <div className="form-hint">
                  Pre-flight check aborts if estimated cost &gt; {Number(budget) * 1.2 || '—'} (budget × 1.2).
                  Runs also stop mid-sweep if live spend exceeds this figure.
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Status</label>
                <select
                  className="form-input"
                  value={brandStatus}
                  onChange={e => setBrandStatus(e.target.value as 'active' | 'paused')}
                >
                  <option value="active">Active — runs on schedule + manual triggers</option>
                  <option value="paused">Paused — scheduled runs skipped, manual blocked</option>
                </select>
                <div className="form-hint">Setting to Paused is the kill switch — use if a run behaves unexpectedly.</div>
              </div>

              <button className="btn btn-measure" onClick={saveSettings} disabled={savingSettings}>
                {savingSettings ? <><span className="loading" /> Saving…</> : '💾 Save settings'}
              </button>
            </div>

            <div style={{ marginTop: 16, padding: '14px 18px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: '0.8rem', color: '#64748b' }}>
              <div style={{ fontWeight: 600, color: '#374151', marginBottom: 6 }}>Schedule</div>
              Runs are triggered every <strong>Sunday at 23:00</strong> UK time via the scheduler.
              The schedule cron is <code style={{ background: '#e2e8f0', padding: '1px 5px', borderRadius: 4 }}>0 23 * * 0</code>.
            </div>
          </div>
        )}

      </div>
    </>
  )
}

// ─── Small sub-components ─────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="stat-card" style={{ borderTop: `3px solid ${accent}` }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ fontSize: '1.6rem', color: accent }}>{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  )
}

function RunStatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    pending:  { bg: '#ede9fe', color: '#5b21b6' },
    running:  { bg: '#dbeafe', color: '#1e40af' },
    complete: { bg: '#d1fae5', color: '#065f46' },
    partial:  { bg: '#fef3c7', color: '#92400e' },
    failed:   { bg: '#fee2e2', color: '#991b1b' },
  }
  const s = styles[status] ?? { bg: '#f1f5f9', color: '#64748b' }
  return (
    <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '2px 8px', borderRadius: 100, background: s.bg, color: s.color }}>
      {status}
    </span>
  )
}

function ResultsTable({ results }: { results: CitationResult[] }) {
  const [expandedResult, setExpandedResult] = useState<string | null>(null)

  // Group by query for a cleaner layout
  const byQuery: Record<string, CitationResult[]> = {}
  for (const r of results) {
    const key = r.query_text || r.query_id || 'unknown'
    if (!byQuery[key]) byQuery[key] = []
    byQuery[key].push(r)
  }

  return (
    <div style={{ padding: '12px 16px', fontSize: '0.8rem' }}>
      {Object.entries(byQuery).map(([queryText, rows]) => (
        <div key={queryText} style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, color: '#374151', marginBottom: 6, fontSize: '0.82rem' }}>
            {rows[0]?.category && <span style={{ background: '#ede9fe', color: '#5b21b6', borderRadius: 8, padding: '1px 6px', fontSize: '0.68rem', marginRight: 6 }}>{rows[0].category}</span>}
            "{queryText}"
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #f1f5f9', color: '#94a3b8', textAlign: 'left', fontWeight: 500 }}>
                <th style={{ padding: '4px 8px' }}>Engine</th>
                <th style={{ padding: '4px 8px' }}>Status</th>
                <th style={{ padding: '4px 8px' }}>Mentioned</th>
                <th style={{ padding: '4px 8px' }}>Position</th>
                <th style={{ padding: '4px 8px' }}>Sentiment</th>
                <th style={{ padding: '4px 8px' }}>Tokens</th>
                <th style={{ padding: '4px 8px' }}>Cost</th>
                <th style={{ padding: '4px 8px' }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <>
                  <tr key={r.id} style={{ borderBottom: '1px solid #f8fafc' }}>
                    <td style={{ padding: '5px 8px', fontWeight: 500 }}>{ENGINE_LABEL[r.engine] ?? r.engine}</td>
                    <td style={{ padding: '5px 8px' }}>
                      {r.error ? <span style={{ color: '#dc2626' }}>❌</span> : <span style={{ color: '#16a34a' }}>✅</span>}
                    </td>
                    <td style={{ padding: '5px 8px', color: '#64748b' }}>
                      {r.brand_mentioned === null ? <span style={{ color: '#94a3b8' }}>–</span> : r.brand_mentioned ? '✅' : '❌'}
                    </td>
                    <td style={{ padding: '5px 8px', color: '#64748b' }}>{r.brand_position ?? <span style={{ color: '#94a3b8' }}>–</span>}</td>
                    <td style={{ padding: '5px 8px', color: '#64748b' }}>{r.sentiment ?? <span style={{ color: '#94a3b8' }}>–</span>}</td>
                    <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{r.input_tokens + r.output_tokens || '–'}</td>
                    <td style={{ padding: '5px 8px', color: '#94a3b8' }}>{r.cost_gbp > 0 ? `£${r.cost_gbp.toFixed(4)}` : '–'}</td>
                    <td style={{ padding: '5px 8px' }}>
                      {r.raw_response && (
                        <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', fontSize: '0.7rem', color: '#4f46e5' }}
                          onClick={() => setExpandedResult(expandedResult === r.id ? null : r.id)}>
                          {expandedResult === r.id ? 'Hide' : 'Raw'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedResult === r.id && r.raw_response && (
                    <tr key={r.id + '-raw'}>
                      <td colSpan={8} style={{ padding: '8px 8px 12px' }}>
                        <div style={{ background: '#f8fafc', borderRadius: 6, padding: '10px 12px', fontSize: '0.78rem', color: '#374151', lineHeight: 1.6, maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap', border: '1px solid #e2e8f0' }}>
                          {r.raw_response}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div style={{ color: '#94a3b8', fontSize: '0.72rem', marginTop: 4 }}>
        Mentioned / Position / Sentiment columns are populated after the classifier runs (Day 3).
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function runStatusLabel(status: string) {
  return { complete: 'completed', partial: 'partial', failed: 'failed', running: 'running', pending: 'queued' }[status] ?? status
}

function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDateTime(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
