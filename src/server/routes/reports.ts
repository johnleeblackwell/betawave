// @ts-nocheck
// Reports — niche lead-magnet products. Each report has a public landing page at
// aim.report/{niche} (served by the /r/:niche route in index.ts) where visitors
// drop an email to download the full HTML report.
import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { subscribeToKit } from '../services/kit.js'

const router = Router() as any

function toSlug(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// List reports (admin view). Filter by client_id.
router.get('/', (req, res) => {
  const { client_id } = req.query as { client_id?: string }
  const rows = client_id
    ? db.prepare('SELECT * FROM reports WHERE client_id = ? ORDER BY created_at DESC').all(client_id)
    : db.prepare('SELECT * FROM reports ORDER BY created_at DESC').all()
  // Don't send body_html over the wire in list view — keep it lean
  res.json(rows.map((r: any) => ({ ...r, body_html: undefined, body_md: undefined })))
})

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Report not found' })
  res.json(row)
})

router.post('/', (req, res) => {
  const { client_id, niche, title, subtitle, template_id } = req.body
  if (!niche || !title) return res.status(400).json({ error: 'niche and title are required' })
  const slug = toSlug(niche)
  if (!slug) return res.status(400).json({ error: 'niche must contain alphanumerics' })

  const existing = db.prepare('SELECT id FROM reports WHERE niche = ?').get(slug)
  if (existing) return res.status(409).json({ error: `Niche "${slug}" already exists` })

  const id = uuid()
  db.prepare(`
    INSERT INTO reports (id, client_id, niche, title, subtitle, template_id, status)
    VALUES (?, ?, ?, ?, ?, ?, 'draft')
  `).run(id, client_id || null, slug, title, subtitle || '', template_id || null)
  res.status(201).json(db.prepare('SELECT * FROM reports WHERE id = ?').get(id))
})

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id) as any
  if (!existing) return res.status(404).json({ error: 'Report not found' })
  const { title, subtitle, hero_copy, body_md, body_html, status, template_id } = req.body
  db.prepare(`
    UPDATE reports
    SET title = ?, subtitle = ?, hero_copy = ?, body_md = ?, body_html = ?, status = ?, template_id = ?, updated_at = unixepoch()
    WHERE id = ?
  `).run(
    title ?? existing.title,
    subtitle ?? existing.subtitle,
    hero_copy ?? existing.hero_copy,
    body_md ?? existing.body_md,
    body_html ?? existing.body_html,
    status ?? existing.status,
    template_id ?? existing.template_id,
    req.params.id
  )
  res.json(db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id))
})

// Flip published <-> draft with a one-shot toggle.
router.patch('/:id/publish', (req, res) => {
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id) as any
  if (!row) return res.status(404).json({ error: 'Report not found' })
  if (!row.body_html) return res.status(400).json({ error: 'Cannot publish: report body is empty. Generate it first.' })
  const next = row.status === 'published' ? 'draft' : 'published'
  db.prepare('UPDATE reports SET status = ?, updated_at = unixepoch() WHERE id = ?').run(next, req.params.id)
  res.json({ ...row, status: next })
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM reports WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// --- Convenience: kick off a report_generate job.
router.post('/:id/generate', (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id) as any
  if (!report) return res.status(404).json({ error: 'Report not found' })

  const template_id = req.body.template_id || report.template_id
  if (!template_id) return res.status(400).json({ error: 'template_id required (none set on report)' })

  // Remember the template chosen so regenerations don't need it re-specified.
  if (template_id !== report.template_id) {
    db.prepare('UPDATE reports SET template_id = ? WHERE id = ?').run(template_id, report.id)
  }

  const jobId = uuid()
  db.prepare(`
    INSERT INTO jobs (id, client_id, type, status, total, params)
    VALUES (?, ?, 'report_generate', 'pending', 1, ?)
  `).run(
    jobId,
    report.client_id,
    JSON.stringify({ report_id: report.id, template_id, extra_vars: req.body.extra_vars || {} })
  )
  res.status(201).json(db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId))
})

// --- Lead capture — called from the public landing page.
router.post('/:id/leads', async (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id) as any
  if (!report) return res.status(404).json({ error: 'Report not found' })

  const { email, name, source, consent_marketing } = req.body
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' })
  }

  const id = uuid()
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || ''
  const ua = (req.headers['user-agent'] as string) || ''

  db.prepare(`
    INSERT INTO report_leads (id, report_id, email, name, source, consent_marketing, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, report.id, email.toLowerCase().trim(), name || '', source || 'landing', consent_marketing === false ? 0 : 1, ip, ua)

  // Push to Kit — non-blocking for the lead-capture response, but we await
  // so kit_synced reflects reality and the front-end can display a toast.
  const kit = await subscribeToKit(email, {
    name,
    tags: [`report:${report.niche}`],
  })
  if (kit.ok) {
    db.prepare('UPDATE report_leads SET kit_synced = 1 WHERE id = ?').run(id)
  }

  res.status(201).json({
    id,
    download_url: `/r/${report.niche}/download?lead=${id}`,
    kit: kit.ok ? 'synced' : (kit.reason || 'not_synced'),
  })
})

// List leads for a report (admin view).
router.get('/:id/leads', (req, res) => {
  const rows = db.prepare(`
    SELECT id, email, name, source, kit_synced, consent_marketing, created_at
    FROM report_leads WHERE report_id = ? ORDER BY created_at DESC
  `).all(req.params.id)
  res.json(rows)
})

// CSV export of leads — one-click grab for manual platforms.
router.get('/:id/leads.csv', (req, res) => {
  const rows = db.prepare(`
    SELECT email, name, source, kit_synced, consent_marketing, created_at
    FROM report_leads WHERE report_id = ? ORDER BY created_at DESC
  `).all(req.params.id) as any[]

  const lines = ['email,name,source,kit_synced,consent_marketing,created_at']
  for (const r of rows) {
    const safeName = (r.name || '').replace(/"/g, '""')
    lines.push(`"${r.email}","${safeName}",${r.source},${r.kit_synced},${r.consent_marketing},${r.created_at}`)
  }
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename="leads-${req.params.id}.csv"`)
  res.send(lines.join('\n'))
})

export default router
