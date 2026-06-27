// @ts-nocheck
/**
 * Citation Report generator.
 *
 * Registered as job type 'citation_report' in job-runner.ts.
 * Runs after a citation_classify job completes (or manually triggered).
 *
 * Produces:
 *  1. A Claude Sonnet narrative HTML report covering:
 *     - Headline finding
 *     - Citation share table (overall + per engine)
 *     - Week-over-week movement vs prior run
 *     - Top wins (queries where brand was mentioned positively)
 *     - Top concerns (queries where brand was absent or competitors dominated)
 *     - 3–5 recommended actions
 *  2. Saves HTML to citation_reports table
 *  3. Emails it to client.contact_email if SMTP is configured
 */
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { getClient } from './claude.js'
import nodemailer from 'nodemailer'

const SONNET_MODEL = 'claude-sonnet-4-5'

// ─── DB migration — citation_reports table ────────────────────────────────────
// Called once at server start via db.ts, but we guard with IF NOT EXISTS here
// so this file is safe to import at any time.
db.exec(`
  CREATE TABLE IF NOT EXISTS citation_reports (
    id          TEXT PRIMARY KEY,
    brand_id    TEXT NOT NULL,
    run_id      TEXT NOT NULL,
    html        TEXT NOT NULL,
    emailed_at  INTEGER,
    created_at  INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (brand_id) REFERENCES tracked_brands(id) ON DELETE CASCADE,
    FOREIGN KEY (run_id)   REFERENCES citation_runs(id)  ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_citation_reports_brand ON citation_reports(brand_id);
`)

// ─── Job worker ───────────────────────────────────────────────────────────────

export async function runCitationReportJob(jobId: string): Promise<void> {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any
  if (!job) throw new Error(`Job ${jobId} not found`)

  const params = JSON.parse(job.params || '{}')
  const { run_id, brand_id } = params
  if (!run_id || !brand_id) throw new Error(`citation_report job ${jobId} missing run_id or brand_id`)

  db.prepare(`UPDATE jobs SET status = 'running', started_at = unixepoch() WHERE id = ?`).run(jobId)

  // ── Load data ────────────────────────────────────────────────────────────────
  const brand  = db.prepare('SELECT * FROM tracked_brands WHERE id = ?').get(brand_id) as any
  if (!brand) throw new Error(`Brand ${brand_id} not found`)

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(brand.client_id) as any

  const run = db.prepare('SELECT * FROM citation_runs WHERE id = ?').get(run_id) as any
  if (!run) throw new Error(`Run ${run_id} not found`)

  // Current run results (classified)
  const results = db.prepare(`
    SELECT r.*, q.text as query_text, q.category
    FROM citation_results r
    LEFT JOIN tracked_queries q ON q.id = r.query_id
    WHERE r.run_id = ? AND r.classified_at IS NOT NULL AND r.error = ''
    ORDER BY q.priority ASC, r.engine ASC
  `).all(run_id) as any[]

  // Previous run for comparison
  const prevRun = db.prepare(`
    SELECT id FROM citation_runs
    WHERE brand_id = ? AND status IN ('complete','partial') AND id != ?
    ORDER BY run_at DESC LIMIT 1
  `).get(brand_id, run_id) as any

  let prevResults: any[] = []
  if (prevRun) {
    prevResults = db.prepare(`
      SELECT r.*, q.text as query_text
      FROM citation_results r
      LEFT JOIN tracked_queries q ON q.id = r.query_id
      WHERE r.run_id = ? AND r.classified_at IS NOT NULL AND r.error = ''
    `).all(prevRun.id) as any[]
  }

  const competitors = db.prepare(
    'SELECT name FROM tracked_competitors WHERE brand_id = ? AND active = 1',
  ).all(brand_id) as any[]

  // ── Compute stats ─────────────────────────────────────────────────────────────
  const stats = computeStats(results, prevResults, brand.name)

  // ── Generate narrative with Claude ────────────────────────────────────────────
  console.log(`[citation-report] Generating narrative for run ${run_id}…`)
  const narrative = await generateNarrative(brand, client, stats, competitors.map(c => c.name))

  // ── Build HTML ────────────────────────────────────────────────────────────────
  const html = buildHtml(brand, run, stats, narrative)

  // ── Persist ───────────────────────────────────────────────────────────────────
  const reportId = uuid()
  db.prepare(`
    INSERT INTO citation_reports (id, brand_id, run_id, html, created_at)
    VALUES (?, ?, ?, ?, unixepoch())
  `).run(reportId, brand_id, run_id, html)

  console.log(`[citation-report] Report ${reportId} saved`)

  // ── Email ─────────────────────────────────────────────────────────────────────
  let emailed = false
  if (client?.contact_email) {
    emailed = await sendReport(client, brand, html, stats)
  }

  if (emailed) {
    db.prepare('UPDATE citation_reports SET emailed_at = unixepoch() WHERE id = ?').run(reportId)
  }

  db.prepare(`
    UPDATE jobs SET status = 'complete', completed_at = unixepoch(),
    result = ? WHERE id = ?
  `).run(JSON.stringify({ report_id: reportId, emailed }), jobId)

  console.log(`[citation-report] Job ${jobId} complete — report ${reportId}${emailed ? ', emailed' : ''}`)
}

