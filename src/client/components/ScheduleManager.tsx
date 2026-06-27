import { useState, useEffect } from 'react'
import { Client, useToast } from '../App.tsx'

interface Schedule {
  id: string
  client_id: string
  content_type: 'blog' | 'newsletter'
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly'
  day_of_week: number
  time_of_day: string
  auto_publish_email: number
  auto_publish_wp: number
  enabled: number
  next_run: number | null
  last_run: number | null
  topic_hint: string
  wp_post_status?: string
  wp_category_id?: number
}

interface Props {
  clientId: string
  client: Client
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const FREQ_LABELS: Record<string, string> = {
  daily: 'Every day',
  weekly: 'Weekly',
  biweekly: 'Fortnightly',
  monthly: 'Monthly',
}

function formatTs(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  })
}

function ScheduleForm({
  initial,
  client,
  onSave,
  onCancel,
}: {
  initial?: Partial<Schedule>
  client: Client
  onSave: (data: Partial<Schedule>) => void
  onCancel: () => void
}) {
  const [contentType, setContentType] = useState<'blog' | 'newsletter'>(initial?.content_type ?? 'blog')
  const [frequency, setFrequency] = useState<Schedule['frequency']>(initial?.frequency ?? 'weekly')
  const [dayOfWeek, setDayOfWeek] = useState(initial?.day_of_week ?? 1)
  const [timeOfDay, setTimeOfDay] = useState(initial?.time_of_day ?? '09:00')
  const [autoEmail, setAutoEmail] = useState(!!(initial?.auto_publish_email))
  const [autoWp, setAutoWp] = useState(!!(initial?.auto_publish_wp))
  const [topicHint, setTopicHint] = useState(initial?.topic_hint ?? '')
  const [wpPostStatus, setWpPostStatus] = useState(initial?.wp_post_status ?? '')
  const [wpCategoryId, setWpCategoryId] = useState(initial?.wp_category_id ?? 0)
  const [wpCategories, setWpCategories] = useState<{ id: number; name: string }[]>([])

  // Fetch WP categories when WP autopublish is toggled on
  useEffect(() => {
    if (autoWp && client.wp_url && wpCategories.length === 0) {
      fetch(`/api/clients/${client.id}/wordpress/categories`)
        .then(r => r.ok ? r.json() : [])
        .then(setWpCategories)
        .catch(() => {})
    }
  }, [autoWp])

  const showDay = frequency === 'weekly' || frequency === 'biweekly'

  return (
    <div className="card" style={{ maxWidth: 500 }}>
      <div className="card-header">
        <span className="card-title">{initial?.id ? 'Edit Schedule' : 'New Schedule'}</span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        <div className="form-group">
          <label className="form-label">Content type</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['blog', 'newsletter'] as const).map(t => (
              <button
                key={t}
                type="button"
                className={`btn btn-sm ${contentType === t ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setContentType(t)}
              >
                {t === 'blog' ? '📝 Blog post' : '📧 Newsletter'}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Frequency</label>
          <select className="form-input" value={frequency} onChange={e => setFrequency(e.target.value as Schedule['frequency'])}>
            <option value="daily">Every day</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Fortnightly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>

        {showDay && (
          <div className="form-group">
            <label className="form-label">Day of week</label>
            <select className="form-input" value={dayOfWeek} onChange={e => setDayOfWeek(Number(e.target.value))}>
              {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Time</label>
          <input
            type="time"
            className="form-input"
            style={{ maxWidth: 140 }}
            value={timeOfDay}
            onChange={e => setTimeOfDay(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label">
            Content focus <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span>
          </label>
          <input
            type="text"
            className="form-input"
            placeholder={contentType === 'blog' ? 'e.g. "spring lawn care tips" or "new branch opening"' : 'e.g. "monthly roundup of industry news"'}
            value={topicHint}
            onChange={e => setTopicHint(e.target.value)}
          />
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4 }}>
            {contentType === 'blog'
              ? 'Steer every generated post toward this topic. Leave blank to let sources decide.'
              : 'Give the newsletter a recurring theme. Leave blank to use recent blog posts.'}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Auto-publish</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {client.contact_email ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={autoEmail} onChange={e => setAutoEmail(e.target.checked)} />
                <span>Send to <strong>{client.contact_email}</strong> automatically</span>
              </label>
            ) : (
              <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Add a contact email to the client profile to enable auto-send.</p>
            )}
            {client.wp_url ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={autoWp}
                    onChange={e => setAutoWp(e.target.checked)}
                    disabled={contentType === 'newsletter'}
                  />
                  <span style={{ color: contentType === 'newsletter' ? '#94a3b8' : undefined }}>
                    Publish to WordPress automatically
                    {contentType === 'newsletter' ? ' (blog posts only)' : ''}
                  </span>
                </label>

                {autoWp && contentType === 'blog' && (
                  <div style={{ marginLeft: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* Post status */}
                    <div>
                      <div style={{ fontSize: '0.775rem', color: '#64748b', marginBottom: 4 }}>Post status</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {[
                          { value: '', label: `Use client default (${client.wp_post_status || 'draft'})` },
                          { value: 'draft', label: '📝 Draft' },
                          { value: 'publish', label: '🟢 Live' },
                        ].map(opt => (
                          <button
                            key={opt.value}
                            type="button"
                            className={`btn btn-sm ${wpPostStatus === opt.value ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setWpPostStatus(opt.value)}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Category */}
                    <div>
                      <div style={{ fontSize: '0.775rem', color: '#64748b', marginBottom: 4 }}>Default category</div>
                      {wpCategories.length > 0 ? (
                        <select
                          className="form-input"
                          style={{ maxWidth: 260 }}
                          value={wpCategoryId}
                          onChange={e => setWpCategoryId(Number(e.target.value))}
                        >
                          <option value={0}>— No category —</option>
                          {wpCategories.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ fontSize: '0.775rem', color: '#94a3b8' }}>Loading categories…</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Configure WordPress in the client profile to enable auto-publish.</p>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onSave({ content_type: contentType, frequency, day_of_week: dayOfWeek, time_of_day: timeOfDay, auto_publish_email: autoEmail ? 1 : 0, auto_publish_wp: autoWp && contentType === 'blog' ? 1 : 0, topic_hint: topicHint.trim(), wp_post_status: wpPostStatus, wp_category_id: wpCategoryId })}
          >
            Save schedule
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export default function ScheduleManager({ clientId, client }: Props) {
  const { showToast } = useToast()
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [wpCategories, setWpCategories] = useState<{ id: number; name: string }[]>([])

  const load = () =>
    fetch(`/api/clients/${clientId}/schedules`).then(r => r.json()).then(setSchedules)

  useEffect(() => { load() }, [clientId])

  // Pre-load WP categories for the card labels if WP is configured
  useEffect(() => {
    if (client.wp_url) {
      fetch(`/api/clients/${clientId}/wordpress/categories`)
        .then(r => r.ok ? r.json() : [])
        .then(setWpCategories)
        .catch(() => {})
    }
  }, [clientId, client.wp_url])

  const create = async (data: Partial<Schedule>) => {
    const res = await fetch(`/api/clients/${clientId}/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    if (res.ok) { showToast('Schedule created'); setShowForm(false); load() }
    else showToast('Failed to create schedule', 'error')
  }

  const update = async (id: string, data: Partial<Schedule>) => {
    const res = await fetch(`/api/clients/${clientId}/schedules/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    if (res.ok) { showToast('Schedule updated'); setEditingId(null); load() }
    else showToast('Failed to update schedule', 'error')
  }

  const toggle = async (s: Schedule) => {
    await update(s.id, { enabled: s.enabled ? 0 : 1 })
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this schedule?')) return
    await fetch(`/api/clients/${clientId}/schedules/${id}`, { method: 'DELETE' })
    showToast('Schedule deleted')
    load()
  }

  const runNow = async (s: Schedule) => {
    setRunning(s.id)
    try {
      const res = await fetch(`/api/clients/${clientId}/schedules/${s.id}/run-now`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) { showToast('Content generated — check the Content tab'); load() }
      else showToast(data.error || 'Run failed', 'error')
    } catch {
      showToast('Run failed', 'error')
    } finally {
      setRunning(null)
    }
  }

  const editingSchedule = editingId ? schedules.find(s => s.id === editingId) : null

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#374151' }}>Content Schedules</div>
          <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 2 }}>
            βWave generates and publishes content automatically on your chosen schedule.
          </div>
        </div>
        {!showForm && !editingId && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
            + Add Schedule
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ marginBottom: 20 }}>
          <ScheduleForm client={client} onSave={create} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {editingSchedule && (
        <div style={{ marginBottom: 20 }}>
          <ScheduleForm
            initial={editingSchedule}
            client={client}
            onSave={data => update(editingSchedule.id, data)}
            onCancel={() => setEditingId(null)}
          />
        </div>
      )}

      {schedules.length === 0 && !showForm ? (
        <div className="empty-state">
          <div className="empty-state-icon">🗓️</div>
          <div className="empty-state-title">No schedules yet</div>
          <p>Set up a schedule and βWave will generate content automatically.</p>
          <button className="btn btn-primary mt-16" onClick={() => setShowForm(true)}>
            + Add First Schedule
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {schedules.map(s => (
            <div
              key={s.id}
              className="card"
              style={{ opacity: s.enabled ? 1 : 0.6, border: s.enabled ? '1px solid #e2e8f0' : '1px dashed #cbd5e1' }}
            >
              <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ fontSize: '1.5rem' }}>
                    {s.content_type === 'blog' ? '📝' : '📧'}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#0f172a' }}>
                      {s.content_type === 'blog' ? 'Blog post' : 'Newsletter'}
                      {' · '}
                      <span style={{ color: '#64748b', fontWeight: 400 }}>
                        {FREQ_LABELS[s.frequency]}
                        {(s.frequency === 'weekly' || s.frequency === 'biweekly') ? ` on ${DAYS[s.day_of_week]}s` : ''}
                        {' at '}{s.time_of_day}
                      </span>
                    </div>
                    {s.topic_hint && (
                      <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 2 }}>
                        🎯 Focus: <em>{s.topic_hint}</em>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: '0.775rem', color: '#94a3b8' }}>
                      <span>Next: {formatTs(s.next_run)}</span>
                      {s.last_run && <span>· Last ran: {formatTs(s.last_run)}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {s.auto_publish_email ? <span className="tag" style={{ fontSize: '0.7rem' }}>✉️ auto-email</span> : null}
                      {s.auto_publish_wp ? (
                        <>
                          <span className="tag" style={{ fontSize: '0.7rem' }}>
                            🌐 WP {s.wp_post_status === 'publish' ? '🟢 live' : s.wp_post_status === 'draft' ? '📝 draft' : '(client default)'}
                          </span>
                          {s.wp_category_id ? (
                            <span className="tag" style={{ fontSize: '0.7rem' }}>
                              🏷 {wpCategories.find(c => c.id === s.wp_category_id)?.name ?? `Cat #${s.wp_category_id}`}
                            </span>
                          ) : null}
                        </>
                      ) : null}
                      {!s.auto_publish_email && !s.auto_publish_wp && (
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>saves as draft</span>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => runNow(s)}
                    disabled={running === s.id}
                    title="Generate content right now"
                  >
                    {running === s.id ? <><span className="loading" /> Running…</> : '▶ Run now'}
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setEditingId(s.id === editingId ? null : s.id)}
                  >
                    ✏️ Edit
                  </button>
                  <button
                    className={`btn btn-sm ${s.enabled ? 'btn-secondary' : 'btn-primary'}`}
                    onClick={() => toggle(s)}
                    title={s.enabled ? 'Pause schedule' : 'Resume schedule'}
                  >
                    {s.enabled ? '⏸ Pause' : '▶ Resume'}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => remove(s.id)}>🗑</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
