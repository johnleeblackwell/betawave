/**
 * A hard ceiling on LLM spend, and the model choice for each job.
 *
 * WHY THIS EXISTS
 *
 * The pitch drafter was pinned to claude-fable-5 in a source file, on the
 * reasoning that outreach is "a handful of calls a day, so quality beats token
 * cost". Nobody agreed to that, and the premise expired the moment daily volume
 * went from a handful to 161: 579 drafts cost £33.33 where a mid-range model
 * would have cost about £5. The per-draft badge showed pennies, so the total was
 * invisible until the API account hit its spend limit — at which point every
 * draft silently downgraded to the cheapest model in the fallback chain and kept
 * going, with no warning, for a day and a half.
 *
 * The same model had already been copied into the cold-email route, and four
 * unattended services (scheduler, pSEO, reports, citation gap content) were on
 * Opus. The scheduler polls every 60 seconds with nobody watching.
 *
 * Two rules follow, and they are the whole point of this file:
 *
 *   1. NO MODEL IS CHOSEN IN A SOURCE FILE. Every job resolves its model through
 *      modelFor(), which reads the operator's configuration first. A default
 *      here is a fallback, never a decision, and defaults are mid-range.
 *
 *   2. SPEND STOPS, IT DOES NOT DEGRADE. Past the ceiling, calls throw. A job
 *      that fails loudly gets noticed in minutes; one that quietly switches to a
 *      worse model does not get noticed at all.
 */
import db from '../db.js'

/** What a call is for. Drives both the model default and how it's budgeted. */
export type Job =
  | 'pitch'          // one message, one named human — quality matters, volume is high
  | 'email'          // as above, by email
  | 'content'        // blogs, posts, newsletters
  | 'pseo'           // bulk page generation — volume risk
  | 'report'         // client reports
  | 'classify'       // mechanical: tagging, extraction, scoring
  | 'agent'          // the in-app assistant, driven by a human in real time

/**
 * Defaults, deliberately mid-range or cheaper.
 *
 * Anything a human reads and edits before it goes out does NOT need a top-tier
 * model — the human is the quality gate. Anything mechanical gets the cheapest
 * model that can do the job.
 */
const DEFAULTS: Record<Job, string> = {
  // Opus 5 on everything a human reads before it goes out — John's explicit
  // instruction on 14 Aug after lifting the Anthropic cap. Roughly £0.015 a
  // draft; at 45 a day that is about £20 a month, and the messages are the
  // thing that generates the revenue, so it is the last place to economise.
  pitch:    'claude-opus-5',
  email:    'claude-opus-5',
  content:  'claude-opus-5',
  report:   'claude-opus-5',
  agent:    'claude-opus-5',
  // These two stay cheap on purpose and it is not a compromise: pSEO is bulk
  // page generation where volume, not nuance, is the risk, and classification
  // is mechanical tagging. Paying Opus rates to decide whether a job title
  // contains the word "founder" would be waste, not quality.
  pseo:     'claude-haiku-4-5',
  classify: 'claude-haiku-4-5',
}

/**
 * Resolution order, most specific first:
 *   MODEL_PITCH=…            per-job env override
 *   LLM_MODEL_DEFAULT=…      one override for everything
 *   client.llm_content_model the client's own setting
 *   DEFAULTS[job]            the fallback above
 *
 * Setting any of these to "default" hands the choice back to the provider layer.
 */
export function modelFor(job: Job, client?: any): string | undefined {
  const perJob = (process.env[`MODEL_${job.toUpperCase()}`] || '').trim()
  if (perJob) return perJob === 'default' ? undefined : perJob

  const global = (process.env.LLM_MODEL_DEFAULT || '').trim()
  if (global) return global === 'default' ? undefined : global

  const fromClient = String(client?.llm_content_model || '').trim()
  if (fromClient) return fromClient

  return DEFAULTS[job]
}

/** Spend so far today, in GBP, across every provider. */
export function spentTodayGbp(): number {
  const r = db.prepare(
    `SELECT COALESCE(SUM(cost_gbp), 0) AS g FROM llm_usage
     WHERE created_at >= unixepoch('now', 'start of day')`,
  ).get() as any
  return Number(r?.g || 0)
}

/** Spend so far this calendar month, in GBP. */
export function spentThisMonthGbp(): number {
  const r = db.prepare(
    `SELECT COALESCE(SUM(cost_gbp), 0) AS g FROM llm_usage
     WHERE created_at >= unixepoch('now', 'start of month')`,
  ).get() as any
  return Number(r?.g || 0)
}

const num = (v: string | undefined, fallback: number) => {
  const n = Number(String(v ?? '').trim())
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Ceilings. Generous enough not to interrupt normal work, low enough to catch
 *  a runaway before it becomes a bill worth arguing about. Override in .env. */
export const DAILY_LIMIT_GBP = num(process.env.LLM_DAILY_LIMIT_GBP, 5)
export const MONTHLY_LIMIT_GBP = num(process.env.LLM_MONTHLY_LIMIT_GBP, 50)

export class SpendLimitError extends Error {
  readonly code = 'SPEND_LIMIT'
  constructor(public readonly scope: 'day' | 'month', public readonly spent: number, public readonly limit: number) {
    super(
      `LLM spend limit reached for the ${scope}: £${spent.toFixed(2)} of £${limit.toFixed(2)}. ` +
      `Nothing has been generated. Raise LLM_${scope === 'day' ? 'DAILY' : 'MONTHLY'}_LIMIT_GBP in .env, ` +
      `or wait for the ${scope} to roll over.`,
    )
  }
}

/**
 * Called before every generation. Throws rather than downgrading.
 *
 * Checked BEFORE the call rather than after, so the limit is a ceiling on what
 * can be spent rather than a report on what already was. A single call can still
 * carry the total slightly past the limit; the next one will not run.
 */
export function assertWithinBudget(): void {
  const month = spentThisMonthGbp()
  if (month >= MONTHLY_LIMIT_GBP) throw new SpendLimitError('month', month, MONTHLY_LIMIT_GBP)
  const day = spentTodayGbp()
  if (day >= DAILY_LIMIT_GBP) throw new SpendLimitError('day', day, DAILY_LIMIT_GBP)
}

/** For status displays — what's been spent and what's left. */
export function budgetStatus() {
  const day = spentTodayGbp(), month = spentThisMonthGbp()
  return {
    day_spent_gbp: Number(day.toFixed(4)),
    day_limit_gbp: DAILY_LIMIT_GBP,
    month_spent_gbp: Number(month.toFixed(4)),
    month_limit_gbp: MONTHLY_LIMIT_GBP,
    day_pct: Math.round((day / DAILY_LIMIT_GBP) * 100),
    month_pct: Math.round((month / MONTHLY_LIMIT_GBP) * 100),
  }
}
