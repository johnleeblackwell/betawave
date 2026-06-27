import { useState, useEffect, useCallback } from 'react'
import { Client, useToast } from '../App.tsx'

interface Props {
  clientId: string
  client: Client
}

type ProductType = 'gift_card' | 'service' | 'subscription' | 'product'

interface Sku {
  id: string
  product_type: ProductType
  label: string
  description: string
  denomination: number | null
  price_gbp: number | null
  expiry_months: number
  personalization_enabled: number
  max_stock: number | null
  active: number
  signature_required: number
  delivery_terms: string
  billing_interval: string
  trial_days: number
  sold_count: number
  created_at: number
}

interface Purchase {
  id: string
  product_type: ProductType
  sku_label: string
  denomination: number | null
  price_gbp: number | null
  buyer_email: string
  buyer_name: string
  recipient_name: string
  redemption_code: string | null
  amount: number
  redeemed_total: number
  status: string
  expiry_date: number | null
  purchase_date: number
  fulfilled_at: number | null
}

const STATUS_COLOURS: Record<string, string> = {
  active: '#16a34a', paid: '#3b82f6', fulfilled: '#7c3aed',
  redeemed: '#64748b', expired: '#94a3b8', refunded: '#dc2626',
}

const TYPE_LABEL: Record<ProductType, { icon: string; name: string }> = {
  gift_card:    { icon: '🎁', name: 'Gift card' },
  service:      { icon: '💼', name: 'Service' },
  subscription: { icon: '🔁', name: 'Subscription' },
  product:      { icon: '📦', name: 'Product' },
}

function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatPrice(s: Sku | Purchase): string {
  const gbp = (s as any).denomination ?? (s as any).price_gbp ?? (s as any).amount ?? 0
  if ((s as any).billing_interval) return `£${Number(gbp).toFixed(2)} / ${(s as any).billing_interval}`
  return `£${Number(gbp).toFixed(2)}`
}

