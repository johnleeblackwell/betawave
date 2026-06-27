import { useState, useEffect } from 'react'
import { useToast } from '../App.tsx'

// ─── Types ────────────────────────────────────────────────────────────────────

type Platform = 'instagram' | 'gbp' | 'whatsapp' | 'twitter' | 'tiktok'
type AccountStatus = 'active' | 'pending' | 'disconnected' | 'error'
type SubTab = 'inbox' | 'suggestions' | 'accounts' | 'conversations'

interface Suggestion {
  id: string; kind: 'repost' | 'follow' | 'like' | 'reply'
  target_handle: string; target_name: string; target_text: string; target_url: string
  reason: string; score: number; draft: string
}

interface SocialAccount {
  id: string
  client_id: string
  platform: Platform
  account_name: string
  location_label: string
  external_id: string
  username: string
  status: AccountStatus
  error_message: string
  last_fetched_at: number | null
  webhook_verified: number
  created_at: number
}

interface SocialComment {
  id: string
  account_id: string
  platform: Platform
  account_name: string
  location_label: string
  external_id: string
  author_name: string
  content: string
  rating: number | null
  status: string
  sentiment: string | null
  published_at: number | null
  reply_id: string | null
  reply_status: string | null
  draft_content: string
  approved_content: string
}

interface SocialConversation {
  id: string
  account_id: string
  platform: Platform
  account_name: string
  location_label: string
  contact_name: string
  contact_phone: string
  status: string
  unread_count: number
  last_message_at: number | null
  last_message_preview: string
}

interface SocialMessage {
  id: string
  conversation_id: string
  direction: 'inbound' | 'outbound'
  content: string
  media_url: string
  media_type: string
  status: string
  draft_content: string
  created_at: number
}

