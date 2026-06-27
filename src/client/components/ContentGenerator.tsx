import { useState, useRef, useEffect } from 'react'
import { useToast } from '../App.tsx'

interface Props {
  clientId: string
  onContentSaved?: (id: string) => void
}

type GenType = 'blog' | 'newsletter'

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Escape HTML entities, then apply safe inline markdown (bold only).
function renderInline(s: string) {
  return escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

// Simple markdown-to-styled-HTML renderer for the preview pane.
// Content is HTML-escaped first to prevent XSS from AI-generated output.
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

export default function ContentGenerator({ clientId, onContentSaved }: Props) {
  const { showToast } = useToast()
  const [genType, setGenType] = useState<GenType>('blog')
  const [topicHint, setTopicHint] = useState('')
  const [content, setContent] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [savedTitle, setSavedTitle] = useState('')
  const [sourceCount, setSourceCount] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`/api/clients/${clientId}/sources`).then(r => r.json()).then((s: any[]) => {
      setSourceCount(s.filter(x => x.active).length)
    })
  }, [clientId])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [content])

  const generate = async () => {
    setContent('')
    setSavedId(null)
    setSavedTitle('')
    setIsGenerating(true)
    abortRef.current = new AbortController()

    try {
      const res = await fetch(`/api/clients/${clientId}/content/generate/${genType}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicHint }),
        signal: abortRef.current.signal
      })

      if (!res.ok || !res.body) {
        showToast('Generation failed — check your API key', 'error')
        setIsGenerating(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'delta') {
              setContent(prev => prev + data.text)
            } else if (data.type === 'done') {
              setSavedId(data.content_id)
              setSavedTitle(data.title)
              showToast('Content generated and saved as draft')
              onContentSaved?.(data.content_id)
            } else if (data.type === 'error') {
              showToast(data.message || 'Generation error', 'error')
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        showToast('Connection error during generation', 'error')
      }
    } finally {
      setIsGenerating(false)
    }
  }

  const stop = () => {
    abortRef.current?.abort()
    setIsGenerating(false)
  }

  return (
    <div className="page-content" style={{ padding: '20px 32px' }}>
      <div className="generate-panel">
        {/* Controls */}
        <div className="generate-controls">
          <div className="card">
            <div className="card-header"><span className="card-title">⚡ Generate Content</span></div>
            <div className="card-body">
              <div className="form-group">
                <label className="form-label">Content Type</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className={`btn ${genType === 'blog' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ flex: 1 }}
                    onClick={() => setGenType('blog')}
                  >📝 Blog Post</button>
                  <button
                    className={`btn ${genType === 'newsletter' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ flex: 1 }}
                    onClick={() => setGenType('newsletter')}
                  >📧 Newsletter</button>
                </div>
              </div>

              {genType === 'blog' && (
                <div className="form-group">
                  <label className="form-label">Topic Hint <span className="text-muted">(optional)</span></label>
                  <textarea
                    className="form-textarea"
                    value={topicHint}
                    onChange={e => setTopicHint(e.target.value)}
                    placeholder="e.g. Impact of new planning regulations on local landlords"
                    rows={3}
                    disabled={isGenerating}
                  />
                  <div className="form-hint">Leave blank to let Claude pick from your sources</div>
                </div>
              )}

              {genType === 'newsletter' && (
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 12px', fontSize: '0.8rem', color: '#166534' }}>
                  📬 Will compile your recent blog posts from the last 30 days into a warm, personal newsletter
                </div>
              )}

              <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px', fontSize: '0.78rem', color: '#64748b', marginBottom: 12 }}>
                {sourceCount > 0
                  ? `📡 Using ${sourceCount} active source${sourceCount !== 1 ? 's' : ''}`
                  : '⚠️ No active sources — add RSS feeds or keywords for richer content'}
              </div>

              <button
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
                onClick={generate}
                disabled={isGenerating}
              >
                {isGenerating ? <><span className="loading" /> Generating…</> : `✨ Generate ${genType === 'blog' ? 'Blog Post' : 'Newsletter'}`}
              </button>

              {isGenerating && (
                <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={stop}>
                  ⏹ Stop
                </button>
              )}
            </div>
          </div>

          {savedId && (
            <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: '14px 16px', fontSize: '0.85rem' }}>
              <div style={{ fontWeight: 600, color: '#166534', marginBottom: 4 }}>✅ Saved as Draft</div>
              <div style={{ color: '#374151', fontStyle: 'italic' }}>{savedTitle}</div>
              <div style={{ color: '#64748b', marginTop: 4, fontSize: '0.75rem' }}>Find it in the Content tab to review or send</div>
            </div>
          )}
        </div>

        {/* Output */}
        <div className="generate-output">
          <div className="generate-output-header">
            <span>{genType === 'blog' ? '📝 Blog Post Preview' : '📧 Newsletter Preview'}</span>
            {content && !isGenerating && (
              <span style={{ color: '#22c55e', fontWeight: 500 }}>✅ Complete</span>
            )}
            {isGenerating && <span style={{ color: '#d97706' }}>⚡ Generating…</span>}
          </div>

          <div
            className={`generate-output-body ${isGenerating && !content ? '' : ''}`}
            ref={outputRef}
          >
            {!content && !isGenerating && (
              <div className="empty-state" style={{ padding: '40px 20px' }}>
                <div className="empty-state-icon">✨</div>
                <div className="empty-state-title">Ready to generate</div>
                <p>Configure the options and click Generate</p>
              </div>
            )}
            {content && (
              <div
                dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
                style={{ fontFamily: 'Georgia, serif', lineHeight: '1.8' }}
              />
            )}
            {isGenerating && content && <span className="cursor-blink" />}
          </div>

          {content && !isGenerating && (
            <div className="generate-output-footer">
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                ~{Math.round(content.split(' ').length)} words
              </span>
              <div style={{ flex: 1 }} />
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => { navigator.clipboard.writeText(content); showToast('Copied to clipboard') }}
              >📋 Copy</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
