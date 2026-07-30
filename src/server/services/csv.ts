/**
 * CSV parsing that survives real exports.
 *
 * Written because the Discovery bulk import used `line.split(',')`, which
 * shreds any file containing a quoted comma — and every business export has
 * them, because addresses look like "280 W 81st St, New York, NY 10024". Each
 * such row silently shifted its columns, so phone numbers landed in address
 * fields and nobody noticed until the data was already in.
 *
 * Handles: quoted fields, escaped quotes (""), embedded commas, embedded
 * NEWLINES inside quotes (multi-line address fields are common), CRLF, and a
 * UTF-8 BOM. Deliberately dependency-free — this is a self-hosted product and
 * a CSV parser is not worth a supply-chain risk.
 */

/** Split raw CSV text into rows of raw cells. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuotes = false

  const src = text.replace(/^﻿/, '')     // strip BOM

  for (let i = 0; i < src.length; i++) {
    const c = src[i]

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++ }   // escaped quote
        else inQuotes = false
      } else cur += c
      continue
    }

    if (c === '"') { inQuotes = true; continue }
    if (c === ',') { row.push(cur); cur = ''; continue }
    if (c === '\r') continue                          // CRLF — handled by \n
    if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; continue }
    cur += c
  }
  // Final cell/row (files often lack a trailing newline)
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }

  return rows.filter(r => r.some(c => c.trim() !== ''))
}

/**
 * Parse to objects keyed by NORMALISED header (lowercased, non-alphanumerics
 * collapsed to underscore) so "Google Rating", "google_rating" and
 * "GOOGLE-RATING" all land on the same key. Callers then alias from there.
 */
export function parseCsvObjects(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text)
  if (rows.length < 2) return []
  const headers = rows[0].map(normaliseHeader)
  return rows.slice(1).map(cells => {
    const o: Record<string, string> = {}
    headers.forEach((h, i) => { if (h) o[h] = (cells[i] ?? '').trim() })
    return o
  })
}

export function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

/**
 * First non-empty value among candidate keys, matched loosely.
 *
 * Loose on purpose: lead tools rename columns between versions and localise
 * them, and this has to accept an export we have never seen without the user
 * editing their file first. Exact match wins before substring, so a column
 * literally called "email" beats "email_status".
 */
export function pick(row: Record<string, string>, ...candidates: string[]): string {
  for (const c of candidates) {
    const v = row[c]
    if (v && v.trim()) return v.trim()
  }
  const keys = Object.keys(row)
  for (const c of candidates) {
    const k = keys.find(k => k.includes(c) && row[k]?.trim())
    if (k) return row[k].trim()
  }
  return ''
}

/** Extract the first plausible email from a cell that may hold several. */
export function firstEmail(s: string): string {
  const m = (s || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return m ? m[0].toLowerCase() : ''
}

/** Hostname from a URL-ish string, or '' — never throws on malformed input. */
export function domainFrom(urlish: string): string {
  const s = (urlish || '').trim()
  if (!s) return ''
  try {
    return new URL(s.startsWith('http') ? s : `https://${s}`).hostname.replace(/^www\./, '').toLowerCase()
  } catch { return '' }
}
