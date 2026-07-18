/**
 * Discovery Layer routes — client-scoped.
 *
 * Mounted at /api/clients/:clientId/discovery
 *   GET    /verticals                       — verticals for this client
 *   POST   /verticals                       — create one
 *   PATCH  /verticals/:vid                  — update
 *   DELETE /verticals/:vid                  — delete (cascade clears children)
 *   POST   /verticals/seed                  — seed a curated template
 *
 *   GET    /verticals/:vid/organizations    — orgs in vertical
 *   POST   /verticals/:vid/organizations    — add one
 *   POST   /verticals/:vid/organizations/bulk — CSV bulk import
 *   PATCH  /organizations/:id               — update
 *   DELETE /organizations/:id               — delete
 *
 *   GET    /organizations/:id/contacts      — contacts for an org
 *   POST   /organizations/:id/contacts      — add contact
 *   POST   /contacts/bulk                   — Leadswift CSV import (matches by domain within this client)
 *   PATCH  /contacts/:id                    — update
 *   DELETE /contacts/:id                    — delete
 *
 *   GET    /verticals/:vid/prospects        — ranked prospects
 *   POST   /verticals/:vid/score            — recompute visibility scores ({ run_id })
 *   POST   /verticals/:vid/promote          — promote bottom quartile to prospects ({ run_id })
 *   GET    /verticals/:vid/delta            — daily delta
 *
 *   PATCH  /prospects/:id                   — update prospect status/notes
 *
 *   GET    /llm/test                        — ping configured LLM provider
 *   POST   /llm/generate                    — manual generate (for UI testing)
 */
import { Router } from 'express'
import crypto from 'node:crypto'
import db from '../db.js'
import {
  computeVerticalVisibility,
  promoteProspectsForVertical,
  computeDailyDelta,
} from '../services/discovery-visibility.js'
import { generate, ping } from '../services/llm.js'
import { findEmail, verifyEmail } from '../services/email-finder.js'

const router = Router({ mergeParams: true })

// ─── Vertical templates (curated seeds users can adopt for a client) ─────────
const VERTICAL_TEMPLATES: Record<string, Array<{ slug: string; name: string; description: string; minLocations?: number }>> = {
  // Local high-LTV service businesses, single-site included (minLocations 1) —
  // built for an owner-operated-practice outbound sprint.
  'owner-operated': [
    { slug: 'cosmetic-dentists', name: 'Cosmetic Dentists', minLocations: 1,
      description: 'Private/cosmetic dental practices — implants, aligners, veneers, whitening. High LTV, marketing-aware.' },
    { slug: 'aesthetics-clinics', name: 'Aesthetics & Skin Clinics', minLocations: 1,
      description: 'Injectables, laser, skin treatment and medi-spa clinics. Owner-led, image-conscious, already buying marketing.' },
    { slug: 'home-improvement-local', name: 'Home Improvement (Local)', minLocations: 1,
      description: 'Kitchens, bathrooms, glazing, driveways, landscaping firms. Big-ticket jobs, lead-hungry, weak digital presence.' },
    { slug: 'law-firms', name: 'Law Firms', minLocations: 1,
      description: 'Family, PI, conveyancing and private-client practices. High case value, competitive local search.' },
    { slug: 'private-vets', name: 'Private Vets & Pet Care', minLocations: 1,
      description: 'Independent veterinary practices and premium pet-care businesses. Loyal client base, recurring revenue.' },
  ],
  'local-services': [
    { slug: 'home-improvements', name: 'Home Improvements',
      description: 'Multi-unit home improvement retailers — glazing, flooring, kitchens, bathrooms, furniture. 3+ physical locations.' },
    { slug: 'skilled-trades', name: 'Skilled Trades',
      description: 'Multi-branch trade contractors and trade-adjacent retail — plumbing, electrical, HVAC, roofing, builders\' merchants, tool hire.' },
    { slug: 'beauty-wellness', name: 'Beauty & Wellness',
      description: 'Multi-unit beauty and wellness operators — hair salons, beauty/aesthetic clinics, spas, nail bars, massage/physio chains.' },
  ],
  'professional-services': [
    { slug: 'legal', name: 'Legal — Solicitors & Law Firms',
      description: 'Multi-office solicitors and law firms — conveyancing, family, personal injury, commercial, and private-client practices.' },
    { slug: 'accountancy', name: 'Accountancy & Bookkeeping',
      description: 'Accountancy practices and bookkeeping firms serving SMEs — tax, payroll, advisory, and compliance services.' },
    { slug: 'healthcare', name: 'Private Healthcare & Dental',
      description: 'Private dental groups, GP practices, physiotherapy, and aesthetic/medical clinics with multiple locations.' },
    { slug: 'property', name: 'Estate & Letting Agents',
      description: 'Multi-branch estate and letting agents — residential sales, lettings, property management, and developers.' },
  ],
}

