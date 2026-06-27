import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import db from '../db.js'
import { postToMeshDestination } from '../services/syndication.js'

const router = Router({ mergeParams: true })

const PLATFORM_SPECS = {
  linkedin: {
    name: 'LinkedIn',
    icon: '🔗',
    maxChars: 3000,
    optimalWords: '150–250 words',
    hashtagCount: '3–5 hashtags',
    tone: 'professional, thought-leadership, personal insight',
    notes: 'Hook in the first line — it shows before "see more". End with a question or clear CTA. Hashtags at the very end.',
  },
  facebook: {
    name: 'Facebook',
    icon: '👍',
    maxChars: 63206,
    optimalWords: '40–80 words',
    hashtagCount: '1–2 hashtags max',
    tone: 'warm, conversational, community-focused',
    notes: 'Ask a question to drive comments. Relatable storytelling works well. Keep hashtags minimal.',
  },
  instagram: {
    name: 'Instagram',
    icon: '📸',
    maxChars: 2200,
    optimalWords: '100–150 words',
    hashtagCount: '15–20 hashtags',
    tone: 'visual, aspirational, engaging',
    notes: 'First 125 characters must hook (truncated before "more"). Emojis throughout the caption. Block of hashtags at the end, separated from the main caption.',
  },
  x: {
    name: 'X / Twitter',
    icon: '𝕏',
    maxChars: 280,
    optimalWords: '30–40 words',
    hashtagCount: '1–2 hashtags',
    tone: 'punchy, opinionated, direct',
    notes: 'Every word counts. Lead with the most interesting idea. No fluff.',
  },
  tiktok: {
    name: 'TikTok',
    icon: '🎵',
    maxChars: 2200,
    optimalWords: '50–100 words',
    hashtagCount: '3–5 hashtags',
    tone: 'raw, authentic, trend-aware, direct address to camera',
    notes: 'Write as a spoken video caption / hook, not a traditional post. First line is the hook that makes people stop scrolling. Use "you" directly. Short punchy sentences. Trending sounds reference optional. Hashtags at the end.',
  },
}

type PlatformKey = keyof typeof PLATFORM_SPECS

router.post('/generate', async (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const {
    topic,
    source_content,
    platforms = ['linkedin', 'facebook', 'instagram'],
  } = req.body as { topic: string; source_content?: string; platforms?: PlatformKey[] }

  if (!topic && !source_content) {
    return res.status(400).json({ error: 'Provide a topic or source content to repurpose' })
  }

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId) as any
  if (!client) return res.status(404).json({ error: 'Client not found' })

  const validPlatforms = platforms.filter(p => p in PLATFORM_SPECS)
  if (!validPlatforms.length) return res.status(400).json({ error: 'No valid platforms selected' })

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const platformGuides = validPlatforms
    .map(p => {
      const s = PLATFORM_SPECS[p]
      return `${s.icon} ${s.name}: ${s.optimalWords}, ${s.hashtagCount}. Tone: ${s.tone}. ${s.notes}`
    })
    .join('\n')

  const platformKeys = validPlatforms.map(p => `"${p}": { "post": "...", "char_count": 0 }`).join(',\n  ')

  const prompt = `You are a social media expert writing posts for ${client.business_name}, a ${client.industry} business.

Brand voice: ${client.tone_of_voice || 'professional and engaging'}
Target audience: ${client.target_audience || 'general audience'}${client.style_notes ? `\nStyle notes: ${client.style_notes}` : ''}
${client.expertise_areas?.length ? `Expertise: ${client.expertise_areas.join(', ')}` : ''}

${source_content ? `REPURPOSE THIS CONTENT into social posts:\n---\n${source_content.slice(0, 2000)}\n---` : `TOPIC / BRIEF: ${topic}`}

Write a social media post for each platform below. Return ONLY valid JSON — no markdown, no code fences, no commentary.

{
  ${platformKeys}
}

Platform guidelines:
${platformGuides}

Rules:
- Each post must feel native to its platform — do NOT write one post and copy it across
- Include relevant emojis where appropriate for the platform
- Include hashtags within the post text itself (not separate)
- char_count should equal the actual character length of the post string
- Write as if you ARE the brand, not about it`

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = (message.content[0] as Anthropic.TextBlock).text.trim()

    // Strip markdown code fences if model wrapped them anyway
    const json = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
    const posts = JSON.parse(json)

    // Recompute char counts server-side (model often gets them wrong)
    for (const p of validPlatforms) {
      if (posts[p]?.post) {
        posts[p].char_count = posts[p].post.length
        posts[p].max_chars = PLATFORM_SPECS[p].maxChars
        posts[p].platform_name = PLATFORM_SPECS[p].name
        posts[p].platform_icon = PLATFORM_SPECS[p].icon
      }
    }

    res.json({ posts })
  } catch (err: any) {
    console.error('[social/generate]', err)
    res.status(500).json({ error: err.message || 'Generation failed' })
  }
})

// POST /api/clients/:clientId/social/post-now
// Immediately posts a piece of text to a saved destination.
router.post('/post-now', async (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const { destination_id, text, title } = req.body as { destination_id: string; text: string; title?: string }
  if (!destination_id || !text?.trim()) return res.status(400).json({ error: 'destination_id and text required' })

  // Verify destination belongs to this client
  const dest = db.prepare(`SELECT id, platform, handle, label FROM syndication_destinations WHERE id = ? AND client_id = ?`).get(destination_id, clientId) as any
  if (!dest) return res.status(404).json({ error: 'Destination not found' })

  try {
    const result = await postToMeshDestination(destination_id, title || text.split('\n')[0].slice(0, 100), text)
    res.json({ ok: true, platform: dest.platform, handle: dest.handle, posted_url: result.url, posted_id: result.id })
  } catch (err: any) {
    console.error('[social/post-now]', err)
    res.status(502).json({ error: err.message || 'Post failed' })
  }
})

// GET /api/clients/:clientId/social/destinations
// Returns connected destinations for this client — used by the Social tab's "Post now" buttons.
router.get('/destinations', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const rows = db.prepare(
    `SELECT id, label, platform, handle, active FROM syndication_destinations WHERE client_id = ? AND active = 1 ORDER BY platform, label`
  ).all(clientId) as any[]
  res.json(rows)
})

export default router
