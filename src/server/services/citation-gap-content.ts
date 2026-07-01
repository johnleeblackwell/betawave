// @ts-nocheck
/**
 * Citation gap → content closer.
 *
 * The one thing missing from βWave that most matches its "autonomous team,
 * not dashboard" positioning: Measure (Citation Tracker) and Produce (content
 * generation) were two disconnected silos. A citation run could tell you
 * "you're absent from this query, your competitor isn't" — and then a human
 * had to notice, and manually go write something about it.
 *
 * This closes the loop. Called once a citation_classify job finishes: for
 * each tracked query where the brand was cited by NONE of the engines this
 * run (a full gap), draft a blog post targeting exactly that gap — reusing
 * the same buildBlogPrompt/generation pipeline as every other blog post in
 * the app, so quality and voice match. Always lands as a 'draft' — nothing
 * publishes itself. Capped at 3 gaps per run so one bad week doesn't flood
 * the Content Library.
 */
import db from '../db.js'
import { getClient, buildBlogPrompt } from './claude.js'
import { extractTitle, extractImageQuery } from './content-utils.js'
import { v4 as uuid } from 'uuid'

const MODEL = 'claude-opus-4-6'
const MAX_GAPS_PER_RUN = 3

interface GapQuery {
  query_id: string
  text: string
  category: string
  priority: number
  competitors: string[]
}

async function generate(prompt: string): Promise<string> {
  const r = await getClient().messages.create({
    model: MODEL, max_tokens: 2048,
    thinking: { type: 'adaptive' } as any,
    messages: [{ role: 'user', content: prompt }],
  })
  return r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
}

function findGapQueries(runId: string, brandId: string): GapQuery[] {
  const rows = db.prepare(`
    SELECT r.query_id, q.text, q.category, q.priority, r.brand_mentioned, r.competitor_mentions_json
    FROM citation_results r
    JOIN tracked_queries q ON q.id = r.query_id
    WHERE r.run_id = ? AND q.brand_id = ? AND r.classified_at IS NOT NULL
  `).all(runId, brandId) as any[]

  const byQuery = new Map<string, { text: string; category: string; priority: number; anyMentioned: boolean; competitors: Set<string> }>()
  for (const r of rows) {
    let g = byQuery.get(r.query_id)
    if (!g) {
      g = { text: r.text, category: r.category || '', priority: r.priority ?? 1, anyMentioned: false, competitors: new Set() }
      byQuery.set(r.query_id, g)
    }
    if (r.brand_mentioned) g.anyMentioned = true
    try {
      const mentions = JSON.parse(r.competitor_mentions_json || '[]') as Array<{ name: string }>
      mentions.forEach(m => m?.name && g!.competitors.add(m.name))
    } catch { /* malformed json, skip */ }
  }

  const gaps: GapQuery[] = []
  for (const [query_id, g] of byQuery) {
    if (g.anyMentioned) continue // only FULL gaps — cited by at least one engine doesn't count
    gaps.push({ query_id, text: g.text, category: g.category, priority: g.priority, competitors: [...g.competitors].slice(0, 5) })
  }

  return gaps.sort((a, b) => b.priority - a.priority).slice(0, MAX_GAPS_PER_RUN)
}

export async function draftContentForCitationGaps(runId: string, brandId: string): Promise<{ drafted: number; skipped: number }> {
  const brand = db.prepare(`SELECT * FROM tracked_brands WHERE id = ?`).get(brandId) as any
  if (!brand) return { drafted: 0, skipped: 0 }

  const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(brand.client_id) as any
  if (!client) return { drafted: 0, skipped: 0 }

  const clientForPrompt = {
    business_name: client.business_name,
    industry: client.industry,
    expertise_areas: JSON.parse(client.expertise_areas || '[]'),
    tone_of_voice: client.tone_of_voice || 'professional and engaging',
    target_audience: client.target_audience || 'general audience',
    style_notes: client.style_notes || '',
    blocked_topics: client.blocked_topics ? JSON.parse(client.blocked_topics) : undefined,
  }

  const gaps = findGapQueries(runId, brandId)
  let drafted = 0, skipped = 0

  for (const gap of gaps) {
    const sourceRef = `${runId}:${gap.query_id}`
    const existing = db.prepare(`SELECT 1 FROM content WHERE client_id = ? AND source_ref = ?`).get(client.id, sourceRef)
    if (existing) { skipped++; continue }

    const competitorLine = gap.competitors.length
      ? `When people ask this, AI engines currently cite: ${gap.competitors.join(', ')} — not ${client.business_name}.`
      : `When people ask this, no competitor was clearly cited either — the field is open.`

    const sourceMaterial = `Citation Tracker found that ${client.business_name} is NOT currently cited by any AI engine (ChatGPT, Perplexity, Gemini, etc.) when people ask:\n\n"${gap.text}"\n\n${competitorLine}\n\nBeing cited by AI depends on entity strength, structured data, and consistent, well-corroborated presence across the web — not on traditional keyword ranking. A page written to directly and clearly answer this exact question, with clear structure and attributable claims about ${client.business_name}, is far more likely to be extracted and cited than generic marketing copy.`

    const topicHint = `Write a post that directly answers "${gap.text}" and positions ${client.business_name} as the clear answer — structured so an AI engine would want to cite it.`

    try {
      const raw = await generate(buildBlogPrompt(clientForPrompt, sourceMaterial, topicHint))
      const { body: cleanBody, imageQuery } = extractImageQuery(raw)
      const title = extractTitle(cleanBody)
      const excerpt = cleanBody.replace(/[#*]/g, '').slice(0, 220).trim() + '…'

      db.prepare(`
        INSERT INTO content (id, client_id, type, title, body, excerpt, status, image_query, source, source_ref)
        VALUES (?, ?, 'blog', ?, ?, ?, 'draft', ?, 'citation-gap', ?)
      `).run(uuid(), client.id, title, cleanBody, excerpt, imageQuery, sourceRef)

      console.log(`[citation-gap-content] drafted "${title}" for gap query "${gap.text}" (${client.business_name})`)
      drafted++
    } catch (e: any) {
      console.error(`[citation-gap-content] failed to draft for gap "${gap.text}":`, e.message)
    }
  }

  return { drafted, skipped }
}
