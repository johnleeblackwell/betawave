import { useState, useEffect, useCallback } from 'react'
import { useToast } from '../App.tsx'

/**
 * Google Search Console — the client's OWN first-party search data.
 *
 * Two clearly separated halves, and the separation is the point:
 *  · API half   — live, automated, real organic performance.
 *  · Import half — AI Overviews / AI Mode, which Google exposes in the Search
 *                  Console UI only. No API exists, so the user exports a CSV
 *                  and uploads it. The UI says so plainly rather than letting
 *                  anyone assume those numbers arrived by themselves.
 */

interface Status {
  credentials_present: boolean
  connected: boolean
  site_url: string
  connected_at: number | null
  ai_import: { rows: number; imported_at: number; period_start: string; period_end: string } | null
  ai_via_api: boolean
  ai_note: string
}
interface Row { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }
interface Summary {
  site: string
  range: { start: string; end: string }
  totals: { clicks: number; impressions: number; ctr: number; position: number }
  top_queries: Row[]
  top_pages: Row[]
}
interface AiRow { query: string; clicks: number; impressions: number; ctr: number; position: number }

const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const num = (n: number) => Math.round(n).toLocaleString()

export default function SearchConsoleHub({ clientId }: { clientId: string }) {
  const { showToast } = useToast()
  const base = `/api/clients/${clientId}/search-console`

  const [status, setStatus] = useState<Status | null>(null)
  const [sites, setSites] = useState<{ siteUrl: string; permissionLevel: string }[]>([])
  const [sum, setSum] = useState<Summary | null>(null)
  const [ai, setAi] = useState<{ rows: AiRow[]; totals: { clicks: number; impressions: number; ctr: number } } | null>(null)
  const [loading, setLoading] = useState(false)
  const [days, setDays] = useState(28)
  const [csv, setCsv] = useState('')
  const [tab, setTab] = useState<'organic' | 'ai'>('organic')

  const loadStatus = useCallback(async () => {
    const r = await fetch(`${base}/status`)
    if (r.ok) setStatus(await r.json())
  }, [base])

  useEffect(() => { loadStatus() }, [loadStatus])

  const loadSummary = useCallback(async () => {
    setLoading(true)
    const r = await fetch(`${base}/summary?days=${days}`)
    const d = await r.json()
    setLoading(false)
    if (!r.ok) { showToast(d.error || 'Could not load Search Console', 'error'); return }
    setSum(d)
  }, [base, days, showToast])

  const loadAi = useCallback(async () => {
    const r = await fetch(`${base}/ai`)
    if (r.ok) setAi(await r.json())
  }, [base])

  useEffect(() => {
    if (status?.connected) loadSummary()
    if (status?.ai_import) loadAi()
  }, [status?.connected, status?.ai_import, loadSummary, loadAi])

  const pickSites = async () => {
    const r = await fetch(`${base}/sites`)
    const d = await r.json()
    if (!r.ok) { showToast(d.error || 'Could not list properties', 'error'); return }
    setSites(d.sites || [])
    if (!d.sites?.length) showToast('That Google account has no Search Console properties', 'error')
  }

  const connect = async (siteUrl: string) => {
    const r = await fetch(`${base}/property`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_url: siteUrl }),
    })
    if (r.ok) { showToast(`Connected ${siteUrl}`); setSites([]); loadStatus() }
  }

  const importCsv = async () => {
    const r = await fetch(`${base}/ai-import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv }),
    })
    const d = await r.json()
    if (!r.ok) { showToast(d.error || 'Import failed', 'error'); return }
    showToast(`Imported ${d.imported} rows`)
    setCsv(''); loadStatus(); loadAi()
  }

  if (!status) return <div className="loading" />

  if (!status.credentials_present) {
    return (
      <div className="card">
        <div className="card-header"><span className="card-title">🔍 Google Search Console</span></div>
        <div className="card-body" style={{ fontSize: '0.9rem', lineHeight: 1.6 }}>
          <p style={{ marginBottom: 12 }}>
            Not configured. Search Console is <strong>your own</strong> Google data — what Google
            actually showed people and what they actually clicked. No scraping, no third-party
            vendor, no terms-of-service grey area.
          </p>
          <p style={{ color: 'var(--text-tertiary)', marginBottom: 12 }}>
            Google has no API-key auth for this, so it needs OAuth. Create a Google Cloud project,
            enable the Search Console API, make an OAuth client, then add the client ID, secret and
            a refresh token under <strong>Settings → API keys</strong>. Your credentials, your
            Google account — βWave never holds either.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="card-title">🔍 Google Search Console</span>
          {status.connected && (
            <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>{status.site_url}</span>
          )}
        </div>
        <div className="card-body">
          {!status.connected ? (
            <>
              <p style={{ fontSize: '0.9rem', marginBottom: 12 }}>Pick the property for this client.</p>
              <button className="btn btn-primary btn-sm" onClick={pickSites}>List my properties</button>
              {!!sites.length && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {sites.map(s => (
                    <div key={s.siteUrl} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => connect(s.siteUrl)}>Connect</button>
                      <span style={{ fontSize: '0.85rem' }}>{s.siteUrl}</span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{s.permissionLevel}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className={`btn btn-sm ${tab === 'organic' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('organic')}>
                Organic (live from API)
              </button>
              <button className={`btn btn-sm ${tab === 'ai' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('ai')}>
                AI Overviews (CSV import)
              </button>
              {tab === 'organic' && (
                <>
                  <select className="form-input" style={{ width: 'auto', marginLeft: 'auto' }}
                          value={days} onChange={e => { setDays(Number(e.target.value)) }}>
                    <option value={7}>7 days</option>
                    <option value={28}>28 days</option>
                    <option value={90}>90 days</option>
                  </select>
                  <button className="btn btn-ghost btn-sm" onClick={loadSummary} disabled={loading}>
                    {loading ? <span className="loading" /> : '↻ Refresh'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {status.connected && tab === 'organic' && sum && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
            <Stat label="Clicks" value={num(sum.totals.clicks)} />
            <Stat label="Impressions" value={num(sum.totals.impressions)} />
            <Stat label="CTR" value={pct(sum.totals.ctr)} />
            <Stat label="Avg position" value={sum.totals.position.toFixed(1)} />
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
            {sum.range.start} → {sum.range.end} · Search Console data lags ~2 days, so the window ends there.
          </div>
          <RowTable title="Top queries" rows={sum.top_queries} />
          <RowTable title="Top pages" rows={sum.top_pages} />
        </>
      )}

      {status.connected && tab === 'ai' && (
        <>
          <div className="card" style={{ borderColor: 'var(--border-default)' }}>
            <div className="card-body" style={{ fontSize: '0.85rem', lineHeight: 1.6 }}>
              <strong>These numbers are not automated, and that is Google's doing.</strong>
              <p style={{ marginTop: 6, color: 'var(--text-tertiary)' }}>{status.ai_note}</p>
              <p style={{ marginTop: 8, color: 'var(--text-tertiary)' }}>
                In Search Console: <em>Performance → Search results</em>, switch on the Generative AI
                report, set your date range, then <em>Export → CSV</em> and paste it below. When
                Google ships an API for it, this becomes automatic and nothing else changes.
              </p>
            </div>
          </div>

          {status.ai_import && ai && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
                <Stat label="AI clicks" value={num(ai.totals.clicks)} />
                <Stat label="AI impressions" value={num(ai.totals.impressions)} />
                <Stat label="AI CTR" value={pct(ai.totals.ctr)} />
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                Imported {new Date(status.ai_import.imported_at * 1000).toLocaleString()} · {status.ai_import.rows} rows
                {status.ai_import.period_start && ` · ${status.ai_import.period_start} → ${status.ai_import.period_end}`}
              </div>
              <AiTable rows={ai.rows} />
            </>
          )}

          <div className="card">
            <div className="card-header"><span className="card-title">Import a Generative AI export</span></div>
            <div className="card-body">
              <textarea className="form-input" style={{ minHeight: 120, fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' }}
                        placeholder="Paste the CSV here — headers included" value={csv} onChange={e => setCsv(e.target.value)} />
              <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} disabled={!csv.trim()} onClick={importCsv}>
                Import
              </button>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginLeft: 10 }}>
                Replaces the previous import — it's a snapshot of a period, not a running log.
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: '0.72rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  )
}

function RowTable({ title, rows }: { title: string; rows: Row[] }) {
  if (!rows?.length) return null
  return (
    <div className="card">
      <div className="card-header"><span className="card-title">{title}</span></div>
      <div className="card-body" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
              <th style={{ padding: '6px 8px' }}>Term</th>
              <th style={{ padding: '6px 8px' }}>Clicks</th>
              <th style={{ padding: '6px 8px' }}>Impr.</th>
              <th style={{ padding: '6px 8px' }}>CTR</th>
              <th style={{ padding: '6px 8px' }}>Pos.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '6px 8px', wordBreak: 'break-word' }}>{r.keys.join(' · ')}</td>
                <td style={{ padding: '6px 8px' }}>{num(r.clicks)}</td>
                <td style={{ padding: '6px 8px' }}>{num(r.impressions)}</td>
                <td style={{ padding: '6px 8px' }}>{pct(r.ctr)}</td>
                <td style={{ padding: '6px 8px' }}>{r.position.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AiTable({ rows }: { rows: AiRow[] }) {
  if (!rows?.length) return null
  return (
    <div className="card">
      <div className="card-header"><span className="card-title">Queries where AI showed you</span></div>
      <div className="card-body" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
              <th style={{ padding: '6px 8px' }}>Query</th>
              <th style={{ padding: '6px 8px' }}>Clicks</th>
              <th style={{ padding: '6px 8px' }}>Impr.</th>
              <th style={{ padding: '6px 8px' }}>CTR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '6px 8px', wordBreak: 'break-word' }}>{r.query}</td>
                <td style={{ padding: '6px 8px' }}>{num(r.clicks)}</td>
                <td style={{ padding: '6px 8px' }}>{num(r.impressions)}</td>
                <td style={{ padding: '6px 8px' }}>{pct(r.ctr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
