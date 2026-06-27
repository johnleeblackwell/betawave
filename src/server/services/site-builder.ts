import ejs from 'ejs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { v4 as uuid } from 'uuid'
import db from '../db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BUILDS_DIR = join(__dirname, '../../../site-builds')

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'site'
}

function markdownToHtml(md: string): string {
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  html = html.replace(/^\- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
  html = html.replace(/\n\n/g, '</p><p>')
  html = html.replace(/^(?!<[hupb])/m, '<p>')
  html = '<p>' + html + '</p>'
  html = html.replace(/<p>\s*<\/p>/g, '')
  return html
}

function stripMd(md: string): string {
  return md.replace(/[#*[\]>!|]/g, '').replace(/\([^)]*\)/g, '').trim()
}

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  })
}

interface SiteConfig {
  id: string
  client_id: string
  name: string
  slug: string
  custom_domain: string
  template_id: string | null
  status: string
  build_output_path: string
  last_built_at: number | null
  last_deployed_at: number | null
}

interface ContentRow {
  id: string
  client_id: string
  type: string
  title: string
  body: string
  excerpt: string
  status: string
  image_query: string
  created_at: number
}

interface ClientRow {
  id: string
  name: string
  business_name: string
  industry: string
  [key: string]: any
}

export async function getOrCreateSite(clientId: string): Promise<SiteConfig> {
  let site = db.prepare('SELECT * FROM sites WHERE client_id = ?').get(clientId) as SiteConfig | undefined
  if (!site) {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId) as unknown as ClientRow | undefined
    const slug = slugify(client?.business_name || client?.name || 'site')
    const id = uuid()
    const outputPath = join(BUILDS_DIR, slug)
    db.prepare(`
      INSERT INTO sites (id, client_id, name, slug, build_output_path, status)
      VALUES (?, ?, 'Website', ?, ?, 'draft')
    `).run(id, clientId, slug, outputPath)
    site = db.prepare('SELECT * FROM sites WHERE client_id = ?').get(clientId) as unknown as SiteConfig
  }
  return site!
}

