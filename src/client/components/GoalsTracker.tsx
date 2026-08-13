/**
 * Goals — the scoreboard on the dashboard.
 *
 * Deliberately NOT a card board. A Kanban needs cards moved, and the week you
 * are too busy to move them is the week it starts lying — which is worse than
 * having nothing, because it still looks authoritative. Every number here is
 * derived from the pipeline itself: messages actually sent, replies actually
 * received. Nothing to tick, nothing to forget, and it turns red on its own.
 *
 * Shows the day first because that is the only horizon you can act on right
 * now, with the week and month underneath for the trend that the day cannot
 * show you.
 */
import { useEffect, useState, useCallback } from 'react'

interface Goal {
  id: string; client_id: string | null; client_name: string
  metric: string; period: string; target: number
  actual: number; pct: number; met: boolean
}
interface Data {
  goals: Goal[]
  today_by_campaign: { id: string; name: string; n: number }[]
  totals: { today: number; week: number; month: number; replies_week: number; calls_month: number }
}

const METRIC_LABEL: Record<string, string> = {
  touches: 'messages out', replies: 'replies', calls: 'calls booked', won: 'closed',
}

function Bar({ pct, met }: { pct: number; met: boolean }) {
  return (
    <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden', marginTop: 6 }}>
      <div style={{
        width: `${pct}%`, height: '100%',
        background: met ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444',
        transition: 'width .3s',
      }} />
    </div>
  )
}

export default function GoalsTracker() {
  const [d, setD] = useState<Data | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(() => {
    fetch('/api/goals').then(r => (r.ok ? r.json() : null)).then(j => j && setD(j)).catch(() => {})
  }, [])
  useEffect(() => { load() }, [load])

  if (!d) return null
  const day = d.goals.filter(g => g.period === 'day')
  const longer = d.goals.filter(g => g.period !== 'day')

  // No targets set yet: offer the default rather than an empty panel, because a
  // scoreboard with nothing on it is the same drift it exists to prevent.
  if (!d.goals.length) {
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: '0.9rem' }}>
            <strong>No daily target set.</strong>{' '}
            <span className="text-muted">{d.totals.today} messages went out today.</span>
          </div>
          <button className="btn btn-primary btn-sm" onClick={async () => {
            await fetch('/api/goals', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ metric: 'touches', period: 'day', target: 45 }),
            })
            load()
          }}>Set a target of 45/day</button>
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
            Today
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen(o => !o)}
            style={{ fontSize: '0.72rem' }}>{open ? 'hide' : 'week / month'}</button>
        </div>

        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          {day.map(g => (
            <div key={g.id} style={{ flex: '1 1 200px', minWidth: 170 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: '1.6rem', fontWeight: 700, color: g.met ? '#10b981' : 'var(--text-primary)' }}>
                  {g.actual}
                </span>
                <span className="text-muted" style={{ fontSize: '0.85rem' }}>/ {g.target}</span>
                {g.met && <span style={{ fontSize: '0.8rem' }}>✅</span>}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {METRIC_LABEL[g.metric] || g.metric} · {g.client_name}
              </div>
              <Bar pct={g.pct} met={g.met} />
            </div>
          ))}
        </div>

        {/* Campaigns that received NOTHING today are the point of this row —
            an untouched campaign is invisible in a total. */}
        <div style={{ marginTop: 14, display: 'flex', gap: '4px 16px', flexWrap: 'wrap' }}>
          {d.today_by_campaign.length === 0
            ? <span style={{ fontSize: '0.78rem', color: '#ef4444' }}>Nothing sent today.</span>
            : d.today_by_campaign.map(c => (
              <span key={c.id} style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>{c.n}</strong> {c.name}
              </span>
            ))}
        </div>

        {open && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12 }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                This week <strong style={{ color: 'var(--text-primary)' }}>{d.totals.week}</strong> out ·{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{d.totals.replies_week}</strong> replies
              </span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                This month <strong style={{ color: 'var(--text-primary)' }}>{d.totals.month}</strong> out ·{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{d.totals.calls_month}</strong> calls booked
              </span>
            </div>
            {longer.map(g => (
              <div key={g.id} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {g.period === 'week' ? 'This week' : 'This month'} — {METRIC_LABEL[g.metric] || g.metric}
                  {g.client_name !== 'All campaigns' && ` · ${g.client_name}`}
                  {'  '}<strong style={{ color: 'var(--text-primary)' }}>{g.actual}</strong> / {g.target}
                </div>
                <Bar pct={g.pct} met={g.met} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