// ─── Stats builder ────────────────────────────────────────────────────────────

interface RunStats {
  overall_share: number
  prev_share: number | null
  delta: number | null
  engine_shares: Record<string, { share: number; prev: number | null }>
  wins: Array<{ query: string; engine: string; position: string; sentiment: string }>
  concerns: Array<{ query: string; reason: string }>
  total_classified: number
  total_mentioned: number
}

function computeStats(results: any[], prevResults: any[], brandName: string): RunStats {
  const mentioned = results.filter(r => r.brand_mentioned)
  const overall_share = results.length > 0
    ? Math.round((mentioned.length / results.length) * 100)
    : 0

  // Per-engine
  const engines = ['anthropic', 'openai', 'perplexity', 'gemini']
  const engine_shares: RunStats['engine_shares'] = {}
  for (const eng of engines) {
    const engRows = results.filter(r => r.engine === eng)
    const engMentioned = engRows.filter(r => r.brand_mentioned)
    if (engRows.length === 0) continue
    engine_shares[eng] = {
      share: Math.round((engMentioned.length / engRows.length) * 100),
      prev: null,
    }
  }

  // Previous overall
  let prev_share: number | null = null
  if (prevResults.length > 0) {
    const prevMentioned = prevResults.filter(r => r.brand_mentioned).length
    prev_share = Math.round((prevMentioned / prevResults.length) * 100)

    // Previous per-engine
    for (const eng of engines) {
      if (!engine_shares[eng]) continue
      const prevEng = prevResults.filter(r => r.engine === eng)
      const prevEngMentioned = prevEng.filter(r => r.brand_mentioned)
      if (prevEng.length > 0) {
        engine_shares[eng].prev = Math.round((prevEngMentioned.length / prevEng.length) * 100)
      }
    }
  }

  const delta = prev_share !== null ? overall_share - prev_share : null

  // Wins: brand mentioned, position first or mid, sentiment positive/neutral
  const wins = mentioned
    .filter(r => r.brand_position !== 'late' && r.sentiment !== 'negative')
    .slice(0, 5)
    .map(r => ({
      query: r.query_text ?? 'unknown',
      engine: r.engine,
      position: r.brand_position ?? 'unknown',
      sentiment: r.sentiment ?? 'neutral',
    }))

  // Concerns: brand absent, or mentioned late/negative
  const concernRows = results.filter(r => !r.brand_mentioned || r.brand_position === 'late' || r.sentiment === 'negative')
  const byQuery: Record<string, string[]> = {}
  for (const r of concernRows) {
    const q = r.query_text ?? 'unknown'
    if (!byQuery[q]) byQuery[q] = []
    if (!r.brand_mentioned) byQuery[q].push(`absent on ${r.engine}`)
    else if (r.sentiment === 'negative') byQuery[q].push(`negative on ${r.engine}`)
    else byQuery[q].push(`late mention on ${r.engine}`)
  }
  const concerns = Object.entries(byQuery).slice(0, 5).map(([query, reasons]) => ({
    query,
    reason: reasons.slice(0, 3).join(', '),
  }))

  return {
    overall_share, prev_share, delta,
    engine_shares,
    wins, concerns,
    total_classified: results.length,
    total_mentioned: mentioned.length,
  }
}

