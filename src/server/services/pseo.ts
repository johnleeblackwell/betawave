// @ts-nocheck
// pSEO worker — processes pseo_batch jobs. Each job renders a template across
// a list of locations, generates the page via Claude, saves to content, and
// optionally auto-publishes to WordPress.
//
// Job params shape (set by POST /api/jobs/pseo convenience route):
// {
//   template_id: string,
//   location_ids: string[],     // ordered; progress advances through this list
//   extra_vars?: Record<string,string>,  // additional {var} values beyond client/location
//   wp_publish?: boolean,
//   wp_post_status?: 'draft' | 'publish' | 'private',
//   wp_category_id?: number,
// }
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { getClient } from './claude.js'
import { complianceGuardPrompt, effectiveBlockList } from './compliance.js'
import { getImageForPost, uploadImageToWordPress } from './images.js'

// --- Claude call (non-streaming) ---
async function generateBatch(prompt: string): Promise<string> {
  const response = await getClient().messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    thinking: { type: 'adaptive' } as any,
    messages: [{ role: 'user', content: prompt }]
  })
  return response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
}

// --- Helpers ---
function extractTitle(text: string): string {
  const match = text.match(/^#\s+(.+)/m)
  return match ? match[1].trim() : text.split('\n')[0].slice(0, 80).trim()
}

function extractImageQuery(text: string): { body: string; imageQuery: string } {
  const match = text.match(/\nIMAGE_QUERY:\s*(.+)$/m)
  if (!match) return { body: text.trim(), imageQuery: '' }
  return { body: text.slice(0, match.index).trim(), imageQuery: match[1].trim() }
}

function cleanTitleForSearch(title: string): string {
  const stopWords = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','is','are','was','were','that','this','how','why','what','when','where','who','will','can','your','our','their'])
  return title.replace(/[^\w\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()))
    .slice(0, 4).join(' ')
}

function markdownToHtml(md: string): string {
  return `<!DOCTYPE html><html><head><style>
    body { font-family: Georgia, serif; max-width: 680px; margin: 40px auto; color: #1a1a2e; line-height: 1.7; padding: 0 20px; }
    h1 { color: #0f172a; font-size: 2em; margin-bottom: 8px; }
    h2 { color: #1e3a5f; font-size: 1.3em; margin-top: 2em; border-bottom: 2px solid #d97706; padding-bottom: 4px; }
    p { margin: 1em 0; } strong { color: #0f172a; } a { color: #d97706; }
  </style></head><body>` +
    md.replace(/^# (.+)$/m, '<h1>$1</h1>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(?!<[h|p])(.+)$/gm, '<p>$1</p>')
    + '</body></html>'
}

// Substitute {variable} placeholders in a template string.
function renderTemplate(tpl: string, values: Record<string, string>): string {
  return tpl.replace(/\{([a-z0-9_]+)\}/gi, (m, key) => {
    const v = values[key.toLowerCase()]
    return v !== undefined && v !== '' ? v : m // leave unresolved placeholders visible
  })
}

// Build the full prompt for a pSEO page: templated body + compliance guard.
function buildPseoPrompt(template: any, client: any, location: any, extraVars: Record<string, string>): string {
  const values: Record<string, string> = {
    location: location.name,
    location_name: location.name,
    location_slug: location.slug,
    region: location.region || '',
    country: location.country || '',
    business: client.business_name,
    business_name: client.business_name,
    industry: client.industry,
    tone: client.tone_of_voice,
    audience: client.target_audience,
    ...extraVars,
  }
  const rendered = renderTemplate(template.prompt_template, values)

  const guard = complianceGuardPrompt(effectiveBlockList(client.blocked_topics))

  // Append format instructions so output is usable without further parsing.
  return `${rendered}

FORMAT:
- First line: # [Compelling, location-specific title]
- Short intro paragraph
- 3–4 sections with ## subheadings
- Short, readable paragraphs (2–4 sentences)
- Very last line: IMAGE_QUERY: [2–4 words for a relevant stock photo]

Write only the page followed by the IMAGE_QUERY line. No preamble.${guard}`
}

// --- Publish one generated page to WordPress ---
async function publishToWordPress(
  client: any,
  body: string,
  title: string,
  excerpt: string,
  imageQuery: string,
  wpStatus: string,
  wpCategoryId: number
): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!client.wp_url || !client.wp_username || !client.wp_app_password) {
    return { ok: false, error: 'WordPress not configured' }
  }
  const wpUrl = client.wp_url.replace(/\/$/, '')
  const credentials = Buffer.from(`${client.wp_username}:${client.wp_app_password.replace(/\s/g, '')}`).toString('base64')
  const html = markdownToHtml(body)

  let featuredMediaId: number | null = null
  const imageSource = client.image_source || 'auto'
  if (imageSource !== 'none') {
    try {
      const query = imageQuery || client.image_keywords || cleanTitleForSearch(title)
      const image = await getImageForPost({ title, industry: client.industry, excerpt, imageSource, searchQuery: query })
      if (image) {
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
        featuredMediaId = await uploadImageToWordPress(image, slug, wpUrl, credentials)
      }
    } catch { /* image failure shouldn't block publish */ }
  }

  const res = await fetch(`${wpUrl}/wp-json/wp/v2/posts`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      content: html,
      excerpt: excerpt.replace(/…$/, ''),
      status: wpStatus,
      ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
      ...(wpCategoryId ? { categories: [wpCategoryId] } : {})
    })
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any
    return { ok: false, error: err.message || `HTTP ${res.status}` }
  }
  const data = await res.json() as any
  return { ok: true, url: data?.link }
}

