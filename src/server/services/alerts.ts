/**
 * Ops alerting — emails the operator when something silently breaks.
 *
 * Born from a real incident: the syndication feed died 3× from EXTERNAL
 * provider billing (X credits, then spend cap), each caught only by eyeballing
 * x.com. This makes a dead feed page you instead of embarrassing you.
 *
 * Design:
 *  - Alerts ONCE per incident (state + cooldown persisted in app_state), not
 *    every 30-min tick.
 *  - Sends a recovery notice when posting resumes.
 *  - SMTP from .env; recipient = ALERT_EMAIL (falls back to SMTP_USER).
 *  - Never throws into the scheduler — a broken mailer must not break posting.
 */
import nodemailer from 'nodemailer'
import db from '../db.js'

const STATE_KEY = 'ops_alert_syndication'
const COOLDOWN_HOURS = 6 // don't re-alert the same ongoing incident more often than this

interface AlertState { failing: boolean; lastAlertAt: number; lastError: string }

function readState(): AlertState {
  const row = db.prepare(`SELECT value FROM app_state WHERE key = ?`).get(STATE_KEY) as { value?: string } | undefined
  try { return row?.value ? JSON.parse(row.value) : { failing: false, lastAlertAt: 0, lastError: '' } }
  catch { return { failing: false, lastAlertAt: 0, lastError: '' } }
}
function writeState(s: AlertState): void {
  db.prepare(`INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(STATE_KEY, JSON.stringify(s))
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Generic operator email. Returns true if sent. Never throws. */
export async function sendOpsAlert(subject: string, html: string): Promise<boolean> {
  try {
    const host = process.env.SMTP_HOST
    const port = Number(process.env.SMTP_PORT || 587)
    const user = process.env.SMTP_USER
    const pass = process.env.SMTP_PASS
    const from = process.env.SMTP_FROM || user
    const to = process.env.ALERT_EMAIL || user
    if (!host || !user || !pass || !to) {
      console.warn('[alerts] SMTP or ALERT_EMAIL not configured — alert NOT sent:', subject)
      return false
    }
    const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
    await transporter.sendMail({ from, to, subject, html })
    console.log(`[alerts] sent → ${to}: ${subject}`)
    return true
  } catch (e) {
    console.error('[alerts] send failed:', (e as Error).message)
    return false
  }
}

/** Map a raw provider error to a human cause — the silent feed-killers first. */
function classify(err: string): string {
  if (/402|CreditsDepleted|credits/i.test(err)) return 'X API — credits depleted (billing)'
  if (/403|SpendCapReached|spend\s*cap/i.test(err)) return 'X API — spend cap reached (billing)'
  if (/401|unauthor|invalid.*(token|credential)/i.test(err)) return 'API auth failure (token/credentials expired)'
  if (/429|rate.?limit/i.test(err)) return 'API rate limit'
  return 'posting failure'
}

/**
 * Call after each syndication tick. Fires one alert when the feed goes down
 * (cooldown-gated) and a recovery notice when it returns.
 */
export async function checkSyndicationHealth(result: { posted: number; failed: number; skipped: number }): Promise<void> {
  const state = readState()
  const now = Math.floor(Date.now() / 1000)

  // FEED DOWN — attempts are failing and nothing got out.
  if (result.failed > 0 && result.posted === 0) {
    const row = db.prepare(`SELECT error FROM syndications WHERE status = 'failed' AND error IS NOT NULL ORDER BY id DESC LIMIT 1`).get() as { error?: string } | undefined
    const err = row?.error || 'unknown error'
    const reason = classify(err)
    const hoursSinceAlert = (now - state.lastAlertAt) / 3600
    const shouldAlert = !state.failing || hoursSinceAlert >= COOLDOWN_HOURS

    if (shouldAlert) {
      const sent = await sendOpsAlert(
        `🔴 βWave: syndication blocked — ${reason}`,
        `<h2 style="color:#b91c1c">Syndication is failing</h2>
         <p><b>Cause:</b> ${escapeHtml(reason)}</p>
         <p><b>Last tick:</b> posted=${result.posted}, failed=${result.failed}, skipped=${result.skipped}</p>
         <p><b>Provider error:</b><br><code style="font-size:12px">${escapeHtml(err).slice(0, 500)}</code></p>
         <p>Posts are not going out. If this is a billing block, top up or raise the spend cap on the provider account. βWave will email again when it recovers.</p>`,
      )
      writeState({ failing: true, lastAlertAt: sent ? now : state.lastAlertAt, lastError: err })
    } else {
      writeState({ failing: true, lastAlertAt: state.lastAlertAt, lastError: err })
    }
    return
  }

  // RECOVERED — was failing, now posting again.
  if (result.posted > 0 && state.failing) {
    await sendOpsAlert(
      `✅ βWave: syndication recovered`,
      `<h2 style="color:#15803d">Syndication is posting again</h2>
       <p>Last tick posted ${result.posted}. The previous block has cleared.</p>`,
    )
    writeState({ failing: false, lastAlertAt: state.lastAlertAt, lastError: '' })
  }
}
