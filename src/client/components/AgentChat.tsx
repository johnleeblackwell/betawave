/**
 * AgentChat — the βWave in-app assistant ("Upgrade Bot"), v2.
 *
 * A floating launcher (bottom-right) that opens a chat panel. You talk to
 * Claude and it answers from your real βWave data via server-side tools, and it
 * can now propose ACTIONS (currently: draft a reply to a comment). Actions are
 * gated: the agent hands you a proposal card and nothing happens until you tap
 * Approve. Rejecting tells it to drop the idea.
 *
 * Owner-only — App.tsx only mounts it for the owner (it can see every client).
 *
 * Responsive: on a phone the panel is a full-screen sheet using dynamic
 * viewport height (100dvh) so the on-screen keyboard can't bury the input, with
 * safe-area padding for the notch and home-bar. On desktop it's a floating box.
 */
import { useState, useRef, useEffect } from 'react'

interface PendingAction { tool: string; summary: string; danger: string }
interface Pending { id: string; actions: PendingAction[] }
interface Msg {
  role: 'user' | 'assistant'
  content: string
  pending?: Pending          // an assistant turn that proposed a gated action
  resolved?: 'approve' | 'reject'  // set once the owner decides
}

const GREETING: Msg = {
  role: 'assistant',
  content: "Hi — I'm your βWave™ assistant. I read your live data, and I can draft things for you — a reply to a comment, or a full blog post for a client. When I act, I show you exactly what I'll do and wait for your Approve. Nothing is saved or sent without it.\n\nHere are a few things I could do for you right now — want me to take one on? Tap it, or just ask me anything.",
}

