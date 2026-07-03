import { Router } from 'express'
import db from '../db.js'
import { buildSite as legacyBuildSite, getOrCreateSite } from '../services/site-builder.js'
import {
  materialiseSite,
  buildSite as astroBuild,
  deployToNetlify,
  publishSite,
  createNetlifySite,
  pingNetlifySite,
  writeContentToSite,
  destroyMaterialisedSite,
  type ContentPayload,
} from '../services/astro-publisher.js'

const router = Router({ mergeParams: true })

// GET /api/clients/:clientId/sites — current site config for this client
router.get('/', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const site = db.prepare('SELECT * FROM sites WHERE client_id = ?').get(clientId)
  if (!site) return res.json(null)
  res.json(site)
})

// PUT /api/clients/:clientId/sites — update site config (works for both stacks)
router.put('/', async (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const existing = db.prepare('SELECT * FROM sites WHERE client_id = ?').get(clientId) as any
  if (!existing) await getOrCreateSite(clientId)

  const editable = [
    'name', 'custom_domain', 'stack', 'domain', 'tagline', 'accent_colour',
    'netlify_site_id', 'netlify_site_name', 'git_remote', 'pseo_collection',
  ]
  const sets: string[] = []
  const vals: any[] = []
  for (const k of editable) {
    if (req.body[k] !== undefined) { sets.push(`${k} = ?`); vals.push(req.body[k]) }
  }
  if (sets.length > 0) {
    vals.push(clientId)
    db.prepare(`UPDATE sites SET ${sets.join(', ')}, updated_at = unixepoch() WHERE client_id = ?`).run(...vals)
  }
  res.json(db.prepare('SELECT * FROM sites WHERE client_id = ?').get(clientId))
})

// ─── Legacy EJS build (kept for existing sites) ────────────────────────────
router.post('/build', async (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const site = db.prepare('SELECT * FROM sites WHERE client_id = ?').get(clientId) as any
  if (site?.stack === 'astro_netlify') {
    return res.status(400).json({ ok: false, log: 'This is an astro_netlify site — use /publish instead' })
  }
  const result = await legacyBuildSite(clientId)
  if (result.ok) res.json({ ok: true, log: result.log, url: result.url })
  else res.status(500).json({ ok: false, log: result.log })
})

// ─── Astro + Netlify lifecycle ─────────────────────────────────────────────

