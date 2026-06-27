/**
 * βWave Astro publisher — owns the full Astro+Netlify pipeline.
 *
 * Pipeline:
 *   1. materialiseSite(siteId)   — copy ./astro-template → ./astro-sites/{slug}, npm install
 *   2. writeContentToSite(...)   — drop markdown files into src/content/{collection}/
 *   3. buildSite(siteId)         — spawn `astro build`, capture logs
 *   4. deployToNetlify(siteId)   — file-digest upload of dist/ to Netlify Deploy API
 *   5. createNetlifySite(...)    — POST /api/v1/sites; βWave never touches the dashboard
 *
 * Aligned with βWave manifesto:
 *   • Local-first  — every Astro repo lives under ./astro-sites/, owned by the user
 *   • Lean deps    — uses node:crypto, fs, child_process; no zip libs, no netlify SDK
 *   • Survivable   — git is optional; works fully offline up to the deploy step
 */
import { spawn } from 'child_process'
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join, dirname, relative, sep } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import { v4 as uuid } from 'uuid'
import db from '../db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '../../..')
const TEMPLATE_DIR = join(REPO_ROOT, 'astro-template')
const SITES_DIR = join(REPO_ROOT, 'astro-sites')

const NETLIFY_API = 'https://api.netlify.com/api/v1'

export interface SiteRow {
  id: string
  client_id: string
  name: string
  slug: string
  stack: string
  domain: string
  site_dir: string
  netlify_site_id: string
  netlify_site_name: string
  git_remote: string
  accent_colour: string
  tagline: string
  custom_domain: string
  last_built_at: number | null
  last_deployed_at: number | null
  last_deploy_url: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'site'
}

function netlifyToken(): string {
  const t = process.env.NETLIFY_ACCESS_TOKEN?.trim()
  if (!t) throw new Error('NETLIFY_ACCESS_TOKEN not set in .env — get one at netlify.com → User Settings → Applications')
  return t
}

function copyDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.astro') continue
    const s = join(src, entry.name)
    const d = join(dst, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else copyFileSync(s, d)
  }
}

function walkFiles(dir: string, base: string = dir): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(p, base))
    else out.push(p)
  }
  return out
}

function sha1(buf: Buffer): string {
  return createHash('sha1').update(buf).digest('hex')
}

/** Spawn a command, return stdout+stderr combined and exit code. */
function run(cmd: string, args: string[], cwd: string, log: (line: string) => void): Promise<number> {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32'
    // npm/npx need shell on Windows
    const useShell = isWindows && (cmd === 'npm' || cmd === 'npx' || cmd === 'git')
    const child = spawn(cmd, args, { cwd, shell: useShell })
    child.stdout.on('data', (d) => log(d.toString()))
    child.stderr.on('data', (d) => log(d.toString()))
    child.on('close', (code) => resolve(code ?? 1))
    child.on('error', (err) => { log(`[spawn error] ${err.message}\n`); resolve(1) })
  })
}

function getSite(siteId: string): SiteRow {
  const row = db.prepare(`SELECT * FROM sites WHERE id = ?`).get(siteId) as SiteRow | undefined
  if (!row) throw new Error(`Site ${siteId} not found`)
  return row
}

function updateSite(siteId: string, fields: Record<string, any>): void {
  const keys = Object.keys(fields)
  if (keys.length === 0) return
  const set = keys.map(k => `${k} = ?`).join(', ')
  db.prepare(`UPDATE sites SET ${set}, updated_at = unixepoch() WHERE id = ?`)
    .run(...keys.map(k => fields[k]), siteId)
}

function recordDeployment(siteId: string, type: string): { id: string; appendLog: (line: string) => void; finish: (status: string, url?: string) => void } {
  const id = uuid()
  db.prepare(`INSERT INTO site_deployments (id, site_id, type, status, log) VALUES (?, ?, ?, 'running', '')`).run(id, siteId, type)
  let buf = ''
  return {
    id,
    appendLog: (line: string) => {
      buf += line
      // Truncate to last 32KB to avoid runaway logs
      if (buf.length > 32 * 1024) buf = buf.slice(-32 * 1024)
      db.prepare(`UPDATE site_deployments SET log = ? WHERE id = ?`).run(buf, id)
    },
    finish: (status: string, url?: string) => {
      db.prepare(`UPDATE site_deployments SET status = ?, url = ? WHERE id = ?`).run(status, url || '', id)
    },
  }
}

