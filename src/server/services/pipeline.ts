/**
 * Outreach pipeline — stages and cadence.
 *
 * The whole CRM is two columns on dl_contacts: `stage` and `next_action_at`.
 * Everything else (today's follow-ups, what's stalled, conversion by stage) is
 * a query over those two. Kept deliberately small: a heavier model would need
 * maintaining, and the thing that actually earns replies is simply returning to
 * people on schedule.
 *
 * Cadence is measured in days from the touch just recorded. The gaps widen
 * because a same-day chase reads as desperate and a fortnight's silence reads
 * as forgotten.
 */

export type Stage =
  | 'new'
  | 'touch_1' | 'touch_2' | 'touch_3'
  | 'replied' | 'discussing' | 'call_booked' | 'trial'
  | 'won' | 'lost' | 'nurture'

/** Stages that still want work. Anything else has left the queue. */
export const ACTIVE_STAGES: Stage[] = ['new', 'touch_1', 'touch_2', 'touch_3', 'replied', 'discussing', 'call_booked', 'trial']

/** Stages a human closed out — never auto-scheduled, never re-queued. */
export const TERMINAL_STAGES: Stage[] = ['won', 'lost']

export const ALL_STAGES: Stage[] = [
  'new', 'touch_1', 'touch_2', 'touch_3', 'replied', 'discussing', 'call_booked', 'trial', 'won', 'lost', 'nurture',
]

export function isStage(s: unknown): s is Stage {
  return typeof s === 'string' && (ALL_STAGES as string[]).includes(s)
}

/**
 * Where a contact goes after an outbound touch, and when to come back.
 *
 * Touch 3 is the last cold attempt — after that they go to `nurture` rather
 * than `lost`, because "no answer" is not "no". They stay reachable when
 * there's a genuine reason to make contact, without clogging the daily queue.
 */
/** Days before a nurtured contact resurfaces. Long enough that a fresh
 *  approach is legitimate rather than nagging; short enough that the list stays
 *  an asset instead of a graveyard. Their situation changes — new budget, new
 *  boss, an agency that just disappointed them — and none of that is visible
 *  from outside. */
export const NURTURE_RESURFACE_DAYS = 90

const NEXT_AFTER_TOUCH: Record<string, { stage: Stage; days: number | null }> = {
  new:     { stage: 'touch_1', days: 3 },
  touch_1: { stage: 'touch_2', days: 5 },
  /**
   * TWO TOUCHES, THEN STOP. Measured, not assumed.
   *
   * Across 781 contacted people: touch 1 produced 0 replies from 393, touch 2
   * produced all 6 from 315, and touch 3 produced 0 from 72. Every reply this
   * business has ever received arrived at touch 2.
   *
   * So touch 3 is not a weaker touch, it is a worthless one — and it is the
   * message where someone who has ignored you twice concludes you are not going
   * to stop. That is the message that gets reported, and a spam report costs the
   * whole account, not one contact.
   *
   * They go to nurture rather than lost, because no answer is still not a no.
   */
  touch_2: { stage: 'nurture', days: NURTURE_RESURFACE_DAYS },
  // Kept so anyone already sitting at touch_3 from the old cadence lands
  // somewhere sane instead of falling through to the `new` default and being
  // pitched as a stranger.
  touch_3: { stage: 'nurture', days: NURTURE_RESURFACE_DAYS },
  // Someone already engaged: keep chasing, but on a human interval.
  replied:     { stage: 'replied',     days: 3 },
  // A live conversation where the ball is in THEIR court — you have answered
  // and are waiting. Chasing tomorrow reads as impatient; leaving it a week
  // lets a warm thread cool. Four days is the interval that respects both.
  discussing:  { stage: 'discussing',  days: 4 },
  call_booked: { stage: 'call_booked', days: 3 },
  trial:       { stage: 'trial',       days: 7 },
  // A nurtured contact you touch again goes back into the queue on the same
  // quarterly rhythm rather than falling silent for good.
  nurture:     { stage: 'nurture',     days: NURTURE_RESURFACE_DAYS },
}

export interface Advance { stage: Stage; next_action_at: number | null }

/** Advance after recording an outbound touch. */
export function advanceAfterTouch(current: string, now = Math.floor(Date.now() / 1000)): Advance {
  const rule = NEXT_AFTER_TOUCH[current] ?? NEXT_AFTER_TOUCH.new
  return {
    stage: rule.stage,
    next_action_at: rule.days === null ? null : now + rule.days * 86400,
  }
}

/**
 * A reply always wins. Whatever the cadence had planned, a human responding
 * outranks it — jump straight to `replied` and come back tomorrow, because a
 * warm reply left for three days goes cold.
 */
export function advanceAfterReply(now = Math.floor(Date.now() / 1000)): Advance {
  return { stage: 'replied', next_action_at: now + 86400 }
}

/**
 * Human-set stage.
 *
 * Won/lost clear the schedule — those are decisions, not pauses. Nurture does
 * NOT: it is where "not right now" belongs, and the whole point of that answer
 * is that it has an expiry date. Clearing the schedule would turn a soft no
 * into a permanent one, which is the commonest way a pipeline quietly leaks.
 */
export function setStage(stage: Stage, now = Math.floor(Date.now() / 1000)): Advance {
  if (TERMINAL_STAGES.includes(stage)) return { stage, next_action_at: null }
  if (stage === 'nurture') return { stage, next_action_at: now + NURTURE_RESURFACE_DAYS * 86400 }
  if (stage === 'new') return { stage, next_action_at: null }
  const rule = NEXT_AFTER_TOUCH[stage]
  return { stage, next_action_at: rule?.days ? now + rule.days * 86400 : now + 3 * 86400 }
}

export const STAGE_LABEL: Record<Stage, string> = {
  new: 'Not contacted',
  touch_1: 'Touch 1 sent',
  touch_2: 'Touch 2 sent',
  touch_3: 'Touch 3 sent',
  replied: 'Replied',
  discussing: 'In conversation',
  call_booked: 'Call booked',
  trial: 'Trialling',
  won: 'Won',
  lost: 'Lost',
  nurture: 'Nurture',
}
