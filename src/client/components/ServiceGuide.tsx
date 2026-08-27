/**
 * What this section is, what it replaces, and where to go next.
 *
 * WHY THIS EXISTS
 *
 * βWave is not sold as software with features. It is sold as the thing that
 * lets someone cancel five subscriptions — and that argument was being made
 * only in a DM, on a landing page, and by John on a call. Inside the product
 * itself, where a prospect is actually looking, nothing said it.
 *
 * So every section now names the subscriptions it displaces, with what they
 * cost. The argument lands where the person is standing, not where the
 * marketing was.
 *
 * IT IS ALSO THE TOUR
 *
 * Each panel ends by pointing at the next section, so following them in order
 * IS a guided journey across the whole platform — but it still works for
 * someone who lands cold on Syndicate from a bookmark, which a modal
 * step-through does not. One component, both jobs.
 *
 * This matters most for the people John will never meet. An affiliate cannot
 * be on the call, and a prospect exploring alone will not infer that Respond
 * replaces Sprout Social at £199/month. Somebody has to say it, every time,
 * in the room where they are.
 */
import { useState } from 'react'

interface Replaced { name: string; price: string }
interface Guide {
  title: string
  purpose: string
  replaces: Replaced[]
  next?: { tab: string; label: string }
}

/**
 * Prices are the advertised entry tier at the time of writing, rounded and
 * marked "from" — they move, and the point is the shape of the bill rather
 * than an audited figure. Understating is deliberate: a prospect who checks
 * should find the real number is worse, never better.
 */
export const SERVICE_GUIDE: Record<string, Guide> = {
  overview: {
    title: 'Overview',
    purpose: 'What this instance has actually produced, published and answered — the receipt, not a dashboard. Everything below runs whether anyone logs in or not.',
    replaces: [{ name: 'HubSpot Marketing Hub', price: 'from £700/mo' }],
    next: { tab: 'sources', label: 'Sources — where the material comes from' },
  },
  sources: {
    title: 'Sources',
    purpose: 'Everything βWave writes starts from material you already own — your blog, your podcast, your competitors\' feeds, your own back catalogue. Point it at the well once; it draws from it forever.',
    replaces: [{ name: 'Feedly Pro', price: 'from £8/mo' }, { name: 'Zapier RSS', price: 'from £20/mo' }],
    next: { tab: 'generate', label: 'Generate — turn it into publishable work' },
  },
  generate: {
    title: 'Generate',
    purpose: 'Blogs, newsletters and social posts written in your voice from your sources. Not a blank prompt box — it already knows the brand, the audience and the tone, because you told it once.',
    replaces: [{ name: 'Jasper', price: 'from £39/mo' }, { name: 'Copy.ai', price: 'from £36/mo' }],
    next: { tab: 'content', label: 'Content — everything it has produced' },
  },
  content: {
    title: 'Content',
    purpose: 'The library. Every piece produced, its status, and what it was built from. Nothing here has gone anywhere until you say so.',
    replaces: [{ name: 'Notion / Airtable calendars', price: 'from £8/user/mo' }],
    next: { tab: 'social', label: 'Social — the short-form version' },
  },
  social: {
    title: 'Social',
    purpose: 'Long-form work atomised into posts per channel, each written for that channel rather than copy-pasted across all of them.',
    replaces: [{ name: 'Buffer', price: 'from £5/channel/mo' }, { name: 'Later', price: 'from £25/mo' }],
    next: { tab: 'syndicate', label: 'Syndicate — getting it out' },
  },
  syndicate: {
    title: 'Syndicate',
    purpose: 'One piece of work, routed to every destination on a schedule, with per-channel throttles so you never carpet-bomb the same audience. Runs unattended.',
    replaces: [{ name: 'Hootsuite', price: 'from £99/mo' }, { name: 'Zapier', price: 'from £20/mo' }],
    next: { tab: 'schedule', label: 'Schedule — when it all happens' },
  },
  schedule: {
    title: 'Schedule',
    purpose: 'The calendar the engine works to. Set the rhythm once and it holds it — including the weeks you are on holiday.',
    replaces: [{ name: 'Buffer / Hootsuite scheduling', price: 'included above' }],
    next: { tab: 'site', label: 'Site — your own property' },
  },
  site: {
    title: 'Site',
    purpose: 'A fast static site you own, published to your own domain. The one destination no platform can take away from you, and the only one that still exists if X or LinkedIn change their minds.',
    replaces: [{ name: 'WordPress hosting + plugins', price: 'from £25/mo' }, { name: 'Webflow', price: 'from £18/mo' }],
    next: { tab: 'reports', label: 'Reports — something worth an email address' },
  },
  reports: {
    title: 'Reports',
    purpose: 'Niche lead-magnet reports, each with its own landing page. The thing people hand over an email address for.',
    replaces: [{ name: 'Leadpages', price: 'from £37/mo' }, { name: 'Instapage', price: 'from £79/mo' }],
    next: { tab: 'discovery', label: 'Discovery — who to talk to' },
  },
  discovery: {
    title: 'Discovery',
    purpose: 'Find the businesses worth approaching, the people inside them, and the reason to make contact. Then work the list one day at a time, ordered by who can actually say yes.',
    replaces: [{ name: 'Apollo', price: 'from £39/mo' }, { name: 'Sales Navigator', price: 'from £70/mo' }, { name: 'Lemlist', price: 'from £29/mo' }],
    next: { tab: 'respond', label: 'Respond — what comes back' },
  },
  respond: {
    title: 'Respond',
    purpose: 'Every mention, comment and reply in one place with an answer already drafted, waiting on a human. Nothing addressed to a real person goes out before someone has read it.',
    replaces: [{ name: 'Sprout Social', price: 'from £199/mo' }, { name: 'Agorapulse', price: 'from £69/mo' }],
    next: { tab: 'citation', label: 'Measure — whether any of it worked' },
  },
  citation: {
    title: 'Measure',
    purpose: 'Whether the work is landing — asked of the assistants people actually use, and read from your own first-party numbers rather than a third party\'s estimate.',
    replaces: [{ name: 'Semrush', price: 'from £99/mo' }, { name: 'Ahrefs', price: 'from £99/mo' }],
    next: { tab: 'gsc', label: 'Search Console — your own numbers' },
  },
  gsc: {
    title: 'Search Console',
    purpose: 'Your real impressions and clicks, straight from Google, from your own account. Not scraped, not modelled, not somebody\'s index.',
    replaces: [{ name: 'Rank-tracking seats', price: 'from £49/mo' }],
    // The last stop is the assistant, not a lap back to Overview — see the
    // note on `assistant` below.
    next: { tab: '__assistant', label: 'The assistant — the part nobody else has' },
  },
}

