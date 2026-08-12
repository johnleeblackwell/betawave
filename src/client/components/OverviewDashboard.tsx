/**
 * Overview dashboard — proof that the engine is running, above the fold.
 *
 * The Overview tab used to open on identity fields and a brand-voice
 * paragraph: a configuration screen. Anyone being shown the product — a
 * prospect on the demo login, or a self-hoster on first run — landed on
 * settings, with every piece of evidence that it works one click away under
 * Produce, Reach and Measure.
 *
 * So this sits at the top: four tiles for the four pillars, a pipeline bar,
 * and a dated activity stream. The stream matters more than the tiles. Counts
 * say how much exists; dated events say the thing is alive, which is the
 * question a visitor is actually asking.
 *
 * Renders nothing at all when the tenant is genuinely empty — a wall of zeroes
 * is worse than the identity card it replaced.
 */
import { useEffect, useState } from 'react'

interface Overview {
  produce: { published: number; scheduled: number; drafts: number; last_30_days: number }
  reach: { segments: number; organisations: number; contacts: number; in_play: number; due_today: number; replied: number; won: number }
  pipeline: { stage: string; n: number }[]
  measure: { tracked_queries: number; runs: number; visibility_pct: number | null; previous_pct: number | null; trend: { at: number; pct: number }[] }
  activity: { at: number; kind: string; text: string }[]
}

/** Colour per pillar, matching the sidebar accordion so the two read as one system. */
const PILLAR: Record<string, string> = {
  produce: 'var(--produce, #f59e0b)',
  reach: 'var(--reach, #3b82f6)',
  respond: 'var(--respond, #ec4899)',
  measure: 'var(--measure, #10b981)',
}

function Tile({ pillar, label, value, sub, onClick }: {
  pillar: string; label: string; value: string | number; sub?: string; onClick?: () => void
}) {
  return (
    <div
      className="card"
      onClick={onClick}
      style={{
        flex: '1 1 170px', minWidth: 150, cursor: onClick ? 'pointer' : 'default',
        borderTop: `3px solid ${PILLAR[pillar] || 'var(--border)'}`,
      }}
    >
      <div className="card-body" style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
          {label}
        </div>
        <div style={{ fontSize: '1.75rem', fontWeight: 700, lineHeight: 1.1, color: 'var(--text-primary)' }}>{value}</div>
        {sub && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  )
}

/** Inline sparkline. Twelve points is too few for a chart library to earn its bytes. */
function Spark({ points }: { points: number[] }) {
  if (points.length < 2) return null
  const w = 120, h = 28
  const max = Math.max(...points, 1), min = Math.min(...points, 0)
  const span = max - min || 1
  const d = points.map((p, i) =>
    `${(i / (points.length - 1)) * w},${h - ((p - min) / span) * h}`).join(' ')
  return (
    <svg width={w} height={h} style={{ display: 'block', marginTop: 6 }} aria-hidden>
      <polyline points={d} fill="none" stroke={PILLAR.measure} strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function OverviewDashboard({ clientId, onNavigate }: {
  clientId: string; onNavigate?: (tab: string) => void
}) {
  const [d, setD] = useState<Overview | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/clients/${clientId}/overview`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (live && j) setD(j) })
      .catch(() => {})
    return () => { live = false }
  }, [clientId])

  if (!d) return null

  const { produce, reach, measure, pipeline, activity } = d
  const totalContent = produce.published + produce.scheduled + produce.drafts
  // An empty tenant gets the old screen rather than a grid of zeroes.
  if (!totalContent && !reach.contacts && !measure.runs) return null

  const delta = measure.visibility_pct != null && measure.previous_pct != null
    ? Number((measure.visibility_pct - measure.previous_pct).toFixed(1)) : null

  const STAGE_ORDER = ['new', 'touch_1', 'touch_2', 'touch_3', 'replied', 'discussing', 'call_booked', 'trial', 'won']
  const ordered = pipeline
    .filter(p => STAGE_ORDER.includes(p.stage))
    .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage))
  const pipeTotal = ordered.reduce((s, p) => s + p.n, 0)

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Tile pillar="produce" label="Content" value={totalContent}
          sub={`${produce.published} published · ${produce.scheduled} scheduled · ${produce.drafts} draft`}
          onClick={onNavigate && (() => onNavigate('content'))} />
        <Tile pillar="reach" label="Contacts" value={reach.contacts.toLocaleString()}
          sub={`${reach.segments} segment${reach.segments === 1 ? '' : 's'} · ${reach.in_play} in play`}
          onClick={onNavigate && (() => onNavigate('discovery'))} />
        <Tile pillar="reach" label="Due today" value={reach.due_today}
          sub={reach.due_today ? 'follow-ups waiting' : 'nothing outstanding'}
          onClick={onNavigate && (() => onNavigate('discovery'))} />
        <Tile pillar="respond" label="Replies" value={reach.replied}
          sub={reach.won ? `${reach.won} won` : 'conversations opened'} />
        <div className="card" style={{ flex: '1 1 190px', minWidth: 170, borderTop: `3px solid ${PILLAR.measure}` }}>
          <div className="card-body" style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
              AI visibility
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: '1.75rem', fontWeight: 700, lineHeight: 1.1, color: 'var(--text-primary)' }}>
                {measure.visibility_pct != null ? `${measure.visibility_pct}%` : '—'}
              </span>
              {delta != null && delta !== 0 && (
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: delta > 0 ? '#10b981' : '#ef4444' }}>
                  {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
              {measure.tracked_queries} queries · {measure.runs} runs
            </div>
            <Spark points={measure.trend.map(t => t.pct)} />
          </div>
        </div>
      </div>

      {pipeTotal > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 10 }}>
              Pipeline
            </div>
            <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: 10 }}>
              {ordered.map((p, i) => (
                <div key={p.stage} title={`${p.stage.replace(/_/g, ' ')}: ${p.n}`}
                  style={{
                    width: `${(p.n / pipeTotal) * 100}%`,
                    background: PILLAR.reach,
                    opacity: 0.35 + (i / Math.max(ordered.length - 1, 1)) * 0.65,
                  }} />
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
              {ordered.map(p => (
                <span key={p.stage} style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>{p.n}</strong> {p.stage.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {activity.length > 0 && (
        <div className="card">
          <div className="card-header"><span className="card-title">Recent activity</span></div>
          <div className="card-body" style={{ padding: '8px 16px 14px' }}>
            {activity.map((a, i) => (
              <div key={i} style={{
                display: 'flex', gap: 10, alignItems: 'baseline',
                padding: '7px 0',
                borderBottom: i < activity.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <span style={{ fontSize: '0.8rem' }}>{a.kind === 'reply' ? '💬' : '📝'}</span>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', flex: 1 }}>{a.text}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {new Date(a.at * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
