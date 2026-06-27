// @ts-nocheck
// Templates — parameterised prompt templates for pSEO pages, niche reports, and reusable content formats.
// client_id is nullable — NULL rows are install-wide templates (available to all clients).
import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'

const router = Router() as any

const VALID_KINDS = ['blog', 'newsletter', 'pseo', 'report']

// Extract {variable} placeholder names from the prompt template, de-duplicated.
function detectVariables(promptTemplate: string): string[] {
  const found = new Set<string>()
  const re = /\{([a-z0-9_]+)\}/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(promptTemplate))) found.add(m[1].toLowerCase())
  return [...found]
}

function parseRow(r: any) {
  return { ...r, variables: JSON.parse(r.variables || '[]') }
}

// List templates — optionally filtered by kind and/or client_id.
// `?client_id=<id>` returns both install-wide (NULL) and that client's own templates.
// `?client_id=none` returns only install-wide.
router.get('/', (req, res) => {
  const { kind, client_id } = req.query as { kind?: string; client_id?: string }
  const clauses: string[] = []
  const args: any[] = []

  if (kind) {
    clauses.push('kind = ?')
    args.push(kind)
  }
  if (client_id === 'none') {
    clauses.push('client_id IS NULL')
  } else if (client_id) {
    clauses.push('(client_id IS NULL OR client_id = ?)')
    args.push(client_id)
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = db.prepare(`SELECT * FROM templates ${where} ORDER BY created_at DESC`).all(...args)
  res.json(rows.map(parseRow))
})

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Template not found' })
  res.json(parseRow(row))
})

router.post('/', (req, res) => {
  const { client_id, name, kind, prompt_template, output_format, notes, variables } = req.body
  if (!name || !prompt_template) {
    return res.status(400).json({ error: 'name and prompt_template are required' })
  }
  const resolvedKind = VALID_KINDS.includes(kind) ? kind : 'blog'
  // Auto-detect variables from the template if caller didn't supply them.
  const vars = Array.isArray(variables) && variables.length ? variables : detectVariables(prompt_template)
  const id = uuid()
  db.prepare(`
    INSERT INTO templates (id, client_id, name, kind, prompt_template, variables, output_format, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    client_id || null,
    name,
    resolvedKind,
    prompt_template,
    JSON.stringify(vars),
    output_format || 'markdown',
    notes || ''
  )
  res.status(201).json(parseRow(db.prepare('SELECT * FROM templates WHERE id = ?').get(id)))
})

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Template not found' })
  const { name, kind, prompt_template, output_format, notes, status, variables } = req.body
  const resolvedKind = VALID_KINDS.includes(kind) ? kind : (existing as any).kind
  const nextPrompt = prompt_template ?? (existing as any).prompt_template
  const vars = Array.isArray(variables)
    ? variables
    : (prompt_template ? detectVariables(nextPrompt) : JSON.parse((existing as any).variables))

  db.prepare(`
    UPDATE templates
    SET name = ?, kind = ?, prompt_template = ?, variables = ?, output_format = ?, notes = ?, status = ?, updated_at = unixepoch()
    WHERE id = ?
  `).run(
    name ?? (existing as any).name,
    resolvedKind,
    nextPrompt,
    JSON.stringify(vars),
    output_format ?? (existing as any).output_format,
    notes ?? (existing as any).notes,
    status ?? (existing as any).status,
    req.params.id
  )
  res.json(parseRow(db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id)))
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// Preview — render a template with sample values, returning the would-be prompt.
// Useful for debugging placeholder coverage before kicking off a job.
router.post('/:id/preview', (req, res) => {
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Template not found' })
  const values = (req.body?.values || {}) as Record<string, string>
  let rendered = (row as any).prompt_template as string
  const missing: string[] = []
  for (const v of JSON.parse((row as any).variables)) {
    if (values[v] === undefined || values[v] === '') missing.push(v)
    rendered = rendered.replaceAll(`{${v}}`, values[v] ?? `{${v}}`)
  }
  res.json({ rendered, missing })
})

export default router
