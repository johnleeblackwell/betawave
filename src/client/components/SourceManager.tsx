import { useState, useEffect, KeyboardEvent } from 'react'
import { useToast } from '../App.tsx'

interface Source {
  id: string
  type: 'rss' | 'keywords'
  url: string
  keywords: string[]
  label: string
  active: number
}

interface Props { clientId: string }

export default function SourceManager({ clientId }: Props) {
  const { showToast } = useToast()
  const [sources, setSources] = useState<Source[]>([])
  const [showModal, setShowModal] = useState(false)
  const [sourceType, setSourceType] = useState<'rss' | 'keywords'>('rss')
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [keywords, setKeywords] = useState<string[]>([])
  const [kwInput, setKwInput] = useState('')
  const [validating, setValidating] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const res = await fetch(`/api/clients/${clientId}/sources`)
    setSources(await res.json())
  }

  useEffect(() => { load() }, [clientId])

  const resetModal = () => {
    setLabel(''); setUrl(''); setKeywords([]); setKwInput(''); setSourceType('rss')
  }

  const addKw = () => {
    const v = kwInput.trim()
    if (v && !keywords.includes(v)) setKeywords(k => [...k, v])
    setKwInput('')
  }

  const onKwKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addKw() }
    if (e.key === 'Backspace' && !kwInput && keywords.length) setKeywords(k => k.slice(0, -1))
  }

  const validateAndAdd = async () => {
    if (!label) { showToast('Label is required', 'error'); return }
    if (sourceType === 'rss' && !url) { showToast('RSS URL is required', 'error'); return }
    if (sourceType === 'keywords' && !keywords.length) { showToast('Add at least one keyword', 'error'); return }

    if (sourceType === 'rss') {
      setValidating(true)
      try {
        const res = await fetch(`/api/validate-rss?url=${encodeURIComponent(url)}`)
        const data = await res.json()
        if (!data.ok) { showToast(`Invalid RSS feed: ${data.error}`, 'error'); return }
        showToast(`Feed verified: ${data.title || url}`)
      } catch {
        showToast('Could not validate feed', 'error'); return
      } finally {
        setValidating(false)
      }
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: sourceType, label, url, keywords })
      })
      if (!res.ok) throw new Error()
      showToast('Source added')
      setShowModal(false)
      resetModal()
      load()
    } catch {
      showToast('Failed to add source', 'error')
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (id: string) => {
    await fetch(`/api/clients/${clientId}/sources/${id}/toggle`, { method: 'PATCH' })
    load()
  }

  const remove = async (id: string) => {
    await fetch(`/api/clients/${clientId}/sources/${id}`, { method: 'DELETE' })
    showToast('Source removed')
    load()
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#374151' }}>Content Sources</div>
          <div className="text-muted mt-4">RSS feeds and keyword topics used when generating content</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>➕ Add Source</button>
      </div>

      {sources.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📡</div>
          <div className="empty-state-title">No sources configured</div>
          <p>Add RSS feeds or keywords to inform Claude's content generation</p>
          <button className="btn btn-primary mt-16" onClick={() => setShowModal(true)}>➕ Add First Source</button>
        </div>
      ) : (
        <div className="source-list">
          {sources.map(s => (
            <div key={s.id} className={`source-item ${s.active ? '' : 'inactive'}`}>
              <div className={`source-icon ${s.type === 'rss' ? 'source-icon-rss' : 'source-icon-keywords'}`}>
                {s.type === 'rss' ? '📰' : '🔑'}
              </div>
              <div className="source-info">
                <div className="source-label">{s.label}</div>
                <div className="source-detail">
                  {s.type === 'rss' ? s.url : s.keywords.join(', ')}
                </div>
              </div>
              <div className="source-actions">
                <button className="btn btn-sm btn-secondary" onClick={() => toggle(s.id)}>
                  {s.active ? '⏸ Pause' : '▶ Resume'}
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => remove(s.id)}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Source Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">Add Content Source</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Source Type</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className={`btn ${sourceType === 'rss' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setSourceType('rss')}
                    type="button"
                  >📰 RSS Feed</button>
                  <button
                    className={`btn ${sourceType === 'keywords' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setSourceType('keywords')}
                    type="button"
                  >🔑 Keywords</button>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Label *</label>
                <input className="form-input" value={label} onChange={e => setLabel(e.target.value)} placeholder={sourceType === 'rss' ? 'e.g. Property Wire News' : 'e.g. Local Property Topics'} />
              </div>

              {sourceType === 'rss' ? (
                <div className="form-group">
                  <label className="form-label">RSS Feed URL *</label>
                  <input className="form-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/feed.xml" type="url" />
                  <div className="form-hint">The feed will be validated before saving</div>
                </div>
              ) : (
                <div className="form-group">
                  <label className="form-label">Keywords / Topics *</label>
                  <div className="tag-input-container" onClick={() => document.getElementById('kw-input')?.focus()}>
                    {keywords.map(k => (
                      <span key={k} className="tag">
                        {k}
                        <span className="tag-remove" onClick={() => setKeywords(kw => kw.filter(x => x !== k))}>×</span>
                      </span>
                    ))}
                    <input id="kw-input" className="tag-input" value={kwInput} onChange={e => setKwInput(e.target.value)} onKeyDown={onKwKey} onBlur={addKw} placeholder={keywords.length ? '' : 'Type and press Enter…'} />
                  </div>
                  <div className="form-hint">E.g. "commercial property trends", "stamp duty changes"</div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => { setShowModal(false); resetModal() }}>Cancel</button>
              <button className="btn btn-primary" onClick={validateAndAdd} disabled={validating || saving}>
                {validating ? <><span className="loading" /> Validating…</> : saving ? <><span className="loading" /> Saving…</> : '✅ Add Source'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
