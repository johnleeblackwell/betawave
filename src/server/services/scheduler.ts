import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { runAllSettlements, applyInactivityGates } from './commission.js'
import { getClient, buildBlogPrompt, buildNewsletterPrompt } from './claude.js'
import { fetchRSSItems } from './rss.js'
import { getImageForPost, uploadImageToWordPress } from './images.js'
import { extractTitle, extractImageQuery, cleanTitleForSearch, markdownToHtml } from './content-utils.js'
import nodemailer from 'nodemailer'

export interface Schedule {
  id: string
  client_id: string
  content_type: 'blog' | 'newsletter'
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly'
  day_of_week: number
  time_of_day: string
  auto_publish_email: number
  auto_publish_wp: number
  enabled: number
  next_run: number | null
  last_run: number | null
  topic_hint: string
  wp_post_status: string
  wp_category_id: number
  created_at: number
}

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

interface SourceRow {
  id: string
  client_id: string
  type: string
  url?: string
  keywords?: string
  active: number
}

// --- Next-run calculator ---

export function calculateNextRun(
  frequency: string,
  dayOfWeek: number,
  timeOfDay: string,
  after?: Date
): number {
  const [hours, minutes] = timeOfDay.split(':').map(Number)
  const now = after ?? new Date()

  if (frequency === 'daily') {
    const next = new Date(now)
    next.setHours(hours, minutes, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    return Math.floor(next.getTime() / 1000)
  }

  if (frequency === 'weekly' || frequency === 'biweekly') {
    const interval = frequency === 'biweekly' ? 14 : 7
    const next = new Date(now)
    next.setHours(hours, minutes, 0, 0)
    let daysUntil = (dayOfWeek - now.getDay() + 7) % 7
    if (daysUntil === 0 && next <= now) daysUntil = interval
    next.setDate(next.getDate() + daysUntil)
    return Math.floor(next.getTime() / 1000)
  }

  if (frequency === 'monthly') {
    const next = new Date(now)
    next.setHours(hours, minutes, 0, 0)
    if (next <= now) next.setMonth(next.getMonth() + 1)
    return Math.floor(next.getTime() / 1000)
  }

  return Math.floor(Date.now() / 1000) + 3600
}

// --- Batch generation (non-streaming, for background jobs) ---

async function generateBatch(prompt: string): Promise<string> {
  const response = await getClient().messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    // 'adaptive' thinking is supported by the API but not yet in SDK typedefs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    thinking: { type: 'adaptive' } as any,
    messages: [{ role: 'user', content: prompt }]
  })
  return response.content
    .filter(b => b.type === 'text')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map(b => (b as any).text as string)
    .join('')
}

// --- Run a single schedule ---

