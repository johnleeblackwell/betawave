/**
 * βWave MCP server definition.
 *
 * buildServer() returns a fresh McpServer with all tools + resources registered
 * against a BWaveClient. Transport-agnostic: stdio.ts and http.ts both call it.
 * In stateless HTTP mode a new server is built per request.
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { BWaveClient } from './data.js'

const NAME = 'bwave'
const VERSION = '0.1.0'

// Tool result helpers ─────────────────────────────────────────────────────────
const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] })
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true })

export function buildServer(client: BWaveClient): McpServer {
  const server = new McpServer({ name: NAME, version: VERSION })

  // ─── TOOLS — executable actions ─────────────────────────────────────────────

  server.registerTool('bwave_list_clients', {
    title: 'List clients',
    description: 'List all βWave clients (id, business name, industry). Start here to get a clientId for other tools.',
    inputSchema: {},
  }, async () => {
    try { return ok(await client.listClients()) } catch (e) { return fail((e as Error).message) }
  })

  server.registerTool('bwave_get_client', {
    title: 'Get client profile',
    description: 'Get the full profile + brand DNA (tone, audience, style notes) for one client.',
    inputSchema: { clientId: z.string().describe('Client UUID from bwave_list_clients') },
  }, async ({ clientId }) => {
    try {
      const c = await client.getClient(clientId)
      return c ? ok(c) : fail(`Client ${clientId} not found`)
    } catch (e) { return fail((e as Error).message) }
  })

  server.registerTool('bwave_get_pipeline', {
    title: 'Get sales pipeline',
    description: 'List prospects for a client, optionally filtered by stage. Stages: lead, qualified, proposal_sent, signed, active, churned.',
    inputSchema: {
      clientId: z.string().describe('Client UUID'),
      status: z.enum(['lead', 'qualified', 'proposal_sent', 'signed', 'active', 'churned']).optional().describe('Filter by pipeline stage'),
    },
  }, async ({ clientId, status }) => {
    try { return ok(await client.listProspects(clientId, status)) } catch (e) { return fail((e as Error).message) }
  })

  server.registerTool('bwave_list_engagements', {
    title: 'List engagements',
    description: 'List engagements (retainers / one-off contracts) for a client. Use to find an engagementId before creating an invoice.',
    inputSchema: { clientId: z.string().describe('Client UUID') },
  }, async ({ clientId }) => {
    try { return ok(await client.listEngagements(clientId)) } catch (e) { return fail((e as Error).message) }
  })

  server.registerTool('bwave_list_invoices', {
    title: 'List invoices',
    description: 'List invoices for a client, optionally filtered by status (pending, paid, overdue, cancelled).',
    inputSchema: {
      clientId: z.string().describe('Client UUID'),
      status: z.enum(['pending', 'paid', 'overdue', 'cancelled']).optional(),
    },
  }, async ({ clientId, status }) => {
    try { return ok(await client.listInvoices(clientId, status)) } catch (e) { return fail((e as Error).message) }
  })

  server.registerTool('bwave_create_invoice', {
    title: 'Create invoice',
    description: 'Raise a new PENDING invoice against an engagement. Does NOT charge anyone — just records it. Get engagementId from bwave_list_engagements first.',
    inputSchema: {
      clientId: z.string().describe('Client UUID'),
      engagementId: z.string().describe('Engagement UUID the invoice is raised against'),
      amount: z.number().positive().describe('Invoice amount (same currency as the engagement)'),
      month: z.string().optional().describe('Billing period label, e.g. "2026-06"'),
      notes: z.string().optional(),
    },
    annotations: { destructiveHint: false, idempotentHint: false },
  }, async ({ clientId, engagementId, amount, month, notes }) => {
    try { return ok(await client.createInvoice(clientId, engagementId, amount, month, notes)) } catch (e) { return fail((e as Error).message) }
  })

  server.registerTool('bwave_mark_invoice_paid', {
    title: 'Mark invoice paid',
    description: 'Mark an invoice as PAID. This fires the commission calculation (20% first payment / 10% recurring) for any attributed lead generator. Irreversible — confirm with the user before calling.',
    inputSchema: {
      clientId: z.string().describe('Client UUID'),
      invoiceId: z.string().describe('Invoice UUID from bwave_list_invoices'),
    },
    annotations: { destructiveHint: true, idempotentHint: false },
  }, async ({ clientId, invoiceId }) => {
    try { return ok(await client.markInvoicePaid(clientId, invoiceId)) } catch (e) { return fail((e as Error).message) }
  })

  server.registerTool('bwave_list_syndication_routes', {
    title: 'List syndication routes',
    description: 'List a client\'s syndication routes (source → X destination) with active flag and daily-post counts.',
    inputSchema: { clientId: z.string().describe('Client UUID') },
  }, async ({ clientId }) => {
    try { return ok(await client.listSyndicationRoutes(clientId)) } catch (e) { return fail((e as Error).message) }
  })

  server.registerTool('bwave_run_syndication', {
    title: 'Run syndication tick',
    description: 'Force an immediate syndication run across ALL eligible routes (respects daily caps + destination throttles). Returns counts: posted / failed / skipped.',
    inputSchema: {},
    annotations: { destructiveHint: true, idempotentHint: false },
  }, async () => {
    try { return ok(await client.runSyndication()) } catch (e) { return fail((e as Error).message) }
  })

  // bwave_generate_content — STUB. Content generation is an SSE-streaming,
  // image-pipeline-heavy flow in routes/content.ts. Wiring it cleanly is a
  // follow-up; exposing a half-built version would be fragile. For now, point
  // the caller at the UI. TODO: extract a callable generateDraft() service.
  server.registerTool('bwave_generate_content', {
    title: 'Generate content (not yet wired)',
    description: 'Generate a blog/newsletter draft. NOT YET IMPLEMENTED via MCP — use the βWave UI → Generate tab. This stub exists so the tool surface is discoverable.',
    inputSchema: {
      clientId: z.string(),
      type: z.enum(['blog', 'newsletter']),
      brief: z.string().describe('What to write about'),
    },
  }, async () => fail('bwave_generate_content is not yet wired through MCP. Use the βWave UI → Generate tab. (Tracked as a follow-up: extract a callable generateDraft() from routes/content.ts.)'))

  // ─── RESOURCES — read-only context Claude pulls on demand ───────────────────

  server.registerResource('clients', 'bwave://clients', {
    title: 'All clients',
    description: 'Directory of every βWave client.',
    mimeType: 'application/json',
  }, async (uri) => {
    const data = await client.listClients()
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] }
  })

  server.registerResource('client', new ResourceTemplate('bwave://client/{id}', { list: undefined }), {
    title: 'Client profile',
    description: 'Full profile + brand DNA for one client.',
    mimeType: 'application/json',
  }, async (uri, { id }) => {
    const data = await client.getClient(String(id))
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] }
  })

  server.registerResource('pipeline', new ResourceTemplate('bwave://client/{id}/pipeline', { list: undefined }), {
    title: 'Client pipeline',
    description: 'All prospects for a client, across stages.',
    mimeType: 'application/json',
  }, async (uri, { id }) => {
    const data = await client.listProspects(String(id))
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] }
  })

  server.registerResource('invoices', new ResourceTemplate('bwave://client/{id}/invoices', { list: undefined }), {
    title: 'Client invoices',
    description: 'Invoice ledger for a client.',
    mimeType: 'application/json',
  }, async (uri, { id }) => {
    const data = await client.listInvoices(String(id))
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] }
  })

  server.registerResource('syndication', new ResourceTemplate('bwave://client/{id}/syndication', { list: undefined }), {
    title: 'Client syndication routes',
    description: 'Syndication routes for a client.',
    mimeType: 'application/json',
  }, async (uri, { id }) => {
    const data = await client.listSyndicationRoutes(String(id))
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] }
  })

  return server
}
