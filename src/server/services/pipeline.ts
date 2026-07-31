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
  | 'replied' | 'call_booked' | 'trial'
  | 'won' | 'lost' | 'nurture'

/** Stages that still want work. Anything else has left the queue. */
export const ACTIVE_STAGES: Stage[] = ['new', 'touch_1', 'touch_2', 'touch_3', 'replied', 'call_booked', 'trial']

/** Stages a human closed out — never auto-scheduled, never re-queued. */
export const TERMINAL_STAGES: Stage[] = ['won', 'lost']

export const ALL_STAGES: Stage[] = [
  'new', 'touch_1', 'touch_2', 'touch_3', 'replied', 'call_booked', 'trial', 'won', 'lost', 'nurture',
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
const NEXT_AFTER_TOUCH: Record<string, { stage: Stage; days: number | null }> = {
  new:     { stage: 'touch_1', days: 3 },
  touch_1: { stage: 'touch_2', days: 5 },
  touch_2: { stage: 'touch_3', days: 7 },
  touch_3: { stage: 'nurture', days: null },   // sequence exhausted
  // Someone already engaged: keep chasing, but on a human interval.
  replied:     { stage: 'replied',     days: 3 },
  call_booked: { stage: 'call_booked', days: 3 },
  trial:       { stage: 'trial',       days: 7 },
  nurture:     { stage: 'nurture',     days: null },
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

/** Human-set stage. Terminal and nurture stages clear the schedule. */
export function setStage(stage: Stage, now = Math.floor(Date.now() / 1000)): Advance {
  if (TERMINAL_STAGES.includes(stage) || stage === 'nurture') {
    return { stage, next_action_at: null }
  }
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
  call_booked: 'Call booked',
  trial: 'Trialling',
  won: 'Won',
  lost: 'Lost',
  nurture: 'Nurture',
}