export async function runSchedule(schedule: Schedule): Promise<void> {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(schedule.client_id) as ClientRow | undefined
  if (!client) throw new Error(`Client ${schedule.client_id} not found`)
  const clientWithAreas = {
    ...client,
    expertise_areas: JSON.parse(client.expertise_areas || '[]') as string[],
    blocked_topics: client.blocked_topics ? JSON.parse(client.blocked_topics) as string[] : undefined,
  }

  const contentId = uuid()

  if (schedule.content_type === 'blog') {
    const sources = db.prepare('SELECT * FROM sources WHERE client_id = ? AND active = 1').all(schedule.client_id) as unknown as SourceRow[]
    let sourceMaterial = ''
    for (const source of sources) {
      if (source.type === 'rss' && source.url) {
        try {
          const items = await fetchRSSItems(source.url)
          items.slice(0, 4).forEach(item => {
            sourceMaterial += `\n\n**${item.title}**\n${(item.content || '').slice(0, 400)}`
          })
        } catch (err) {
          console.warn('[scheduler] RSS feed fetch failed, skipping:', (err as Error).message)
        }
      } else if (source.type === 'keywords') {
        const kw = JSON.parse(source.keywords || '[]') as string[]
        if (kw.length) sourceMaterial += `\n\nKey topics to draw on: ${kw.join(', ')}`
      }
    }

    const prompt = buildBlogPrompt(clientWithAreas, sourceMaterial, schedule.topic_hint || '')
    const rawContent = await generateBatch(prompt)
    const { body: cleanBody, imageQuery: extractedImageQuery } = extractImageQuery(rawContent)
    const title = extractTitle(cleanBody)
    const excerpt = cleanBody.replace(/[#*]/g, '').slice(0, 220).trim() + '…'

    db.prepare(`
      INSERT INTO content (id, client_id, type, title, body, excerpt, status, image_query)
      VALUES (?, ?, 'blog', ?, ?, ?, 'draft', ?)
    `).run(contentId, schedule.client_id, title, cleanBody, excerpt, extractedImageQuery)

    console.log(`[scheduler] Generated blog "${title}" for ${client.business_name}`)

    if (schedule.auto_publish_wp && client.wp_url && client.wp_username && client.wp_app_password) {
      try {
        const wpUrl = client.wp_url.replace(/\/$/, '')
        const credentials = Buffer.from(`${client.wp_username}:${client.wp_app_password.replace(/\s/g, '')}`).toString('base64')
        const html = markdownToHtml(cleanBody)

        let featuredMediaId: number | null = null
        const imageSource = client.image_source || 'auto'
        if (imageSource !== 'none') {
          const imageSearchQuery = extractedImageQuery || client.image_keywords || cleanTitleForSearch(title)
          const image = await getImageForPost({ title, industry: client.industry, excerpt, imageSource, searchQuery: imageSearchQuery })
          if (image) {
            const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
            featuredMediaId = await uploadImageToWordPress(image, slug, wpUrl, credentials)
          }
        }

        const wpStatus = schedule.wp_post_status || client.wp_post_status || 'draft'
        const categoryIds = schedule.wp_category_id ? [schedule.wp_category_id] : []

        const wpRes = await fetch(`${wpUrl}/wp-json/wp/v2/posts`, {
          method: 'POST',
          headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            content: html,
            excerpt: excerpt.replace(/…$/, ''),
            status: wpStatus,
            ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
            ...(categoryIds.length ? { categories: categoryIds } : {})
          })
        })
        if (wpRes.ok) {
          db.prepare("UPDATE content SET status = 'published' WHERE id = ?").run(contentId)
          console.log(`[scheduler] Published to WordPress for ${client.business_name}`)
        } else {
          const errBody = await wpRes.json().catch(() => ({}) as Record<string, unknown>)
          console.error(`[scheduler] WordPress publish failed: ${(errBody as { message?: string }).message || wpRes.status}`)
        }
      } catch (err) {
        console.error(`[scheduler] WordPress error: ${(err as Error).message}`)
      }
    }

    if (schedule.auto_publish_email && client.contact_email) {
      try {
        await sendEmail(client, contentId, title, cleanBody)
      } catch (err) {
        console.error(`[scheduler] Email error: ${(err as Error).message}`)
      }
    }

  } else {
    const since = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60
    const recentPosts = db.prepare(`
      SELECT title, excerpt FROM content
      WHERE client_id = ? AND type = 'blog' AND created_at > ?
      ORDER BY created_at DESC LIMIT 5
    `).all(schedule.client_id, since) as unknown as Array<{ title: string; excerpt: string }>

    const prompt = buildNewsletterPrompt(clientWithAreas, recentPosts)
    const fullContent = await generateBatch(prompt)
    const title = extractTitle(fullContent) || `Newsletter — ${new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`
    const excerpt = fullContent.replace(/[#*\[\]]/g, '').slice(0, 220).trim() + '…'

    db.prepare(`
      INSERT INTO content (id, client_id, type, title, body, excerpt, status)
      VALUES (?, ?, 'newsletter', ?, ?, ?, 'draft')
    `).run(contentId, schedule.client_id, title, fullContent, excerpt)

    console.log(`[scheduler] Generated newsletter "${title}" for ${client.business_name}`)

    if (schedule.auto_publish_email && client.contact_email) {
      try {
        await sendEmail(client, contentId, title, fullContent)
      } catch (err) {
        console.error(`[scheduler] Email error: ${(err as Error).message}`)
      }
    }
  }
}

async function sendEmail(client: ClientRow, contentId: string, title: string, body: string) {
  const smtpHost = client.smtp_host || process.env.SMTP_HOST
  const smtpPort = Number(client.smtp_port || process.env.SMTP_PORT || 587)
  const smtpUser = client.smtp_user || process.env.SMTP_USER
  const smtpPass = client.smtp_pass || process.env.SMTP_PASS
  const smtpFrom = client.smtp_from || process.env.SMTP_FROM || smtpUser

  if (!smtpHost || !smtpUser || !smtpPass) {
    throw new Error('SMTP not configured')
  }

  const transporter = nodemailer.createTransport({ host: smtpHost, port: smtpPort, secure: smtpPort === 465, auth: { user: smtpUser, pass: smtpPass } })
  await transporter.sendMail({ from: smtpFrom, to: client.contact_email, subject: title, html: markdownToHtml(body) })
  db.prepare("UPDATE content SET status = 'sent' WHERE id = ?").run(contentId)
  console.log(`[scheduler] Sent email to ${client.contact_email}`)
}

// --- Cron loop: check every minute ---

async function processDueSchedules() {
  const now = Math.floor(Date.now() / 1000)
  const due = db.prepare(`
    SELECT * FROM schedules WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= ?
  `).all(now) as unknown as Schedule[]

  for (const schedule of due) {
    db.prepare('UPDATE schedules SET next_run = NULL WHERE id = ?').run(schedule.id)

    runSchedule(schedule)
      .then(() => {
        const next = calculateNextRun(schedule.frequency, schedule.day_of_week, schedule.time_of_day)
        db.prepare('UPDATE schedules SET last_run = ?, next_run = ? WHERE id = ?').run(now, next, schedule.id)
      })
      .catch(err => {
        console.error(`[scheduler] Schedule ${schedule.id} failed: ${(err as Error).message}`)
        const next = calculateNextRun(schedule.frequency, schedule.day_of_week, schedule.time_of_day)
        db.prepare('UPDATE schedules SET next_run = ? WHERE id = ?').run(next, schedule.id)
      })
  }
}

// ─── Citation run scheduler ───────────────────────────────────────────────────

const CITATION_INTERVAL_S = 7 * 24 * 60 * 60

async function processDueCitationRuns() {
  const now = Math.floor(Date.now() / 1000)

  const dueBrands = db.prepare(`
    SELECT id, client_id, name, next_run_at
    FROM tracked_brands
    WHERE status = 'active'
      AND (next_run_at IS NOT NULL AND next_run_at <= ?)
  `).all(now) as Array<{ id: string; client_id: string; name: string; next_run_at: number }>

  if (dueBrands.length === 0) return

  console.log(`[scheduler] ${dueBrands.length} citation brand(s) due`)

  for (const brand of dueBrands) {
    const nextRun = now + CITATION_INTERVAL_S
    db.prepare('UPDATE tracked_brands SET last_run_at = ?, next_run_at = ? WHERE id = ?')
      .run(now, nextRun, brand.id)

    const inFlight = db.prepare(
      "SELECT id FROM citation_runs WHERE brand_id = ? AND status = 'running' LIMIT 1",
    ).get(brand.id)

    if (inFlight) {
      console.log(`[scheduler] Skipping brand ${brand.name} — run already in progress`)
      continue
    }

    const { v4: uuidV4 } = await import('uuid')
    const jobId = uuidV4()
    db.prepare(`
      INSERT INTO jobs (id, type, status, params, created_at)
      VALUES (?, 'citation_run', 'pending', ?, unixepoch())
    `).run(jobId, JSON.stringify({ brand_id: brand.id }))

    console.log(`[scheduler] Queued citation run for brand "${brand.name}" (job ${jobId})`)
  }
}

// ─── Citation drop alert ──────────────────────────────────────────────────────

const DROP_THRESHOLD = 0.20

export async function maybeSendCitationDropAlert(brandId: string): Promise<void> {
  const runs = db.prepare(`
    SELECT id, total_queries, mentioned_count
    FROM citation_runs
    WHERE brand_id = ? AND status IN ('complete', 'partial')
    ORDER BY run_at DESC
    LIMIT 2
  `).all(brandId) as Array<{ id: string; total_queries: number; mentioned_count: number }>

  if (runs.length < 2) return

  const [latest, previous] = runs

  const latestRate   = latest.total_queries   > 0 ? latest.mentioned_count   / latest.total_queries   : 0
  const previousRate = previous.total_queries > 0 ? previous.mentioned_count / previous.total_queries : 0

  if (previousRate === 0) return
  const drop = (previousRate - latestRate) / previousRate

  if (drop < DROP_THRESHOLD) return

  const brand = db.prepare('SELECT * FROM tracked_brands WHERE id = ?').get(brandId) as { name: string; client_id: string } | undefined
  if (!brand) return

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(brand.client_id) as ClientRow | undefined
  if (!client?.contact_email) return

  const smtpHost = client.smtp_host || process.env.SMTP_HOST
  const smtpUser = client.smtp_user || process.env.SMTP_USER
  const smtpPass = client.smtp_pass || process.env.SMTP_PASS
  const smtpFrom = client.smtp_from || process.env.SMTP_FROM || smtpUser

  if (!smtpHost || !smtpUser || !smtpPass) {
    console.warn(`[scheduler] Citation drop alert skipped for brand ${brand.name} — SMTP not configured`)
    return
  }

  const prevPct   = Math.round(previousRate * 100)
  const latestPct = Math.round(latestRate   * 100)
  const dropPct   = Math.round(drop         * 100)

  const subject = `⚠️ Citation alert: ${brand.name} mention rate dropped ${dropPct}%`
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a2e">
      <h2 style="color:#4f46e5">Citation Share Drop Detected</h2>
      <p>Your brand <strong>${brand.name}</strong> has seen a significant drop in AI citation share.</p>
      <table style="border-collapse:collapse;width:100%;margin:24px 0">
        <tr style="background:#f8f8ff">
          <th style="padding:10px;text-align:left;border:1px solid #ddd">Run</th>
          <th style="padding:10px;text-align:left;border:1px solid #ddd">Mention Rate</th>
        </tr>
        <tr>
          <td style="padding:10px;border:1px solid #ddd">Previous run</td>
          <td style="padding:10px;border:1px solid #ddd">${prevPct}%</td>
        </tr>
        <tr style="background:#fff0f0">
          <td style="padding:10px;border:1px solid #ddd">Latest run</td>
          <td style="padding:10px;border:1px solid #ddd;color:#dc2626;font-weight:bold">${latestPct}% (▼ ${dropPct}%)</td>
        </tr>
      </table>
      <p>Log in to <strong>βWave</strong> to review which queries are no longer returning your brand and explore content improvements.</p>
      <p style="color:#888;font-size:12px;margin-top:32px">This alert was generated automatically by βWave Citation Tracker. A drop of ${DROP_THRESHOLD * 100}%+ triggers this notification.</p>
    </div>
  `

  try {
    const smtpPort = Number(client.smtp_port || process.env.SMTP_PORT || 587)
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    })
    await transporter.sendMail({ from: smtpFrom, to: client.contact_email, subject, html })
    console.log(`[scheduler] Citation drop alert sent to ${client.contact_email} for brand ${brand.name}`)
  } catch (err) {
    console.error(`[scheduler] Citation drop alert email failed: ${(err as Error).message}`)
  }
}

// ─── Seed next_run_at for newly created brands ────────────────────────────────

function seedCitationNextRun() {
  const now = new Date()
  const nextSunday = new Date(now)
  nextSunday.setHours(23, 0, 0, 0)
  const daysUntilSunday = (7 - now.getDay()) % 7 || 7
  nextSunday.setDate(now.getDate() + daysUntilSunday)
  const nextRunTs = Math.floor(nextSunday.getTime() / 1000)

  db.prepare(`
    UPDATE tracked_brands
    SET next_run_at = ?
    WHERE status = 'active' AND next_run_at IS NULL
  `).run(nextRunTs)
}

// ─── Commission: nightly inactivity gate + monthly settlement ─────────────────

function processCommissionJobs() {
  const now = new Date()

  if (now.getHours() === 0 && now.getMinutes() < 2) {
    applyInactivityGates()
  }

  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  if (now.getDate() === lastDay && now.getHours() === 9 && now.getMinutes() < 2) {
    console.log('[scheduler] Monthly commission settlement run')
    runAllSettlements()
  }
}

// Syndication runs every 30 min. Daily caps reset at midnight.
// NOTE: these are module-level counters — safe only in single-process deployments.
// In cluster/multi-worker mode, move these into SQLite.
let syndicationTickCount = 0

async function processSyndication() {
  syndicationTickCount++
  // Persisted, UTC-based daily cap reset — survives restarts. (The old
  // in-memory `lastSyndicationDay` reset on every restart, which froze
  // posts_today and silently halted the feed after the Hetzner migration.)
  const { maybeResetDailyCaps } = await import('./syndication.js')
  maybeResetDailyCaps()
  if (syndicationTickCount % 30 !== 0) return
  // Posting window (GMT/UTC) — only drip during active hours. Default 07:00–23:00.
  // Override with SYNDICATION_START_HOUR / SYNDICATION_END_HOUR in .env.
  const startHour = Number(process.env.SYNDICATION_START_HOUR ?? 7)
  const endHour = Number(process.env.SYNDICATION_END_HOUR ?? 23)
  const hourUTC = new Date().getUTCHours()
  if (hourUTC < startHour || hourUTC >= endHour) return // outside window — stay quiet
  try {
    const { runSyndicationTick } = await import('./syndication.js')
    const result = await runSyndicationTick()
    if (result.posted + result.failed > 0) {
      console.log(`[scheduler] Syndication: posted=${result.posted} failed=${result.failed} skipped=${result.skipped}`)
    }
    // Alert the operator if the feed is silently blocked (e.g. provider billing).
    const { checkSyndicationHealth } = await import('./alerts.js')
    await checkSyndicationHealth(result)

    // Respond module: ingest X mentions (self-throttled, read-budget aware) and
    // deliver human-approved replies (paced). Failures must not break posting.
    try {
      const { pollXMentions, sendApprovedXReplies } = await import('./respond-x.js')
      await pollXMentions()
      await sendApprovedXReplies()
      // Growth: discover share/follow suggestions (self-throttled, human-gated)
      // and execute only what a human approved (paced, per-kind daily caps).
      const { discoverXSuggestions, executeApprovedXActions } = await import('./respond-x-growth.js')
      await discoverXSuggestions()
      await executeApprovedXActions()
      // Telegram responder — poll inbound into the inbox + send human-approved replies.
      const { pollTelegramUpdates, sendApprovedTelegramReplies } = await import('./telegram.js')
      await pollTelegramUpdates()
      await sendApprovedTelegramReplies()
    } catch (err) {
      console.error('[scheduler] Respond-X error:', (err as Error).message)
    }
  } catch (err) {
    console.error('[scheduler] Syndication error:', (err as Error).message)
  }
}

// Citation runs finish in minutes. Any run still 'running' after a restart is
// orphaned (the process died mid-run) and would otherwise show "In progress"
// forever. On boot, finalise them: complete (if any results landed) + queue
// classification to salvage them, else fail. Also clear their dead jobs.
function reconcileOrphanedCitationRuns() {
  const cutoff = Math.floor(Date.now() / 1000) - 2 * 3600
  const orphans = db.prepare(
    `SELECT id, brand_id, job_id, completed FROM citation_runs WHERE status = 'running' AND run_at < ?`,
  ).all(cutoff) as Array<{ id: string; brand_id: string; job_id: string; completed: number }>
  for (const o of orphans) {
    const status = o.completed > 0 ? 'complete' : 'failed'
    db.prepare(`UPDATE citation_runs SET status = ?, notes = 'auto-reconciled: process restarted mid-run' WHERE id = ?`).run(status, o.id)
    if (o.job_id) db.prepare(`UPDATE jobs SET status = 'failed', error = 'orphaned — reconciled on restart' WHERE id = ? AND status IN ('running','pending')`).run(o.job_id)
    if (status === 'complete') {
      db.prepare(`INSERT INTO jobs (id, type, status, params, created_at) VALUES (?, 'citation_classify', 'pending', ?, unixepoch())`)
        .run(uuid(), JSON.stringify({ run_id: o.id, brand_id: o.brand_id }))
    }
    console.log(`[scheduler] reconciled orphaned citation run ${o.id} → ${status}`)
  }
}

export function startScheduler() {
  console.log('[scheduler] Started — checking every 60s')
  try { reconcileOrphanedCitationRuns() } catch (e) { console.error('[scheduler] orphan reconcile error:', (e as Error).message) }
  seedCitationNextRun()
  processDueSchedules().catch(console.error)
  processDueCitationRuns().catch(console.error)
  setInterval(() => {
    processDueSchedules().catch(console.error)
    processDueCitationRuns().catch(console.error)
    try { processCommissionJobs() } catch (err) { console.error('[scheduler] Commission job error:', (err as Error).message) }
    processSyndication().catch(err => console.error('[scheduler] Syndication tick error:', (err as Error).message))
  }, 60_000)
}
