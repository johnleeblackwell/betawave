import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { checkClientPayload, effectiveBlockList, DEFAULT_BLOCKED_TOPICS } from '../services/compliance.js'

const router = Router()

// Shared row parser: expertise_areas + blocked_topics + modules_enabled are stored as JSON strings.
// DEFENSIVE: one malformed field in one row must never 500 the whole client list
// (it did on 2026-06-12 — a seed wrote blocked_topics as a plain comma string).
// Non-JSON strings degrade to a comma-split array; never throw.
function parseJsonArray(value: any): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : [String(parsed)]
  } catch {
    return String(value).split(',').map((s: string) => s.trim()).filter(Boolean)
  }
}
function parseClient(row: any) {
  if (!row) return row
  let modules_enabled: any = { produce: 1, reach: 1, respond: 1, measure: 1, affiliates: 0, shop: 0 }
  try { if (row.modules_enabled) modules_enabled = JSON.parse(row.modules_enabled) } catch { /* keep default */ }
  return {
    ...row,
    expertise_areas: parseJsonArray(row.expertise_areas),
    blocked_topics:  parseJsonArray(row.blocked_topics),
    modules_enabled,
  }
}

// Whitelist of fields the API accepts. Anything not in this list is ignored.
// Keeps POST/PUT future-proof when we add new client columns.
const WRITABLE_FIELDS = [
  // Identity
  'name', 'business_name', 'industry', 'location', 'contact_email',
  'primary_domain', 'logo_url', 'geography', 'time_zone',
  // Mission
  'mission', 'icp', 'offerings', 'brand_voice', 'never_say', 'always_say',
  // Module activation (JSON; serialised in writeFields)
  'modules_enabled',
  // Legacy content-tool fields (kept for backward compat)
  'tone_of_voice', 'target_audience', 'style_notes',
  'expertise_areas', 'blocked_topics',
  // Connectors — SMTP
  'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from',
  // Connectors — WordPress
  'wp_url', 'wp_username', 'wp_app_password', 'wp_post_status',
  // Image generation
  'image_source', 'image_keywords',
  // Discovery + LLM provider (already on table)
  'discovery_enabled', 'discovery_sender_email', 'discovery_sender_name',
  'discovery_whatsapp_number', 'daily_citation_budget_gbp',
  'llm_content_provider', 'llm_content_model', 'llm_content_api_key', 'llm_content_base_url',
] as const

const JSON_FIELDS = new Set(['expertise_areas', 'blocked_topics', 'modules_enabled'])

/** Extracts writable fields from req.body, JSON-stringifying the JSON ones. */
function writeFields(body: any): Record<string, any> {
  const out: Record<string, any> = {}
  for (const f of WRITABLE_FIELDS) {
    if (body[f] === undefined) continue
    out[f] = JSON_FIELDS.has(f) ? JSON.stringify(body[f]) : body[f]
  }
  return out
}