export default function ShopHub({ clientId, client }: Props) {
  const { showToast } = useToast()
  const [skus, setSkus] = useState<Sku[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [tab, setTab] = useState<'skus' | 'sales' | 'redeem'>('skus')
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)

  // Redeem form
  const [redeemCode, setRedeemCode] = useState('')
  const [redeemValue, setRedeemValue] = useState('')
  const [redeemBy, setRedeemBy] = useState('')
  const [checkResult, setCheckResult] = useState<any>(null)
  const [redeemLoading, setRedeemLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [skuRes, purchaseRes] = await Promise.all([
      fetch(`/api/clients/${clientId}/shop/skus`).then(r => r.json()),
      fetch(`/api/clients/${clientId}/shop/purchases`).then(r => r.json()),
    ])
    setSkus(skuRes)
    setPurchases(purchaseRes)
    setLoading(false)
  }, [clientId])

  useEffect(() => { load() }, [load])

  const toggleSku = async (sku: Sku) => {
    await fetch(`/api/clients/${clientId}/shop/skus/${sku.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: sku.active ? 0 : 1 }),
    })
    load()
  }

  const checkCode = async () => {
    if (!redeemCode.trim()) return
    setRedeemLoading(true)
    const res = await fetch(`/api/shop/check/${redeemCode.trim().toUpperCase()}`)
    const data = await res.json()
    setCheckResult(res.ok ? data : { error: data.error })
    setRedeemLoading(false)
  }

  const processRedemption = async () => {
    if (!checkResult?.valid || !redeemValue) return
    const purchaseId = purchases.find(p => p.redemption_code === checkResult.code)?.id
    if (!purchaseId) { showToast('Could not match code to purchase', 'error'); return }

    setRedeemLoading(true)
    const res = await fetch(`/api/clients/${clientId}/shop/purchases/${purchaseId}/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value_redeemed: Number(redeemValue), redeemed_by: redeemBy }),
    })
    const data = await res.json()
    setRedeemLoading(false)

    if (res.ok) {
      showToast(`Redeemed £${redeemValue} — £${data.remaining_balance.toFixed(2)} remaining`)
      setRedeemCode(''); setRedeemValue(''); setRedeemBy(''); setCheckResult(null)
      load()
    } else {
      showToast(data.error || 'Redemption failed', 'error')
    }
  }

  const markFulfilled = async (purchaseId: string) => {
    const res = await fetch(`/api/clients/${clientId}/shop/purchases/${purchaseId}/fulfilled`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    if (res.ok) { showToast('Marked fulfilled'); load() }
    else { const e = await res.json(); showToast(e.error || 'Failed', 'error') }
  }

  // Stats
  const totalRevenue = purchases.filter(p => p.status !== 'refunded').reduce((s, p) => s + p.amount, 0)
  const totalRedeemed = purchases.filter(p => p.status !== 'refunded').reduce((s, p) => s + (p.redeemed_total || 0), 0)
  const activeCount = purchases.filter(p => ['active', 'paid'].includes(p.status)).length
  const storefrontUrl = `${window.location.origin}/shop/${clientId}`

  if (loading) return <div style={{ padding: 32 }}><span className="loading" /> Loading…</div>

  return (
    <div className="page-content">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>🛍️ Shop</div>
          <div style={{ fontSize: '0.875rem', color: '#64748b' }}>{client.business_name} · gift cards, services, subscriptions, products</div>
        </div>
        <a href={storefrontUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
          🛍️ View Storefront ↗
        </a>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { label: '💰 Total Revenue', value: `£${totalRevenue.toFixed(2)}`, colour: '#16a34a' },
          { label: '🎫 Active / Paid',  value: activeCount, colour: '#0f172a' },
          { label: '✅ Redeemed Value', value: `£${totalRedeemed.toFixed(2)}`, colour: '#6366f1' },
          { label: '📦 SKUs',           value: skus.filter(s => s.active).length, colour: '#d97706' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: s.colour }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {(['skus', 'sales', 'redeem'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-secondary'}`}>
            {t === 'skus' ? '📦 SKUs' : t === 'sales' ? '📊 Sales' : '✅ Redeem'}
          </button>
        ))}
      </div>

      {/* SKU management */}
      {tab === 'skus' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddForm(!showAddForm)}>
              {showAddForm ? '× Cancel' : '+ Add product'}
            </button>
          </div>

          {showAddForm && <AddSkuForm clientId={clientId} onSaved={() => { load(); setShowAddForm(false) }} />}

          <div className="card">
            <div className="card-body" style={{ padding: 0 }}>
              {skus.length === 0
                ? <p style={{ padding: '24px', color: '#94a3b8', textAlign: 'center' }}>No products yet — click "+ Add product" to create one.</p>
                : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc' }}>
                        {['Type', 'Label', 'Price', 'Sold', 'Status', ''].map(h => (
                          <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: '0.75rem' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {skus.map(s => (
                        <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 10, background: '#f1f5f9', color: '#475569' }}>
                              {TYPE_LABEL[s.product_type].icon} {TYPE_LABEL[s.product_type].name}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <div style={{ fontWeight: 600 }}>{s.label}</div>
                            {s.description && <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: 2 }}>{s.description}</div>}
                          </td>
                          <td style={{ padding: '10px 14px' }}>{formatPrice(s)}</td>
                          <td style={{ padding: '10px 14px' }}>{s.sold_count}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                              background: s.active ? '#dcfce7' : '#f1f5f9', color: s.active ? '#16a34a' : '#94a3b8' }}>
                              {s.active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => toggleSku(s)}>
                              {s.active ? 'Deactivate' : 'Activate'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
              }
            </div>
          </div>
        </>
      )}

      {/* Sales */}
      {tab === 'sales' && (
        <div className="card">
          <div className="card-body" style={{ padding: 0 }}>
            {purchases.length === 0
              ? <p style={{ padding: '24px', color: '#94a3b8', textAlign: 'center' }}>No sales yet.</p>
              : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['Type', 'Item', 'Buyer', 'Amount', 'Status', 'Code', 'Purchased', ''].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: '0.75rem' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.map(p => (
                      <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 14px' }}>{TYPE_LABEL[p.product_type].icon}</td>
                        <td style={{ padding: '10px 14px' }}>{p.sku_label}</td>
                        <td style={{ padding: '10px 14px', color: '#64748b' }}>{p.buyer_email}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 600 }}>£{p.amount.toFixed(2)}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                            background: (STATUS_COLOURS[p.status] || '#94a3b8') + '22', color: STATUS_COLOURS[p.status] || '#475569' }}>
                            {p.status}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 600, fontSize: '0.78rem' }}>
                          {p.redemption_code || '—'}
                        </td>
                        <td style={{ padding: '10px 14px', color: '#64748b' }}>{fmtDate(p.purchase_date)}</td>
                        <td style={{ padding: '10px 14px' }}>
                          {p.product_type !== 'gift_card' && p.status === 'paid' && (
                            <button className="btn btn-ghost btn-sm" onClick={() => markFulfilled(p.id)}>
                              Mark fulfilled
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            }
          </div>
        </div>
      )}

      {/* Redeem (gift cards only) */}
      {tab === 'redeem' && (
        <div className="card" style={{ maxWidth: 480 }}>
          <div className="card-header"><span className="card-title">Redeem a Gift Card</span></div>
          <div className="card-body">
            <div className="form-group">
              <label className="form-label">Redemption code</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="form-input" value={redeemCode}
                  onChange={e => setRedeemCode(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  style={{ fontFamily: 'monospace', letterSpacing: 2 }} />
                <button className="btn btn-secondary" onClick={checkCode} disabled={redeemLoading || !redeemCode}>
                  Check
                </button>
              </div>
            </div>

            {checkResult && (
              checkResult.error
                ? <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px', color: '#dc2626', marginBottom: 16 }}>
                    ❌ {checkResult.error}
                  </div>
                : checkResult.valid
                  ? <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '14px', marginBottom: 16 }}>
                      <div style={{ fontWeight: 700, color: '#16a34a', marginBottom: 8 }}>✅ Valid gift card</div>
                      <div style={{ fontSize: '0.875rem', color: '#374151' }}>
                        Original: <strong>£{checkResult.original_amount.toFixed(2)}</strong> &nbsp;·&nbsp;
                        Remaining: <strong style={{ color: '#16a34a' }}>£{checkResult.remaining_balance.toFixed(2)}</strong>
                      </div>
                    </div>
                  : <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '12px', color: '#92400e', marginBottom: 16 }}>
                      ⚠️ Gift card is {checkResult.status}
                    </div>
            )}

            {checkResult?.valid && (
              <>
                <div className="form-group">
                  <label className="form-label">Amount to redeem (£)</label>
                  <input className="form-input" type="number" min="0.01" step="0.01"
                    max={checkResult.remaining_balance} value={redeemValue}
                    onChange={e => setRedeemValue(e.target.value)} placeholder="0.00" />
                </div>
                <div className="form-group">
                  <label className="form-label">Staff name (optional)</label>
                  <input className="form-input" value={redeemBy}
                    onChange={e => setRedeemBy(e.target.value)} placeholder="Your name" />
                </div>
                <button className="btn btn-primary" onClick={processRedemption}
                  disabled={redeemLoading || !redeemValue}>
                  {redeemLoading ? <><span className="loading" /> Processing…</> : '✅ Process Redemption'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Add SKU form (type-aware) ────────────────────────────────────────────────
function AddSkuForm({ clientId, onSaved }: { clientId: string; onSaved: () => void }) {
  const { showToast } = useToast()
  const [type, setType] = useState<ProductType>('gift_card')
  const [saving, setSaving] = useState(false)

  // Shared
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')

  // Gift card
  const [denomination, setDenomination] = useState('')
  const [expiryMonths, setExpiryMonths] = useState('24')
  const [personalization, setPersonalization] = useState(true)

  // Service / Subscription / Product
  const [priceGbp, setPriceGbp] = useState('')

  // Service
  const [signatureRequired, setSignatureRequired] = useState(false)
  const [deliveryTerms, setDeliveryTerms] = useState('')

  // Subscription
  const [billingInterval, setBillingInterval] = useState<'month' | 'year' | 'week'>('month')
  const [trialDays, setTrialDays] = useState('0')

  const submit = async () => {
    setSaving(true)
    const body: any = { product_type: type, label, description }
    if (type === 'gift_card') {
      body.denomination = Number(denomination)
      body.expiry_months = Number(expiryMonths) || 24
      body.personalization_enabled = personalization ? 1 : 0
    } else {
      body.price_gbp = Number(priceGbp)
    }
    if (type === 'service') {
      body.signature_required = signatureRequired ? 1 : 0
      body.delivery_terms = deliveryTerms
    }
    if (type === 'subscription') {
      body.billing_interval = billingInterval
      body.trial_days = Number(trialDays) || 0
    }

    const res = await fetch(`/api/clients/${clientId}/shop/skus`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    setSaving(false)
    if (res.ok) {
      onSaved()
      showToast('Product created')
    } else {
      const d = await res.json()
      showToast(d.error || 'Failed', 'error')
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header"><span className="card-title">New product</span></div>
      <div className="card-body">

        {/* Type picker */}
        <div className="form-group" style={{ marginBottom: 14 }}>
          <label className="form-label">Product type</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {(['gift_card', 'service', 'subscription', 'product'] as ProductType[]).map(t => (
              <button key={t}
                onClick={() => setType(t)}
                style={{
                  padding: '12px 8px', borderRadius: 8, cursor: 'pointer',
                  border: `2px solid ${type === t ? '#4f46e5' : '#e2e8f0'}`,
                  background: type === t ? '#eef2ff' : '#fff',
                  textAlign: 'center', fontSize: '0.85rem',
                }}>
                <div style={{ fontSize: '1.4rem', marginBottom: 4 }}>{TYPE_LABEL[t].icon}</div>
                <div style={{ fontWeight: 600 }}>{TYPE_LABEL[t].name}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Common */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label className="form-label">Label *</label>
            <input className="form-input" value={label} onChange={e => setLabel(e.target.value)}
              placeholder={
                type === 'gift_card' ? '£50 Gift Card' :
                type === 'service' ? 'Discovery Layer Build' :
                type === 'subscription' ? 'Pro plan' : 'Branded T-shirt'
              } />
          </div>
          <div>
            <label className="form-label">{type === 'gift_card' ? 'Denomination (£)' : 'Price (£)'} *</label>
            {type === 'gift_card' ? (
              <input className="form-input" type="number" min="1" value={denomination}
                onChange={e => setDenomination(e.target.value)} placeholder="50" />
            ) : (
              <input className="form-input" type="number" min="0.01" step="0.01" value={priceGbp}
                onChange={e => setPriceGbp(e.target.value)} placeholder="12500" />
            )}
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: 12 }}>
          <label className="form-label">Description</label>
          <textarea className="form-input" rows={2} value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={
              type === 'service' ? 'A complete AI search visibility audit and rebuild — 30-day delivery.' :
              type === 'subscription' ? 'Monthly access to all features.' :
              type === 'product' ? 'Limited edition — ships in 5 working days.' :
              'Optional gift message preview shown at checkout.'
            } />
        </div>

        {/* Type-specific fields */}
        {type === 'gift_card' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 8 }}>
              <div>
                <label className="form-label">Expiry (months)</label>
                <input className="form-input" type="number" min="1" value={expiryMonths}
                  onChange={e => setExpiryMonths(e.target.value)} />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={personalization} onChange={e => setPersonalization(e.target.checked)} />
                  Allow gift message + recipient name
                </label>
              </div>
            </div>
          </>
        )}

        {type === 'service' && (
          <>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label className="form-label">Delivery terms</label>
              <input className="form-input" value={deliveryTerms}
                onChange={e => setDeliveryTerms(e.target.value)}
                placeholder="30-day delivery from contract signature. Includes 60 pages, citation tracker, diagnostic report, build-out." />
              <div className="form-hint">Shown to buyers at checkout.</div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={signatureRequired} onChange={e => setSignatureRequired(e.target.checked)} />
              Async signature required before fulfilment
            </label>
          </>
        )}

        {type === 'subscription' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="form-label">Billing interval</label>
              <select className="form-input" value={billingInterval} onChange={e => setBillingInterval(e.target.value as any)}>
                <option value="week">Weekly</option>
                <option value="month">Monthly</option>
                <option value="year">Yearly</option>
              </select>
            </div>
            <div>
              <label className="form-label">Free trial (days)</label>
              <input className="form-input" type="number" min="0" value={trialDays}
                onChange={e => setTrialDays(e.target.value)} />
            </div>
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" disabled={saving || !label || (type === 'gift_card' ? !denomination : !priceGbp)}
            onClick={submit}>
            {saving ? <span className="loading" /> : '+ Create product'}
          </button>
        </div>
      </div>
    </div>
  )
}
