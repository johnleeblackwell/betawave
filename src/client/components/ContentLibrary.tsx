import { useState, useEffect } from 'react'
import { useToast } from '../App.tsx'

interface ContentItem {
  id: string
  client_id: string
  type: 'blog' | 'newsletter'
  title: string
  body: string
  excerpt: string
  status: 'draft' | 'sent'
  created_at: number
}

interface WpCategory { id: number; name: string; count: number; slug: string }

interface Props { clientId: string; wpConfigured?: boolean }

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderInline(s: string) {
  return escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function renderMarkdown(text: string) {
  return text
    .split('\n')
    .map(line => {
      if (line.startsWith('# ')) return `<h1>${renderInline(line.slice(2))}</h1>`
      if (line.startsWith('## ')) return `<h2>${renderInline(line.slice(3))}</h2>`
      if (line.startsWith('[SUBJECT: ')) return `<div style="background:#fff7ed;border-left:3px solid #d97706;padding:8px 12px;border-radius:4px;font-size:0.85rem;color:#92400e;margin-bottom:8px"><strong>Subject:</strong> ${renderInline(line.slice(10, -1))}</div>`
      if (line === '') return '<br/>'
      return `<p>${renderInline(line)}</p>`
    })
    .join('')
}

function timeAgo(ts: number) {
  const diff = Math.floor(Date.now() / 1000) - ts
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function ContentLibrary({ clientId, wpConfigured }: Props) {
  const { showToast } = useToast()
  const [items, setItems] = useState<ContentItem[]>([])
  const [filter, setFilter] = useState<'all' | 'blog' | 'newsletter'>('all')
  const [preview, setPreview] = useState<ContentItem | null>(null)
  const [sending, setSending] = useState(false)
  const [sendTo, setSendTo] = useState('')
  const [showSendModal, setShowSendModal] = useState(false)
  const [sendTarget, setSendTarget] = useState<ContentItem | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [showWpModal, setShowWpModal] = useState(false)
  const [wpTarget, setWpTarget] = useState<ContentItem | null>(null)
  const [wpCategories, setWpCategories] = useState<WpCategory[]>([])
  const [selectedCategories, setSelectedCategories] = useState<number[]>([])
  const [loadingCategories, setLoadingCategories] = useState(false)
  const [suggestingCategory, setSuggestingCategory] = useState(false)

  const load = async () => {
    const res = await fetch(`/api/clients/${clientId}/content`)
    setItems(await res.json())
  }

  useEffect(() => { load() }, [clientId])

  const remove = async (id: string) => {
    if (!confirm('Delete this content?')) return
    await fetch(`/api/clients/${clientId}/content/${id}`, { method: 'DELETE' })
    showToast('Content deleted')
    if (preview?.id === id) setPreview(null)
    load()
  }

  const openSend = (item: ContentItem) => {
    setSendTarget(item)
    setSendTo('')
    setShowSendModal(true)
  }

  const sendNewsletter = async () => {
    if (!sendTarget) return
    setSending(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/content/${sendTarget.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: sendTo || undefined })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      showToast(`Newsletter sent to ${data.sent_to}`)
      setShowSendModal(false)
      load()
    } catch (err: any) {
      showToast(err?.message || 'Failed to send', 'error')
    } finally {
      setSending(false)
    }
  }

  const openWpModal = async (item: ContentItem) => {
    setWpTarget(item)
    setSelectedCategories([])
    setWpCategories([])
    setShowWpModal(true)
    setLoadingCategories(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/wordpress/categories`)
      if (!res.ok) throw new Error()
      const cats: WpCategory[] = await res.json()
      setWpCategories(cats)
      // Auto-suggest category with Claude
      if (cats.length > 0) {
        setSuggestingCategory(true)
        try {
          const suggestRes = await fetch(`/api/clients/${clientId}/content/${item.id}/suggest-category`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categories: cats })
          })
          if (suggestRes.ok) {
            const { suggested_id } = await suggestRes.json()
            if (suggested_id) setSelectedCategories([suggested_id])
          }
        } catch { /* non-critical */ } finally {
          setSuggestingCategory(false)
        }
      }
    } catch {
      // WP not reachable — still allow publishing without categories
    } finally {
      setLoadingCategories(false)
    }
  }

  const publishToWordPress = async () => {
    if (!wpTarget) return
    setPublishing(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/content/${wpTarget.id}/publish/wordpress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_ids: selectedCategories })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const imageNote = data.featured_image ? ' with featured image' : ''
      showToast(data.wp_status === 'publish'
        ? `Published to WordPress${imageNote}! 🎉`
        : `Saved to WordPress as draft${imageNote}`)
      setShowWpModal(false)
      load()
    } catch (err: any) {
      showToast(err?.message || 'Failed to publish to WordPress', 'error')
    } finally {
      setPublishing(false)
    }
  }

  const toggleCategory = (id: number) => {
    setSelectedCategories(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    )
  }

  const filtered = filter === 'all' ? items : items.filter(i => i.type === filter)

  return (
    <div className="page-content">
      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        {(['all', 'blog', 'newsletter'] as const).map(f => (
          <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'blog' ? '📝 Blog Posts' : '📧 Newsletters'}
            {f !== 'all' && <span style={{ marginLeft: 4, opacity: 0.7 }}>({items.filter(i => i.type === f).length})</span>}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span className="text-muted">{filtered.length} piece{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📭</div>
          <div className="empty-state-title">No content yet</div>
          <p>Generate your first blog post or newsletter in the Generate tab</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: preview ? '1fr 1fr' : '1fr', gap: 16 }}>
          {/* List */}
          <div className="content-list">
            {filtered.map(item => (
              <div
                key={item.id}
                className="content-item"
                style={{ cursor: 'pointer', borderColor: preview?.id === item.id ? '#d97706' : undefined }}
                onClick={() => setPreview(preview?.id === item.id ? null : item)}
              >
                <div className="content-item-info">
                  <div className="content-item-title">{item.title}</div>
                  <div className="content-item-excerpt">{item.excerpt}</div>
                  <div className="content-item-meta">
                    <span className={`badge badge-${item.type}`}>{item.type === 'blog' ? '📝 Blog' : '📧 Newsletter'}</span>
                    <span className={`badge badge-${item.status}`}>{item.status}</span>
                    <span className="text-muted">{timeAgo(item.created_at)}</span>
                    <span className="text-muted">~{Math.round(item.body.split(' ').length)} words</span>
                  </div>
                </div>
                <div className="content-actions" onClick={e => e.stopPropagation()}>
                  {item.type === 'newsletter' && (
                    <button className="btn btn-sm btn-secondary" onClick={() => openSend(item)}>
                      📤 Send
                    </button>
                  )}
                  {item.type === 'blog' && wpConfigured && (
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => openWpModal(item)}
                      title="Publish to WordPress"
                    >
                      🌐 WP
                    </button>
                  )}
                  <button className="btn btn-sm btn-danger" onClick={() => remove(item.id)}>🗑</button>
                </div>
              </div>
            ))}
          </div>

          {/* Preview panel */}
          {preview && (
            <div>
              <div className="card" style={{ position: 'sticky', top: 0 }}>
                <div className="card-header">
                  <span className="card-title" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '80%' }}>{preview.title}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setPreview(null)}>✕</button>
                </div>
                <div style={{ padding: '20px', maxHeight: '70vh', overflowY: 'auto', fontFamily: 'Georgia, serif', lineHeight: 1.8, fontSize: '0.9rem', color: '#1e293b' }}>
                  <div dangerouslySetInnerHTML={{ __html: renderMarkdown(preview.body) }} />
                </div>
                <div style={{ padding: '12px 20px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { navigator.clipboard.writeText(preview.body); showToast('Copied!') }}
                  >📋 Copy</button>
                  {preview.type === 'newsletter' && (
                    <button className="btn btn-primary btn-sm" onClick={() => openSend(preview)}>📤 Send</button>
                  )}
                  {preview.type === 'blog' && wpConfigured && (
                    <button className="btn btn-primary btn-sm" onClick={() => openWpModal(preview)}>
                      🌐 Publish to WP
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* WordPress publish modal */}
      {showWpModal && wpTarget && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowWpModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">🌐 Publish to WordPress</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowWpModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: 16 }}>
                Publishing: <strong>{wpTarget.title}</strong>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  Categories
                  {suggestingCategory && (
                    <span style={{ fontSize: '0.75rem', color: '#d97706', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="loading" /> Claude is suggesting…
                    </span>
                  )}
                  {!suggestingCategory && selectedCategories.length > 0 && wpCategories.length > 0 && (
                    <span style={{ fontSize: '0.75rem', color: '#16a34a' }}>✨ AI suggested</span>
                  )}
                </label>

                {loadingCategories ? (
                  <div style={{ color: '#94a3b8', fontSize: '0.85rem', padding: '8px 0' }}>
                    <span className="loading" /> Fetching categories from WordPress…
                  </div>
                ) : wpCategories.length === 0 ? (
                  <div style={{ color: '#94a3b8', fontSize: '0.85rem', padding: '8px 0' }}>
                    No categories found — post will be uncategorised.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                    {wpCategories.map(cat => (
                      <label
                        key={cat.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                          padding: '6px 12px', borderRadius: 6, fontSize: '0.85rem',
                          border: `2px solid ${selectedCategories.includes(cat.id) ? '#d97706' : '#e2e8f0'}`,
                          background: selectedCategories.includes(cat.id) ? '#fff7ed' : '#fff',
                          fontWeight: selectedCategories.includes(cat.id) ? 600 : 400,
                          transition: 'all 0.1s',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedCategories.includes(cat.id)}
                          onChange={() => toggleCategory(cat.id)}
                          style={{ display: 'none' }}
                        />
                        {cat.name}
                        <span style={{ opacity: 0.4, fontSize: '0.75rem' }}>({cat.count})</span>
                      </label>
                    ))}
                  </div>
                )}
                <div className="form-hint" style={{ marginTop: 8 }}>
                  Claude has pre-selected the best fit. Click to adjust. Multiple categories allowed.
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowWpModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={publishToWordPress} disabled={publishing}>
                {publishing ? <><span className="loading" /> Publishing…</> : '🌐 Publish Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send modal */}
      {showSendModal && sendTarget && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowSendModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">📤 Send Newsletter</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowSendModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: 16 }}>
                Sending: <strong>{sendTarget.title}</strong>
              </div>
              <div className="form-group">
                <label className="form-label">Send To (email address)</label>
                <input
                  className="form-input"
                  type="email"
                  value={sendTo}
                  onChange={e => setSendTo(e.target.value)}
                  placeholder="Leave blank to use client's contact email"
                />
                <div className="form-hint">SMTP must be configured in .env for email sending to work</div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowSendModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={sendNewsletter} disabled={sending}>
                {sending ? <><span className="loading" /> Sending…</> : '📤 Send Now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