// ─── Verticals ────────────────────────────────────────────────────────────────
router.get('/verticals', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const verticals = db.prepare(`
    SELECT v.*,
      (SELECT COUNT(*) FROM dl_organizations WHERE vertical_id = v.id AND status = 'active') AS org_count,
      (SELECT COUNT(*) FROM dl_prospects     WHERE vertical_id = v.id) AS prospect_count
    FROM verticals v
    WHERE v.client_id = ? AND v.status = 'active'
    ORDER BY v.created_at
  `).all(clientId)
  res.json(verticals)
})

router.post('/verticals', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const { slug, name, description = '', multi_unit_min_locations = 3 } = req.body
  if (!name?.trim() || !slug?.trim()) return res.status(400).json({ error: 'slug + name required' })

  // Slug must be unique per client
  const exists = db.prepare(`SELECT 1 FROM verticals WHERE client_id = ? AND slug = ?`).get(clientId, slug)
  if (exists) return res.status(409).json({ error: 'slug already exists for this client' })

  const id = crypto.randomUUID()
  db.prepare(`
    INSERT INTO verticals (id, client_id, slug, name, description, multi_unit_min_locations)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, clientId, slug.trim(), name.trim(), description, Number(multi_unit_min_locations) || 3)
  res.json(db.prepare(`SELECT * FROM verticals WHERE id = ?`).get(id))
})

router.patch('/verticals/:vid', (req, res) => {
  const { clientId, vid } = req.params as { clientId: string; vid: string }
  const v = db.prepare(`SELECT * FROM verticals WHERE id = ? AND client_id = ?`).get(vid, clientId)
  if (!v) return res.status(404).json({ error: 'Vertical not found' })

  const fields = ['name', 'description', 'multi_unit_min_locations', 'status']
  const updates: string[] = []
  const values: any[] = []
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`)
      values.push(req.body[f])
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'no fields to update' })
  values.push(vid)
  db.prepare(`UPDATE verticals SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  res.json(db.prepare(`SELECT * FROM verticals WHERE id = ?`).get(vid))
})

router.delete('/verticals/:vid', (req, res) => {
  const { clientId, vid } = req.params as { clientId: string; vid: string }
  // Verify ownership before deleting
  const v = db.prepare(`SELECT id FROM verticals WHERE id = ? AND client_id = ?`).get(vid, clientId)
  if (!v) return res.status(404).json({ error: 'Vertical not found' })
  // Manually cascade since we can't rely on FK from a TEXT column we just added
  db.exec('BEGIN')
  try {
    db.prepare(`DELETE FROM dl_visibility_scores WHERE vertical_id = ?`).run(vid)
    db.prepare(`DELETE FROM dl_prospects         WHERE vertical_id = ?`).run(vid)
    db.prepare(`DELETE FROM dl_organizations     WHERE vertical_id = ?`).run(vid)
    db.prepare(`DELETE FROM verticals            WHERE id = ?`).run(vid)
    db.exec('COMMIT')
  } catch (e: any) {
    db.exec('ROLLBACK')
    return res.status(500).json({ error: e.message })
  }
  res.json({ ok: true })
})

/**
 * POST /verticals/seed   { template: 'local-services' | 'professional-services' }
 * Idempotent: skips slugs that already exist for this client.
 */
router.post('/verticals/seed', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const { template } = req.body as { template: string }
  const seeds = VERTICAL_TEMPLATES[template]
  if (!seeds) return res.status(400).json({ error: 'unknown template', available: Object.keys(VERTICAL_TEMPLATES) })

  const existsStmt = db.prepare(`SELECT 1 FROM verticals WHERE client_id = ? AND slug = ?`)
  const insert = db.prepare(`
    INSERT INTO verticals (id, client_id, slug, name, description, multi_unit_min_locations)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  let inserted = 0
  let skipped = 0
  for (const s of seeds) {
    if (existsStmt.get(clientId, s.slug)) { skipped++; continue }
    insert.run(crypto.randomUUID(), clientId, s.slug, s.name, s.description, s.minLocations ?? 3)
    inserted++
  }
  res.json({ inserted, skipped, template })
})