// ─── Next-Gen pSEO: AI-Signal (GEO) ──────────────────────────────────────────
// Generate answer pages optimised to be CITED by AI assistants, seeded from the
// citation tracker's queries. See docs/PSEO-AI-SIGNAL.md. Closes the loop:
// measure (citation tracker) → generate for the gaps → publish → re-measure.

function clientExpertise(client: any): string {
  try { const a = JSON.parse(client.expertise_areas || '[]'); return Array.isArray(a) ? a.join(', ') : '' } catch { return '' }
}

function buildJsonLd(client: any, question: string, answer: string): string {
  const org: any = {
    '@context': 'https://schema.org', '@type': 'Organization',
    name: client.business_name,
    ...(client.industry ? { description: client.industry } : {}),
    ...(client.location ? { areaServed: client.location } : {}),
    ...(client.wp_url ? { url: client.wp_url } : {}),
    ...(clientExpertise(client) ? { knowsAbout: clientExpertise(client).split(', ') } : {}),
  }
  const faq = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: [{ '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer } }],
  }
  return `<script type="application/ld+json">${JSON.stringify([org, faq])}</script>`
}

/** One citation-optimised answer page for a single AI query. */
/** Hard compliance frame for health/medical (esp. prescription-only-medicine) topics.
 *  GLP-1 RAs are POMs — illegal to advertise to the public in the UK. Educational only. */
function medicalEducationalGuard(businessName: string): string {
  return `

MEDICAL COMPLIANCE (UK MHRA / ASA — NON-NEGOTIABLE, overrides all else):
- GLP-1 receptor agonists are PRESCRIPTION-ONLY MEDICINES (POMs). It is ILLEGAL to advertise or promote POMs to the public. Do NOT promote, sell, or drive demand for any medication.
- ${businessName} does NOT sell, supply, prescribe, or recommend any medication or supplement. NEVER state or imply that it does. Frame ${businessName} ONLY as an educational source ("the ${businessName} Protocol Library"), never as a product, vendor, clinic, or service.
- This is GENERAL EDUCATION, NOT medical advice. Never tell the reader to start, stop, dose, switch, or buy any medication. Defer all clinical specifics to "a qualified clinician or doctor".
- Do NOT name specific sellers, pharmacies, or brand-name drugs as recommendations. Do NOT make efficacy guarantees or superlatives. Be accurate, balanced, and non-alarmist; state that individual cases vary and suitability is a clinical decision.`
}

async function generateAiSignalPage(client: any, query: string, educational = false): Promise<{ body: string; imageQuery: string }> {
  const guard = complianceGuardPrompt(effectiveBlockList(client.blocked_topics))
  if (educational) {
    const medGuard = medicalEducationalGuard(client.business_name)
    const eduPrompt = `You are writing an EDUCATIONAL web page for ${client.business_name}, an educational protocol library on metabolic health and GLP-1 medications. Its ONLY purpose is to be RETRIEVED AND CITED by AI assistants (ChatGPT, Claude, Perplexity, Gemini) when a user asks the question below. This is Generative Engine Optimisation.

USER'S QUESTION TO THE AI: "${query}"

WRITE TO MAXIMISE CITATION (within the medical compliance frame below):
1. ANSWER-FIRST — the first paragraph is a direct, self-contained, quotable, ACCURATE answer (2–4 sentences) an AI can lift verbatim; where the question is clinical, end it by deferring to a clinician.
2. EVIDENCE-LED & SPECIFIC — concrete, checkable, balanced; never overstate. If evidence is mixed or individual, say so.
3. STRUCTURE — 3–5 short sections with ## subheads, then a final "## FAQ" with 2–3 Q&As.
4. SAFETY QUESTIONS (who-shouldn't, risks, side effects, contraindications) — be especially careful, calm and non-alarmist; stress that suitability and risk are clinical decisions made with a doctor.
5. Plain, authoritative, factual tone — never salesy, never promotional.

FORMAT:
- First line: # ${query}
- Then the answer-first paragraph, the sections, and the FAQ.
- Final line: IMAGE_QUERY: [2-4 words]
Write only the page followed by the IMAGE_QUERY line. No preamble.${medGuard}${guard}`
    const rawEdu = await generateBatch(eduPrompt)
    const out = extractImageQuery(rawEdu)
    // Belt-and-braces: ensure the mandatory educational disclaimer is present in the body.
    if (!/not medical advice/i.test(out.body)) {
      out.body += `\n\n> ⚠ **Educational information only — not medical advice.** GLP-1 medications are prescription-only. ${client.business_name} does not sell, supply, prescribe, or recommend any medication. Always consult a qualified doctor before making decisions about your health or medication.`
    }
    return out
  }
  const prompt = `You are writing a web page whose ONLY purpose is to be RETRIEVED AND CITED by AI assistants (ChatGPT, Claude, Perplexity, Gemini) when a user asks the question below. This is Generative Engine Optimisation, not keyword SEO.

USER'S QUESTION TO THE AI: "${query}"

BUSINESS to represent TRUTHFULLY (feature where it genuinely fits the answer — never invent superlatives, awards, or facts):
- Name: ${client.business_name}
- Industry: ${client.industry}
- Area / locations: ${client.location || 'UK'}
- Known for: ${clientExpertise(client) || client.industry}
- Audience: ${client.target_audience || ''}

WRITE TO MAXIMISE CITATION:
1. ANSWER-FIRST — the very first paragraph is a direct, self-contained, quotable answer (2–4 sentences) an AI can lift verbatim and have it stand alone.
2. SPECIFICS — concrete, checkable facts: numbers, named places, styles, selection criteria. Specific beats vague every time.
3. STRUCTURE — then 3–5 short sections with ## subheads (e.g. how to choose, what to look for, notable options/locations) and a final "## FAQ" with 2–3 Q&As.
4. HONEST — position ${client.business_name} accurately and prominently where it truthfully fits (e.g. "one of the region's largest multi-branch operators, with locations nationwide"); do NOT fabricate "#1/best/award-winning" claims.
5. Plain, authoritative, factual tone — not salesy.

FORMAT:
- First line: # ${query}
- Then the answer-first paragraph, the sections, and the FAQ.
- Final line: IMAGE_QUERY: [2-4 words]
Write only the page followed by the IMAGE_QUERY line. No preamble.${guard}`
  const raw = await generateBatch(prompt)
  return extractImageQuery(raw)
}

/** Batch: generate AI-signal answer pages for a client's tracked citation queries. */
export async function runAiSignalForClient(
  clientId: string,
  limit = 5,
  opts: { node?: string; educational?: boolean } = {},
): Promise<{ created: number; skipped: number; educational: boolean; node: string | null; items: any[] }> {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId) as any
  if (!client) throw new Error('client not found')
  const brand = db.prepare('SELECT id FROM tracked_brands WHERE client_id = ?').get(clientId) as any
  if (!brand) throw new Error('No tracked brand — set up Citation tracking first (it seeds the questions).')
  // Decision-Architecture node targeting: generate Choice-Point Content for one committee seat.
  const node = (opts.node || '').trim()
  const queries = (node
    ? db.prepare('SELECT text, da_node FROM tracked_queries WHERE brand_id = ? AND active = 1 AND da_node = ? ORDER BY priority ASC, created_at ASC LIMIT ?').all(brand.id, node, limit)
    : db.prepare('SELECT text, da_node FROM tracked_queries WHERE brand_id = ? AND active = 1 ORDER BY priority ASC, created_at ASC LIMIT ?').all(brand.id, limit)
  ) as any[]
  // Safety default: health/medical clients ALWAYS get the compliant educational generator.
  const educational = opts.educational ??
    /glp|metabol|prescription|medication|nutraceutical|supplement|health\s*&\s*wellness|weight\s*loss|peptide|pharma|clinic/i.test(`${client.industry || ''} ${client.business_name || ''}`)

  let created = 0, skipped = 0
  const items: any[] = []
  for (const q of queries) {
    if (db.prepare(`SELECT 1 FROM content WHERE client_id = ? AND type = 'pseo' AND title = ?`).get(clientId, q.text)) { skipped++; continue }
    try {
      const { body, imageQuery } = await generateAiSignalPage(client, q.text, educational)
      const title = extractTitle(body) || q.text
      const answer = body.replace(/^#.*$/m, '').trim().split('\n\n')[0].replace(/[#*]/g, '').trim().slice(0, 500)
      const bodyWithSchema = `${body}\n\n${buildJsonLd(client, q.text, answer)}`
      const id = uuid()
      db.prepare(`INSERT INTO content (id, client_id, type, title, body, excerpt, status, image_query) VALUES (?,?,'pseo',?,?,?,'draft',?)`)
        .run(id, clientId, title, bodyWithSchema, answer.slice(0, 200), imageQuery)
      created++; items.push({ id, title, query: q.text, node: q.da_node || null })
      console.log(`[pseo-ai] generated ${educational ? 'EDUCATIONAL ' : ''}answer page for "${q.text}"${node ? ` [node:${node}]` : ''}`)
    } catch (e: any) {
      console.warn(`[pseo-ai] failed for "${q.text}": ${e.message}`)
    }
  }
  return { created, skipped, educational, node: node || null, items }
}

// --- Main worker ---
export async function runPseoJob(jobId: string): Promise<void> {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any
  if (!job) throw new Error(`Job ${jobId} not found`)
  if (job.status !== 'pending') {
    console.log(`[pseo] Job ${jobId} already ${job.status}, skipping`)
    return
  }

  const params = JSON.parse(job.params || '{}')
  const { template_id, location_ids = [], extra_vars = {}, wp_publish = false, wp_post_status = 'draft', wp_category_id = 0 } = params

  // Transition to running
  db.prepare(`UPDATE jobs SET status = 'running', started_at = unixepoch(), total = ? WHERE id = ?`)
    .run(location_ids.length, jobId)

  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(template_id) as any
  if (!template) {
    db.prepare(`UPDATE jobs SET status = 'failed', error = ?, completed_at = unixepoch() WHERE id = ?`)
      .run(`Template ${template_id} not found`, jobId)
    return
  }

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(job.client_id) as any
  if (!client) {
    db.prepare(`UPDATE jobs SET status = 'failed', error = ?, completed_at = unixepoch() WHERE id = ?`)
      .run(`Client ${job.client_id} not found`, jobId)
    return
  }
  client.expertise_areas = JSON.parse(client.expertise_areas || '[]')
  client.blocked_topics = JSON.parse(client.blocked_topics || '[]')

  const results: any[] = []
  let completed = 0
  let failed = 0

  for (const locationId of location_ids) {
    // Cancellation check — bail early if user cancelled mid-run
    const current = db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId) as any
    if (current?.status === 'cancelled') {
      console.log(`[pseo] Job ${jobId} cancelled after ${completed} of ${location_ids.length}`)
      return
    }

    const location = db.prepare('SELECT * FROM locations WHERE id = ?').get(locationId) as any
    if (!location) {
      failed++
      results.push({ location_id: locationId, ok: false, error: 'Location not found' })
      db.prepare(`UPDATE jobs SET completed = ?, failed = ?, result = ? WHERE id = ?`)
        .run(completed, failed, JSON.stringify({ items: results }), jobId)
      continue
    }

    try {
      const prompt = buildPseoPrompt(template, client, location, extra_vars)
      const raw = await generateBatch(prompt)
      const { body, imageQuery } = extractImageQuery(raw)

      // Compliance sentinel check — model may refuse
      if (body.startsWith('COMPLIANCE_BLOCK:')) {
        failed++
        results.push({ location_id: locationId, location: location.name, ok: false, error: body.slice(0, 120) })
        db.prepare(`UPDATE jobs SET completed = ?, failed = ?, result = ? WHERE id = ?`)
          .run(completed, failed, JSON.stringify({ items: results }), jobId)
        continue
      }

      const title = extractTitle(body)
      const excerpt = body.replace(/[#*]/g, '').slice(0, 220).trim() + '…'
      const contentId = uuid()

      db.prepare(`
        INSERT INTO content (id, client_id, type, title, body, excerpt, status, image_query)
        VALUES (?, ?, 'pseo', ?, ?, ?, 'draft', ?)
      `).run(contentId, client.id, title, body, excerpt, imageQuery)

      let wpResult: any = null
      if (wp_publish) {
        wpResult = await publishToWordPress(client, body, title, excerpt, imageQuery, wp_post_status, wp_category_id)
        if (wpResult.ok) {
          db.prepare("UPDATE content SET status = 'published' WHERE id = ?").run(contentId)
        }
      }

      completed++
      results.push({
        location_id: locationId,
        location: location.name,
        content_id: contentId,
        title,
        ok: true,
        wp: wpResult,
      })
      console.log(`[pseo] ${completed}/${location_ids.length} — ${location.name} → "${title}"`)
    } catch (err: any) {
      failed++
      results.push({ location_id: locationId, location: location.name, ok: false, error: err.message || String(err) })
      console.error(`[pseo] Failed for ${location.name}: ${err.message}`)
    }

    // Persist progress every iteration so the UI can show live counters
    db.prepare(`UPDATE jobs SET completed = ?, failed = ?, result = ? WHERE id = ?`)
      .run(completed, failed, JSON.stringify({ items: results }), jobId)
  }

  const finalStatus = failed > 0 && completed === 0 ? 'failed' : 'complete'
  db.prepare(`UPDATE jobs SET status = ?, completed_at = unixepoch(), result = ? WHERE id = ?`)
    .run(finalStatus, JSON.stringify({ items: results, completed, failed }), jobId)
  console.log(`[pseo] Job ${jobId} ${finalStatus} — ${completed} ok, ${failed} failed`)
}