// POST /api/clients/:clientId/sites/materialise — copy template + npm install
router.post('/materialise', async (req, res) => {
  try {
    const site = db.prepare('SELECT id FROM sites WHERE client_id = ?').get((req.params as any).clientId) as any
    if (!site) return res.status(404).json({ error: 'Site not found — configure it first' })
    const result = await materialiseSite(site.id)
    res.json(result)
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// POST /api/clients/:clientId/sites/publish — build + deploy in one shot
router.post('/publish', async (req, res) => {
  try {
    const site = db.prepare('SELECT id, stack FROM sites WHERE client_id = ?').get((req.params as any).clientId) as any
    if (!site) return res.status(404).json({ error: 'Site not found' })
    if (site.stack !== 'astro_netlify') return res.status(400).json({ error: 'Publish only works for astro_netlify stack' })
    const result = await publishSite(site.id)
    if (result.ok) res.json(result)
    else res.status(500).json(result)
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// POST /api/clients/:clientId/sites/build-only — astro build without deploy (for testing)
router.post('/build-only', async (req, res) => {
  try {
    const site = db.prepare('SELECT id FROM sites WHERE client_id = ?').get((req.params as any).clientId) as any
    if (!site) return res.status(404).json({ error: 'Site not found' })
    const result = await astroBuild(site.id)
    res.json(result)
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// POST /api/clients/:clientId/sites/deploy-only — deploy existing dist/ (for testing)
router.post('/deploy-only', async (req, res) => {
  try {
    const site = db.prepare('SELECT id FROM sites WHERE client_id = ?').get((req.params as any).clientId) as any
    if (!site) return res.status(404).json({ error: 'Site not found' })
    const result = await deployToNetlify(site.id)
    res.json(result)
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// POST /api/clients/:clientId/sites/netlify/create — create new Netlify site via API
router.post('/netlify/create', async (req, res) => {
  try {
    const { netlifySiteName, customDomain } = req.body
    if (!netlifySiteName) return res.status(400).json({ error: 'netlifySiteName required' })
    const result = await createNetlifySite({ netlifySiteName, customDomain })

    // Auto-attach to this client's site row
    const clientId = (req.params as any).clientId
    db.prepare(`
      UPDATE sites SET netlify_site_id = ?, netlify_site_name = ?, domain = ?, stack = 'astro_netlify'
      WHERE client_id = ?
    `).run(result.site_id, netlifySiteName, customDomain ? `https://${customDomain}` : result.default_url, clientId)

    res.json(result)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/clients/:clientId/sites/netlify/ping — verify netlify_site_id + token
router.post('/netlify/ping', async (req, res) => {
  try {
    const { netlifySiteId } = req.body
    if (!netlifySiteId) return res.status(400).json({ error: 'netlifySiteId required' })
    const result = await pingNetlifySite(netlifySiteId)
    res.json(result)
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// POST /api/clients/:clientId/sites/content — drop a content row into the Astro site
// Body: ContentPayload (collection + slug + title + body + ...)
router.post('/content', (req, res) => {
  try {
    const site = db.prepare('SELECT id FROM sites WHERE client_id = ?').get((req.params as any).clientId) as any
    if (!site) return res.status(404).json({ error: 'Site not found' })
    const payload = req.body as ContentPayload
    if (!payload.collection || !payload.slug || !payload.title) {
      return res.status(400).json({ error: 'collection, slug, title required' })
    }
    const path = writeContentToSite(site.id, payload)
    res.json({ ok: true, path })
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// POST /api/clients/:clientId/sites/destroy-local — nuke the materialised astro-sites/ dir
router.post('/destroy-local', (req, res) => {
  try {
    const site = db.prepare('SELECT id FROM sites WHERE client_id = ?').get((req.params as any).clientId) as any
    if (!site) return res.status(404).json({ error: 'Site not found' })
    res.json(destroyMaterialisedSite(site.id))
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// GET /api/clients/:clientId/sites/pseo — draft pSEO content rows available to publish
router.get('/pseo', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const rows = db.prepare(`
    SELECT id, title, excerpt, status, created_at FROM content
    WHERE client_id = ? AND type = 'pseo'
    ORDER BY created_at DESC
  `).all(clientId)
  res.json(rows)
})

// POST /api/clients/:clientId/sites/pseo-publish — write selected pSEO rows into
// the site's configured collection, build, and deploy. Body: { contentIds: string[], live?: boolean }
// SAFE BY DEFAULT: deploys as a draft preview unless `live: true` is explicitly sent.
router.post('/pseo-publish', async (req, res) => {
  try {
    const { clientId } = req.params as { clientId: string }
    const { contentIds, live } = req.body as { contentIds: string[]; live?: boolean }
    if (!Array.isArray(contentIds) || contentIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'contentIds required' })
    }

    const site = db.prepare('SELECT * FROM sites WHERE client_id = ?').get(clientId) as any
    if (!site) return res.status(404).json({ ok: false, error: 'Site not found' })
    if (site.stack !== 'astro_netlify') {
      return res.status(400).json({ ok: false, error: 'pSEO publish only works for astro_netlify sites' })
    }
    if (!site.site_dir) {
      return res.status(400).json({ ok: false, error: 'Site not materialised yet — run materialise first' })
    }

    const collection = (site.pseo_collection || 'posts') as ContentPayload['collection']
    const written: string[] = []
    for (const id of contentIds) {
      const row = db.prepare(`SELECT id, title, body, excerpt FROM content WHERE id = ? AND client_id = ?`).get(id, clientId) as any
      if (!row) continue
      writeContentToSite(site.id, {
        collection,
        slug: row.title,
        title: row.title,
        description: row.excerpt || '',
        pubDate: new Date(),
        body: row.body,
      })
      written.push(row.id)
    }

    if (written.length === 0) return res.status(400).json({ ok: false, error: 'No matching content rows found' })

    const b = await astroBuild(site.id)
    if (!b.ok) return res.status(500).json({ ok: false, error: `Build failed: ${b.log}` })

    const d = await deployToNetlify(site.id, { draft: !live })
    if (!d.ok) return res.status(500).json({ ok: false, error: `Deploy failed: ${d.log}` })

    if (d.production) {
      for (const id of written) db.prepare(`UPDATE content SET status = 'published' WHERE id = ?`).run(id)
    }

    res.json({ ok: true, written: written.length, production: !!d.production, url: d.url })
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// GET /api/clients/:clientId/sites/deployments — deployment history
router.get('/deployments', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const site = db.prepare('SELECT id FROM sites WHERE client_id = ?').get(clientId) as any
  if (!site) return res.json([])
  const deployments = db.prepare(`
    SELECT * FROM site_deployments WHERE site_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(site.id)
  res.json(deployments)
})

export default router
