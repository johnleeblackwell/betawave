// @ts-nocheck
// Locations — per-client geo entries used for pSEO batches (e.g. a chain's 13 location cities).
import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'

const router = Router({ mergeParams: true }) as any

// Generate a URL-safe slug from a name, falling back to a random suffix for collisions.
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function parseRow(r: any) {
  return { ...r, meta: JSON.parse(r.meta || '{}') }
}

router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM locations WHERE client_id = ? ORDER BY name ASC'
  ).all(req.params.clientId)
  res.json(rows.map(parseRow))
})

router.post('/', (req, res) => {
  const { name, slug, region, country, lat, lng, meta } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })

  // Accept supplied slug, otherwise derive from name. If the derived slug already
  // exists for this client, append a short random suffix to keep the UNIQUE constraint happy.
  let finalSlug = (slug && toSlug(slug)) || toSlug(name)
  const existing = db.prepare(
    'SELECT 1 FROM locations WHERE client_id = ? AND slug = ?'
  ).get(req.params.clientId, finalSlug)
  if (existing) finalSlug = `${finalSlug}-${Math.random().toString(36).slice(2, 6)}`

  const id = uuid()
  db.prepare(`
    INSERT INTO locations (id, client_id, name, slug, region, country, lat, lng, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.params.clientId,
    name,
    finalSlug,
    region || '',
    country || 'UK',
    lat ?? null,
    lng ?? null,
    JSON.stringify(meta || {})
  )
  res.status(201).json(parseRow(db.prepare('SELECT * FROM locations WHERE id = ?').get(id)))
})

// Bulk import — accepts { items: [{ name, region?, country?, meta? }, ...] }.
// Primary use case: paste-in a list of location cities in one shot.
router.post('/bulk', (req, res) => {
  const items = (req.body?.items || []) as any[]
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'items array is required' })
  }
  const created: any[] = []
  const skipped: string[] = []
  const insert = db.prepare(`
    INSERT INTO locations (id, client_id, name, slug, region, country, lat, lng, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const slugTaken = db.prepare('SELECT 1 FROM locations WHERE client_id = ? AND slug = ?')

  for (const item of items) {
    if (!item?.name) { skipped.push('(unnamed)'); continue }
    let slug = toSlug(item.slug || item.name)
    if (slugTaken.get(req.params.clientId, slug)) {
      slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`
    }
    const id = uuid()
    insert.run(
      id,
      req.params.clientId,
      item.name,
      slug,
      item.region || '',
      item.country || 'UK',
      item.lat ?? null,
      item.lng ?? null,
      JSON.stringify(item.meta || {})
    )
    created.push({ id, name: item.name, slug })
  }
  res.status(201).json({ created, skipped, total_created: created.length })
})

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Location not found' })
  const { name, slug, region, country, lat, lng, meta, active } = req.body
  db.prepare(`
    UPDATE locations
    SET name = ?, slug = ?, region = ?, country = ?, lat = ?, lng = ?, meta = ?, active = ?
    WHERE id = ?
  `).run(
    name ?? (existing as any).name,
    slug ? toSlug(slug) : (existing as any).slug,
    region ?? (existing as any).region,
    country ?? (existing as any).country,
    lat ?? (existing as any).lat,
    lng ?? (existing as any).lng,
    meta !== undefined ? JSON.stringify(meta) : (existing as any).meta,
    active !== undefined ? (active ? 1 : 0) : (existing as any).active,
    req.params.id
  )
  res.json(parseRow(db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id)))
})

router.patch('/:id/toggle', (req, res) => {
  db.prepare('UPDATE locations SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?').run(req.params.id)
  const row = db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id)
  res.json(parseRow(row))
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM locations WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router