const PLATFORM_META: Record<Platform, { label: string; icon: string; color: string }> = {
  instagram: { label: 'Instagram',  icon: '📸', color: '#e1306c' },
  gbp:       { label: 'Google',     icon: '⭐', color: '#4285f4' },
  whatsapp:  { label: 'WhatsApp',   icon: '💬', color: '#25d366' },
  twitter:   { label: 'X / Twitter',icon: '𝕏',  color: '#000000' },
  tiktok:    { label: 'TikTok',     icon: '🎵', color: '#ff0050' },
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RespondHub({ clientId }: { clientId: string }) {
  const { showToast } = useToast()
  const [subTab, setSubTab] = useState<SubTab>('inbox')

  // Summary
  const [summary, setSummary] = useState<{ account_count: number; pending_comments: number; open_conversations: number; platforms: Platform[] } | null>(null)

  // Accounts
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [newPlatform, setNewPlatform] = useState<Platform>('instagram')
  const [newAccountName, setNewAccountName] = useState('')
  const [newLocationLabel, setNewLocationLabel] = useState('')
  const [newUsername, setNewUsername] = useState('')
  const [addingAccount, setAddingAccount] = useState(false)

  // Inbox
  const [comments, setComments] = useState<SocialComment[]>([])
  const [conversations, setConversations] = useState<SocialConversation[]>([])
  const [inboxFilter, setInboxFilter] = useState<Platform | 'all'>('all')
  const [expandedComment, setExpandedComment] = useState<string | null>(null)
  const [draftingFor, setDraftingFor] = useState<string | null>(null)
  const [editedDraft, setEditedDraft] = useState<Record<string, string>>({})

  // Conversations
  const [selectedConv, setSelectedConv] = useState<SocialConversation | null>(null)
  const [messages, setMessages] = useState<SocialMessage[]>([])
  const [convDraft, setConvDraft] = useState('')
  const [draftingConv, setDraftingConv] = useState(false)

  // Growth suggestions (curation queue)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [discovering, setDiscovering] = useState(false)

  // Telegram connect
  const [tg, setTg] = useState<{ configured: boolean; chat: string; active: boolean }>({ configured: false, chat: '', active: false })
  const [tgToken, setTgToken] = useState('')
  const [tgChat, setTgChat] = useState('')
  const [tgBusy, setTgBusy] = useState(false)
  const loadTg = async () => { const r = await fetch(`/api/clients/${clientId}/telegram`); if (r.ok) setTg(await r.json()) }
  const connectTg = async () => {
    if (!tgToken.trim() || !tgChat.trim()) { showToast('Bot token and channel id are both required', 'error'); return }
    setTgBusy(true)
    try {
      const r = await fetch(`/api/clients/${clientId}/telegram`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tgToken.trim(), chatId: tgChat.trim() }) })
      const d = await r.json()
      if (!r.ok) { showToast(d.error || 'Connect failed', 'error'); return }
      showToast(`Connected ${d.bot || 'bot'} ✓`); setTgToken(''); loadTg()
    } finally { setTgBusy(false) }
  }
  const testTg = async () => {
    setTgBusy(true)
    try {
      const r = await fetch(`/api/clients/${clientId}/telegram/test`, { method: 'POST' })
      const d = await r.json()
      showToast(d.ok ? 'Test message sent — check your channel ✓' : (d.error || 'Test failed'), d.ok ? 'success' : 'error')
    } finally { setTgBusy(false) }
  }
  const disconnectTg = async () => {
    if (!confirm('Disconnect Telegram for this client?')) return
    await fetch(`/api/clients/${clientId}/telegram`, { method: 'DELETE' }); showToast('Disconnected'); loadTg()
  }

  // ── Load ─────────────────────────────────────────────────────────────────

  const loadSummary = async () => {
    const res = await fetch(`/api/clients/${clientId}/respond`)
    if (res.ok) setSummary(await res.json())
  }

  const loadSuggestions = async () => {
    const res = await fetch(`/api/clients/${clientId}/respond/suggestions?status=pending`)
    if (res.ok) { const d = await res.json(); setSuggestions(d.suggestions || []) }
  }

  const discoverNow = async () => {
    setDiscovering(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/respond/suggestions/discover`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) { showToast(d.error || 'Discovery failed', 'error'); return }
      showToast(d.created ? `Found ${d.created} new suggestion(s)` : 'No new suggestions right now')
      loadSuggestions()
    } finally { setDiscovering(false) }
  }

  const decideSuggestion = async (id: string, action: 'approve' | 'reject') => {
    await fetch(`/api/clients/${clientId}/respond/suggestions/${id}/${action}`, { method: 'POST' })
    showToast(action === 'approve' ? 'Approved — βWave will action it (paced, within daily caps)' : 'Rejected')
    setSuggestions(s => s.filter(x => x.id !== id))
  }

  const loadAccounts = async () => {
    const res = await fetch(`/api/respond/accounts/${clientId}`)
    if (res.ok) setAccounts(await res.json())
  }

  const loadInbox = async () => {
    const params = new URLSearchParams({ status: 'pending', limit: '50' })
    if (inboxFilter !== 'all') params.set('platform', inboxFilter)
    const res = await fetch(`/api/clients/${clientId}/respond/inbox?${params}`)
    if (res.ok) {
      const data = await res.json()
      setComments(data.comments || [])
      setConversations(data.conversations || [])
    }
  }

  useEffect(() => {
    loadSummary()
    loadAccounts()
    loadInbox()
    loadSuggestions()
    loadTg()
  }, [clientId])

  useEffect(() => { loadInbox() }, [inboxFilter])

  // ── Accounts ──────────────────────────────────────────────────────────────

  const addAccount = async () => {
    if (!newAccountName.trim()) { showToast('Account name is required', 'error'); return }
    setAddingAccount(true)
    try {
      const res = await fetch(`/api/respond/accounts/${clientId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: newPlatform,
          account_name: newAccountName.trim(),
          location_label: newLocationLabel.trim(),
          username: newUsername.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || 'Failed', 'error'); return }
      showToast(`${PLATFORM_META[newPlatform].label} account added`)
      setNewAccountName(''); setNewLocationLabel(''); setNewUsername('')
      setShowAddAccount(false)
      loadAccounts(); loadSummary()
    } finally { setAddingAccount(false) }
  }

  const deleteAccount = async (id: string, name: string) => {
    if (!confirm(`Remove "${name}"? All associated comments and conversations will be deleted.`)) return
    await fetch(`/api/respond/accounts/${id}`, { method: 'DELETE' })
    showToast('Account removed')
    loadAccounts(); loadSummary()
  }

  const updateAccountStatus = async (id: string, status: AccountStatus) => {
    await fetch(`/api/respond/accounts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    loadAccounts()
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  const generateDraft = async (commentId: string) => {
    setDraftingFor(commentId)
    try {
      const res = await fetch(`/api/respond/comments/${commentId}/draft`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || 'Draft failed', 'error'); return }
      setEditedDraft(d => ({ ...d, [commentId]: data.draft_content }))
      loadInbox()
    } finally { setDraftingFor(null) }
  }

  const approveReply = async (commentId: string) => {
    const content = editedDraft[commentId]
    if (!content?.trim()) { showToast('Reply cannot be empty', 'error'); return }
    const res = await fetch(`/api/respond/comments/${commentId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    if (!res.ok) { showToast('Failed to save reply', 'error'); return }
    showToast('Reply approved — ready to post once platform OAuth is connected')
    setExpandedComment(null)
    loadInbox(); loadSummary()
  }

  const ignoreComment = async (commentId: string) => {
    await fetch(`/api/respond/comments/${commentId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ignored' }),
    })
    loadInbox(); loadSummary()
  }

  // ── Conversations ─────────────────────────────────────────────────────────

  const loadMessages = async (conv: SocialConversation) => {
    setSelectedConv(conv)
    const res = await fetch(`/api/respond/conversations/${conv.id}/messages`)
    if (res.ok) setMessages(await res.json())
  }

  const generateConvDraft = async () => {
    if (!selectedConv) return
    setDraftingConv(true)
    try {
      const res = await fetch(`/api/respond/conversations/${selectedConv.id}/draft`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || 'Draft failed', 'error'); return }
      setConvDraft(data.draft)
    } finally { setDraftingConv(false) }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const pendingCount = comments.length + conversations.length

  return (
    <>
      {/* Sub-tabs */}
      <div className="sub-tabs">
        {(['inbox', 'suggestions', 'accounts', 'conversations'] as SubTab[]).map(t => (
          <button
            key={t}
            className={`sub-tab sub-tab-respond ${subTab === t ? 'active' : ''}`}
            onClick={() => setSubTab(t)}
          >
            {t === 'inbox' && '📥 '}
            {t === 'suggestions' && '✨ '}
            {t === 'accounts' && '🔗 '}
            {t === 'conversations' && '💬 '}
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === 'inbox' && pendingCount > 0 && (
              <span style={{ marginLeft: 5, background: '#ef4444', color: 'white', borderRadius: 10, padding: '1px 6px', fontSize: '0.65rem', fontWeight: 700 }}>
                {pendingCount}
              </span>
            )}
            {t === 'suggestions' && suggestions.length > 0 && (
              <span style={{ marginLeft: 5, background: '#7c3aed', color: 'white', borderRadius: 10, padding: '1px 6px', fontSize: '0.65rem', fontWeight: 700 }}>
                {suggestions.length}
              </span>
            )}
            {t === 'accounts' && accounts.length > 0 && (
              <span style={{ marginLeft: 4, fontSize: '0.65rem', background: '#dcfce7', color: '#166534', borderRadius: 8, padding: '1px 6px' }}>
                {accounts.filter(a => a.status === 'active').length}/{accounts.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="page-content">

        {/* ── Inbox ── */}
        {subTab === 'inbox' && (
          <div style={{ maxWidth: 760 }}>
            {/* Summary row */}
            {summary && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
                <StatCard label="Connected accounts" value={String(summary.account_count)} accent="#6366f1" />
                <StatCard label="Pending comments" value={String(summary.pending_comments)} accent="#ef4444" />
                <StatCard label="Open conversations" value={String(summary.open_conversations)} accent="#25d366" />
              </div>
            )}

            {/* Platform filter */}
            {accounts.length > 0 && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                <FilterChip label="All" active={inboxFilter === 'all'} onClick={() => setInboxFilter('all')} />
                {(Object.keys(PLATFORM_META) as Platform[]).filter(p => accounts.some(a => a.platform === p)).map(p => (
                  <FilterChip
                    key={p}
                    label={`${PLATFORM_META[p].icon} ${PLATFORM_META[p].label}`}
                    active={inboxFilter === p}
                    onClick={() => setInboxFilter(p)}
                    color={PLATFORM_META[p].color}
                  />
                ))}
              </div>
            )}

            {accounts.length === 0 ? (
              <div className="empty-state" style={{ padding: '48px 20px' }}>
                <div className="empty-state-icon">🔗</div>
                <div className="empty-state-title">No accounts connected yet</div>
                <p>Add your business social accounts in the <strong>Accounts</strong> tab to start monitoring comments, reviews and messages.</p>
                <button className="btn btn-respond btn-sm" style={{ marginTop: 12 }} onClick={() => setSubTab('accounts')}>
                  → Add accounts
                </button>
              </div>
            ) : comments.length === 0 && conversations.length === 0 ? (
              <div className="empty-state" style={{ padding: '40px 20px' }}>
                <div className="empty-state-icon">✅</div>
                <div className="empty-state-title">Inbox zero</div>
                <p>No pending comments or messages. Check back after the next fetch.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {comments.map(comment => (
                  <CommentCard
                    key={comment.id}
                    comment={comment}
                    expanded={expandedComment === comment.id}
                    onExpand={() => setExpandedComment(expandedComment === comment.id ? null : comment.id)}
                    draft={editedDraft[comment.id] ?? comment.draft_content ?? ''}
                    onDraftChange={v => setEditedDraft(d => ({ ...d, [comment.id]: v }))}
                    onGenerateDraft={() => generateDraft(comment.id)}
                    onApprove={() => approveReply(comment.id)}
                    onIgnore={() => ignoreComment(comment.id)}
                    drafting={draftingFor === comment.id}
                  />
                ))}
                {conversations.map(conv => (
                  <div key={conv.id} className="card" style={{ padding: '14px 16px', cursor: 'pointer' }}
                    onClick={() => { setSubTab('conversations'); loadMessages(conv) }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: '1.4rem' }}>{PLATFORM_META[conv.platform]?.icon ?? '💬'}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{conv.contact_name || conv.contact_phone || 'Unknown'}</div>
                        <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{conv.last_message_preview || 'No messages yet'}</div>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 2 }}>{conv.location_label || conv.account_name}</div>
                      </div>
                      {conv.unread_count > 0 && (
                        <span style={{ background: '#25d366', color: 'white', borderRadius: 10, padding: '1px 7px', fontSize: '0.72rem', fontWeight: 700 }}>
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Accounts ── */}
        {/* ── Suggestions (growth curation queue) ── */}
        {subTab === 'suggestions' && (
          <div style={{ maxWidth: 760 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>Growth suggestions</div>
                <div style={{ color: '#888', fontSize: '0.85rem' }}>
                  UK-relevant, non-competitor content relevant to your brand to amplify. Nothing is actioned without your approval.
                </div>
              </div>
              <button className="btn btn-respond btn-sm" onClick={discoverNow} disabled={discovering} style={{ whiteSpace: 'nowrap' }}>
                {discovering ? 'Searching…' : '🔍 Find new'}
              </button>
            </div>

            {suggestions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 20px', color: '#888' }}>
                <div style={{ fontSize: '2rem', marginBottom: 8 }}>✨</div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>No pending suggestions</div>
                <div style={{ fontSize: '0.85rem' }}>Hit “Find new” to scan X for posts worth reposting and accounts worth following.</div>
              </div>
            ) : suggestions.map(s => {
              const km = ({
                repost: { label: 'Repost', color: '#7c3aed', icon: '🔁' },
                follow: { label: 'Follow', color: '#2563eb', icon: '➕' },
                like:   { label: 'Like',   color: '#ef4444', icon: '❤️' },
                reply:  { label: 'Reply',  color: '#059669', icon: '💬' },
              } as Record<string, { label: string; color: string; icon: string }>)[s.kind] || { label: s.kind, color: '#7c3aed', icon: '•' }
              return (
                <div key={s.id} style={{ padding: 14, marginBottom: 12, border: '1px solid var(--border, #e5e7eb)', borderRadius: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ background: km.color, color: '#fff', borderRadius: 6, padding: '2px 8px', fontSize: '0.72rem', fontWeight: 700 }}>{km.icon} {km.label}</span>
                    <strong>{s.target_handle}</strong>
                    {s.target_name && <span style={{ color: '#888', fontSize: '0.85rem' }}>{s.target_name}</span>}
                    {typeof s.score === 'number' && <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: '#888' }}>relevance {Math.round(s.score * 100)}%</span>}
                  </div>
                  {s.target_text && <div style={{ fontSize: '0.9rem', marginBottom: 8, whiteSpace: 'pre-wrap' }}>{s.target_text}</div>}
                  {s.reason && <div style={{ fontSize: '0.78rem', color: '#7c3aed', marginBottom: 8 }}>Why: {s.reason}</div>}
                  {s.kind === 'reply' && (
                    <textarea
                      value={s.draft || ''}
                      onChange={e => setSuggestions(list => list.map(x => x.id === s.id ? { ...x, draft: e.target.value } : x))}
                      onBlur={e => fetch(`/api/clients/${clientId}/respond/suggestions/${s.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: e.target.value }) })}
                      style={{ width: '100%', minHeight: 60, marginBottom: 8, padding: 8, borderRadius: 8 }}
                    />
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button className="btn btn-respond btn-sm" onClick={() => decideSuggestion(s.id, 'approve')}>✓ Approve</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => decideSuggestion(s.id, 'reject')}>✕ Reject</button>
                    {s.target_url && <a href={s.target_url} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', fontSize: '0.8rem' }}>View on X →</a>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {subTab === 'accounts' && (
          <div style={{ maxWidth: 700 }}>

            {/* Connect Telegram — self-serve */}
            <div style={{ border: '1px solid var(--border, #e5e7eb)', borderRadius: 12, padding: 18, marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: '1.3rem' }}>✈️</span>
                <strong style={{ fontSize: '1.02rem' }}>Telegram channel</strong>
                {tg.configured && tg.active && <span style={{ marginLeft: 'auto', background: 'rgba(16,185,129,.15)', color: '#10b981', padding: '2px 9px', borderRadius: 999, fontSize: '.72rem', fontWeight: 700 }}>Connected · {tg.chat}</span>}
              </div>
              {tg.configured && tg.active ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div className="text-muted" style={{ flex: 1, minWidth: 200, fontSize: '.88rem' }}>Posting &amp; replies run through your bot on <strong>{tg.chat}</strong>.</div>
                  <button className="btn btn-secondary btn-sm" disabled={tgBusy} onClick={testTg}>Send test</button>
                  <button className="btn btn-ghost btn-sm" onClick={disconnectTg}>Disconnect</button>
                </div>
              ) : (
                <>
                  <div className="text-muted" style={{ fontSize: '.86rem', marginBottom: 12 }}>
                    In Telegram: <strong>@BotFather</strong> → <code>/newbot</code> for a token, then add that bot as an <strong>admin</strong> of your channel. Paste both below.
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input type="password" autoComplete="off" placeholder="Bot token (123456:AAH…)" value={tgToken} onChange={e => setTgToken(e.target.value)} style={{ flex: 2, minWidth: 220, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #d1d5db)' }} />
                    <input type="text" placeholder="@channel or chat id" value={tgChat} onChange={e => setTgChat(e.target.value)} style={{ flex: 1, minWidth: 140, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #d1d5db)' }} />
                    <button className="btn btn-primary btn-sm" disabled={tgBusy} onClick={connectTg}>{tgBusy ? '…' : 'Connect'}</button>
                  </div>
                </>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 600, color: '#374151' }}>Connected accounts</div>
                <div className="text-muted mt-4">One row per location per platform. Add as many as needed.</div>
              </div>
              <button className="btn btn-respond btn-sm" onClick={() => setShowAddAccount(!showAddAccount)}>
                {showAddAccount ? '✕ Cancel' : '+ Add account'}
              </button>
            </div>

            {/* Add account form */}
            {showAddAccount && (
              <div className="card" style={{ padding: 20, marginBottom: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 14, fontSize: '0.875rem' }}>Add social account</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label className="form-label">Platform *</label>
                    <select className="form-input" value={newPlatform} onChange={e => setNewPlatform(e.target.value as Platform)}>
                      {(Object.entries(PLATFORM_META) as [Platform, any][]).map(([p, m]) => (
                        <option key={p} value={p}>{m.icon} {m.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Account / Location name *</label>
                    <input
                      className="form-input"
                      value={newAccountName}
                      onChange={e => setNewAccountName(e.target.value)}
                      placeholder={newPlatform === 'whatsapp' ? 'e.g. Riverside Dental Central' : 'e.g. Riverside Dental Northgate'}
                    />
                  </div>
                  <div>
                    <label className="form-label">Location label <span className="text-muted">(helps staff identify location)</span></label>
                    <input
                      className="form-input"
                      value={newLocationLabel}
                      onChange={e => setNewLocationLabel(e.target.value)}
                      placeholder="e.g. Northgate, Manchester"
                    />
                  </div>
                  <div>
                    <label className="form-label">
                      {newPlatform === 'whatsapp' ? 'WhatsApp number' : newPlatform === 'gbp' ? 'Google location name' : '@username'}
                    </label>
                    <input
                      className="form-input"
                      value={newUsername}
                      onChange={e => setNewUsername(e.target.value)}
                      placeholder={newPlatform === 'whatsapp' ? '+44 7700 900000' : newPlatform === 'gbp' ? 'Business name on Google' : '@handle'}
                    />
                  </div>
                </div>
                <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 14px', fontSize: '0.78rem', color: '#64748b', marginBottom: 12 }}>
                  💡 <strong>OAuth connection</strong> for {PLATFORM_META[newPlatform].label} will be added in the next build.
                  For now, add the account details and tokens can be connected once OAuth is wired up.
                </div>
                <button className="btn btn-respond" onClick={addAccount} disabled={addingAccount || !newAccountName.trim()}>
                  {addingAccount ? <><span className="loading" /> Adding…</> : `Add ${PLATFORM_META[newPlatform].label} account`}
                </button>
              </div>
            )}

            {/* Platform groups */}
            {accounts.length === 0 ? (
              <div className="empty-state" style={{ padding: '40px 20px' }}>
                <div className="empty-state-icon">🔗</div>
                <div className="empty-state-title">No accounts yet</div>
                <p>Add each location's social accounts — Instagram, Google Business Profile, WhatsApp, Twitter, and TikTok.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(Object.keys(PLATFORM_META) as Platform[]).map(platform => {
                  const platformAccounts = accounts.filter(a => a.platform === platform)
                  if (platformAccounts.length === 0) return null
                  return (
                    <div key={platform}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, marginTop: 8 }}>
                        <span style={{ fontSize: '1rem' }}>{PLATFORM_META[platform].icon}</span>
                        <span style={{ fontWeight: 600, fontSize: '0.82rem', color: '#374151' }}>{PLATFORM_META[platform].label}</span>
                        <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{platformAccounts.length} account{platformAccounts.length !== 1 ? 's' : ''}</span>
                      </div>
                      {platformAccounts.map(account => (
                        <div key={account.id} className="card" style={{ padding: '12px 16px', marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{account.account_name}</div>
                              <div style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', gap: 10, marginTop: 2 }}>
                                {account.location_label && <span>📍 {account.location_label}</span>}
                                {account.username && <span>{account.platform === 'whatsapp' ? '📱' : '@'}{account.username.replace(/^@/, '')}</span>}
                                {account.last_fetched_at && <span>Last fetched: {fmtDate(account.last_fetched_at)}</span>}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <StatusBadge status={account.status} />
                              <select
                                className="form-input"
                                style={{ padding: '3px 8px', fontSize: '0.72rem', width: 'auto' }}
                                value={account.status}
                                onChange={e => updateAccountStatus(account.id, e.target.value as AccountStatus)}
                              >
                                <option value="active">Active</option>
                                <option value="pending">Pending</option>
                                <option value="disconnected">Disconnected</option>
                              </select>
                              <button className="btn btn-ghost btn-sm" style={{ color: '#dc2626' }}
                                onClick={() => deleteAccount(account.id, account.account_name)}>🗑</button>
                            </div>
                          </div>
                          {account.status === 'error' && account.error_message && (
                            <div style={{ marginTop: 8, fontSize: '0.75rem', color: '#dc2626', background: '#fee2e2', borderRadius: 6, padding: '4px 10px' }}>
                              ⚠️ {account.error_message}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Conversations (WhatsApp) ── */}
        {subTab === 'conversations' && (
          <div style={{ maxWidth: 800, display: 'grid', gridTemplateColumns: selectedConv ? '280px 1fr' : '1fr', gap: 16 }}>
            {/* Conversation list */}
            <div>
              <div style={{ fontWeight: 600, color: '#374151', marginBottom: 12 }}>WhatsApp conversations</div>
              {conversations.length === 0 ? (
                <div className="empty-state" style={{ padding: '32px 16px' }}>
                  <div className="empty-state-icon">💬</div>
                  <div className="empty-state-title" style={{ fontSize: '0.9rem' }}>No conversations yet</div>
                  <p style={{ fontSize: '0.8rem' }}>Incoming WhatsApp messages will appear here once connected.</p>
                </div>
              ) : (
                conversations.map(conv => (
                  <div
                    key={conv.id}
                    className="card"
                    style={{ padding: '12px 14px', marginBottom: 6, cursor: 'pointer', background: selectedConv?.id === conv.id ? '#f5f3ff' : 'white', borderLeft: selectedConv?.id === conv.id ? '3px solid #6366f1' : '3px solid transparent' }}
                    onClick={() => loadMessages(conv)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{conv.contact_name || conv.contact_phone}</div>
                        <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{conv.location_label || conv.account_name}</div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 3 }}>{conv.last_message_preview}</div>
                      </div>
                      {conv.unread_count > 0 && (
                        <span style={{ background: '#25d366', color: 'white', borderRadius: 10, padding: '1px 6px', fontSize: '0.65rem', fontWeight: 700, flexShrink: 0 }}>
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Message thread */}
            {selectedConv && (
              <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 500 }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{selectedConv.contact_name || selectedConv.contact_phone}</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{selectedConv.location_label || selectedConv.account_name}</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSelectedConv(null)}>✕</button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {messages.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem', marginTop: 40 }}>No messages yet</div>
                  ) : (
                    messages.map(msg => (
                      <div key={msg.id} style={{ display: 'flex', justifyContent: msg.direction === 'outbound' ? 'flex-end' : 'flex-start' }}>
                        <div style={{
                          maxWidth: '70%', padding: '8px 12px', borderRadius: 12, fontSize: '0.85rem',
                          background: msg.direction === 'outbound' ? '#6366f1' : '#f1f5f9',
                          color: msg.direction === 'outbound' ? 'white' : '#1a1a2e',
                          borderBottomRightRadius: msg.direction === 'outbound' ? 2 : 12,
                          borderBottomLeftRadius: msg.direction === 'inbound' ? 2 : 12,
                        }}>
                          {msg.content}
                          <div style={{ fontSize: '0.65rem', opacity: 0.6, marginTop: 3, textAlign: 'right' }}>
                            {fmtTime(msg.created_at)}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div style={{ padding: '12px 16px', borderTop: '1px solid #f1f5f9' }}>
                  <textarea
                    className="form-input"
                    rows={2}
                    placeholder="Type a reply…"
                    value={convDraft}
                    onChange={e => setConvDraft(e.target.value)}
                    style={{ marginBottom: 8, resize: 'none' }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-ghost btn-sm" onClick={generateConvDraft} disabled={draftingConv} style={{ color: '#6366f1' }}>
                      {draftingConv ? <><span className="loading" /> Drafting…</> : '✨ AI draft'}
                    </button>
                    <button
                      className="btn btn-respond btn-sm"
                      disabled={!convDraft.trim()}
                      onClick={() => showToast('Send will be active once WhatsApp OAuth is connected')}
                    >
                      Send
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </>
  )
}

// ─── Comment card ─────────────────────────────────────────────────────────────

function CommentCard({ comment, expanded, onExpand, draft, onDraftChange, onGenerateDraft, onApprove, onIgnore, drafting }: {
  comment: SocialComment
  expanded: boolean
  onExpand: () => void
  draft: string
  onDraftChange: (v: string) => void
  onGenerateDraft: () => void
  onApprove: () => void
  onIgnore: () => void
  drafting: boolean
}) {
  const pm = PLATFORM_META[comment.platform]
  return (
    <div className="card">
      <div style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start' }} onClick={onExpand}>
        <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>{pm?.icon ?? '💬'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{comment.author_name || 'Anonymous'}</span>
            {comment.rating && <StarRating rating={comment.rating} />}
            <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{comment.location_label || comment.account_name}</span>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', marginLeft: 'auto' }}>{comment.published_at ? fmtDate(comment.published_at) : ''}</span>
          </div>
          <div style={{ fontSize: '0.85rem', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expanded ? 'normal' : 'nowrap' }}>
            {comment.content}
          </div>
          {comment.sentiment && (
            <span style={{ fontSize: '0.68rem', marginTop: 4, display: 'inline-block', ...sentimentStyle(comment.sentiment) }}>
              {comment.sentiment}
            </span>
          )}
        </div>
        <span style={{ color: '#94a3b8', fontSize: '0.8rem', flexShrink: 0 }}>{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid #f1f5f9', padding: '12px 16px' }}>
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label className="form-label" style={{ margin: 0 }}>Reply</label>
              <button className="btn btn-ghost btn-sm" style={{ color: '#6366f1', fontSize: '0.75rem' }} onClick={onGenerateDraft} disabled={drafting}>
                {drafting ? <><span className="loading" /> Drafting…</> : '✨ AI draft'}
              </button>
            </div>
            <textarea
              className="form-input"
              rows={3}
              value={draft}
              onChange={e => onDraftChange(e.target.value)}
              placeholder="Write a reply or click AI draft…"
              style={{ resize: 'vertical' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-respond btn-sm" onClick={onApprove} disabled={!draft.trim()}>
              ✓ Approve reply
            </button>
            <button className="btn btn-ghost btn-sm" style={{ color: '#94a3b8' }} onClick={onIgnore}>
              Ignore
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Small components ─────────────────────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="stat-card" style={{ borderTop: `3px solid ${accent}` }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color: accent, fontSize: '1.8rem' }}>{value}</div>
    </div>
  )
}

function FilterChip({ label, active, onClick, color }: { label: string; active: boolean; onClick: () => void; color?: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 12px', borderRadius: 20, fontSize: '0.78rem', border: '1px solid #e2e8f0',
        background: active ? (color ?? '#6366f1') : 'white',
        color: active ? 'white' : '#64748b',
        cursor: 'pointer', fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  )
}

function StatusBadge({ status }: { status: string }) {
  const s: Record<string, { bg: string; color: string }> = {
    active:       { bg: '#d1fae5', color: '#065f46' },
    pending:      { bg: '#fef3c7', color: '#92400e' },
    disconnected: { bg: '#f1f5f9', color: '#64748b' },
    error:        { bg: '#fee2e2', color: '#991b1b' },
  }
  const style = s[status] ?? s.pending
  return (
    <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '2px 7px', borderRadius: 100, background: style.bg, color: style.color }}>
      {status}
    </span>
  )
}

function StarRating({ rating }: { rating: number }) {
  return (
    <span style={{ color: '#f59e0b', fontSize: '0.75rem' }}>
      {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
    </span>
  )
}

function sentimentStyle(sentiment: string): React.CSSProperties {
  const s: Record<string, React.CSSProperties> = {
    positive: { background: '#d1fae5', color: '#065f46', borderRadius: 8, padding: '1px 7px' },
    neutral:  { background: '#f1f5f9', color: '#64748b', borderRadius: 8, padding: '1px 7px' },
    negative: { background: '#fee2e2', color: '#991b1b', borderRadius: 8, padding: '1px 7px' },
  }
  return s[sentiment] ?? s.neutral
}

function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function fmtTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
