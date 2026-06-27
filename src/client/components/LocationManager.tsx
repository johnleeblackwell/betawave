import { useState, useEffect } from 'react'
import { useToast } from '../App.tsx'

interface Location {
  id: string
  client_id: string
  name: string
  slug: string
  region: string
  country: string
  active: number
}

interface Props { clientId: string }

export default function LocationManager({ clientId }: Props) {
  const { showToast } = useToast()
  const [locations, setLocations] = useState<Location[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [region, setRegion] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [bulkMode, setBulkMode] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const res = await fetch(`/api/clients/${clientId}/locations`)
    setLocations(await res.json())
  }

  useEffect(() => { load() }, [clientId])

  const addOne = async () => {
    if (!name.trim()) { showToast('Name required', 'error'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), region: region.trim() })
      })
      if (!res.ok) throw new Error()
      showToast('Location added')
      setName(''); setRegion(''); setShowAdd(false)
      load()
    } catch {
      showToast('Failed to add location', 'error')
    } finally { setSaving(false) }
  }

  const addBulk = async () => {
    // Parse "Name" or "Name, Region" per line
    const items = bulkText.split('\n')
      .map(l => l.trim()).filter(Boolean)
      .map(line => {
        const [n, r] = line.split(',').map(s => s.trim())
        return { name: n, region: r || '' }
      })
    if (!items.length) { showToast('Paste at least one location', 'error'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/locations/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      })
      const data = await res.json()
      showToast(`Imported ${data.total_created} location${data.total_created === 1 ? '' : 's'}`)
      setBulkText(''); setBulkMode(false); setShowAdd(false)
      load()
    } catch {
      showToast('Bulk import failed', 'error')
    } finally { setSaving(false) }
  }

  const toggle = async (id: string) => {
    await fetch(`/api/clients/${clientId}/locations/${id}/toggle`, { method: 'PATCH' })
    load()
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this location?')) return
    await fetch(`/api/clients/${clientId}/locations/${id}`, { method: 'DELETE' })
    showToast('Location removed')
    load()
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#374151' }}>Locations</div>
          <div className="text-muted mt-4">Geographic entries used for pSEO page generation</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>➕ Add Location</button>
      </div>

      {locations.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📍</div>
          <div className="empty-state-title">No locations yet</div>
          <p>Add cities or regions that you want to generate pSEO pages for</p>
          <button className="btn btn-primary mt-16" onClick={() => setShowAdd(true)}>➕ Add First Location</button>
        </div>
      ) : (
        <div className="source-list">
          {locations.map(loc => (
            <div key={loc.id} className={`source-item ${loc.active ? '' : 'inactive'}`}>
              <div className="source-icon source-icon-rss">📍</div>
              <div className="source-info">
                <div className="source-label">{loc.name}</div>
                <div className="source-detail">
                  /{loc.slug}{loc.region ? ` · ${loc.region}` : ''}{loc.country ? ` · ${loc.country}` : ''}
                </div>
              </div>
              <div className="source-actions">
                <button className="btn btn-sm btn-secondary" onClick={() => toggle(loc.id)}>
                  {loc.active ? '⏸ Pause' : '▶ Resume'}
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => remove(loc.id)}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowAdd(false)}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">Add {bulkMode ? 'Locations (bulk)' : 'Location'}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button
                  className={`btn btn-sm ${!bulkMode ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setBulkMode(false)}
                  type="button"
                >Single</button>
                <button
                  className={`btn btn-sm ${bulkMode ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setBulkMode(true)}
                  type="button"
                >Bulk paste</button>
              </div>

              {!bulkMode ? (
                <>
                  <div className="form-group">
                    <label className="form-label">Name *</label>
                    <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Manchester" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Region <span className="text-muted">(optional)</span></label>
                    <input className="form-input" value={region} onChange={e => setRegion(e.target.value)} placeholder="e.g. Greater Manchester" />
                  </div>
                </>
              ) : (
                <div className="form-group">
                  <label className="form-label">Paste locations — one per line</label>
                  <textarea
                    className="form-textarea"
                    rows={10}
                    value={bulkText}
                    onChange={e => setBulkText(e.target.value)}
                    placeholder={'Manchester, Greater Manchester\nLeeds, West Yorkshire\nSheffield, South Yorkshire\nLiverpool, Merseyside'}
                  />
                  <div className="form-hint">Format: <code>Name</code> or <code>Name, Region</code></div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={bulkMode ? addBulk : addOne}
                disabled={saving}
              >
                {saving ? <><span className="loading" /> Saving…</> : bulkMode ? '📋 Import' : '✅ Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
