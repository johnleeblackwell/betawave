/**
 * One place that decides what currency the UI speaks.
 *
 * WHY THIS EXISTS
 *
 * Every cost in the database is sterling and correctly so — `estimateCostGbp`
 * takes the providers' USD per-token rates and converts once, so `cost_gbp` is
 * a real number in a real currency, not a mislabelled one.
 *
 * The display was a different matter. Fourteen components each hardcoded a "£"
 * next to `cost_gbp.toFixed(4)`, which is right for the person paying the bill
 * and wrong for everybody else — and everybody else is now the audience. The
 * demo is aimed at the American market, and a US prospect reading "£0.0041"
 * has to do a conversion in their head before they can judge whether the
 * running cost is cheap. That hesitation is happening at exactly the moment
 * the number was supposed to be doing the selling.
 *
 * So: the ledger stays sterling, and the presentation layer converts. One
 * function, one env var, and the symbol stops being a decision made
 * independently in fourteen files.
 *
 * The rate is deliberately a constant rather than a live feed. These are
 * fractions of a cent shown to give a sense of scale — a daily FX call to move
 * the fourth decimal place would be machinery serving no reader.
 */

/** Sterling per USD, as used by the server's own cost conversion. */
const GBP_PER_USD = 0.79

export type DisplayCurrency = 'USD' | 'GBP'

/**
 * USD unless someone says otherwise. The old behaviour is one env var away
 * for John's own instance, where sterling is what the bank actually charges.
 */
export const DISPLAY_CURRENCY: DisplayCurrency =
  (import.meta.env.VITE_DISPLAY_CURRENCY as DisplayCurrency) === 'GBP' ? 'GBP' : 'USD'

export const CURRENCY_SYMBOL = DISPLAY_CURRENCY === 'GBP' ? '£' : '$'

/** Convert a stored sterling amount into whatever the UI is speaking. */
export function fromGbp (gbp: number): number {
  return DISPLAY_CURRENCY === 'GBP' ? gbp : gbp / GBP_PER_USD
}

/**
 * Format a stored sterling amount for display.
 *
 * `dp` defaults to 2 because most call sites are whole amounts. The per-call
 * costs pass 3 or 4 — an LLM call routinely costs less than a penny, and
 * rounding it to two places renders the entire ledger as "$0.00", which reads
 * as broken rather than as cheap.
 */
export function fmtMoney (gbp: number, dp = 2): string {
  return `${CURRENCY_SYMBOL}${fromGbp(gbp).toFixed(dp)}`
}

/** Sub-penny amounts need more places than round ones. Used by the cost columns. */
export function fmtCost (gbp: number): string {
  const v = fromGbp(gbp)
  return `${CURRENCY_SYMBOL}${v < 0.01 ? v.toFixed(4) : v.toFixed(3)}`
}