// Small matchMedia hook — re-renders when we cross the phone breakpoint.
function useIsMobile(query = '(max-width: 640px)') {
  const [match, setMatch] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

export default function AgentChat() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([GREETING])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [suggestions, setSuggestions] = useState<{ label: string; prompt: string; hint?: string }[]>([])
  const isMobile = useIsMobile()
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const askedSuggestions = useRef(false)

  // Fetch concrete "things I could do right now" when the panel first opens, so
  // the assistant offers rather than waits. Best-effort — never blocks the chat.
  useEffect(() => {
    if (!open || askedSuggestions.current) return
    askedSuggestions.current = true
    fetch('/api/agent/suggestions')
      .then(r => (r.ok ? r.json() : { suggestions: [] }))
      .then(d => setSuggestions(Array.isArray(d.suggestions) ? d.suggestions : []))
      .catch(() => {})
  }, [open])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, busy, open])

  // Focus the input when opening — but not on mobile, where auto-focus yanks up
  // the keyboard before the user has even seen the panel.
  useEffect(() => { if (open && !isMobile) inputRef.current?.focus() }, [open, isMobile])

  // Lock the background from scrolling while the full-screen sheet is up.
  useEffect(() => {
    if (!(open && isMobile)) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open, isMobile])

  // Append the assistant's reply from a /chat or /approve response, carrying any
  // pending proposal so the card renders.
  const appendReply = (data: any) => {
    const text: string = data.reply || (data.pending ? '' : '(no answer)')
    setMsgs(m => [...m, { role: 'assistant', content: text, pending: data.pending }])
  }

  const send = async (override?: string) => {
    const text = (override ?? input).trim()
    if (!text || busy) return
    const next = [...msgs, { role: 'user' as const, content: text }]
    setMsgs(next)
    if (!override) setInput('')
    setBusy(true)
    try {
      // Send only the real text turns (drop greeting + any proposal cards) as history.
      const history = next
        .filter(m => m !== GREETING && !m.pending)
        .map(m => ({ role: m.role, content: m.content }))
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'The assistant hit an error.')
      appendReply(data)
    } catch (e: any) {
      setMsgs(m => [...m, { role: 'assistant', content: '⚠️ ' + (e.message || 'Something went wrong.') }])
    } finally {
      setBusy(false)
    }
  }

  // Approve or reject a proposed action. `idx` is the message holding the card.
  const decide = async (idx: number, pendingId: string, decision: 'approve' | 'reject') => {
    if (busy) return
    setBusy(true)
    setMsgs(m => m.map((msg, i) => (i === idx ? { ...msg, resolved: decision } : msg)))
    try {
      const res = await fetch('/api/agent/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pendingId, decision }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'The action could not be completed.')
      appendReply(data)
    } catch (e: any) {
      // Undo the resolved marker so the owner can retry the decision.
      setMsgs(m => m.map((msg, i) => (i === idx ? { ...msg, resolved: undefined } : msg)))
      setMsgs(m => [...m, { role: 'assistant', content: '⚠️ ' + (e.message || 'Something went wrong.') }])
    } finally {
      setBusy(false)
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    // On a phone, Enter should insert a newline, not fire — send is the button.
    if (e.key === 'Enter' && !e.shiftKey && !isMobile) { e.preventDefault(); send() }
  }

  const panelStyle: React.CSSProperties = isMobile
    ? { position: 'fixed', zIndex: 200, inset: 0, width: '100vw', height: '100dvh', borderRadius: 0, border: 'none' }
    : {
        position: 'fixed', zIndex: 200,
        bottom: 90, right: 22, width: 'min(400px, calc(100vw - 32px))',
        height: 'min(560px, calc(100vh - 130px))',
        borderRadius: 16, border: '1px solid var(--border-default, #e2e8f0)',
      }

  return (
    <>
      {!(open && isMobile) && (
        <button
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Close assistant' : 'Open βWave™ assistant'}
          style={{
            position: 'fixed', bottom: 22, right: 22, zIndex: 200,
            width: 56, height: 56, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: 'linear-gradient(145deg, #4C8DFF, #7C5CFF)', color: '#fff',
            fontSize: 24, fontWeight: 800, fontStyle: 'italic',
            boxShadow: '0 8px 24px -6px rgba(92,124,255,.7)',
            display: 'grid', placeItems: 'center',
          }}
        >
          {open ? '✕' : 'β'}
        </button>
      )}

      {open && (
        <div
          style={{
            ...panelStyle,
            display: 'flex', flexDirection: 'column',
            background: 'var(--bg-card, #fff)', color: 'var(--text-primary, #131a22)',
            boxShadow: isMobile ? 'none' : '0 20px 60px -20px rgba(0,0,0,.5)', overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{
            padding: '12px 16px',
            paddingTop: isMobile ? 'calc(12px + env(safe-area-inset-top))' : 12,
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'linear-gradient(145deg, #4C8DFF, #7C5CFF)', color: '#fff',
          }}>
            <span style={{ fontWeight: 800, fontStyle: 'italic', fontSize: 18 }}>β</span>
            <div style={{ lineHeight: 1.2, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>βWave™ Assistant</div>
              <div style={{ fontSize: 10.5, opacity: .85, fontFamily: 'ui-monospace, monospace', letterSpacing: '.04em' }}>v2 · ASKS BEFORE ACTING</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              style={{
                width: 32, height: 32, flex: 'none', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: 'rgba(255,255,255,.18)', color: '#fff', fontSize: 16, lineHeight: 1,
              }}
            >✕</button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10, WebkitOverflowScrolling: 'touch' }}>
            {msgs.map((m, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                {m.content && (
                  <div style={{
                    maxWidth: '86%', padding: '9px 12px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.5,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    background: m.role === 'user' ? 'linear-gradient(145deg,#4C8DFF,#6B6BFF)' : 'var(--bg-hover, #f1f5f9)',
                    color: m.role === 'user' ? '#fff' : 'var(--text-primary, #131a22)',
                    borderBottomRightRadius: m.role === 'user' ? 3 : 12,
                    borderBottomLeftRadius: m.role === 'user' ? 12 : 3,
                  }}>
                    {m.content}
                  </div>
                )}

                {/* Approval card(s) for a proposed action. */}
                {m.pending && m.pending.actions.map((a, j) => (
                  <div key={j} style={{
                    maxWidth: '92%', width: '92%', border: '1px solid var(--border-default, #e2e8f0)',
                    borderLeft: `3px solid ${a.danger === 'destructive' ? '#ef4444' : '#7C5CFF'}`,
                    borderRadius: 12, background: 'var(--bg-base, #fff)', overflow: 'hidden',
                  }}>
                    <div style={{
                      padding: '8px 12px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em',
                      textTransform: 'uppercase', color: a.danger === 'destructive' ? '#ef4444' : '#7C5CFF',
                      borderBottom: '1px solid var(--border-default, #eef0f4)',
                    }}>
                      {a.danger === 'destructive' ? '⚠ Needs your approval' : 'Needs your approval'}
                    </div>
                    <div style={{ padding: '10px 12px', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', color: 'var(--text-primary, #131a22)' }}>
                      {a.summary}
                    </div>
                    <div style={{ display: 'flex', gap: 8, padding: '0 12px 12px' }}>
                      {m.resolved ? (
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: m.resolved === 'approve' ? '#10b981' : 'var(--text-tertiary,#64748b)' }}>
                          {m.resolved === 'approve' ? '✓ Approved' : '✕ Rejected'}
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => decide(i, m.pending!.id, 'approve')}
                            disabled={busy}
                            style={{
                              flex: 1, padding: '8px 12px', borderRadius: 9, border: 'none', cursor: busy ? 'default' : 'pointer',
                              background: 'linear-gradient(145deg,#4C8DFF,#7C5CFF)', color: '#fff', fontSize: 13, fontWeight: 700,
                            }}
                          >Approve</button>
                          <button
                            onClick={() => decide(i, m.pending!.id, 'reject')}
                            disabled={busy}
                            style={{
                              flex: 1, padding: '8px 12px', borderRadius: 9, cursor: busy ? 'default' : 'pointer',
                              background: 'transparent', color: 'var(--text-secondary,#475569)', fontSize: 13, fontWeight: 600,
                              border: '1px solid var(--border-default, #e2e8f0)',
                            }}
                          >Reject</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {/* Tap-to-run suggestions — only before the first exchange, so the
                assistant offers concrete things to do the moment it opens. */}
            {msgs.length === 1 && !busy && suggestions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 2 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-tertiary,#64748b)', margin: '2px 0 1px' }}>
                  A few things I could do
                </div>
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => send(s.prompt)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                      padding: '9px 12px', borderRadius: 10, cursor: 'pointer',
                      border: '1px solid var(--border-default, #e2e8f0)', background: 'var(--bg-base, #fff)',
                      color: 'var(--text-primary, #131a22)', fontSize: 13, fontWeight: 500,
                    }}
                  >
                    <span style={{ color: '#7C5CFF', fontWeight: 800, flex: 'none' }}>β</span>
                    <span style={{ flex: 1 }}>{s.label}</span>
                    {s.hint && (
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: '#7C5CFF', background: 'color-mix(in srgb, #7C5CFF 12%, transparent)', padding: '2px 7px', borderRadius: 999, flex: 'none' }}>
                        {s.hint}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {busy && (
              <div style={{ alignSelf: 'flex-start', padding: '9px 12px', fontSize: 13, color: 'var(--text-tertiary, #64748b)' }}>
                <span className="loading" /> thinking…
              </div>
            )}
          </div>

          {/* Input */}
          <div style={{
            padding: 12,
            paddingBottom: isMobile ? 'calc(12px + env(safe-area-inset-bottom))' : 12,
            borderTop: '1px solid var(--border-default, #e2e8f0)',
            display: 'flex', gap: 8, alignItems: 'flex-end',
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKey}
              rows={1}
              placeholder="Ask about your clients, content, pipeline…"
              disabled={busy}
              style={{
                flex: 1, resize: 'none', maxHeight: 100, padding: '10px 12px',
                fontSize: 16, /* 16px stops iOS Safari zooming in on focus */
                borderRadius: 10, border: '1px solid var(--border-default, #e2e8f0)',
                background: 'var(--bg-base, #fff)', color: 'var(--text-primary, #131a22)', fontFamily: 'inherit',
              }}
            />
            <button
              onClick={() => send()}
              disabled={busy || !input.trim()}
              style={{
                width: 44, height: 44, flex: 'none', borderRadius: 10, border: 'none', cursor: busy ? 'default' : 'pointer',
                background: busy || !input.trim() ? 'var(--bg-hover, #e2e8f0)' : 'linear-gradient(145deg,#4C8DFF,#7C5CFF)',
                color: '#fff', fontSize: 17,
              }}
              aria-label="Send"
            >➤</button>
          </div>
        </div>
      )}
    </>
  )
}
