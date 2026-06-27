import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { buildBlogPrompt, buildNewsletterPrompt, streamGenerate, getClient } from '../services/claude.js'
import { getImageForPost, uploadImageToWordPress } from '../services/images.js'
import { fetchRSSItems } from '../services/rss.js'
import { extractTitle, extractImageQuery, cleanTitleForSearch, markdownToHtml } from '../services/content-utils.js'
import nodemailer from 'nodemailer'
import type { TextBlock } from '@anthropic-ai/sdk/resources/messages.js'

// --- DB row shapes ---

interface ClientRow {
  id: string
  business_name: string
  industry: string
  expertise_areas: string   // JSON string
  tone_of_voice: string
  target_audience: string
  style_notes?: string
  location?: string
  blocked_topics?: string
  contact_email?: string
  smtp_host?: string
  smtp_port?: number | string
  smtp_user?: string
  smtp_pass?: string
  smtp_from?: string
  wp_url?: string
  wp_username?: string
  wp_app_password?: string
  wp_post_status?: string
  image_source?: string
  image_keywords?: string
}

interface ContentRow {
  id: string
  client_id: string
  type: string
  title: string
  body: string
  excerpt?: string
  status: string
  image_query?: string
}

interface SourceRow {
  id: string
  client_id: string
  type: string
  url?: string
  keywords?: string
  active: number
}

const router = Router({ mergeParams: true })

// List content for a client
router.get('/', (req, res) => {
  // clientId is a merged param from the parent router (/api/clients/:clientId/...)
  const { clientId } = req.params as { clientId: string }
  const { type } = req.query
  const query = type
    ? 'SELECT * FROM content WHERE client_id = ? AND type = ? ORDER BY created_at DESC'
    : 'SELECT * FROM content WHERE client_id = ? ORDER BY created_at DESC'
  const rows = type
    ? db.prepare(query).all(clientId, type as string)
    : db.prepare(query).all(clientId)
  res.json(rows)
})