export async function buildSite(clientId: string): Promise<{ ok: boolean; log: string; url?: string }> {
  const site = await getOrCreateSite(clientId)
  const deploymentId = uuid()
  db.prepare(`
    INSERT INTO site_deployments (id, site_id, type, status, log)
    VALUES (?, ?, 'build', 'building', '')
  `).run(deploymentId, site.id)

  const log: string[] = []

  try {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId) as unknown as ClientRow | undefined
    if (!client) throw new Error('Client not found')

    log.push(`Building site for ${client.business_name}...`)

    const contentRows = db.prepare(`
      SELECT * FROM content WHERE client_id = ? ORDER BY created_at DESC
    `).all(clientId) as unknown as ContentRow[]

    log.push(`Found ${contentRows.length} content items`)

    const blogPosts = contentRows.filter(c => c.type === 'blog')
    const newsletters = contentRows.filter(c => c.type === 'newsletter')

    log.push(`  ${blogPosts.length} blog posts, ${newsletters.length} newsletters`)

    const defaultTemplatePath = join(__dirname, 'site-templates', 'default.ejs')
    const postTemplatePath = join(__dirname, 'site-templates', 'post.ejs')
    const defaultTemplate = readFileSync(defaultTemplatePath, 'utf-8')
    const postTemplate = readFileSync(postTemplatePath, 'utf-8')

    const templateContent = site.template_id
      ? (db.prepare('SELECT ejs_content FROM site_templates WHERE id = ?').get(site.template_id) as any)?.ejs_content || defaultTemplate
      : defaultTemplate

    const siteName = site.name
    const businessName = client.business_name
    const description = `${businessName} — ${client.industry}`
    const tagline = `${client.industry} expertise`

    const formatPost = (row: ContentRow) => ({
      title: row.title,
      slug: slugify(row.title),
      excerpt: row.excerpt || stripMd(row.body).slice(0, 200),
      date: formatDate(row.created_at),
      bodyHtml: markdownToHtml(row.body),
    })

    const formattedBlogPosts = blogPosts.map(formatPost)
    const formattedNewsletters = newsletters.map(formatPost)

    // Render index page
    const indexHtml = ejs.render(templateContent, {
      siteName,
      businessName,
      slug: site.slug,
      description,
      tagline,
      year: new Date().getFullYear(),
      blogPosts: formattedBlogPosts,
      newsletters: formattedNewsletters,
    })

    // Ensure output directory
    mkdirSync(site.build_output_path, { recursive: true })

    // Write index
    writeFileSync(join(site.build_output_path, 'index.html'), indexHtml, 'utf-8')
    log.push('Wrote index.html')

    // Write individual blog post pages
    for (const post of formattedBlogPosts) {
      const postDir = join(site.build_output_path, 'blog')
      mkdirSync(postDir, { recursive: true })
      const html = ejs.render(postTemplate, {
        siteName,
        businessName,
        slug: site.slug,
        year: new Date().getFullYear(),
        post,
      })
      writeFileSync(join(postDir, `${post.slug}.html`), html, 'utf-8')
      log.push(`Wrote blog/${post.slug}.html`)
    }

    // Write individual newsletter pages
    for (const nl of formattedNewsletters) {
      const nlDir = join(site.build_output_path, 'newsletter')
      mkdirSync(nlDir, { recursive: true })
      const html = ejs.render(postTemplate, {
        siteName,
        businessName,
        slug: site.slug,
        year: new Date().getFullYear(),
        post: nl,
      })
      writeFileSync(join(nlDir, `${nl.slug}.html`), html, 'utf-8')
      log.push(`Wrote newsletter/${nl.slug}.html`)
    }

    // Generate RSS feed
    const rssItems = [...formattedBlogPosts, ...formattedNewsletters]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 50)

    const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${siteName} — ${businessName}</title>
    <link>/site/${site.slug}</link>
    <description>${description}</description>
    <language>en-gb</language>
    <atom:link href="/site/${site.slug}/rss.xml" rel="self" type="application/rss+xml"/>
    ${rssItems.map(item => `
    <item>
      <title><![CDATA[${item.title}]]></title>
      <link>/site/${site.slug}/blog/${item.slug}.html</link>
      <description><![CDATA[${item.excerpt}]]></description>
      <pubDate>${new Date(item.date).toUTCString()}</pubDate>
    </item>`).join('')}
  </channel>
</rss>`
    writeFileSync(join(site.build_output_path, 'rss.xml'), rssXml, 'utf-8')
    log.push('Wrote rss.xml')

    // Generate sitemap
    const urls = [
      { loc: `/site/${site.slug}`, priority: 1.0 },
      ...formattedBlogPosts.map(p => ({ loc: `/site/${site.slug}/blog/${p.slug}.html`, priority: 0.8 })),
      ...formattedNewsletters.map(n => ({ loc: `/site/${site.slug}/newsletter/${n.slug}.html`, priority: 0.6 })),
    ]
    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u.loc}</loc><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>`
    writeFileSync(join(site.build_output_path, 'sitemap.xml'), sitemapXml, 'utf-8')
    log.push('Wrote sitemap.xml')

    // Update site status
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`
      UPDATE sites SET status = 'built', last_built_at = ?, updated_at = ? WHERE id = ?
    `).run(now, now, site.id)

    const fullLog = log.join('\n')
    db.prepare(`
      UPDATE site_deployments SET status = 'built', log = ? WHERE id = ?
    `).run(fullLog, deploymentId)

    return { ok: true, log: fullLog, url: `/site/${site.slug}` }
  } catch (err) {
    const errorLog = log.join('\n') + '\nERROR: ' + (err as Error).message
    db.prepare(`
      UPDATE site_deployments SET status = 'failed', log = ? WHERE id = ?
    `).run(errorLog, deploymentId)
    db.prepare(`UPDATE sites SET status = 'error', updated_at = ? WHERE id = ?`)
      .run(Math.floor(Date.now() / 1000), site.id)
    return { ok: false, log: errorLog }
  }
}