/**
 * The assistant is the last stop on the tour, and it is not a tab.
 *
 * It reads live data, drafts real work and waits to be approved — the most
 * differentiated thing in the product, and it was a floating β button a visitor
 * could easily take for a help bubble and never press. The tour walked people
 * through thirteen sections and then stopped short of the only one nobody else
 * has.
 *
 * Handled as a pseudo-tab so it can sit in the same chain rather than needing
 * its own mechanism: choosing it fires the event AgentChat listens for and
 * leaves the current section on screen underneath, which is the right thing —
 * the assistant is something laid over your work, not somewhere you navigate.
 */
export const ASSISTANT_STEP = '__assistant'

/** The bill this replaces, added up once so nobody has to. */
export function stackTotal(): number {
  const seen = new Set<string>()
  let total = 0
  for (const g of Object.values(SERVICE_GUIDE)) {
    for (const r of g.replaces) {
      if (seen.has(r.name)) continue
      seen.add(r.name)
      const m = r.price.match(/£([\d,]+)/)
      if (m) total += Number(m[1].replace(/,/g, ''))
    }
  }
  return total
}

export default function ServiceGuide (
  { tab, onTabChange }: { tab: string; onTabChange?: (t: string) => void },
) {
  const g = SERVICE_GUIDE[tab]
  // Dismissal is per-section and per-browser. Someone who has read the
  // Syndicate panel does not need it again, but they have not necessarily
  // read the Respond one — collapsing them all together would hide the
  // argument from the person it was written for.
  const key = `bwave-guide-hidden-${tab}`
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(key) === '1' } catch { return false }
  })
  if (!g || hidden) return null

  const dismiss = () => {
    setHidden(true)
    try { localStorage.setItem(key, '1') } catch { /* private window — fine */ }
  }

  /**
   * AMBER, and deliberately not the brand cyan.
   *
   * This panel is not part of the application — it is someone talking to you
   * about it. Rendered in the app's own palette on `var(--panel)` it
   * disappeared into the page in BOTH themes, which is fatal for the one
   * element that has to be noticed by a stranger arriving from a link.
   *
   * Amber reads as a note laid on top rather than another card, and it stays
   * visible on white and on near-black without being restyled per theme.
   */
  return (
    <div style={{
      border: '1px solid rgba(251,146,60,.38)',
      borderLeft: '4px solid #f97316',
      borderRadius: 12, padding: '15px 17px', marginBottom: 18,
      background: 'linear-gradient(180deg, rgba(251,146,60,.14), rgba(251,146,60,.07))',
      boxShadow: '0 2px 14px rgba(249,115,22,.10)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 800, fontSize: '.98rem', marginBottom: 5,
            color: '#c2410c', letterSpacing: '-.01em',
            // Warm on white, still legible on near-black — the one token the
            // theme cannot supply, because this block sits outside the palette.
            filter: 'saturate(1.15)',
          }}>{g.title}</div>
          <p style={{ margin: 0, fontSize: '.89rem', lineHeight: 1.62, color: 'var(--text-primary)' }}>
            {g.purpose}
          </p>

          {/* THE ARGUMENT, NOT A FOOTNOTE.
              This row is the whole pitch — it names the subscriptions this
              section kills and what they cost — and it was rendered in muted
              grey on a near-white panel, which made the most important line the
              least visible thing on screen. Cancelled things now read as
              cancelled: red tint, red strike-through, price in full weight. */}
          {!!g.replaces.length && (
            <div style={{
              marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center',
              padding: '9px 11px', borderRadius: 10,
              // Sits INSIDE the amber panel, so it needs its own ground rather
              // than a tint — a red wash over amber just muddies both.
              background: 'rgba(0,0,0,.16)', border: '1px solid rgba(220,38,38,.3)',
            }}>
              <span style={{
                fontSize: '.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em',
                color: '#dc2626',
              }}>
                cancels
              </span>
              {g.replaces.map(r => (
                <span key={r.name} style={{
                  fontSize: '.78rem', padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap',
                  background: 'rgba(255,255,255,.9)', color: '#1c1917',
                  border: '1px solid rgba(220,38,38,.35)', fontWeight: 600,
                }}>
                  <s style={{ textDecorationColor: '#dc2626', textDecorationThickness: '1.5px' }}>{r.name}</s>{' '}
                  <span style={{ color: '#dc2626', fontWeight: 800 }}>{r.price}</span>
                </span>
              ))}
            </div>
          )}

          {/* THE TOUR ONLY WORKS IF PEOPLE SEE THE BUTTON.
              This was a muted secondary button, which is exactly the styling a
              reader's eye is trained to skip. It is the single control that
              carries someone through all thirteen sections — and for anyone
              arriving from an affiliate's link it is the only guide they get,
              because nobody is on a call with them. Loud on purpose. */}
          {g.next && onTabChange && (
            <button
              onClick={() => {
                if (g.next!.tab === ASSISTANT_STEP) {
                  window.dispatchEvent(new Event('bwave:open-assistant'))
                  return
                }
                onTabChange(g.next!.tab)
              }}
              style={{
                marginTop: 14,
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'linear-gradient(135deg, #A3E635, #22D3EE)',
                color: '#0B0F14',
                fontWeight: 800, fontSize: '.9rem', letterSpacing: '.01em',
                border: 'none', borderRadius: 999, padding: '11px 20px',
                cursor: 'pointer',
                boxShadow: '0 0 0 3px rgba(163,230,53,.22), 0 6px 22px rgba(34,211,238,.35)',
                transition: 'transform .12s ease, box-shadow .12s ease',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-1px)'
                e.currentTarget.style.boxShadow = '0 0 0 4px rgba(163,230,53,.3), 0 10px 28px rgba(34,211,238,.45)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'none'
                e.currentTarget.style.boxShadow = '0 0 0 3px rgba(163,230,53,.22), 0 6px 22px rgba(34,211,238,.35)'
              }}
            >
              <span style={{ fontSize: '1.05rem', lineHeight: 1 }}>👉</span>
              Next → {g.next.label}
            </button>
          )}
        </div>

        <button
          onClick={dismiss}
          title="Hide this for this section"
          style={{
            background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem',
            color: 'var(--text-tertiary)', lineHeight: 1, padding: 2,
          }}
        >×</button>
      </div>
    </div>
  )
}
