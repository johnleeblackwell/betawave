import { Router } from 'express'
import { join } from 'path'
import { existsSync } from 'fs'
import db from '../db.js'

const router = Router()

// Serve built static sites at /site/:slug/*
router.get('/:slug/*', (req, res) => {
  const { slug, 0: filePath } = req.params as { slug: string; 0?: string }
  serveFile(slug, filePath || 'index.html', res)
})

router.get('/:slug', (req, res) => {
  const { slug } = req.params
  serveFile(slug, 'index.html', res)
})

function serveFile(slug: string, relativePath: string, res: any) {
  try {
    const site = db.prepare('SELECT * FROM sites WHERE slug = ?').get(slug) as any
    if (!site || !existsSync(site.build_output_path)) {
      return res.status(404).type('html').send(`
        <!DOCTYPE html><html><head><title>Not Found</title>
        <style>body{font-family:system-ui;padding:40px;text-align:center;color:#64748b}
        h1{font-size:2rem;color:#1e293b}</style></head>
        <body><h1>Site Not Found</h1><p>This site has not been built yet.</p>
        <p><a href="/" style="color:#2563eb">Go to Dashboard</a></p></body></html>
      `)
    }

    const fullPath = join(site.build_output_path, relativePath)
    if (!existsSync(fullPath)) {
      return res.status(404).send('Not found')
    }

    const ext = relativePath.split('.').pop()?.toLowerCase()
    const mimeTypes: Record<string, string> = {
      html: 'text/html',
      xml: 'application/xml',
      css: 'text/css',
      js: 'application/javascript',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      json: 'application/json',
      txt: 'text/plain',
    }
    res.type(mimeTypes[ext || ''] || 'application/octet-stream')
    res.sendFile(fullPath)
  } catch (err) {
    res.status(500).send('Internal server error')
  }
}

export default router