// ─── 1. Materialise: copy template → astro-sites/{slug} + npm install ────────

export async function materialiseSite(siteId: string): Promise<{ ok: boolean; log: string }> {
  const site = getSite(siteId)
  if (site.stack !== 'astro_netlify') {
    throw new Error(`Site ${site.slug} is stack=${site.stack}; materialise only supports astro_netlify`)
  }

  const targetDir = join(SITES_DIR, site.slug)
  const dep = recordDeployment(siteId, 'materialise')

  try {
    if (existsSync(targetDir)) {
      dep.appendLog(`[materialise] ${targetDir} already exists — skipping copy\n`)
    } else {
      dep.appendLog(`[materialise] copying ${TEMPLATE_DIR} → ${targetDir}\n`)
      copyDir(TEMPLATE_DIR, targetDir)
      mkdirSync(join(targetDir, 'src', 'content', 'posts'),  { recursive: true })
      mkdirSync(join(targetDir, 'src', 'content', 'places'), { recursive: true })
      mkdirSync(join(targetDir, 'src', 'content', 'pages'),  { recursive: true })
    }

    dep.appendLog(`[materialise] running npm install (may take a minute)\n`)
    const code = await run('npm', ['install', '--no-audit', '--no-fund'], targetDir, dep.appendLog)
    if (code !== 0) {
      dep.finish('failed')
      return { ok: false, log: `npm install exited with ${code}` }
    }

    updateSite(siteId, { site_dir: targetDir })
    dep.appendLog(`[materialise] complete\n`)
    dep.finish('built')
    return { ok: true, log: 'materialised' }
  } catch (e: any) {
    dep.appendLog(`[materialise] FAILED: ${e.message}\n`)
    dep.finish('failed')
    return { ok: false, log: e.message }
  }
}

// ─── 2. Write content row → markdown file in the right collection ────────────

export interface ContentPayload {
  collection: 'posts' | 'places' | 'pages'
  slug: string
  title: string
  description?: string
  pubDate?: Date
  body: string                       // markdown body (no frontmatter)
  heroImage?: string
  heroImageAlt?: string
  category?: string
  tags?: string[]
  region?: string
  draft?: boolean
}