// Generate blog post (streaming SSE)
router.post('/generate/blog', async (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const { topicHint = '' } = req.body

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`)

  try {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId) as ClientRow | undefined
    if (!client) { send({ type: 'error', message: 'Client not found' }); return res.end() }

    const clientWithAreas = {
      ...client,
      expertise_areas: JSON.parse(client.expertise_areas) as string[],
      blocked_topics: client.blocked_topics ? JSON.parse(client.blocked_topics) as string[] : undefined,
    }

    const sources = db.prepare('SELECT * FROM sources WHERE client_id = ? AND active = 1').all(clientId) as unknown as SourceRow[]
    let sourceMaterial = ''

    for (const source of sources) {
      if (source.type === 'rss' && source.url) {
        try {
          const items = await fetchRSSItems(source.url)
          items.slice(0, 4).forEach(item => {
            sourceMaterial += `\n\n**${item.title}**\n${(item.content || '').slice(0, 400)}`
          })
        } catch (err) {
          console.warn('[content] RSS feed fetch failed, skipping:', (err as Error).message)
        }
      } else if (source.type === 'keywords') {
        const kw = JSON.parse(source.keywords ?? '[]') as string[]
        if (kw.length) sourceMaterial += `\n\nKey topics to draw on: ${kw.join(', ')}`
      }
    }

    const prompt = buildBlogPrompt(clientWithAreas, sourceMaterial, topicHint)
    const contentId = uuid()
    let fullContent = ''

    const stream = streamGenerate(prompt)
    res.on('close', () => stream.controller.abort())

    for await (const text of stream) {
      fullContent += text
      send({ type: 'delta', text })
    }

    const { body: cleanBody, imageQuery } = extractImageQuery(fullContent)
    const title = extractTitle(cleanBody)
    const excerpt = cleanBody.replace(/[#*]/g, '').slice(0, 220).trim() + '…'

    db.prepare(`
      INSERT INTO content (id, client_id, type, title, body, excerpt, status, image_query)
      VALUES (?, ?, 'blog', ?, ?, ?, 'draft', ?)
    `).run(contentId, clientId, title, cleanBody, excerpt, imageQuery)

    // Auto-enqueue in syndication pool so the blog is available for intelligent
    // tweet rotation without needing a separate RSS feed entry.
    try {
      db.prepare(`
        INSERT INTO syndication_pool (id, client_id, source_type, source_item_id, url, title, body, pub_date)
        VALUES (?, ?, 'betawave', ?, '', ?, ?, ?)
        ON CONFLICT(client_id, source_item_id) DO UPDATE SET title = excluded.title, body = excluded.body
      `).run(uuid(), clientId, contentId, title, cleanBody.slice(0, 3000), Math.floor(Date.now() / 1000))
    } catch (poolErr: any) {
      console.warn('[content] failed to enqueue in syndication pool:', poolErr.message)
    }

    send({ type: 'done', content_id: contentId, title })
    res.end()
  } catch (err) {
    send({ type: 'error', message: (err as Error)?.message || 'Generation failed' })
    res.end()
  }
})

// Generate newsletter (streaming SSE)
router.post('/generate/newsletter', async (req, res) => {
  const { clientId } = req.params as { clientId: string }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`)

  try {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId) as ClientRow | undefined
    if (!client) { send({ type: 'error', message: 'Client not found' }); return res.end() }

    const clientWithAreas = {
      ...client,
      expertise_areas: JSON.parse(client.expertise_areas) as string[],
      blocked_topics: client.blocked_topics ? JSON.parse(client.blocked_topics) as string[] : undefined,
    }

    const since = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60
    const recentPosts = db.prepare(`
      SELECT title, excerpt FROM content
      WHERE client_id = ? AND type = 'blog' AND created_at > ?
      ORDER BY created_at DESC LIMIT 5
    `).all(clientId, since) as unknown as Array<{ title: string; excerpt: string }>

    const prompt = buildNewsletterPrompt(clientWithAreas, recentPosts)
    const contentId = uuid()
    let fullContent = ''

    const stream = streamGenerate(prompt)
    res.on('close', () => stream.controller.abort())

    for await (const text of stream) {
      fullContent += text
      send({ type: 'delta', text })
    }

    const title = extractTitle(fullContent) || `Newsletter — ${new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`
    const excerpt = fullContent.replace(/[#*\[\]]/g, '').slice(0, 220).trim() + '…'

    db.prepare(`
      INSERT INTO content (id, client_id, type, title, body, excerpt, status)
      VALUES (?, ?, 'newsletter', ?, ?, ?, 'draft')
    `).run(contentId, clientId, title, fullContent, excerpt)

    send({ type: 'done', content_id: contentId, title })
    res.end()
  } catch (err) {
    send({ type: 'error', message: (err as Error)?.message || 'Generation failed' })
    res.end()
  }
})

// Update content (edit title/body/status)
router.put('/:id', (req, res) => {
  const { title, body, status } = req.body
  db.prepare('UPDATE content SET title=?, body=?, status=? WHERE id=?').run(title, body, status, req.params.id)
  res.json(db.prepare('SELECT * FROM content WHERE id = ?').get(req.params.id))
})

// Delete content
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM content WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// Send newsletter by email
router.post('/:id/send', async (req, res) => {
  try {
    const content = db.prepare('SELECT * FROM content WHERE id = ?').get(req.params.id) as ContentRow | undefined
    if (!content) return res.status(404).json({ error: 'Not found' })

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(content.client_id) as ClientRow | undefined
    const { to } = req.body as { to?: string }
    const recipient = to || client?.contact_email
    if (!recipient) return res.status(400).json({ error: 'No recipient email. Set one in client profile or pass { to: "email" }' })

    const smtpHost = client?.smtp_host || process.env.SMTP_HOST
    const smtpPort = Number(client?.smtp_port || process.env.SMTP_PORT || 587)
    const smtpUser = client?.smtp_user || process.env.SMTP_USER
    const smtpPass = client?.smtp_pass || process.env.SMTP_PASS
    const smtpFrom = client?.smtp_from || process.env.SMTP_FROM || smtpUser

    if (!smtpHost || !smtpUser || !smtpPass) {
      return res.status(400).json({ error: 'SMTP not configured. Add email settings to the client profile, or set SMTP_HOST/USER/PASS in .env as a fallback.' })
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass }
    })

    const html = markdownToHtml(content.body)

    await transporter.sendMail({
      from: smtpFrom,
      to: recipient,
      subject: content.title,
      html
    })

    db.prepare("UPDATE content SET status = 'sent' WHERE id = ?").run(req.params.id)
    res.json({ ok: true, sent_to: recipient })
  } catch (err) {
    res.status(500).json({ error: (err as Error)?.message || 'Failed to send email' })
  }
})

