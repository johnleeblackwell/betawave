/**
 * A rate limit for the paths a stranger can reach.
 *
 * WHY IT DID NOT EXIST BEFORE
 *
 * Until this week βWave had exactly two users, both of them known, so an
 * unlimited API was a reasonable trade for not carrying the code. Promoting a
 * public demo link changes the arithmetic completely: the audience becomes
 * everyone, and two of the endpoints a read-only visitor can reach cost real
 * money on every call.
 *
 * WHAT THIS ACTUALLY PROTECTS
 *
 *   - /api/agent/*    every message is an LLM call, several per conversation
 *   - /api/waitlist/* a write, and the one place a stranger can insert a row
 *
 * In-memory on purpose. A shared store would survive restarts and scale across
 * processes, and βWave runs as a single process on one box — so the honest
 * choice is the one with no new dependency and no new failure mode. If this
 * ever runs clustered the counters need to move into SQLite, and the comment
 * on syndication's module-level counters says the same thing.
 *
 * Keyed on IP, which is imperfect — an office behind one NAT shares a bucket.
 * The limits below are set high enough that a genuine evaluator never notices
 * and low enough that a script cannot empty the account, which is the only
 * balance that matters here.
 */
import { Request, Response, NextFunction } from 'express'

interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

// Swept lazily rather than on a timer: an interval would keep the process busy
// forever to tidy a Map that is empty most of the time.
let lastSweep = Date.now()
function sweep (now: number) {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
}

function clientIp (req: Request): string {
  // nginx sits in front, so the socket address is always 127.0.0.1 — the real
  // client is in X-Forwarded-For. Take the FIRST entry: later ones are proxies,
  // and trusting the last would let a caller spoof their way into a fresh
  // bucket by adding a header.
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return fwd || req.socket.remoteAddress || 'unknown'
}

/**
 * @param max     requests allowed per window
 * @param windowS window length in seconds
 * @param label   what to call it in the log, so a real block is diagnosable
 */
export function rateLimit (max: number, windowS: number, label: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    sweep(now)
    const key = `${label}:${clientIp(req)}`
    const b = buckets.get(key)

    if (!b || b.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowS * 1000 })
      return next()
    }
    if (b.count >= max) {
      const retry = Math.ceil((b.resetAt - now) / 1000)
      res.setHeader('Retry-After', String(retry))
      console.warn(`[rate-limit] ${label} blocked ${clientIp(req)} (${b.count}/${max})`)
      // A human-readable reason, because this is reached by prospects and a
      // bare 429 in a demo reads as a broken product rather than a limit.
      return res.status(429).json({
        error: `Steady on — that is a lot of requests. Try again in ${retry}s.`,
      })
    }
    b.count++
    next()
  }
}
