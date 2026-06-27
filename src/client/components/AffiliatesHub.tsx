import { useState, useEffect, useCallback } from 'react'
import { useToast } from '../App.tsx'

interface LeadGen {
  id: string
  email: string
  name: string
  status: 'invited' | 'active' | 'inactive'
  last_new_sale_date: number | null
  created_at: number
  invited_at: number
  authorized_client_count: number
  total_prospects: number
}

interface Commission {
  id: string
  lead_gen_name: string
  lead_gen_email: string
  client_name: string
  commission_type: 'first_20' | 'recurring_10'
  amount: number
  month: string
  status: 'pending' | 'paid' | 'suspended'
  inactivity_flag: number
  paid_date: number | null
  created_at: number
}

interface Client {
  id: string
  business_name: string
  industry: string
}

interface Access {
  id: string
  client_id: string
  business_name: string
  industry: string
  status: string
  authorized_at: number
}

const STATUS_COLOURS: Record<string, string> = {
  invited: '#d97706',
  active:  '#16a34a',
  inactive:'#94a3b8',
}

const COMMISSION_STATUS_COLOURS: Record<string, string> = {
  pending:   '#d97706',
  paid:      '#16a34a',
  suspended: '#dc2626',
}

function daysSince(ts: number | null): number | null {
  if (!ts) return null
  return Math.floor((Date.now() / 1000 - ts) / 86400)
}

