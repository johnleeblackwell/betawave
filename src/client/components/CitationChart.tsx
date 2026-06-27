import { useState, useEffect } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrendPoint {
  run_id: string
  run_at: number
  overall_share: number
  total_classified: number
  engine_shares: Record<string, number>
}

const ENGINE_COLORS: Record<string, string> = {
  anthropic:  '#e8501a',
  openai:     '#16a34a',
  perplexity: '#2563eb',
  gemini:     '#7c3aed',
}

const ENGINE_LABELS: Record<string, string> = {
  anthropic:  'Anthropic',
  openai:     'OpenAI',
  perplexity: 'Perplexity',
  gemini:     'Gemini',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CitationChart({ brandId }: { brandId: string }) {
  const [points, setPoints] = useState<TrendPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [showEngines, setShowEngines] = useState(false)

  useEffect(() => {
    fetch(`/api/citation-tracker/${brandId}/trend`)
      .then(r => r.json())
      .then(data => { setPoints(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [brandId])

  if (loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
        <span className="loading" /> Loading trend data…
      </div>
    )
  }

  if (points.length === 0) {
    return (
      <div style={{ padding: '24px 20px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
        No classified runs yet — trend chart will appear after the first run completes.
      </div>
    )
  }

  if (points.length === 1) {
    const p = points[0]
    return (
      <div style={{ padding: '20px' }}>
        <SingleRunSummary point={p} />
      </div>
    )
  }

  return (
    <div>
      {/* Toggle */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8, gap: 6 }}>
        <button
          style={{
            fontSize: '0.72rem', padding: '2px 10px', borderRadius: 20, border: '1px solid #e2e8f0',
            background: !showEngines ? '#4f46e5' : 'white',
            color: !showEngines ? 'white' : '#64748b',
            cursor: 'pointer', fontWeight: 500,
          }}
          onClick={() => setShowEngines(false)}
        >
          Overall
        </button>
        <button
          style={{
            fontSize: '0.72rem', padding: '2px 10px', borderRadius: 20, border: '1px solid #e2e8f0',
            background: showEngines ? '#4f46e5' : 'white',
            color: showEngines ? 'white' : '#64748b',
            cursor: 'pointer', fontWeight: 500,
          }}
          onClick={() => setShowEngines(true)}
        >
          By engine
        </button>
      </div>

      {showEngines
        ? <EngineChart points={points} hoveredIdx={hoveredIdx} setHoveredIdx={setHoveredIdx} />
        : <OverallChart points={points} hoveredIdx={hoveredIdx} setHoveredIdx={setHoveredIdx} />
      }

      {/* Tooltip / legend row */}
      <div style={{ marginTop: 10, minHeight: 36 }}>
        {hoveredIdx !== null && points[hoveredIdx] ? (
          <HoverDetail point={points[hoveredIdx]} showEngines={showEngines} />
        ) : (
          <div style={{ fontSize: '0.72rem', color: '#94a3b8', textAlign: 'center' }}>
            Hover a data point for details
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Overall line chart ───────────────────────────────────────────────────────

function OverallChart({ points, hoveredIdx, setHoveredIdx }: {
  points: TrendPoint[]
  hoveredIdx: number | null
  setHoveredIdx: (i: number | null) => void
}) {
  const W = 560, H = 140, PAD = { top: 16, right: 16, bottom: 28, left: 36 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const values = points.map(p => p.overall_share)
  const maxVal = Math.max(100, ...values)

  const xScale = (i: number) => PAD.left + (i / (points.length - 1)) * innerW
  const yScale = (v: number) => PAD.top + innerH - (v / maxVal) * innerH

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(p.overall_share)}`).join(' ')
  const areaD = pathD + ` L ${xScale(points.length - 1)} ${PAD.top + innerH} L ${xScale(0)} ${PAD.top + innerH} Z`

  // Y-axis ticks: 0, 25, 50, 75, 100
  const yTicks = [0, 25, 50, 75, 100]

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
      {/* Grid lines */}
      {yTicks.map(t => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={yScale(t)} y2={yScale(t)} stroke="#f1f5f9" strokeWidth={1} />
          <text x={PAD.left - 6} y={yScale(t) + 4} textAnchor="end" fontSize={9} fill="#94a3b8">{t}%</text>
        </g>
      ))}

      {/* Area fill */}
      <path d={areaD} fill="#4f46e5" fillOpacity={0.08} />

      {/* Line */}
      <path d={pathD} fill="none" stroke="#4f46e5" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {/* Data points */}
      {points.map((p, i) => (
        <g key={p.run_id}>
          <circle
            cx={xScale(i)} cy={yScale(p.overall_share)} r={hoveredIdx === i ? 6 : 4}
            fill={hoveredIdx === i ? '#4f46e5' : 'white'}
            stroke="#4f46e5" strokeWidth={2}
            style={{ cursor: 'pointer', transition: 'r 0.1s' }}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
          />
          {/* X-axis label */}
          <text
            x={xScale(i)} y={H - 4}
            textAnchor="middle" fontSize={8} fill={hoveredIdx === i ? '#4f46e5' : '#94a3b8'}
          >
            {fmtShort(p.run_at)}
          </text>
        </g>
      ))}
    </svg>
  )
}

// ─── Per-engine multi-line chart ──────────────────────────────────────────────

function EngineChart({ points, hoveredIdx, setHoveredIdx }: {
  points: TrendPoint[]
  hoveredIdx: number | null
  setHoveredIdx: (i: number | null) => void
}) {
  const W = 560, H = 140, PAD = { top: 16, right: 16, bottom: 28, left: 36 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const engines = Array.from(new Set(points.flatMap(p => Object.keys(p.engine_shares))))
  const yTicks = [0, 25, 50, 75, 100]

  const xScale = (i: number) => PAD.left + (i / (points.length - 1)) * innerW
  const yScale = (v: number) => PAD.top + innerH - (v / 100) * innerH

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
      {/* Grid */}
      {yTicks.map(t => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={yScale(t)} y2={yScale(t)} stroke="#f1f5f9" strokeWidth={1} />
          <text x={PAD.left - 6} y={yScale(t) + 4} textAnchor="end" fontSize={9} fill="#94a3b8">{t}%</text>
        </g>
      ))}

      {/* One line per engine */}
      {engines.map(eng => {
        const color = ENGINE_COLORS[eng] ?? '#94a3b8'
        const d = points
          .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(p.engine_shares[eng] ?? 0)}`)
          .join(' ')
        return (
          <path key={eng} d={d} fill="none" stroke={color} strokeWidth={1.5}
            strokeLinejoin="round" strokeLinecap="round" strokeDasharray={eng === 'gemini' ? undefined : undefined}
          />
        )
      })}

      {/* Hover targets (invisible wide bands per x position) */}
      {points.map((p, i) => (
        <rect
          key={p.run_id}
          x={xScale(i) - 16} y={PAD.top} width={32} height={innerH}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          onMouseEnter={() => setHoveredIdx(i)}
          onMouseLeave={() => setHoveredIdx(null)}
        />
      ))}

      {/* Highlighted dots at hovered index */}
      {hoveredIdx !== null && engines.map(eng => {
        const p = points[hoveredIdx]
        const color = ENGINE_COLORS[eng] ?? '#94a3b8'
        const v = p?.engine_shares[eng] ?? 0
        return (
          <circle key={eng} cx={xScale(hoveredIdx)} cy={yScale(v)} r={4}
            fill={color} stroke="white" strokeWidth={1.5} />
        )
      })}

      {/* X-axis labels */}
      {points.map((p, i) => (
        <text key={p.run_id} x={xScale(i)} y={H - 4}
          textAnchor="middle" fontSize={8} fill={hoveredIdx === i ? '#374151' : '#94a3b8'}>
          {fmtShort(p.run_at)}
        </text>
      ))}

      {/* Engine colour legend */}
      {engines.map((eng, idx) => (
        <g key={eng} transform={`translate(${PAD.left + idx * 90}, ${H - 2})`}>
          <circle cx={0} cy={-12} r={3} fill={ENGINE_COLORS[eng] ?? '#94a3b8'} />
          <text x={6} y={-8} fontSize={8} fill="#64748b">{ENGINE_LABELS[eng] ?? eng}</text>
        </g>
      ))}
    </svg>
  )
}

// ─── Single-run summary (when only 1 run exists) ──────────────────────────────

function SingleRunSummary({ point }: { point: TrendPoint }) {
  return (
    <div style={{ fontSize: '0.85rem', color: '#374151' }}>
      <div style={{ fontWeight: 600, marginBottom: 12, color: '#0f172a' }}>
        Citation share — {fmtShort(point.run_at)}
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: '2rem', fontWeight: 800, color: '#4f46e5' }}>
          {point.overall_share}%
        </div>
        <div style={{ color: '#64748b', fontSize: '0.78rem' }}>
          overall mention rate<br />
          ({point.total_classified} classified results)
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {Object.entries(point.engine_shares).map(([eng, share]) => (
          <div key={eng} style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#f8fafc', borderRadius: 8, padding: '4px 10px', border: '1px solid #e2e8f0' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: ENGINE_COLORS[eng] ?? '#94a3b8', display: 'inline-block' }} />
            <span style={{ fontWeight: 600 }}>{share}%</span>
            <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}>{ENGINE_LABELS[eng] ?? eng}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: '0.72rem', color: '#94a3b8' }}>
        Trend chart will appear after 2+ runs.
      </div>
    </div>
  )
}

// ─── Hover detail ─────────────────────────────────────────────────────────────

function HoverDetail({ point, showEngines }: { point: TrendPoint; showEngines: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.78rem' }}>
      <span style={{ color: '#64748b' }}>{fmtDate(point.run_at)}</span>
      {!showEngines && (
        <span style={{ fontWeight: 700, color: '#4f46e5', fontSize: '1rem' }}>{point.overall_share}%</span>
      )}
      {(showEngines || true) && Object.entries(point.engine_shares).map(([eng, share]) => (
        <span key={eng} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: ENGINE_COLORS[eng] ?? '#94a3b8', display: 'inline-block' }} />
          <span style={{ fontWeight: 600 }}>{share}%</span>
          <span style={{ color: '#94a3b8' }}>{ENGINE_LABELS[eng] ?? eng}</span>
        </span>
      ))}
      <span style={{ color: '#cbd5e1', fontSize: '0.7rem' }}>{point.total_classified} classified</span>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtShort(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
