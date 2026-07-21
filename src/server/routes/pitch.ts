/**
 * Instant pitch drafter — global, owner-scoped.
 *
 * Mounted at /api/pitch. The browser extension scrapes whatever LinkedIn has
 * already rendered on a profile you're looking at and posts it here; this
 * returns a ready-to-send opener grounded in one true detail about them.
 *
 * Deliberately does NOT require the person to exist in Discovery — the whole
 * point is you can be on any profile, hit one button, and have a message. If
 * you want them tracked afterwards, that's /api/leads/bulk-import's job.
 *
 * It classifies before it writes, because pitching a competing agency as if
 * they were a customer is the fastest way to look like you didn't read their
 * profile:
 *   prospect  — runs/markets a business that could buy
 *   partner   — agency/consultant/freelancer who serves clients (white-label angle)
 *   skip      — recruiter, student, job-seeker, obvious non-fit → say so, don't fake a pitch
 */
import { Router } from 'express'
import db from '../db.js'
import { generate } from '../services/llm.js'

const router = Router()

interface PitchBody {
  client_id?: string
  name?: string
  headline?: string
  about?: string
  location?: string
  current_role?: string
  company?: string
  recent_posts?: { text: string; when?: string }[]
  featured?: string[]
  mutual_connections?: string[]
  /** Who the sender is — a few lines. Without it the message stays generic. */
  sender_bio?: string
  /** What is being offered. Without it the model is told to keep it to an introduction. */
  offer?: string
  /** 'dm' (default, ~600 chars) or 'note' (connection request, hard 300 cap) */
  format?: 'dm' | 'note'
}