// ─── Narrative generator ──────────────────────────────────────────────────────

async function generateNarrative(brand: any, client: any, stats: RunStats, competitorNames: string[]): Promise<string> {
  const deltaStr = stats.delta !== null
    ? `${stats.delta >= 0 ? '+' : ''}${stats.delta}pp vs last week`
    : 'first run — no prior comparison'

  const engineTable = Object.entries(stats.engine_shares)
    .map(([eng, s]) => `${eng}: ${s.share}%${s.prev !== null ? ` (${s.share - s.prev! >= 0 ? '+' : ''}${s.share - s.prev!}pp)` : ''}`)
    .join('\n')

  const winsStr = stats.wins.map(w => `- "${w.query}" — ${w.engine}, position: ${w.position}, sentiment: ${w.sentiment}`).join('\n')
  const concernsStr = stats.concerns.map(c => `- "${c.query}" — ${c.reason}`).join('\n')

  const prompt = `You are writing a weekly Citation Health Report for ${brand.name}, a ${client?.industry ?? 'business'} brand.

CITATION TRACKER DATA — week ending today:
- Overall mention rate: ${stats.overall_share}% (${stats.total_mentioned} of ${stats.total_classified} classified AI responses) — ${deltaStr}
- Per-engine breakdown:
${engineTable}

TOP WINS (brand mentioned prominently):
${winsStr || 'None this week'}

TOP CONCERNS (absent or underperforming):
${concernsStr || 'None this week'}

TRACKED COMPETITORS: ${competitorNames.join(', ') || 'none'}

Write a concise executive report in this exact structure. Use plain language — the reader is a business owner, not a data scientist.

## Headline finding
One punchy sentence summarising the week. Lead with the number.

## What's working
2–3 bullet points from the wins data. Be specific — mention the query and engine.

## What needs attention
2–3 bullet points from the concerns data. Explain why it matters commercially.

## Recommended actions
3–5 numbered actions the client can take to improve their citation share. Be practical and specific to their industry (${client?.industry ?? 'their sector'}).

Keep the whole report under 350 words. No padding, no generic SEO advice.`

  const response = await getClient().messages.create({
    model: SONNET_MODEL,
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }],
  })

  return response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .trim()
}

// ─── HTML builder ─────────────────────────────────────────────────────────────

