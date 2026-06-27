// @ts-nocheck
// Public routes for aim.report niche reports.
//  GET  /r/:niche             → landing page with email capture form
//  POST /r/:niche/capture     → HTML-form fallback for JS-disabled visitors
//  GET  /r/:niche/download    → deliver the full HTML report (requires ?lead=<id>)
//
// These routes are intentionally not under /api because they're the user-facing
// entry points that will eventually be served at aim.report/{niche}.
import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { subscribeToKit } from '../services/kit.js'

const router = Router() as any

// Escape user-supplied strings for safe embedding in HTML.
function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Render the landing page HTML. Placeholder brand system — clean editorial look
// that works for any niche. Swap for bespoke designs later.
function renderLanding(report: any): string {
  const hero = report.hero_copy || `An in-depth report on the ${report.niche} space — built for operators, written for humans.`
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(report.title)} · aim.report</title>
<meta name="description" content="${esc(report.subtitle || hero.slice(0, 150))}">
<style>
  :root { --ink:#0f172a; --accent:#d97706; --muted:#64748b; --bg:#fdfcf8; --line:#e2e8f0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Georgia, 'Times New Roman', serif; color: var(--ink); background: var(--bg); line-height: 1.7; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 72px 24px 80px; }
  .brand { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 2px; color: var(--muted); margin-bottom: 36px; font-family: system-ui, sans-serif; }
  .brand strong { color: var(--accent); }
  h1 { font-size: 2.5rem; line-height: 1.15; margin: 0 0 14px; }
  .subtitle { font-size: 1.15rem; color: var(--muted); margin-bottom: 36px; }
  .hero { font-size: 1.05rem; margin-bottom: 40px; border-left: 3px solid var(--accent); padding-left: 20px; }
  form { margin: 40px 0; padding: 24px; background: #fff; border: 1px solid var(--line); border-radius: 10px; }
  label { display: block; font-family: system-ui, sans-serif; font-size: 0.8rem; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
  input[type=email], input[type=text] { width: 100%; padding: 12px 14px; font-size: 1rem; font-family: Georgia, serif; border: 1px solid var(--line); border-radius: 6px; margin-bottom: 16px; background: var(--bg); }
  input:focus { outline: none; border-color: var(--accent); }
  .consent { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 18px; font-family: system-ui, sans-serif; font-size: 0.8rem; color: var(--muted); }
  button { background: var(--accent); color: #fff; font-family: system-ui, sans-serif; font-size: 1rem; font-weight: 600; padding: 14px 24px; border: none; border-radius: 6px; cursor: pointer; width: 100%; transition: background 0.15s; }
  button:hover { background: #b45309; }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  .footer { margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--line); font-family: system-ui, sans-serif; font-size: 0.78rem; color: var(--muted); }
  .status { padding: 14px; border-radius: 6px; margin-top: 14px; font-family: system-ui, sans-serif; font-size: 0.9rem; display: none; }
  .status.ok { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
  .status.err { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
</style>
</head><body><div class="wrap">
<div class="brand"><strong>aim</strong>.report</div>
<h1>${esc(report.title)}</h1>
${report.subtitle ? `<div class="subtitle">${esc(report.subtitle)}</div>` : ''}
<div class="hero">${esc(hero)}</div>

<form id="capture" method="POST" action="/r/${esc(report.niche)}/capture">
  <label for="email">Your email</label>
  <input type="email" id="email" name="email" required placeholder="you@company.com">
  <label for="name">Name <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></label>
  <input type="text" id="name" name="name" placeholder="First name">
  <div class="consent">
    <input type="checkbox" id="consent" name="consent_marketing" checked>
    <label for="consent" style="text-transform:none;letter-spacing:0;margin:0;color:var(--muted);font-weight:400">
      Yes, send me occasional emails about ${esc(report.niche.replace(/-/g, ' '))} — unsubscribe anytime.
    </label>
  </div>
  <button type="submit" id="btn">Download the report</button>
  <div class="status" id="status"></div>
</form>

<div class="footer">
  aim.report · published ${new Date((report.created_at || 0) * 1000).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
</div>
</div>

<script>
// Progressive enhancement — submit via fetch for instant feedback, fall back to
// the form action attribute if JS is disabled.
(function() {
  var form = document.getElementById('capture');
  var status = document.getElementById('status');
  var btn = document.getElementById('btn');
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = 'Sending…';
    status.style.display = 'none';
    try {
      var res = await fetch('/api/reports/${esc(report.id)}/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('email').value,
          name: document.getElementById('name').value,
          consent_marketing: document.getElementById('consent').checked,
          source: 'landing',
        })
      });
      if (!res.ok) throw new Error();
      var data = await res.json();
      window.location.href = data.download_url;
    } catch (err) {
      status.className = 'status err';
      status.textContent = 'Something went wrong. Please try again.';
      status.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Download the report';
    }
  });
})();
</script>
</body></html>`
}

// Landing page
router.get('/r/:niche', (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE niche = ?').get(req.params.niche) as any
  if (!report) return res.status(404).send('<h1>Not found</h1>')
  if (report.status !== 'published') {
    // Draft reports render behind a ?preview=1 flag so we can QA before going live.
    if (req.query.preview !== '1') return res.status(404).send('<h1>Not found</h1>')
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(renderLanding(report))
})

// No-JS form fallback — redirects to download URL with ?lead= appended.
router.post('/r/:niche/capture', async (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE niche = ?').get(req.params.niche) as any
  if (!report) return res.status(404).send('Not found')

  const email = (req.body?.email || '').toString().toLowerCase().trim()
  if (!email.includes('@')) return res.status(400).send('Invalid email')

  const id = uuid()
  const name = (req.body?.name || '').toString()
  const consent = req.body?.consent_marketing ? 1 : 0

  db.prepare(`
    INSERT INTO report_leads (id, report_id, email, name, source, consent_marketing, ip, user_agent)
    VALUES (?, ?, ?, ?, 'landing-nojs', ?, ?, ?)
  `).run(
    id, report.id, email, name, consent,
    (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '',
    (req.headers['user-agent'] as string) || ''
  )

  const kit = await subscribeToKit(email, { name, tags: [`report:${report.niche}`] })
  if (kit.ok) db.prepare('UPDATE report_leads SET kit_synced = 1 WHERE id = ?').run(id)

  res.redirect(`/r/${req.params.niche}/download?lead=${id}`)
})

// Deliver the report body. We verify the lead ID belongs to this report so
// direct-linking without capture doesn't bypass the gate.
router.get('/r/:niche/download', (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE niche = ?').get(req.params.niche) as any
  if (!report) return res.status(404).send('Not found')

  const leadId = req.query.lead as string
  if (!leadId) return res.status(403).send('<h1>Access required</h1><p>Please request the report via the landing page.</p>')

  const lead = db.prepare('SELECT id FROM report_leads WHERE id = ? AND report_id = ?').get(leadId, report.id)
  if (!lead) return res.status(403).send('<h1>Invalid access link</h1>')

  if (!report.body_html) return res.status(503).send('<h1>Report not yet generated</h1>')

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(report.body_html)
})

export default router