router.post('/', async (req, res) => {
  const b = req.body as PitchBody
  if (!b?.name?.trim() && !b?.headline?.trim()) {
    return res.status(400).json({ error: 'need at least a name or headline — is the profile still loading?' })
  }

  // Any client row works as the voice/LLM-config carrier; prefer the one the
  // extension is configured with, else fall back to the first available.
  const client = (b.client_id
    ? db.prepare(`SELECT * FROM clients WHERE id = ?`).get(b.client_id)
    : null) || db.prepare(`SELECT * FROM clients ORDER BY created_at LIMIT 1`).get()
  if (!client) return res.status(400).json({ error: 'no client configured on this install' })

  const isNote = b.format === 'note'
  const limit = isNote ? 280 : 600

  // Persona comes from the client record + whatever the caller supplies — nothing
  // about any particular business is baked into this file.
  const brand = (client as any).business_name || 'the sender'
  const voice = (client as any).brand_voice || (client as any).tone_of_voice || 'plain-spoken, direct, no hype'
  const senderBio = (b.sender_bio || '').trim()
  const offer = (b.offer || '').trim()

  const system = `You write first-contact LinkedIn messages on behalf of ${brand}.

WHO THE SENDER IS (use sparingly — one line at most, never a CV dump):
${senderBio || `${brand} — see the voice guidance below.`}

WHAT THEY ARE OFFERING (this is the ask — keep it light, never pushy):
${offer || 'An introduction and a genuine, no-strings offer of help.'}

CLASSIFY FIRST, then write for that case:
- "prospect": they run or market a business that could use this. Write the offer plainly.
- "partner": they are an agency, consultant, freelancer or supplier serving clients. Do NOT pitch them as a customer — pitch collaboration/white-label/referral instead.
- "skip": recruiter, student, job-seeker, a direct competitor, or nothing usable on the profile. Return a SHORT honest reason in "reason" and leave "pitch" empty. Never invent a pitch to fill space.

VOICE: ${voice}. Never "I hope this finds you well", never "quick question", never flattery, never a manufactured qualifying question. Sound like a competent human who read their profile, not a template.

RULES FOR THE OPENER:
- Open with ONE genuine, specific thing from their profile — something they actually posted, their own words about their work, a real mutual connection. Reference it naturally; never quote it back verbatim in a creepy way.
- If the profile is thin or generic, DO NOT fake familiarity — open with the substance instead.
- Never invent or embellish anything not in the supplied context.
- Under ${limit} characters. ${isNote ? 'This is a connection request note — hard limit, be very tight.' : ''}
- No emojis. No hashtags. No links. Plain text, no markdown, no subject line.

Reply in EXACTLY this format, nothing before or after. Do not use JSON, do not use code fences:
CLASSIFICATION: prospect
REASON: one short line on why
HOOK: the specific detail you opened with, or none
PITCH:
the message text here, on its own lines

(If the classification is skip, still give CLASSIFICATION and REASON but leave the PITCH section empty.)`

  const lines: string[] = []
  if (b.name) lines.push(`Name: ${b.name}`)
  if (b.headline) lines.push(`Headline: ${b.headline}`)
  if (b.current_role) lines.push(`Current role: ${b.current_role}`)
  if (b.company) lines.push(`Company: ${b.company}`)
  if (b.location) lines.push(`Location: ${b.location}`)
  if (b.about) lines.push(`Their About section: ${String(b.about).slice(0, 1200)}`)
  if (b.recent_posts?.length) {
    lines.push('Recent posts they wrote:')
    for (const p of b.recent_posts.slice(0, 3)) lines.push(`  - ${String(p.text).slice(0, 400)}${p.when ? ` (${p.when})` : ''}`)
  }
  if (b.featured?.length) lines.push(`Pinned/featured on their profile: ${b.featured.join(' | ')}`)
  if (b.mutual_connections?.length) lines.push(`Mutual connections: ${b.mutual_connections.slice(0, 5).join(', ')}`)

  const prompt = `Write the message for this person.\n\n${lines.join('\n')}`

  // Line-delimited rather than JSON on purpose: the Big Pickle fallback model
  // returns an EMPTY string when asked for strict JSON (verified — a plain
  // prompt works, the same prompt asking for JSON returns ""). This format
  // survives every model we've tried.
  const parseReply = (raw: string) => {
    const grab = (label: string) => {
      const m = raw.match(new RegExp(`^${label}:\\s*(.+)$`, 'im'))
      return m ? m[1].trim() : ''
    }
    const pitchIdx = raw.search(/^PITCH:\s*$/im)
    return {
      // Default to 'unknown', never 'prospect' — labelling something a prospect
      // when the model didn't actually say so is a lie the user would act on.
      classification: (grab('CLASSIFICATION') || 'unknown').toLowerCase().replace(/[^a-z]/g, ''),
      reason: grab('REASON'),
      hook: grab('HOOK').replace(/^none$/i, ''),
      // Everything after the PITCH: line is the message. If the model ignored
      // the format entirely, fall back to using the whole reply.
      // NB: when PITCH: is the final line (the skip case) indexOf returns -1,
      // and slice(-1 + 1) would hand back the entire reply including its own
      // scaffolding. Guard it explicitly.
      pitch: pitchIdx >= 0
        ? (() => {
            const nl = raw.indexOf('\n', pitchIdx)
            return nl === -1 ? '' : raw.slice(nl + 1).trim()
          })()
        : (/^(CLASSIFICATION|REASON|HOOK):/im.test(raw) ? '' : raw),
    }
  }

  try {
    // Retry until the reply is actually USABLE, not merely non-empty. The
    // fallback model sometimes returns nothing, and sometimes returns a
    // fragment ("Hi there." — 10 chars) that looks broken in the panel. A
    // 'skip' with no pitch is a legitimate result and accepted immediately.
    const MIN_PITCH = 80
    let parsed: ReturnType<typeof parseReply> | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await generate(client as any, { prompt, system, max_tokens: 600, temperature: 0.85 })
      const raw = (result.text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
      if (!raw) continue
      const p = parseReply(raw)
      if (p.classification === 'skip' || p.pitch.trim().length >= MIN_PITCH) { parsed = p; break }
      parsed = p   // keep the best effort in case every attempt is short
    }
    if (!parsed || (parsed.classification !== 'skip' && !parsed.pitch.trim())) {
      return res.status(502).json({
        classification: 'unknown', reason: 'The model gave nothing usable after 3 tries — hit Draft again.',
        pitch: '', hook: '', chars: 0,
      })
    }

    let pitch = String(parsed.pitch || '').trim()
    if (pitch.length > limit + 80) pitch = pitch.slice(0, limit).replace(/\s+\S*$/, '') + '…'

    res.json({
      classification: parsed.classification || 'prospect',
      reason: parsed.reason || '',
      hook: parsed.hook || '',
      pitch,
      chars: pitch.length,
    })
  } catch (e: any) {
    const msg = String(e?.message || e)
    // Every provider in the chain can rate-limit, and clicking Draft twice in
    // quick succession is enough to trigger it. Say that, rather than showing
    // a raw provider error the user can do nothing with.
    const friendly = /429|rate limit|quota|too many/i.test(msg)
      ? 'All the AI providers are rate-limited right now — wait a few seconds and hit Draft again.'
      : msg
    res.status(500).json({ classification: 'error', reason: friendly, pitch: '', hook: '', chars: 0, error: friendly })
  }
})

export default router