function buildHtml(brand: any, run: any, stats: RunStats, narrative: string): string {
  const deltaColor = stats.delta === null ? '#64748b' : stats.delta >= 0 ? '#16a34a' : '#dc2626'
  const deltaLabel = stats.delta === null ? '' : `${stats.delta >= 0 ? '▲' : '▼'} ${Math.abs(stats.delta)}pp`

  const engineRows = Object.entries(stats.engine_shares).map(([eng, s]) => {
    const diff = s.prev !== null ? s.share - s.prev : null
    const diffHtml = diff !== null
      ? `<span style="color:${diff >= 0 ? '#16a34a' : '#dc2626'};font-size:11px;margin-left:6px">${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)}pp</span>`
      : ''
    return `<tr><td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-transform:capitalize">${eng}</td><td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-weight:700">${s.share}%${diffHtml}</td></tr>`
  }).join('')

  // Convert markdown narrative to basic HTML
  const narrativeHtml = narrative
    .replace(/^## (.+)$/gm, '<h3 style="color:#1e3a5f;font-size:15px;margin-top:24px;margin-bottom:8px;border-bottom:2px solid #4f46e5;padding-bottom:4px">$1</h3>')
    .replace(/^\d+\. (.+)$/gm, '<li style="margin-bottom:6px">$1</li>')
    .replace(/^- (.+)$/gm, '<li style="margin-bottom:6px">$1</li>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/(<li.*<\/li>\n?)+/g, m => `<ul style="padding-left:20px;margin:8px 0">${m}</ul>`)

  const runDate = new Date(run.run_at * 1000).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Citation Health Report — ${brand.name}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a2e">
  <div style="max-width:640px;margin:40px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px;color:white">
      <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;opacity:0.8;margin-bottom:6px">Citation Health Report</div>
      <div style="font-size:22px;font-weight:800;margin-bottom:4px">${brand.name}</div>
      <div style="font-size:13px;opacity:0.8">${runDate}</div>
    </div>

    <!-- Headline stat -->
    <div style="padding:24px 32px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:24px">
      <div>
        <div style="font-size:48px;font-weight:900;color:#4f46e5;line-height:1">${stats.overall_share}%</div>
        <div style="font-size:13px;color:#64748b;margin-top:4px">overall citation share</div>
      </div>
      ${stats.delta !== null ? `
      <div style="background:#f8fafc;border-radius:10px;padding:12px 18px;border:1px solid #e2e8f0">
        <div style="font-size:18px;font-weight:700;color:${deltaColor}">${deltaLabel}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px">vs prior week</div>
      </div>` : ''}
      <div style="margin-left:auto;text-align:right">
        <div style="font-size:13px;color:#64748b">${stats.total_mentioned} of ${stats.total_classified}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px">AI responses</div>
      </div>
    </div>

    <!-- Per-engine table -->
    <div style="padding:24px 32px;border-bottom:1px solid #f1f5f9">
      <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.5px">By engine</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">
            <th style="padding:6px 12px;text-align:left;font-weight:500">Engine</th>
            <th style="padding:6px 12px;text-align:left;font-weight:500">Share</th>
          </tr>
        </thead>
        <tbody>${engineRows}</tbody>
      </table>
    </div>

    <!-- Narrative -->
    <div style="padding:24px 32px">
      <p style="margin:0">${narrativeHtml}</p>
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #f1f5f9;font-size:11px;color:#94a3b8;display:flex;justify-content:space-between">
      <span>Generated by <strong style="color:#4f46e5">βWave</strong> Citation Tracker</span>
      <span>${stats.total_classified} results classified across ${Object.keys(stats.engine_shares).length} engines</span>
    </div>
  </div>
</body>
</html>`
}

// ─── Email sender ─────────────────────────────────────────────────────────────

async function sendReport(client: any, brand: any, html: string, stats: RunStats): Promise<boolean> {
  // Use client SMTP if configured, otherwise fall back to global agency SMTP.
  // The report goes to the client's contact_email — the agency is sending it
  // on their client's behalf, so the global fallback is intentional here.
  const smtpHost = client.smtp_host || process.env.SMTP_HOST
  const smtpUser = client.smtp_user || process.env.SMTP_USER
  const smtpPass = client.smtp_pass || process.env.SMTP_PASS
  const smtpFrom = client.smtp_from || process.env.SMTP_FROM || smtpUser

  if (!smtpHost || !smtpUser || !smtpPass) {
    console.log(`[citation-report] No SMTP configured (client or global) — report saved but not emailed`)
    return false
  }

  const deltaStr = stats.delta !== null
    ? ` (${stats.delta >= 0 ? '▲' : '▼'}${Math.abs(stats.delta)}pp)`
    : ''

  try {
    const smtpPort = Number(client.smtp_port || process.env.SMTP_PORT || 587)
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    })
    await transporter.sendMail({
      from: smtpFrom,
      to: client.contact_email,
      subject: `📡 ${brand.name} Citation Report — ${stats.overall_share}% share${deltaStr}`,
      html,
    })
    console.log(`[citation-report] Report emailed to ${client.contact_email}`)
    return true
  } catch (err: any) {
    console.error(`[citation-report] Email failed: ${err.message}`)
    return false
  }
}