function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function AffiliatesHub() {
  const { showToast } = useToast()
  const [leadGens, setLeadGens] = useState<LeadGen[]>([])
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [selected, setSelected] = useState<LeadGen | null>(null)
  const [access, setAccess] = useState<Access[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'list' | 'detail' | 'invite'>('list')

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteUrl, setInviteUrl] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [lgRes, comRes, clientRes] = await Promise.all([
      fetch('/api/lead-generators').then(r => r.json()),
      fetch('/api/commissions?').then(r => r.json()),
      fetch('/api/clients').then(r => r.json()),
    ])
    setLeadGens(lgRes)
    setCommissions(comRes)
    setClients(clientRes)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const loadAccess = async (lgId: string) => {
    const rows = await fetch(`/api/lead-generators/${lgId}/access`).then(r => r.json())
    setAccess(rows)
  }

  const selectLeadGen = async (lg: LeadGen) => {
    setSelected(lg)
    await loadAccess(lg.id)
    setView('detail')
  }

  const handleInvite = async () => {
    if (!inviteEmail) return
    setInviting(true)
    const res = await fetch('/api/lead-generators/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, name: inviteName }),
    })
    const data = await res.json()
    setInviting(false)
    if (res.ok) {
      setInviteUrl(data.invite_url)
      showToast(`Invite sent to ${inviteEmail}`)
      load()
    } else {
      showToast(data.error || 'Invite failed', 'error')
    }
  }

  const grantAccess = async (lgId: string, clientId: string) => {
    await fetch(`/api/lead-generators/${lgId}/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId }),
    })
    await loadAccess(lgId)
    showToast('Access granted')
  }

  const revokeAccess = async (lgId: string, clientId: string) => {
    await fetch(`/api/lead-generators/${lgId}/access/${clientId}`, { method: 'DELETE' })
    await loadAccess(lgId)
    showToast('Access revoked')
  }

  const toggleStatus = async (lg: LeadGen) => {
    const next = lg.status === 'active' ? 'inactive' : 'active'
    await fetch(`/api/lead-generators/${lg.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
    load()
    showToast(`Lead gen ${next === 'active' ? 'reactivated' : 'deactivated'}`)
  }

  const runSettleAll = async () => {
    await fetch('/api/commissions/settle-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    showToast('Settlement run complete')
    load()
  }

  // Summary stats
  const totalPending = commissions.filter(c => c.status === 'pending').reduce((s, c) => s + c.amount, 0)
  const totalPaid    = commissions.filter(c => c.status === 'paid').reduce((s, c) => s + c.amount, 0)
  const totalSuspended = commissions.filter(c => c.status === 'suspended').reduce((s, c) => s + c.amount, 0)

  if (loading) return <div style={{ padding: 32 }}><span className="loading" /> Loading…</div>

  // ── Invite view ──────────────────────────────────────────────────────────────
  if (view === 'invite') {
    return (
      <div className="page-content">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => { setView('list'); setInviteUrl('') }}>← Back</button>
          <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>Invite Lead Generator</span>
        </div>
        <div className="card" style={{ maxWidth: 480 }}>
          <div className="card-body">
            <div className="form-group">
              <label className="form-label">Email address *</label>
              <input className="form-input" type="email" value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)} placeholder="name@email.com" />
            </div>
            <div className="form-group">
              <label className="form-label">Name (optional)</label>
              <input className="form-input" value={inviteName}
                onChange={e => setInviteName(e.target.value)} placeholder="Jane Smith" />
            </div>
            <button className="btn btn-primary" onClick={handleInvite} disabled={inviting || !inviteEmail}>
              {inviting ? <><span className="loading" /> Sending…</> : '📨 Send Invite'}
            </button>

            {inviteUrl && (
              <div style={{ marginTop: 20, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '14px 16px' }}>
                <div style={{ fontWeight: 600, color: '#16a34a', fontSize: '0.85rem', marginBottom: 8 }}>
                  ✅ Invite link (share manually if email wasn't delivered)
                </div>
                <div style={{ fontSize: '0.8rem', wordBreak: 'break-all', color: '#374151', background: '#fff', padding: '8px 10px', borderRadius: 6, fontFamily: 'monospace' }}>
                  {inviteUrl}
                </div>
                <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }}
                  onClick={() => { navigator.clipboard.writeText(inviteUrl); showToast('Copied!') }}>
                  📋 Copy link
                </button>
              </div>
            )}

            <div style={{ marginTop: 20, padding: '12px 14px', background: '#f8fafc', borderRadius: 8, fontSize: '0.82rem', color: '#64748b' }}>
              <strong>Commission structure (fixed globally):</strong><br />
              20% of first payment · 10% recurring lifetime · 6-month inactivity gate
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Detail view ──────────────────────────────────────────────────────────────
  if (view === 'detail' && selected) {
    const lgCommissions = commissions.filter(c => c.lead_gen_name === selected.name || c.lead_gen_email === selected.email)
    const lgPending   = lgCommissions.filter(c => c.status === 'pending').reduce((s, c) => s + c.amount, 0)
    const lgPaid      = lgCommissions.filter(c => c.status === 'paid').reduce((s, c) => s + c.amount, 0)
    const lgSuspended = lgCommissions.filter(c => c.status === 'suspended').reduce((s, c) => s + c.amount, 0)
    const days = daysSince(selected.last_new_sale_date)
    const inactive = days !== null && days >= 180

    const authorizedClientIds = access.filter(a => a.status === 'active').map(a => a.client_id)
    const grantableClients = clients.filter(c => !authorizedClientIds.includes(c.id))

    return (
      <div className="page-content">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setView('list')}>← Back</button>
          <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>{selected.name || selected.email}</span>
          <span style={{ fontSize: '0.8rem', padding: '2px 10px', borderRadius: 20, fontWeight: 600,
            background: STATUS_COLOURS[selected.status] + '22', color: STATUS_COLOURS[selected.status] }}>
            {selected.status}
          </span>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => toggleStatus(selected)}>
            {selected.status === 'active' ? '🔒 Deactivate' : '✅ Reactivate'}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Lifetime Paid', value: `£${lgPaid.toFixed(2)}`, colour: '#16a34a' },
            { label: 'Pending', value: `£${lgPending.toFixed(2)}`, colour: '#d97706' },
            { label: 'Suspended', value: `£${lgSuspended.toFixed(2)}`, colour: '#dc2626' },
            { label: 'Last Sale', value: days !== null ? `${days}d ago` : 'Never', colour: inactive ? '#dc2626' : '#0f172a' },
          ].map(s => (
            <div key={s.label} className="card" style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 700, color: s.colour }}>{s.value}</div>
            </div>
          ))}
        </div>

        {inactive && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#dc2626', fontSize: '0.875rem' }}>
            ⚠️ Inactivity gate active — {days}+ days since last sale. Recurring commissions are suspended until a new sale is made.
          </div>
        )}

        {days !== null && !inactive && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#92400e', fontSize: '0.875rem' }}>
            ⏳ {180 - days} days until inactivity suspension (last sale {days} days ago)
          </div>
        )}

        {/* Client access */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <span className="card-title">Client Access</span>
          </div>
          <div className="card-body">
            {access.filter(a => a.status === 'active').length === 0 && (
              <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>No clients authorized yet.</p>
            )}
            {access.filter(a => a.status === 'active').map(a => (
              <div key={a.client_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.875rem' }}>
                <div>
                  <strong>{a.business_name}</strong>
                  <span style={{ color: '#94a3b8', marginLeft: 8 }}>{a.industry}</span>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => revokeAccess(selected.id, a.client_id)}>
                  Revoke
                </button>
              </div>
            ))}
            {grantableClients.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#64748b', marginBottom: 8 }}>Grant access to:</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {grantableClients.map(c => (
                    <button key={c.id} className="btn btn-secondary btn-sm" onClick={() => grantAccess(selected.id, c.id)}>
                      + {c.business_name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Commission history */}
        <div className="card">
          <div className="card-header"><span className="card-title">Commission History</span></div>
          <div className="card-body" style={{ padding: 0 }}>
            {lgCommissions.length === 0
              ? <p style={{ color: '#94a3b8', fontSize: '0.875rem', padding: '16px 20px' }}>No commissions yet.</p>
              : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['Month', 'Type', 'Client', 'Amount', 'Status', 'Date'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: '0.75rem' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lgCommissions.map(c => (
                      <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px' }}>{c.month}</td>
                        <td style={{ padding: '8px 12px' }}>{c.commission_type === 'first_20' ? '20% First' : '10% Recurring'}</td>
                        <td style={{ padding: '8px 12px' }}>{c.client_name}</td>
                        <td style={{ padding: '8px 12px', fontWeight: 600 }}>£{c.amount.toFixed(2)}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                            background: COMMISSION_STATUS_COLOURS[c.status] + '22', color: COMMISSION_STATUS_COLOURS[c.status] }}>
                            {c.status}{c.inactivity_flag ? ' (gate)' : ''}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', color: '#64748b' }}>{c.paid_date ? fmtDate(c.paid_date) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </div>
        </div>
      </div>
    )
  }

  // ── List view ────────────────────────────────────────────────────────────────
  return (
    <div className="page-content">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>Affiliates</div>
          <div style={{ fontSize: '0.875rem', color: '#64748b' }}>Global lead generator pool · 20% first · 10% recurring · 6-month gate</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={runSettleAll}>💰 Run Settlement</button>
          <button className="btn btn-primary" onClick={() => { setView('invite'); setInviteUrl('') }}>
            ➕ Invite Lead Gen
          </button>
        </div>
      </div>

      {/* Commission summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { label: '💰 Total Paid', value: `£${totalPaid.toFixed(2)}`, colour: '#16a34a' },
          { label: '⏳ Pending', value: `£${totalPending.toFixed(2)}`, colour: '#d97706' },
          { label: '🔴 Suspended', value: `£${totalSuspended.toFixed(2)}`, colour: '#dc2626' },
          { label: '👥 Lead Gens', value: leadGens.length, colour: '#0f172a' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: s.colour }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Lead gen list */}
      {leadGens.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 24px', color: '#94a3b8' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🤝</div>
          <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: 6, color: '#64748b' }}>No lead generators yet</div>
          <div style={{ fontSize: '0.875rem', marginBottom: 20 }}>Invite your first lead generator to get started</div>
          <button className="btn btn-primary" onClick={() => { setView('invite'); setInviteUrl('') }}>
            ➕ Invite Lead Gen
          </button>
        </div>
      ) : (
        <div className="card">
          <div className="card-body" style={{ padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {['Name', 'Email', 'Status', 'Clients', 'Prospects', 'Last Sale', 'Days to Gate', ''].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: '0.75rem' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leadGens.map(lg => {
                  const days = daysSince(lg.last_new_sale_date)
                  const inactive = days !== null && days >= 180
                  const daysLeft = days !== null ? Math.max(0, 180 - days) : null
                  return (
                    <tr key={lg.id} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                      onClick={() => selectLeadGen(lg)}>
                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>{lg.name || '—'}</td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>{lg.email}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                          background: STATUS_COLOURS[lg.status] + '22', color: STATUS_COLOURS[lg.status] }}>
                          {lg.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px' }}>{lg.authorized_client_count}</td>
                      <td style={{ padding: '10px 14px' }}>{lg.total_prospects}</td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>
                        {lg.last_new_sale_date ? fmtDate(lg.last_new_sale_date) : 'Never'}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        {daysLeft !== null
                          ? <span style={{ color: inactive ? '#dc2626' : daysLeft < 30 ? '#d97706' : '#16a34a', fontWeight: 600 }}>
                              {inactive ? '🔴 SUSPENDED' : `${daysLeft}d`}
                            </span>
                          : <span style={{ color: '#94a3b8' }}>—</span>
                        }
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); selectLeadGen(lg) }}>
                          View →
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
