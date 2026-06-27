/**
 * Discovery Layer — Visibility Score Engine (OPORD 001 §3.c Loop 2)
 *
 * For each tracked organisation in a vertical, compute:
 *   visibility_score = (citations_earned / citations_available) × engine_weight
 *
 * "citations_earned"   = number of (query × engine) probes where this org's
 *                        domain or canonical name was cited in the answer
 * "citations_available" = total probes run for the vertical in this run
 *                        (i.e. number of vertical queries × number of engines)
 *
 * Engine weights reflect AI-search market share/credibility for B2B buyers:
 *   ChatGPT  0.40   (largest user base)
 *   Claude   0.25   (premium / professional)
 *   Gemini   0.20   (Google integration)
 *   Perplexity 0.15 (research-oriented)
 *
 * Lower visibility_score = better target (more invisible = more pain).
 *
 * Output is persisted to dl_visibility_scores so trends/deltas can be charted.
 */

import db from '../db.js'
import crypto from 'node:crypto'

const ENGINE_WEIGHTS: Record<string, number> = {
  openai:     0.40,
  anthropic:  0.25,
  gemini:     0.20,
  perplexity: 0.15,
}

interface CitationResultRow {
  query_id: string
  engine: string
  brand_mentioned: 0 | 1
  classified_at: number | null
  error: string
}

interface OrgRow {
  id: string
  name: string
  domain: string
}

/**
 * Compute visibility scores for every active organisation in a (client, vertical)
 * against the latest completed citation run for that vertical.
 *
 * Persists one row per org to dl_visibility_scores and returns the ranked list.
 */
