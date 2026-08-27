/**
 * A demo tenant must never reach the outside world or spend money.
 *
 * WHY THIS IS ONE PLACE AND NOT SIX
 *
 * The demo client is wired into the scheduler exactly like a real one, because
 * that is what makes it a convincing demonstration. The cost of that realism is
 * that every piece of scheduled work will happily act on it:
 *
 *   - Citation runs fired ~48 live calls a week at Claude, GPT, Gemini and
 *     Perplexity asking whether anyone mentions an invented business. £5.61
 *     before anyone noticed, on an account with a £100 monthly ceiling.
 *   - Syndication routes would have posted to handles nobody owns.
 *   - Approving one of the demo's pending replies would have tried to send it
 *     to a real platform.
 *
 * Each of those was guarded individually as it was found, which is how you end
 * up with five subtly different guards and a sixth job that has none. The
 * per-job checks were also the wrong SHAPE: they tested "does this destination
 * have credentials", so the guarantee rested on somebody remembering to leave a
 * token blank in seed data.
 *
 * The right question is about the TENANT. Invented data does not get to touch
 * anything real, whatever credentials happen to be lying next to it.
 */
import db from '../db.js'

/**
 * A SQL fragment for any query with a `client_id` column in scope.
 *
 * Written as a subquery rather than a join so it drops into an existing WHERE
 * clause without touching the FROM — the reason several of these guards were
 * not added sooner is that retrofitting a join into a working query is exactly
 * the kind of edit people postpone.
 *
 *   WHERE enabled = 1 AND ${NOT_DEMO}
 *   WHERE sr.status = 'approved' AND ${NOT_DEMO('sa.client_id')}
 */
export const NOT_DEMO = (col = 'client_id') =>
  `${col} NOT IN (SELECT id FROM clients WHERE COALESCE(is_demo, 0) = 1)`

/** True when this client is a demonstration tenant. */
export function isDemoClient (clientId: string | null | undefined): boolean {
  if (!clientId) return false
  try {
    const r = db.prepare('SELECT COALESCE(is_demo, 0) AS d FROM clients WHERE id = ?').get(clientId) as any
    return !!r?.d
  } catch { return false }
}

/**
 * Guard for code paths that are not a SQL query — a loop over rows already
 * fetched, or an external call about to be made.
 *
 * Returns true when the work should be SKIPPED, so it reads as an early exit:
 *
 *   if (skipForDemo(clientId, 'x-mentions')) continue
 */
export function skipForDemo (clientId: string | null | undefined, what = 'work'): boolean {
  if (!isDemoClient(clientId)) return false
  console.log(`[demo-guard] skipped ${what} for demonstration tenant ${clientId}`)
  return true
}