// ─── Organizations ────────────────────────────────────────────────────────────
router.get('/verticals/:vid/organizations', (req, res) => {
  const { clientId, vid } = req.params as { clientId: string; vid: string }
  const orgs = db.prepare(`
    SELECT o.*,
      (SELECT COUNT(*) FROM dl_contacts WHERE organization_id = o.id AND status = 'active') AS contact_count
    FROM dl_organizations o
    WHERE o.vertical_id = ? AND o.client_id = ?
    ORDER BY o.name
  `).all(vid, clientId)
  res.json(orgs)
})

router.post('/verticals/:vid/organizations', (req, res) => {
  const { clientId, vid } = req.params as { clientId: string; vid: string }
  const v = db.prepare(`SELECT 1 FROM verticals WHERE id = ? AND client_id = ?`).get(vid, clientId)
  if (!v) return res.status(404).json({ error: 'Vertical not found' })

  const { name, website = '', domain = '', location_count = 0, hq_location = '', hq_postcode = '', companies_house_number = '', sub_segment = '', notes = '' } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name required' })

  const id = crypto.randomUUID()
  let cleanDomain = (domain || '').toLowerCase().trim()
  if (!cleanDomain && website) {
    try { cleanDomain = new URL(website.startsWith('http') ? website : `https://${website}`).hostname.replace(/^www\./, '').toLowerCase() }
    catch { /* malformed */ }
  }

  db.prepare(`
    INSERT INTO dl_organizations
      (id, client_id, vertical_id, name, website, domain, location_count, hq_location,
       hq_postcode, companies_house_number, sub_segment, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, clientId, vid, name.trim(), website, cleanDomain, Number(location_count) || 0,
         hq_location, hq_postcode, companies_house_number, sub_segment, notes)

  res.json(db.prepare(`SELECT * FROM dl_organizations WHERE id = ?`).get(id))
})

router.post('/verticals/:vid/organizations/bulk', (req, res) => {
  const { clientId, vid } = req.params as { clientId: string; vid: string }
  const v = db.prepare(`SELECT 1 FROM verticals WHERE id = ? AND client_id = ?`).get(vid, clientId)
  if (!v) return res.status(404).json({ error: 'Vertical not found' })

  const { rows } = req.body as { rows: any[] }
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows[] required' })

  // Dedup by (client_id, domain) so the same domain can be re-imported into another client
  const exists = db.prepare(`SELECT 1 FROM dl_organizations WHERE client_id = ? AND domain = ?`)
  const insert = db.prepare(`
    INSERT INTO dl_organizations
      (id, client_id, vertical_id, name, website, domain, location_count, hq_location,
       hq_postcode, companies_house_number, sub_segment, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let inserted = 0
  let skipped = 0
  db.exec('BEGIN')
  try {
    for (const r of rows) {
      if (!r.name?.trim()) { skipped++; continue }
      let domain = (r.domain || '').toLowerCase().trim()
      if (!domain && r.website) {
        try {
          domain = new URL(r.website.startsWith('http') ? r.website : `https://${r.website}`).hostname.replace(/^www\./, '').toLowerCase()
        } catch { /* malformed */ }
      }
      if (domain && exists.get(clientId, domain)) { skipped++; continue }

      insert.run(
        crypto.randomUUID(),
        clientId,
        vid,
        r.name.trim(),
        r.website || '',
        domain,
        Number(r.location_count) || 0,
        r.hq_location || '',
        r.hq_postcode || '',
        r.companies_house_number || '',
        r.sub_segment || '',
        r.notes || '',
      )
      inserted++
    }
    db.exec('COMMIT')
  } catch (e: any) {
    db.exec('ROLLBACK')
    return res.status(500).json({ error: e.message })
  }

  res.json({ inserted, skipped, total: rows.length })
})

router.patch('/organizations/:id', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  const o = db.prepare(`SELECT 1 FROM dl_organizations WHERE id = ? AND client_id = ?`).get(id, clientId)
  if (!o) return res.status(404).json({ error: 'Organisation not found' })

  const fields = ['name', 'website', 'domain', 'location_count', 'hq_location',
                  'hq_postcode', 'companies_house_number', 'sub_segment', 'status', 'notes',
                  'google_rating', 'google_reviews', 'search_status']
  const updates: string[] = []
  const values: any[] = []
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`)
      values.push(req.body[f])
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'no fields to update' })
  values.push(id)
  db.prepare(`UPDATE dl_organizations SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  res.json(db.prepare(`SELECT * FROM dl_organizations WHERE id = ?`).get(id))
})

router.delete('/organizations/:id', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  db.prepare(`DELETE FROM dl_organizations WHERE id = ? AND client_id = ?`).run(id, clientId)
  res.json({ ok: true })
})