// Suggest the best WordPress category for a piece of content using Claude
router.post('/:id/suggest-category', async (req, res) => {
  try {
    const content = db.prepare('SELECT * FROM content WHERE id = ?').get(req.params.id) as ContentRow | undefined
    if (!content) return res.status(404).json({ error: 'Not found' })

    const { categories } = req.body as { categories: { id: number; name: string }[] }
    if (!categories?.length) return res.status(400).json({ error: 'No categories provided' })

    const categoryList = categories.map(c => `- ${c.name} (id: ${c.id})`).join('\n')
    const prompt = `You are helping categorise a blog post for a WordPress website.

POST TITLE: ${content.title}
POST EXCERPT: ${content.excerpt || content.body.slice(0, 300)}

AVAILABLE CATEGORIES:
${categoryList}

Which single category best fits this post? Reply with ONLY the category id as a number. Nothing else.`

    const anthropic = getClient()
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 10,
      messages: [{ role: 'user', content: prompt }]
    })

    const firstBlock = message.content[0]
    const raw = firstBlock.type === 'text' ? (firstBlock as TextBlock).text?.trim() : ''
    const suggestedId = parseInt(raw ?? '')
    const match = categories.find(c => c.id === suggestedId)

    res.json({ suggested_id: match ? suggestedId : categories[0].id })
  } catch (err) {
    res.status(500).json({ error: (err as Error)?.message || 'Failed to suggest category' })
  }
})

// Publish blog post to WordPress via REST API
router.post('/:id/publish/wordpress', async (req, res) => {
  try {
    const content = db.prepare('SELECT * FROM content WHERE id = ?').get(req.params.id) as ContentRow | undefined
    if (!content) return res.status(404).json({ error: 'Not found' })
    if (content.type !== 'blog') return res.status(400).json({ error: 'Only blog posts can be published to WordPress' })

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(content.client_id) as ClientRow | undefined
    const wpUrl = (client?.wp_url || '').replace(/\/$/, '')
    const wpUsername = client?.wp_username
    const wpAppPassword = client?.wp_app_password
    const wpStatus = client?.wp_post_status || 'draft'

    if (!wpUrl || !wpUsername || !wpAppPassword) {
      return res.status(400).json({ error: 'WordPress not configured. Add WP settings to the client profile.' })
    }

    // App passwords may contain spaces — strip them before encoding
    const credentials = Buffer.from(`${wpUsername}:${wpAppPassword.replace(/\s/g, '')}`).toString('base64')
    const html = markdownToHtml(content.body)
    const endpoint = `${wpUrl}/wp-json/wp/v2/posts`

    let featuredMediaId: number | null = null
    const imageSource = client?.image_source || 'auto'
    if (imageSource !== 'none') {
      const imageQuery =
        content.image_query ||
        client?.image_keywords ||
        cleanTitleForSearch(content.title)

      const image = await getImageForPost({
        title: content.title,
        industry: client?.industry ?? '',
        excerpt: content.excerpt || '',
        imageSource,
        searchQuery: imageQuery,
      })
      if (image) {
        const slug = content.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
        featuredMediaId = await uploadImageToWordPress(image, slug, wpUrl, credentials)
      }
    }

    const { category_ids } = req.body as { category_ids?: number[] }

    const wpRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: content.title,
        content: html,
        excerpt: content.excerpt?.replace(/…$/, '') || '',
        status: wpStatus,
        ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
        ...(category_ids?.length ? { categories: category_ids } : {}),
      })
    })

    if (!wpRes.ok) {
      const errBody = await wpRes.json().catch(() => ({}) as Record<string, unknown>)
      throw new Error((errBody as { message?: string }).message || `WordPress API returned ${wpRes.status}`)
    }

    const post = await wpRes.json() as { id: number; link: string }
    db.prepare("UPDATE content SET status = 'published' WHERE id = ?").run(req.params.id)
    res.json({
      ok: true,
      wp_post_id: post.id,
      wp_post_url: post.link,
      wp_status: wpStatus,
      featured_image: !!featuredMediaId,
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error)?.message || 'Failed to publish to WordPress' })
  }
})

export default router