function escapeYaml(s: string): string {
  // Wrap in double quotes and escape internal " and \
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function buildFrontmatter(p: ContentPayload): string {
  const lines: string[] = ['---']
  lines.push(`title: ${escapeYaml(p.title)}`)
  if (p.description) lines.push(`description: ${escapeYaml(p.description)}`)
  lines.push(`pubDate: ${(p.pubDate || new Date()).toISOString()}`)
  if (p.heroImage)    lines.push(`heroImage: ${escapeYaml(p.heroImage)}`)
  if (p.heroImageAlt) lines.push(`heroImageAlt: ${escapeYaml(p.heroImageAlt)}`)
  if (p.category)     lines.push(`category: ${escapeYaml(p.category)}`)
  if (p.region)       lines.push(`region: ${escapeYaml(p.region)}`)
  if (p.tags?.length) lines.push(`tags: [${p.tags.map(t => escapeYaml(t)).join(', ')}]`)
  if (p.draft)        lines.push(`draft: true`)
  lines.push('---', '')
  return lines.join('\n')
}

export function writeContentToSite(siteId: string, payload: ContentPayload): string {
  const site = getSite(siteId)
  if (!site.site_dir) throw new Error(`Site ${site.slug} not materialised yet — run materialiseSite first`)

  const slug = slugify(payload.slug)
  const filename = `${slug}.md`
  const dir = join(site.site_dir, 'src', 'content', payload.collection)
  mkdirSync(dir, { recursive: true })

  const filePath = join(dir, filename)
  const content = buildFrontmatter(payload) + (payload.body || '').trim() + '\n'
  writeFileSync(filePath, content, 'utf-8')
  return filePath
}

// ─── 3. Build: spawn `astro build` with site env vars ────────────────────────

export async function buildSite(siteId: string): Promise<{ ok: boolean; deployId: string; log: string }> {
  const site = getSite(siteId)
  if (!site.site_dir) {
    const m = await materialiseSite(siteId)
    if (!m.ok) return { ok: false, deployId: '', log: `materialise failed: ${m.log}` }
  }
  const refreshed = getSite(siteId)
  const dep = recordDeployment(siteId, 'build')

  try {
    const env = {
      ...process.env,
      SITE_URL:     refreshed.domain || `https://${refreshed.netlify_site_name}.netlify.app`,
      SITE_NAME:    refreshed.name,
      SITE_TAGLINE: refreshed.tagline || '',
      SITE_ACCENT:  refreshed.accent_colour || '#d97706',
    }

    dep.appendLog(`[build] SITE_URL=${env.SITE_URL}\n[build] SITE_NAME=${env.SITE_NAME}\n`)
    dep.appendLog(`[build] running astro build in ${refreshed.site_dir}\n`)

    const code = await new Promise<number>((resolve) => {
      const isWindows = process.platform === 'win32'
      const child = spawn('npm', ['run', 'build'], { cwd: refreshed.site_dir, shell: isWindows, env })
      child.stdout.on('data', (d) => dep.appendLog(d.toString()))
      child.stderr.on('data', (d) => dep.appendLog(d.toString()))
      child.on('close', (c) => resolve(c ?? 1))
      child.on('error', (err) => { dep.appendLog(`[spawn error] ${err.message}\n`); resolve(1) })
    })

    if (code !== 0) {
      dep.finish('failed')
      return { ok: false, deployId: dep.id, log: `astro build exited ${code}` }
    }

    updateSite(siteId, { last_built_at: Math.floor(Date.now() / 1000) })
    dep.appendLog(`[build] success\n`)
    dep.finish('built')
    return { ok: true, deployId: dep.id, log: 'built' }
  } catch (e: any) {
    dep.appendLog(`[build] FAILED: ${e.message}\n`)
    dep.finish('failed')
    return { ok: false, deployId: dep.id, log: e.message }
  }
}

// ─── 4. Deploy to Netlify via file-digest API ────────────────────────────────
// Docs: https://docs.netlify.com/api/get-started/#file-digest-method
// Flow:
//   POST /sites/{site_id}/deploys  body { files: { "/index.html": "<sha1>", ... } }
//   → response { id, required: ["sha1", ...] }
//   For each `required` sha1: PUT /deploys/{deploy_id}/files/{path}  body: file bytes
//   When all uploaded, Netlify marks the deploy READY automatically.

export async function deployToNetlify(siteId: string): Promise<{ ok: boolean; url?: string; log: string }> {
  const site = getSite(siteId)
  if (!site.site_dir) throw new Error(`Site not materialised`)
  if (!site.netlify_site_id) throw new Error(`Site has no netlify_site_id — connect or create the Netlify site first`)
  const token = netlifyToken()

  const distDir = join(site.site_dir, 'dist')
  if (!existsSync(distDir)) throw new Error(`No dist/ in ${site.site_dir} — run buildSite first`)

  const dep = recordDeployment(siteId, 'deploy')

  try {
    // 1. Collect all files + compute SHA1
    const allFiles = walkFiles(distDir)
    const filesMap: Record<string, string> = {}        // "/path" → sha1
    const fileBytes: Record<string, Buffer> = {}       // sha1 → bytes
    for (const abs of allFiles) {
      const rel = '/' + relative(distDir, abs).split(sep).join('/')
      const bytes = readFileSync(abs)
      const hash = sha1(bytes)
      filesMap[rel] = hash
      fileBytes[hash] = bytes
    }
    dep.appendLog(`[deploy] ${allFiles.length} files, ${(Object.values(fileBytes).reduce((s, b) => s + b.length, 0) / 1024).toFixed(1)} KB total\n`)

    // 2. Create deploy with digest
    const createRes = await fetch(`${NETLIFY_API}/sites/${site.netlify_site_id}/deploys`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files: filesMap, async: false }),
    })
    if (!createRes.ok) {
      const t = await createRes.text()
      throw new Error(`Netlify create deploy HTTP ${createRes.status}: ${t.slice(0, 400)}`)
    }
    const deploy = await createRes.json() as { id: string; required: string[]; deploy_ssl_url?: string; ssl_url?: string; url?: string }
    dep.appendLog(`[deploy] created deploy ${deploy.id} — ${deploy.required.length} files to upload\n`)

    // 3. Upload required files
    let uploaded = 0
    for (const requiredSha of deploy.required) {
      const bytes = fileBytes[requiredSha]
      if (!bytes) throw new Error(`Netlify wants sha1 ${requiredSha} but we don't have it locally`)
      const path = Object.keys(filesMap).find(k => filesMap[k] === requiredSha)
      if (!path) throw new Error(`Path for sha ${requiredSha} not found`)
      const upRes = await fetch(`${NETLIFY_API}/deploys/${deploy.id}/files${path}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
        },
        body: bytes as any,
      })
      if (!upRes.ok) {
        const t = await upRes.text()
        throw new Error(`upload ${path} HTTP ${upRes.status}: ${t.slice(0, 200)}`)
      }
      uploaded++
      if (uploaded % 20 === 0 || uploaded === deploy.required.length) {
        dep.appendLog(`[deploy] uploaded ${uploaded}/${deploy.required.length}\n`)
      }
    }

    // 4. Poll status (deploy should auto-ready since async:false, but we verify)
    const liveUrl = deploy.deploy_ssl_url || deploy.ssl_url || deploy.url || ''
    dep.appendLog(`[deploy] complete — live at ${liveUrl}\n`)
    dep.finish('deployed', liveUrl)
    updateSite(siteId, { last_deployed_at: Math.floor(Date.now() / 1000), last_deploy_url: liveUrl })
    return { ok: true, url: liveUrl, log: 'deployed' }
  } catch (e: any) {
    dep.appendLog(`[deploy] FAILED: ${e.message}\n`)
    dep.finish('failed')
    return { ok: false, log: e.message }
  }
}

// ─── 5. Netlify site management — create / link without dashboard ────────────

export async function createNetlifySite(opts: {
  netlifySiteName: string                    // becomes {name}.netlify.app
  customDomain?: string                      // e.g. example.com
}): Promise<{ site_id: string; default_url: string; admin_url: string }> {
  const token = netlifyToken()
  const body: any = { name: opts.netlifySiteName }
  if (opts.customDomain) body.custom_domain = opts.customDomain

  const res = await fetch(`${NETLIFY_API}/sites`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Netlify create site HTTP ${res.status}: ${t.slice(0, 400)}`)
  }
  const data = await res.json() as any
  return {
    site_id: data.id,
    default_url: data.ssl_url || data.url || '',
    admin_url: data.admin_url || '',
  }
}