// ─── Contacts ────────────────────────────────────────────────────────────────
router.get('/organizations/:id/contacts', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  // Verify org belongs to client
  const o = db.prepare(`SELECT 1 FROM dl_organizations WHERE id = ? AND client_id = ?`).get(id, clientId)
  if (!o) return res.status(404).json({ error: 'Organisation not found' })

  const contacts = db.prepare(`
    SELECT * FROM dl_contacts WHERE organization_id = ? ORDER BY full_name
  `).all(id)
  res.json(contacts)
})

router.post('/organizations/:id/contacts', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  const o = db.prepare(`SELECT 1 FROM dl_organizations WHERE id = ? AND client_id = ?`).get(id, clientId)
  if (!o) return res.status(404).json({ error: 'Organisation not found' })

  const { full_name, role = '', email = '', linkedin_url = '', source = 'manual', source_confidence = 50 } = req.body
  if (!full_name?.trim()) return res.status(400).json({ error: 'full_name required' })

  const cid = crypto.randomUUID()
  db.prepare(`
    INSERT INTO dl_contacts
      (id, organization_id, full_name, role, email, linkedin_url, source, source_confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cid, id, full_name.trim(), role, (email || '').toLowerCase().trim(),
         linkedin_url, source, Number(source_confidence) || 50)

  res.json(db.prepare(`SELECT * FROM dl_contacts WHERE id = ?`).get(cid))
})

router.post('/contacts/bulk', (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const { rows } = req.body as { rows: any[] }
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows[] required' })

  // Domain match scoped to THIS client's orgs (never global — one client must not see another's orgs)
  const findByDomain = db.prepare(`
    SELECT id FROM dl_organizations WHERE client_id = ? AND LOWER(domain) = ? LIMIT 1
  `)
  const findById = db.prepare(`
    SELECT id FROM dl_organizations WHERE id = ? AND client_id = ?
  `)
  const existsContact = db.prepare(`
    SELECT 1 FROM dl_contacts WHERE organization_id = ? AND LOWER(email) = ? LIMIT 1
  `)
  const insert = db.prepare(`
    INSERT INTO dl_contacts
      (id, organization_id, full_name, role, email, linkedin_url, source, source_confidence)
    VALUES (?, ?, ?, ?, ?, ?, 'leadswift', ?)
  `)

  let inserted = 0
  let skipped = 0
  let no_org_match = 0
  db.exec('BEGIN')
  try {
    for (const r of rows) {
      if (!r.full_name?.trim()) { skipped++; continue }

      let orgId: string | null = null
      if (r.organization_id && findById.get(r.organization_id, clientId)) {
        orgId = r.organization_id
      } else if (r.organization_domain) {
        const found = findByDomain.get(clientId, (r.organization_domain || '').toLowerCase().trim()) as any
        if (found) orgId = found.id
      }

      if (!orgId) { no_org_match++; continue }

      const email = (r.email || '').toLowerCase().trim()
      if (email && existsContact.get(orgId, email)) { skipped++; continue }

      insert.run(
        crypto.randomUUID(),
        orgId,
        r.full_name.trim(),
        r.role || '',
        email,
        r.linkedin_url || '',
        Number(r.source_confidence) || 75,
      )
      inserted++
    }
    db.exec('COMMIT')
  } catch (e: any) {
    db.exec('ROLLBACK')
    return res.status(500).json({ error: e.message })
  }

  res.json({ inserted, skipped, no_org_match, total: rows.length })
})

router.patch('/contacts/:id', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  // Verify the contact's org belongs to this client
  const ok = db.prepare(`
    SELECT 1 FROM dl_contacts c
    JOIN dl_organizations o ON o.id = c.organization_id
    WHERE c.id = ? AND o.client_id = ?
  `).get(id, clientId)
  if (!ok) return res.status(404).json({ error: 'Contact not found' })

  const fields = ['full_name', 'role', 'email', 'linkedin_url', 'status']
  const updates: string[] = []
  const values: any[] = []
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`)
      values.push(req.body[f])
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'no fields to update' })
  values.push(id)
  db.prepare(`UPDATE dl_contacts SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  res.json(db.prepare(`SELECT * FROM dl_contacts WHERE id = ?`).get(id))
})

router.delete('/contacts/:id', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  const ok = db.prepare(`
    SELECT 1 FROM dl_contacts c
    JOIN dl_organizations o ON o.id = c.organization_id
    WHERE c.id = ? AND o.client_id = ?
  `).get(id, clientId)
  if (!ok) return res.status(404).json({ error: 'Contact not found' })

  db.prepare(`DELETE FROM dl_contacts WHERE id = ?`).run(id)
  res.json({ ok: true })
})

// ─── Email discovery (BYO key) + suppression ────────────────────────────────
// Lookup only ever stores what a provider actually returned — never a guessed
// or pattern-inferred address. Suppressed contacts are excluded everywhere.

router.post('/contacts/:id/find-email', async (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  const row = db.prepare(`
    SELECT c.*, o.name AS org_name, o.domain AS org_domain
    FROM dl_contacts c JOIN dl_organizations o ON o.id = c.organization_id
    WHERE c.id = ? AND o.client_id = ?
  `).get(id, clientId) as any
  if (!row) return res.status(404).json({ error: 'Contact not found' })
  if (row.suppressed) return res.status(409).json({ error: 'Contact is suppressed (do not contact)' })

  try {
    const r = await findEmail({
      full_name: row.full_name,
      linkedin_url: row.linkedin_url || undefined,
      domain: row.org_domain || undefined,
      company: row.org_name || undefined,
    })

    if (!r.ok) {
      // A miss is a real answer — record it so we don't burn credits re-asking.
      db.prepare(`UPDATE dl_contacts SET email_status = 'not_found', email_found_at = unixepoch() WHERE id = ?`).run(id)
      return res.status(404).json({ error: r.error || 'No email found', status: 'not_found' })
    }

    db.prepare(`
      UPDATE dl_contacts
      SET email = ?, email_status = ?, email_confidence = ?, email_source = ?, email_found_at = unixepoch()
      WHERE id = ?
    `).run(r.email, r.status, r.confidence ?? null, r.source, id)

    res.json({ email: r.email, status: r.status, confidence: r.confidence, source: r.source })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/contacts/:id/verify-email', async (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  const row = db.prepare(`
    SELECT c.id, c.email FROM dl_contacts c
    JOIN dl_organizations o ON o.id = c.organization_id
    WHERE c.id = ? AND o.client_id = ?
  `).get(id, clientId) as any
  if (!row) return res.status(404).json({ error: 'Contact not found' })
  if (!row.email) return res.status(400).json({ error: 'No email to verify' })

  try {
    const r = await verifyEmail(row.email)
    if (!r.ok) return res.status(400).json({ error: r.error })
    db.prepare(`UPDATE dl_contacts SET email_status = ?, email_confidence = COALESCE(?, email_confidence) WHERE id = ?`)
      .run(r.status, r.confidence ?? null, id)
    res.json({ status: r.status, confidence: r.confidence })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// Bulk lookup — capped per call, highest-priority first, skips anyone already
// searched or suppressed. Sequential on purpose: these are paid, rate-limited
// APIs and hammering them concurrently gets the key throttled.
router.post('/verticals/:vid/find-emails', async (req, res) => {
  const { clientId, vid } = req.params as { clientId: string; vid: string }
  const limit = Math.min(Number((req.body as any)?.limit) || 25, 100)

  const rows = db.prepare(`
    SELECT c.*, o.name AS org_name, o.domain AS org_domain
    FROM dl_contacts c JOIN dl_organizations o ON o.id = c.organization_id
    WHERE o.client_id = ? AND o.vertical_id = ?
      AND c.suppressed = 0
      AND c.email = ''
      AND c.email_status = 'not_searched'
    ORDER BY c.priority_score DESC
    LIMIT ?
  `).all(clientId, vid, limit) as any[]

  let found = 0, missed = 0
  const errors: string[] = []
  for (const row of rows) {
    try {
      const r = await findEmail({
        full_name: row.full_name,
        linkedin_url: row.linkedin_url || undefined,
        domain: row.org_domain || undefined,
        company: row.org_name || undefined,
      })
      if (r.ok) {
        db.prepare(`
          UPDATE dl_contacts
          SET email = ?, email_status = ?, email_confidence = ?, email_source = ?, email_found_at = unixepoch()
          WHERE id = ?
        `).run(r.email, r.status, r.confidence ?? null, r.source, row.id)
        found++
      } else {
        db.prepare(`UPDATE dl_contacts SET email_status = 'not_found', email_found_at = unixepoch() WHERE id = ?`).run(row.id)
        missed++
        if (r.error && errors.length < 3) errors.push(r.error)
      }
    } catch (e: any) {
      missed++
      if (errors.length < 3) errors.push(e.message)
    }
  }

  res.json({ attempted: rows.length, found, missed, errors })
})

// Suppression — honoured across BOTH channels. A hard flag, not a delete, so a
// later re-import can't silently resurrect someone who asked not to be contacted.
router.post('/contacts/:id/suppress', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  const ok = db.prepare(`
    SELECT 1 FROM dl_contacts c JOIN dl_organizations o ON o.id = c.organization_id
    WHERE c.id = ? AND o.client_id = ?
  `).get(id, clientId)
  if (!ok) return res.status(404).json({ error: 'Contact not found' })

  const { reason, undo } = req.body as { reason?: string; undo?: boolean }
  if (undo) {
    db.prepare(`UPDATE dl_contacts SET suppressed = 0, suppressed_at = NULL, suppressed_reason = '' WHERE id = ?`).run(id)
  } else {
    db.prepare(`UPDATE dl_contacts SET suppressed = 1, suppressed_at = unixepoch(), suppressed_reason = ? WHERE id = ?`)
      .run(reason || 'manual', id)
  }
  res.json(db.prepare(`SELECT * FROM dl_contacts WHERE id = ?`).get(id))
})

// ─── LinkedIn outreach — draft + copy + send-yourself (no send API exists) ───

router.post('/contacts/:id/generate-message', async (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(clientId) as any
  if (!client) return res.status(404).json({ error: 'Client not found' })

  const row = db.prepare(`
    SELECT c.*, o.name AS org_name, o.sub_segment AS org_segment, o.hq_location AS org_location
    FROM dl_contacts c
    JOIN dl_organizations o ON o.id = c.organization_id
    WHERE c.id = ? AND o.client_id = ?
  `).get(id, clientId) as any
  if (!row) return res.status(404).json({ error: 'Contact not found' })

  // Contact Magnetism — if we captured real context about THIS person, ground the
  // opener in one true, specific thing. Never fabricate: only use what's provided.
  let context: any = null
  try { context = row.contact_context ? JSON.parse(row.contact_context) : null } catch { /* malformed */ }
  const hasContext = context && (
    (context.recent_posts && context.recent_posts.length) ||
    context.about || (context.mutual_connections && context.mutual_connections.length) ||
    (context.shared && context.shared.length) ||
    (context.featured && context.featured.length) ||
    context.current_role || (context.certifications && context.certifications.length)
  )

  const system = hasContext
    ? `You write short, blunt, honest first-message LinkedIn DMs for a new 1st-degree connection.
Voice: confident, plain-spoken, anti-hype, builder-to-builder, owns its opinions. Never fake-soft framing
like "quick one" or "just wondering", never flattery, never a manufactured qualifying question.

You have been given REAL, captured context about this specific person. Open with ONE genuine, specific
observation drawn ONLY from that context — a thing they actually posted, a genuine mutual connection, their
actual words about their work. This is the point: it must read as one human genuinely noticing another, not
as a template. Rules on the context: use at most ONE item; never invent or embellish beyond what is given;
if the context is thin or generic, it is better to skip it than to fake familiarity. Do NOT quote a post back
verbatim in a creepy way — reference it naturally, the way you'd mention it if you'd actually read it.

After the genuine opener: one plain line naming what you built and who it's for (replaces the pile of marketing
SaaS subscriptions businesses bleed money on every month — free forever, self-hosted, no catch), then a
low-pressure close ("worth a look if useful, ignore if not" — vary the wording). Under 500 characters.
No emojis. No hashtags. Output ONLY the message text, nothing else.`
    : `You write short, blunt, honest first-message LinkedIn DMs for a new 1st-degree connection.