// List all clients
router.get('/', (_req, res) => {
  const clients = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM content WHERE client_id = c.id) as content_count,
      (SELECT COUNT(*) FROM sources WHERE client_id = c.id AND active = 1) as source_count,
      (SELECT COUNT(*) FROM citation_runs cr
        JOIN tracked_brands tb ON tb.id = cr.brand_id
        WHERE tb.client_id = c.id AND cr.status IN ('complete','partial')) as citation_run_count,
      (SELECT ROUND(100.0 * SUM(CASE WHEN res.brand_mentioned = 1 THEN 1 ELSE 0 END) / COUNT(*))
        FROM citation_results res
        JOIN citation_runs cr ON cr.id = res.run_id
        JOIN tracked_brands tb ON tb.id = cr.brand_id
        WHERE tb.client_id = c.id
          AND cr.id = (
            SELECT cr2.id FROM citation_runs cr2
            JOIN tracked_brands tb2 ON tb2.id = cr2.brand_id
            WHERE tb2.client_id = c.id AND cr2.status IN ('complete','partial')
            ORDER BY cr2.run_at DESC LIMIT 1
          )
          AND res.classified_at IS NOT NULL AND res.error = '') as citation_last_share
    FROM clients c
    ORDER BY c.created_at DESC
  `).all()
  res.json(clients.map(parseClient))
})

// Get single client
router.get('/:id', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id)
  if (!client) return res.status(404).json({ error: 'Not found' })
  res.json(parseClient(client))
})

// Default block list — exposed so the UI can show what will apply if the
// client leaves the field blank
router.get('/_meta/default-blocked-topics', (_req, res) => {
  res.json({ default_blocked_topics: DEFAULT_BLOCKED_TOPICS })
})

// Create client — minimum is name + business_name + industry. Everything else
// is configured later through module-specific UIs.
router.post('/', (req, res) => {
  const { name, business_name, industry } = req.body
  if (!name || !business_name || !industry) {
    return res.status(400).json({ error: 'name, business_name, and industry are required' })
  }

  // Compliance still runs if legacy fields are present in payload
  const blockList = effectiveBlockList(req.body.blocked_topics)
  const check = checkClientPayload({
    industry,
    expertise_areas: req.body.expertise_areas,
    style_notes: req.body.style_notes,
    target_audience: req.body.target_audience,
    business_name,
  }, blockList)
  if (!check.ok) {
    return res.status(422).json({
      error: `Compliance: "${check.topic}" detected in ${check.field}. This topic is blocked by the compliance filter. Remove it or adjust the client's blocked_topics list.`,
      field: check.field,
      topic: check.topic,
    })
  }

  const id = uuid()
  const fields = writeFields(req.body)
  fields.name = name
  fields.business_name = business_name
  fields.industry = industry

  const cols = Object.keys(fields)
  const placeholders = cols.map(() => '?').join(', ')
  const values = cols.map(c => fields[c])

  db.prepare(`INSERT INTO clients (id, ${cols.join(', ')}) VALUES (?, ${placeholders})`).run(id, ...values)
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id)
  res.status(201).json(parseClient(client))
})

// Update client — partial PATCH-style: only fields present in body are changed.
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id) as any
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const blockList = effectiveBlockList(req.body.blocked_topics ?? JSON.parse(existing.blocked_topics || '[]'))
  const check = checkClientPayload({
    industry:        req.body.industry        ?? existing.industry,
    expertise_areas: req.body.expertise_areas ?? JSON.parse(existing.expertise_areas || '[]'),
    style_notes:     req.body.style_notes     ?? existing.style_notes,
    target_audience: req.body.target_audience ?? existing.target_audience,
    business_name:   req.body.business_name   ?? existing.business_name,
  }, blockList)
  if (!check.ok) {
    return res.status(422).json({
      error: `Compliance: "${check.topic}" detected in ${check.field}. This topic is blocked by the compliance filter. Remove it or adjust the client's blocked_topics list.`,
      field: check.field,
      topic: check.topic,
    })
  }

  const fields = writeFields(req.body)
  if (Object.keys(fields).length === 0) {
    return res.json(parseClient(existing))
  }
  const setClause = Object.keys(fields).map(c => `${c} = ?`).join(', ')
  const values = Object.values(fields)
  values.push(req.params.id)
  db.prepare(`UPDATE clients SET ${setClause} WHERE id = ?`).run(...values)
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id)
  res.json(parseClient(client))
})

// Delete client
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// Fetch WordPress categories live from the client's WP site
router.get('/:id/wordpress/categories', async (req, res) => {
  try {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id) as any
    if (!client) return res.status(404).json({ error: 'Not found' })

    const wpUrl = (client.wp_url || '').replace(/\/$/, '')
    const wpUsername = client.wp_username
    const wpAppPassword = client.wp_app_password

    if (!wpUrl || !wpUsername || !wpAppPassword) {
      return res.status(400).json({ error: 'WordPress not configured for this client' })
    }

    const credentials = Buffer.from(`${wpUsername}:${wpAppPassword.replace(/\s/g, '')}`).toString('base64')

    const wpRes = await fetch(`${wpUrl}/wp-json/wp/v2/categories?per_page=100&orderby=name&order=asc`, {
      headers: { 'Authorization': `Basic ${credentials}` }
    })

    if (!wpRes.ok) {
      const err = await wpRes.json().catch(() => ({})) as any
      throw new Error(err.message || `WordPress API returned ${wpRes.status}`)
    }

    const categories = await wpRes.json() as any[]
    res.json(categories.map(c => ({ id: c.id, name: c.name, count: c.count, slug: c.slug })))
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to fetch categories' })
  }
})

export default router