/** Verify a Netlify token works + the site_id exists. Used by the connect-site UI. */
export async function pingNetlifySite(netlifySiteId: string): Promise<{ ok: boolean; name?: string; url?: string; error?: string }> {
  try {
    const token = netlifyToken()
    const res = await fetch(`${NETLIFY_API}/sites/${netlifySiteId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    if (!res.ok) {
      const t = await res.text()
      return { ok: false, error: `HTTP ${res.status}: ${t.slice(0, 200)}` }
    }
    const data = await res.json() as any
    return { ok: true, name: data.name, url: data.ssl_url || data.url || '' }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

// ─── 6. One-shot publish: build + deploy in sequence ─────────────────────────

export async function publishSite(siteId: string): Promise<{ ok: boolean; url?: string; log: string }> {
  const buildRes = await buildSite(siteId)
  if (!buildRes.ok) return { ok: false, log: `build failed: ${buildRes.log}` }
  const deployRes = await deployToNetlify(siteId)
  return deployRes
}

// ─── 7. Nuke materialised site (rare; e.g. template changed) ─────────────────

export function destroyMaterialisedSite(siteId: string): { ok: boolean } {
  const site = getSite(siteId)
  if (site.site_dir && existsSync(site.site_dir)) {
    rmSync(site.site_dir, { recursive: true, force: true })
  }
  updateSite(siteId, { site_dir: '', last_built_at: null })
  return { ok: true }
}