Voice: confident, plain-spoken, anti-hype, builder-to-builder, owns its opinions. Never use fake-soft framing
like "quick one" or "just wondering" or a manufactured qualifying question — say what it is plainly.
Structure: thank them for connecting, one line naming what you built and who it's for (replaces the pile of
marketing SaaS subscriptions businesses bleed money on every month — free forever, self-hosted, no catch),
then a low-pressure close ("worth a look if useful, ignore if not" or similar — vary the wording, never copy
a template verbatim). Under 400 characters. No emojis. No hashtags. Output ONLY the message text, nothing else.`

  let contextBlock = ''
  if (hasContext) {
    const lines: string[] = []
    if (context.recent_posts?.length) {
      lines.push('Recent posts they made:')
      for (const p of context.recent_posts.slice(0, 3)) lines.push(`  - ${p.text}${p.when ? ` (${p.when})` : ''}`)
    }
    if (context.about) lines.push(`Their own bio: ${context.about}`)
    if (context.mutual_connections?.length) lines.push(`Genuine mutual connections: ${context.mutual_connections.slice(0, 5).join(', ')}`)
    if (context.shared?.length) lines.push(`Shared context: ${context.shared.join(', ')}`)
    if (context.current_role) lines.push(`Current role line shown on their profile (note the tenure — only mention "new role" if it genuinely reads as recent): ${context.current_role}`)
    if (context.featured?.length) lines.push(`Content they've deliberately pinned to their profile: ${context.featured.join(' | ')}`)
    if (context.certifications?.length) lines.push(`Certifications/licenses listed: ${context.certifications.join(', ')}`)
    contextBlock = `\n\nREAL CONTEXT captured from their profile (use at most ONE item, never fabricate):\n${lines.join('\n')}`
  }

  const prompt = `Write the message for:
Name: ${row.full_name}
Role: ${row.role || 'unknown role'}
Company: ${row.org_name}${row.org_segment ? ` (${row.org_segment})` : ''}${contextBlock}
Include a link placeholder exactly as: [link]`

  try {
    const result = await generate(client, { prompt, system, max_tokens: 300, temperature: 0.9 })
    const message = result.text.trim()
    db.prepare(`UPDATE dl_contacts SET outreach_message = ? WHERE id = ?`).run(message, id)
    res.json({ message })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/contacts/:id/mark-messaged', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  const ok = db.prepare(`
    SELECT 1 FROM dl_contacts c
    JOIN dl_organizations o ON o.id = c.organization_id
    WHERE c.id = ? AND o.client_id = ?
  `).get(id, clientId)
  if (!ok) return res.status(404).json({ error: 'Contact not found' })

  const { message } = req.body as { message?: string }
  db.prepare(`
    UPDATE dl_contacts SET outreach_status = 'messaged', outreach_sent_at = unixepoch(), outreach_message = COALESCE(?, outreach_message)
    WHERE id = ?
  `).run(message ?? null, id)
  res.json(db.prepare(`SELECT * FROM dl_contacts WHERE id = ?`).get(id))
})

// ─── Prospects + Visibility ──────────────────────────────────────────────────
router.get('/verticals/:vid/prospects', (req, res) => {
  const { clientId, vid } = req.params as { clientId: string; vid: string }
  const prospects = db.prepare(`
    SELECT p.*,
      o.name AS org_name, o.domain, o.website, o.location_count,
      (SELECT COUNT(*) FROM dl_contacts WHERE organization_id = o.id AND status = 'active') AS contact_count
    FROM dl_prospects p
    JOIN dl_organizations o ON o.id = p.organization_id
    WHERE p.vertical_id = ? AND p.client_id = ?
    ORDER BY p.visibility_score ASC, p.rank ASC
  `).all(vid, clientId)
  res.json(prospects)
})

router.post('/verticals/:vid/score', (req, res) => {
  const { clientId, vid } = req.params as { clientId: string; vid: string }
  const v = db.prepare(`SELECT 1 FROM verticals WHERE id = ? AND client_id = ?`).get(vid, clientId)
  if (!v) return res.status(404).json({ error: 'Vertical not found' })
  const { run_id } = req.body
  if (!run_id) return res.status(400).json({ error: 'run_id required' })
  const result = computeVerticalVisibility(clientId, vid, run_id)
  res.json({ scored: result.length, top: result.slice(0, 25) })
})

router.post('/verticals/:vid/promote', (req, res) => {
  const { clientId, vid } = req.params as { clientId: string; vid: string }
  const v = db.prepare(`SELECT 1 FROM verticals WHERE id = ? AND client_id = ?`).get(vid, clientId)
  if (!v) return res.status(404).json({ error: 'Vertical not found' })
  const { run_id } = req.body
  if (!run_id) return res.status(400).json({ error: 'run_id required' })
  const result = promoteProspectsForVertical(clientId, vid, run_id)
  res.json(result)
})

router.get('/verticals/:vid/delta', (req, res) => {
  const { clientId, vid } = req.params as { clientId: string; vid: string }
  const v = db.prepare(`SELECT 1 FROM verticals WHERE id = ? AND client_id = ?`).get(vid, clientId)
  if (!v) return res.status(404).json({ error: 'Vertical not found' })
  res.json(computeDailyDelta(clientId, vid))
})

router.patch('/prospects/:id', (req, res) => {
  const { clientId, id } = req.params as { clientId: string; id: string }
  const ok = db.prepare(`SELECT 1 FROM dl_prospects WHERE id = ? AND client_id = ?`).get(id, clientId)
  if (!ok) return res.status(404).json({ error: 'Prospect not found' })

  const fields = ['status', 'notes', 'approved_at', 'sent_at', 'hot_at', 'won_at', 'lost_at']
  const updates: string[] = []
  const values: any[] = []
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`)
      values.push(req.body[f])
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'no fields to update' })
  values.push(id)
  db.prepare(`UPDATE dl_prospects SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  res.json(db.prepare(`SELECT * FROM dl_prospects WHERE id = ?`).get(id))
})

// ─── LLM provider testing ───────────────────────────────────────────────────
router.get('/llm/test', async (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(clientId) as any
  if (!client) return res.status(404).json({ error: 'Client not found' })
  const result = await ping(client)
  res.json(result)
})

router.post('/llm/generate', async (req, res) => {
  const { clientId } = req.params as { clientId: string }
  const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(clientId) as any
  if (!client) return res.status(404).json({ error: 'Client not found' })
  try {
    const { prompt, system, max_tokens, temperature } = req.body
    if (!prompt) return res.status(400).json({ error: 'prompt required' })
    const result = await generate(client, { prompt, system, max_tokens, temperature })
    res.json(result)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export default router