export function computeVerticalVisibility(clientId: string, verticalId: string, runId: string) {
  // 1. Pull all classified results for this run
  const results = db.prepare(`
    SELECT cr.query_id, cr.engine, cr.brand_mentioned, cr.classified_at, cr.error,
           cr.raw_response, cr.competitor_mentions_json
    FROM citation_results cr
    JOIN tracked_queries tq ON tq.id = cr.query_id
    WHERE cr.run_id = ?
      AND tq.vertical_id = ?
      AND cr.classified_at IS NOT NULL
      AND cr.error = ''
  `).all(runId, verticalId) as unknown as (CitationResultRow & { raw_response: string; competitor_mentions_json: string })[]

  if (results.length === 0) return []

  // 2. Pull every active org for this client+vertical
  const orgs = db.prepare(`
    SELECT id, name, domain FROM dl_organizations
    WHERE client_id = ? AND vertical_id = ? AND status = 'active'
  `).all(clientId, verticalId) as unknown as OrgRow[]

  if (orgs.length === 0) return []

  // 3. For each org, count citations across the run
  const totalProbes = results.length
  const enginesPresent = Array.from(new Set(results.map(r => r.engine)))

  // Available probes per engine (for per-engine score weighting)
  const probesByEngine: Record<string, number> = {}
  for (const r of results) probesByEngine[r.engine] = (probesByEngine[r.engine] || 0) + 1

  const now = Math.floor(Date.now() / 1000)
  const insert = db.prepare(`
    INSERT INTO dl_visibility_scores
      (id, client_id, organization_id, run_id, vertical_id, score, citations_earned,
       citations_available, per_engine_json, calculated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  // Wipe prior rows for this (client, vertical, run) to keep idempotent
  db.prepare(`
    DELETE FROM dl_visibility_scores
    WHERE client_id = ? AND run_id = ? AND vertical_id = ?
  `).run(clientId, runId, verticalId)

  const scored = orgs.map(org => {
    const earnedByEngine: Record<string, number> = {}
    let totalEarned = 0

    for (const r of results) {
      // brand_mentioned alone isn't enough — that flag is for the *tracked brand*
      // (the client's own brand), not arbitrary orgs. We text-match
      // org.name and org.domain in the raw response, plus check the
      // competitor_mentions_json array (populated by the classifier).
      const text = (r.raw_response || '').toLowerCase()
      const competitors = r.competitor_mentions_json || '[]'
      const nameHit = org.name && text.includes(org.name.toLowerCase())
      const domainHit = org.domain && text.includes(org.domain.toLowerCase())
      const competitorHit = org.name && competitors.toLowerCase().includes(org.name.toLowerCase())
      if (nameHit || domainHit || competitorHit) {
        earnedByEngine[r.engine] = (earnedByEngine[r.engine] || 0) + 1
        totalEarned++
      }
    }

    // Weighted score across engines that actually ran
    let weightedScore = 0
    let usedWeight = 0
    const perEngine: Record<string, { earned: number; available: number; share: number }> = {}

    for (const eng of enginesPresent) {
      const earned = earnedByEngine[eng] || 0
      const available = probesByEngine[eng] || 0
      const share = available > 0 ? earned / available : 0
      const weight = ENGINE_WEIGHTS[eng] ?? 0.1
      weightedScore += share * weight
      usedWeight += weight
      perEngine[eng] = { earned, available, share }
    }

    // Normalise by total weight actually used (so missing engines don't depress score)
    const score = usedWeight > 0 ? weightedScore / usedWeight : 0

    insert.run(
      crypto.randomUUID(),
      clientId,
      org.id,
      runId,
      verticalId,
      score,
      totalEarned,
      totalProbes,
      JSON.stringify(perEngine),
      now,
    )

    return {
      organization_id: org.id,
      name: org.name,
      domain: org.domain,
      score,
      citations_earned: totalEarned,
      citations_available: totalProbes,
      per_engine: perEngine,
    }
  })

  // Sort ascending — lowest score = highest pain = best target
  scored.sort((a, b) => a.score - b.score)
  return scored
}

/**
 * Promote the bottom quartile by visibility score into dl_prospects.
 * Idempotent: existing prospects keep their status; only new orgs are inserted.
 */
export function promoteProspectsForVertical(clientId: string, verticalId: string, runId: string) {
  const scored = computeVerticalVisibility(clientId, verticalId, runId)
  if (scored.length === 0) return { promoted: 0, total: 0 }

  // Bottom quartile (or 25 minimum if vertical is small)
  const cutoffIndex = Math.max(25, Math.floor(scored.length * 0.25))
  const quartile = scored.slice(0, cutoffIndex)

  const now = Math.floor(Date.now() / 1000)
  const upsert = db.prepare(`
    INSERT INTO dl_prospects
      (id, client_id, organization_id, vertical_id, visibility_score, score_calculated_at, rank, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'scored')
    ON CONFLICT(organization_id) DO UPDATE SET
      visibility_score    = excluded.visibility_score,
      score_calculated_at = excluded.score_calculated_at,
      rank                = excluded.rank
  `)

  let promoted = 0
  quartile.forEach((row, i) => {
    upsert.run(
      crypto.randomUUID(),
      clientId,
      row.organization_id,
      verticalId,
      row.score,
      now,
      i + 1,
    )
    promoted++
  })

  return { promoted, total: scored.length }
}

/**
 * Daily delta — who gained/lost citations vs the previous run for the same vertical.
 * Returns { gained, lost, never_cited } for the WhatsApp 0800 BST digest.
 */
export function computeDailyDelta(clientId: string, verticalId: string) {
  const recentRuns = db.prepare(`
    SELECT DISTINCT run_id, calculated_at FROM dl_visibility_scores
    WHERE client_id = ? AND vertical_id = ?
    ORDER BY calculated_at DESC
    LIMIT 2
  `).all(clientId, verticalId) as unknown as { run_id: string; calculated_at: number }[]

  if (recentRuns.length < 1) return { gained: [], lost: [], never_cited: [] }

  const [latest, prior] = recentRuns
  const latestRows = db.prepare(`
    SELECT s.organization_id, s.score, s.citations_earned, o.name, o.domain
    FROM dl_visibility_scores s
    JOIN dl_organizations o ON o.id = s.organization_id
    WHERE s.client_id = ? AND s.run_id = ?
  `).all(clientId, latest.run_id) as any[]

  if (!prior) {
    // First run — everything is "never cited" if 0
    return {
      gained: [],
      lost: [],
      never_cited: latestRows.filter(r => r.citations_earned === 0)
                              .map(r => ({ id: r.organization_id, name: r.name, domain: r.domain })),
    }
  }

  const priorRows = db.prepare(`
    SELECT organization_id, citations_earned FROM dl_visibility_scores
    WHERE client_id = ? AND run_id = ?
  `).all(clientId, prior.run_id) as unknown as { organization_id: string; citations_earned: number }[]

  const priorMap = new Map(priorRows.map(r => [r.organization_id, r.citations_earned]))

  const gained: any[] = []
  const lost: any[] = []
  const neverCited: any[] = []

  for (const r of latestRows) {
    const before = priorMap.get(r.organization_id) ?? 0
    const after = r.citations_earned
    if (after > before) gained.push({ id: r.organization_id, name: r.name, before, after })
    else if (after < before) lost.push({ id: r.organization_id, name: r.name, before, after })
    if (after === 0 && before === 0) neverCited.push({ id: r.organization_id, name: r.name, domain: r.domain })
  }

  return { gained, lost, never_cited: neverCited }
}
