import { useState, useEffect } from 'react'
import { useToast } from '../App.tsx'

interface Template {
  id: string
  client_id: string | null
  name: string
  kind: 'blog' | 'newsletter' | 'pseo' | 'report'
  prompt_template: string
  variables: string[]
  output_format: string
  status: string
  notes: string
  created_at: number
}

interface Props {
  clientId: string
  kindFilter?: Template['kind']   // when set, only shows + creates templates of this kind
}

const KIND_LABELS: Record<Template['kind'], string> = {
  blog: 'Blog post', newsletter: 'Newsletter', pseo: 'pSEO page', report: 'Niche report'
}

export default function TemplateManager({ clientId, kindFilter }: Props) {
  const { showToast } = useToast()
  const [templates, setTemplates] = useState<Template[]>([])
  const [editing, setEditing] = useState<Partial<Template> | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const qs = new URLSearchParams({ client_id: clientId })
    if (kindFilter) qs.set('kind', kindFilter)
    const res = await fetch(`/api/templates?${qs.toString()}`)
    setTemplates(await res.json())
  }

  useEffect(() => { load() }, [clientId, kindFilter])

  const openNew = () => setEditing({
    name: '',
    kind: kindFilter || 'pseo',
    prompt_template: '',
    notes: '',
    client_id: clientId,   // default to per-client; user can override in a future version
  })

  const save = async () => {
    if (!editing?.name || !editing?.prompt_template) {
      showToast('Name and template body required', 'error'); return
    }
    setSaving(true)
    try {
      const url = editing.id ? `/api/templates/${editing.id}` : '/api/templates'
      const method = editing.id ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: editing.client_id || clientId,
          name: editing.name,
          kind: editing.kind || 'pseo',
          prompt_template: editing.prompt_template,
          notes: editing.notes || '',
        })
      })
      if (!res.ok) throw new Error()
      showToast(editing.id ? 'Template updated' : 'Template created')
      setEditing(null)
      load()
    } catch {
      showToast('Save failed', 'error')
    } finally { setSaving(false) }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this template?')) return
    await fetch(`/api/templates/${id}`, { method: 'DELETE' })
    showToast('Template deleted')
    load()
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#374151' }}>
            {kindFilter ? `${KIND_LABELS[kindFilter]} templates` : 'Templates'}
          </div>
          <div className="text-muted mt-4">Parameterised prompts — use <code>{'{location}'}</code>, <code>{'{business}'}</code>, etc.</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openNew}>➕ New Template</button>
      </div>

      {templates.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📝</div>
          <div className="empty-state-title">No templates yet</div>
          <p>Create a reusable prompt template with <code>{'{placeholders}'}</code></p>
          <button className="btn btn-primary mt-16" onClick={openNew}>➕ Create First Template</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {templates.map(t => (
            <div key={t.id} className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{t.name}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    <span className="tag">{KIND_LABELS[t.kind]}</span>
                    {t.client_id === null && <span className="tag" style={{ background: '#dbeafe', color: '#1e40af' }}>install-wide</span>}
                    {t.variables.map(v => (
                      <span key={v} className="tag" style={{ background: '#fef3c7', color: '#92400e' }}>{`{${v}}`}</span>
                    ))}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 8, fontFamily: 'monospace', whiteSpace: 'pre-wrap', background: '#f8fafc', padding: 8, borderRadius: 6, maxHeight: 100, overflow: 'hidden' }}>
                    {t.prompt_template.slice(0, 240)}{t.prompt_template.length > 240 ? '…' : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button className="btn btn-sm btn-secondary" onClick={() => setEditing(t)}>✏️ Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={() => remove(t.id)}>🗑</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setEditing(null)}>
          <div className="modal" style={{ maxWidth: 720 }}>
            <div className="modal-header">
              <span className="modal-title">{editing.id ? 'Edit template' : 'New template'}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Name *</label>
                <input className="form-input" value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Local services city page" />
              </div>
              {!kindFilter && (
                <div className="form-group">
                  <label className="form-label">Kind</label>
                  <select className="form-input" value={editing.kind} onChange={e => setEditing({ ...editing, kind: e.target.value as any })}>
                    {(['pseo', 'report', 'blog', 'newsletter'] as const).map(k => (
                      <option key={k} value={k}>{KIND_LABELS[k]}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Prompt template *</label>
                <textarea
                  className="form-textarea"
                  rows={10}
                  value={editing.prompt_template || ''}
                  onChange={e => setEditing({ ...editing, prompt_template: e.target.value })}
                  placeholder={'Write an 800-word page about {business} in {location}, {region}.\n\nEmphasise the local scene, what makes {location} unique, and include a few landmarks.'}
                  style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
                <div className="form-hint">
                  Placeholders auto-resolve from the client profile and each location: <code>{'{location}'}</code>, <code>{'{region}'}</code>, <code>{'{country}'}</code>, <code>{'{business}'}</code>, <code>{'{industry}'}</code>, <code>{'{tone}'}</code>, <code>{'{audience}'}</code>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Notes <span className="text-muted">(optional)</span></label>
                <input className="form-input" value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} placeholder="What is this template for?" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? <><span className="loading" /> Saving…</> : '✅ Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
