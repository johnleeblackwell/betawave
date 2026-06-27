import { useState, useEffect } from 'react'

interface Props {
  clientId: string
}

type PlatformKey = 'linkedin' | 'facebook' | 'instagram' | 'x' | 'tiktok'

interface GeneratedPost {
  post: string
  char_count: number
  max_chars: number
  platform_name: string
  platform_icon: string
}

interface Destination {
  id: string
  label: string
  platform: string
  handle: string
  active: number
}

const PLATFORMS: { key: PlatformKey; name: string; icon: string; colour: string }[] = [
  { key: 'linkedin',  name: 'LinkedIn',    icon: '🔗', colour: '#0a66c2' },
  { key: 'facebook',  name: 'Facebook',    icon: '👍', colour: '#1877f2' },
  { key: 'instagram', name: 'Instagram',   icon: '📸', colour: '#e1306c' },
  { key: 'x',         name: 'X / Twitter', icon: '𝕏',  colour: '#000000' },
  { key: 'tiktok',    name: 'TikTok',      icon: '🎵', colour: '#010101' },
]

export default function SocialHub({ clientId }: Props) {
  const [topic, setTopic] = useState('')
  const [sourceContent, setSourceContent] = useState('')
  const [repurposeMode, setRepurposeMode] = useState(false)
  const [selectedPlatforms, setSelectedPlatforms] = useState<PlatformKey[]>(['linkedin', 'facebook', 'instagram'])
  const [loading, setLoading] = useState(false)
  const [posts, setPosts] = useState<Record<string, GeneratedPost> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [destinations, setDestinations] = useState<Destination[]>([])
  const [posting, setPosting] = useState<string | null>(null) // "platformKey-destId"
  const [postResult, setPostResult] = useState<Record<string, { ok: boolean; msg: string }>>({})
  const [openPostMenu, setOpenPostMenu] = useState<string | null>(null) // platform key

  // Load connected destinations once on mount
  useEffect(() => {
    fetch(`/api/clients/${clientId}/social/destinations`)
      .then(r => r.ok ? r.json() : [])
      .then(setDestinations)
      .catch(() => {})
  }, [clientId])

  const togglePlatform = (key: PlatformKey) => {
    setSelectedPlatforms(prev =>
      prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]
    )
  }

  const generate = async () => {
    if (selectedPlatforms.length === 0) return
    if (!repurposeMode && !topic.trim()) return
    if (repurposeMode && !sourceContent.trim()) return

    setLoading(true)
    setError(null)
    setPosts(null)
    setPostResult({})

    try {
      const res = await fetch(`/api/clients/${clientId}/social/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: repurposeMode ? undefined : topic,
          source_content: repurposeMode ? sourceContent : undefined,
          platforms: selectedPlatforms,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generation failed')
      setPosts(data.posts)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const copyPost = (key: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const postNow = async (platformKey: string, destId: string, text: string) => {
    const resultKey = `${platformKey}-${destId}`
    setPosting(resultKey)
    setOpenPostMenu(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/social/post-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination_id: destId, text }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setPostResult(r => ({ ...r, [platformKey]: { ok: true, msg: `Posted to ${data.handle || data.platform}!` } }))
      } else {
        setPostResult(r => ({ ...r, [platformKey]: { ok: false, msg: data.error || 'Post failed' } }))
      }
    } catch (err: any) {
      setPostResult(r => ({ ...r, [platformKey]: { ok: false, msg: err.message || 'Post failed' } }))
    } finally {
      setPosting(null)
    }
  }

  const charColour = (count: number, max: number) => {
    const pct = count / max
    if (pct > 0.9) return '#dc2626'
    if (pct > 0.7) return '#d97706'
    return '#16a34a'
  }

  return (
    <div className="page-content" onClick={() => setOpenPostMenu(null)}>
      {/* Input panel */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <span className="card-title">🚀 Social Post Generator</span>
        </div>
        <div className="card-body">

          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button
              className={`btn btn-sm ${!repurposeMode ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setRepurposeMode(false)}
            >
              ✏️ From topic
            </button>
            <button
              className={`btn btn-sm ${repurposeMode ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setRepurposeMode(true)}
            >
              ♻️ Repurpose content
            </button>
          </div>

          {!repurposeMode ? (
            <div className="form-group">
              <label className="form-label">Topic or brief</label>
              <input
                className="form-input"
                placeholder="e.g. We're hiring a senior stylist — applications open now"
                value={topic}
                onChange={e => setTopic(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && generate()}
              />
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label">Paste content to repurpose (blog post, article, notes…)</label>
              <textarea
                className="form-input"
                rows={6}
                placeholder="Paste your existing content here and we'll adapt it for each platform…"
                value={sourceContent}
                onChange={e => setSourceContent(e.target.value)}
                style={{ resize: 'vertical' }}
              />
            </div>
          )}

          {/* Platform selector */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Platforms</label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {PLATFORMS.map(p => (
                <button
                  key={p.key}
                  onClick={() => togglePlatform(p.key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 14px',
                    borderRadius: 20,
                    border: `2px solid ${selectedPlatforms.includes(p.key) ? p.colour : '#e2e8f0'}`,
                    background: selectedPlatforms.includes(p.key) ? `${p.colour}15` : 'white',
                    color: selectedPlatforms.includes(p.key) ? p.colour : '#64748b',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <span>{p.icon}</span> {p.name}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ padding: '0 20px 20px' }}>
          <button
            className="btn btn-primary"
            onClick={generate}
            disabled={loading || selectedPlatforms.length === 0 || (!repurposeMode && !topic.trim()) || (repurposeMode && !sourceContent.trim())}
          >
            {loading ? <><span className="loading" /> Generating…</> : '⚡ Generate Posts'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', color: '#dc2626', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Results */}
      {posts && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
          {Object.entries(posts).map(([key, post]) => {
            const platform = PLATFORMS.find(p => p.key === key)
            if (!post) return null
            // Destinations whose platform key matches this post's key
            const matchingDests = destinations.filter(d => d.platform === key)
            const result = postResult[key]

            return (
              <div
                key={key}
                className="card"
                style={{ borderTop: `3px solid ${platform?.colour || '#6366f1'}` }}
              >
                <div className="card-header" style={{ paddingBottom: 8 }}>
                  <span className="card-title" style={{ color: platform?.colour }}>
                    {post.platform_icon} {post.platform_name}
                  </span>
                  <span style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: charColour(post.char_count, post.max_chars),
                  }}>
                    {post.char_count.toLocaleString()} / {post.max_chars.toLocaleString()} chars
                  </span>
                </div>
                <div className="card-body" style={{ paddingTop: 0 }}>
                  {/* Character bar */}
                  <div style={{ height: 3, background: '#f1f5f9', borderRadius: 2, marginBottom: 12, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(100, (post.char_count / post.max_chars) * 100)}%`,
                      background: charColour(post.char_count, post.max_chars),
                      borderRadius: 2,
                      transition: 'width 0.3s',
                    }} />
                  </div>

                  <div style={{
                    whiteSpace: 'pre-wrap',
                    fontSize: '0.875rem',
                    lineHeight: 1.6,
                    color: '#1e293b',
                    background: '#f8fafc',
                    padding: '12px 14px',
                    borderRadius: 8,
                    marginBottom: 12,
                    maxHeight: 300,
                    overflowY: 'auto',
                  }}>
                    {post.post}
                  </div>

                  {/* Post result feedback */}
                  {result && (
                    <div style={{
                      fontSize: '0.8rem',
                      padding: '6px 10px',
                      borderRadius: 6,
                      marginBottom: 8,
                      background: result.ok ? '#dcfce7' : '#fee2e2',
                      color: result.ok ? '#16a34a' : '#dc2626',
                    }}>
                      {result.ok ? '✅' : '❌'} {result.msg}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ flex: 1 }}
                      onClick={() => copyPost(key, post.post)}
                    >
                      {copied === key ? '✅ Copied!' : '📋 Copy'}
                    </button>

                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        const singleGenerate = async () => {
                          setLoading(true)
                          try {
                            const res = await fetch(`/api/clients/${clientId}/social/generate`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                topic: repurposeMode ? undefined : topic,
                                source_content: repurposeMode ? sourceContent : undefined,
                                platforms: [key],
                              }),
                            })
                            const data = await res.json()
                            if (res.ok) {
                              setPosts(prev => ({ ...prev!, ...data.posts }))
                              setPostResult(r => { const n = {...r}; delete n[key]; return n })
                            }
                          } finally {
                            setLoading(false)
                          }
                        }
                        singleGenerate()
                      }}
                    >
                      🔄 Retry
                    </button>

                    {/* Post now button — only rendered if there are connected destinations */}
                    {matchingDests.length > 0 && (
                      <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                        {matchingDests.length === 1 ? (
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={posting !== null}
                            onClick={() => postNow(key, matchingDests[0].id, post.post)}
                          >
                            {posting === `${key}-${matchingDests[0].id}` ? <span className="loading" /> : `→ Post`}
                          </button>
                        ) : (
                          <>
                            <button
                              className="btn btn-primary btn-sm"
                              disabled={posting !== null}
                              onClick={() => setOpenPostMenu(openPostMenu === key ? null : key)}
                            >
                              {posting !== null && posting.startsWith(key + '-') ? <span className="loading" /> : '→ Post ▾'}
                            </button>
                            {openPostMenu === key && (
                              <div style={{
                                position: 'absolute', bottom: '110%', right: 0,
                                background: 'white', border: '1px solid #e2e8f0',
                                borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                                minWidth: 200, zIndex: 100, overflow: 'hidden',
                              }}>
                                <div style={{ padding: '8px 12px', fontSize: '0.75rem', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #f1f5f9' }}>
                                  Post to…
                                </div>
                                {matchingDests.map(d => (
                                  <button
                                    key={d.id}
                                    onClick={() => postNow(key, d.id, post.post)}
                                    style={{
                                      display: 'block', width: '100%', textAlign: 'left',
                                      padding: '9px 14px', background: 'none', border: 'none',
                                      cursor: 'pointer', fontSize: '0.85rem', color: '#1e293b',
                                    }}
                                    onMouseOver={e => (e.currentTarget.style.background = '#f8fafc')}
                                    onMouseOut={e => (e.currentTarget.style.background = 'none')}
                                  >
                                    {d.label} {d.handle ? `· ${d.handle}` : ''}
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Empty state */}
      {!posts && !loading && !error && (
        <div style={{ textAlign: 'center', padding: '48px 24px', color: '#94a3b8' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>📱</div>
          <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: 6, color: '#64748b' }}>Ready to generate</div>
          <div style={{ fontSize: '0.875rem' }}>Enter a topic or paste content above, select your platforms, and hit Generate</div>
          {destinations.length === 0 && (
            <div style={{ marginTop: 12, fontSize: '0.8rem', color: '#94a3b8' }}>
              💡 Connect social accounts in <strong>Syndicate → Destinations</strong> to unlock one-click posting
            </div>
          )}
        </div>
      )}
    </div>
  )
}
