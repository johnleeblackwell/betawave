/**
 * Data access layer for the βWave MCP server.
 *
 * Defines a single `BWaveClient` interface with two interchangeable
 * implementations:
 *
 *   • EmbeddedClient — imports the app's libsql `db` (and side-effecting
 *     services) directly, in-process. Fastest, zero infra. Phase 1 default.
 *
 *   • HttpClient — calls the existing REST API at :3001/api with a bearer
 *     service token. Decoupled, remote-deployable. Phase 2 (remote microservice
 *     / marketplace). Selected by setting BWAVE_API_URL.
 *
 * Tool and resource handlers in server.ts depend ONLY on this interface, so the
 * data layer can be swapped without touching any MCP definition.
 */

// ─── Domain shapes (loose — mirror the DB rows) ──────────────────────────────
export interface ClientRow { id: string; name: string; business_name: string; industry: string; [k: string]: unknown }
export interface ProspectRow { id: string; client_id: string; name: string; status: string; [k: string]: unknown }
export interface EngagementRow { id: string; client_id: string; type: string; value: number; status: string; [k: string]: unknown }
export interface InvoiceRow { id: string; client_id: string; engagement_id: string; amount: number; status: string; [k: string]: unknown }
export interface RouteRow { id: string; active: number; [k: string]: unknown }

export interface BWaveClient {
  listClients(): Promise<ClientRow[]>
  getClient(clientId: string): Promise<ClientRow | null>
  listProspects(clientId: string, status?: string): Promise<ProspectRow[]>
  listEngagements(clientId: string): Promise<EngagementRow[]>
  listInvoices(clientId: string, status?: string): Promise<InvoiceRow[]>
  createInvoice(clientId: string, engagementId: string, amount: number, month?: string, notes?: string): Promise<InvoiceRow>
  markInvoicePaid(clientId: string, invoiceId: string): Promise<InvoiceRow>
  listSyndicationRoutes(clientId: string): Promise<RouteRow[]>
  runSyndication(): Promise<{ posted: number; failed: number; skipped: number }>
}

// ─── EmbeddedClient — in-process, imports the app DB directly ─────────────────
export class EmbeddedClient implements BWaveClient {
  // Lazy dynamic imports so importing this module is cheap and so console output
  // from db.ts is already redirected (quiet.ts) by the time db loads.
  private async db() {
    const mod = await import('../../src/server/db.js')
    return mod.default
  }

  async listClients() {
    const db = await this.db()
    return db.prepare(`SELECT id, name, business_name, industry, created_at FROM clients ORDER BY business_name`).all() as ClientRow[]
  }

  async getClient(clientId: string) {
    const db = await this.db()
    return (db.prepare(`SELECT * FROM clients WHERE id = ?`).get(clientId) as ClientRow | undefined) ?? null
  }

  async listProspects(clientId: string, status?: string) {
    const db = await this.db()
    let q = `SELECT * FROM prospects WHERE client_id = ?`
    const p: unknown[] = [clientId]
    if (status) { q += ` AND status = ?`; p.push(status) }
    q += ` ORDER BY created_at DESC`
    return db.prepare(q).all(...p) as ProspectRow[]
  }

  async listEngagements(clientId: string) {
    const db = await this.db()
    return db.prepare(`SELECT * FROM engagements WHERE client_id = ? ORDER BY created_at DESC`).all(clientId) as EngagementRow[]
  }

  async listInvoices(clientId: string, status?: string) {
    const db = await this.db()
    let q = `SELECT * FROM invoices WHERE client_id = ?`
    const p: unknown[] = [clientId]
    if (status) { q += ` AND status = ?`; p.push(status) }
    q += ` ORDER BY created_at DESC`
    return db.prepare(q).all(...p) as InvoiceRow[]
  }

  async createInvoice(clientId: string, engagementId: string, amount: number, month = '', notes = '') {
    const db = await this.db()
    const { v4: uuid } = await import('uuid')
    const engagement = db.prepare(`SELECT id FROM engagements WHERE id = ? AND client_id = ?`).get(engagementId, clientId)
    if (!engagement) throw new Error(`Engagement ${engagementId} not found for client ${clientId}`)
    if (!amount || isNaN(Number(amount))) throw new Error('amount must be a number')
    const id = uuid()
    db.prepare(`INSERT INTO invoices (id, client_id, engagement_id, amount, month, status, notes)
                VALUES (?, ?, ?, ?, ?, 'pending', ?)`)
      .run(id, clientId, engagementId, Number(amount), month, notes)
    return db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(id) as InvoiceRow
  }

  async markInvoicePaid(clientId: string, invoiceId: string) {
    const db = await this.db()
    const invoice = db.prepare(`SELECT * FROM invoices WHERE id = ? AND client_id = ?`).get(invoiceId, clientId) as InvoiceRow | undefined
    if (!invoice) throw new Error(`Invoice ${invoiceId} not found for client ${clientId}`)
    if (invoice.status === 'paid') throw new Error('Invoice already marked paid')
    const paidAt = Math.floor(Date.now() / 1000)
    db.prepare(`UPDATE invoices SET status = 'paid', paid_at = ? WHERE id = ?`).run(paidAt, invoiceId)
    // Fire the same commission trigger the REST route uses.
    try {
      const { onInvoicePaid } = await import('../../src/server/services/commission.js')
      onInvoicePaid(invoiceId)
    } catch (e) {
      console.warn('[mcp] commission trigger failed:', (e as Error).message)
    }
    return db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(invoiceId) as InvoiceRow
  }

  async listSyndicationRoutes(clientId: string) {
    const db = await this.db()
    return db.prepare(`SELECT * FROM syndication_routes WHERE client_id = ? ORDER BY created_at DESC`).all(clientId) as RouteRow[]
  }

  async runSyndication() {
    const { runSyndicationTick } = await import('../../src/server/services/syndication.js')
    return runSyndicationTick()
  }
}

// ─── HttpClient — Phase 2: calls the REST API over HTTP ───────────────────────
// Selected when BWAVE_API_URL is set. Requires MCP_SERVICE_TOKEN to match the
// token the main app's auth middleware accepts (see middleware/auth.ts edit).
export class HttpClient implements BWaveClient {
  constructor(private base: string, private token?: string) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(init?.headers || {}),
      },
    })
    if (!res.ok) throw new Error(`${init?.method || 'GET'} ${path} → HTTP ${res.status}`)
    return res.json() as Promise<T>
  }

  listClients() { return this.call<ClientRow[]>(`/api/clients`) }
  getClient(id: string) { return this.call<ClientRow | null>(`/api/clients/${id}`) }
  listProspects(id: string, status?: string) { return this.call<ProspectRow[]>(`/api/clients/${id}/prospects${status ? `?status=${status}` : ''}`) }
  listEngagements(id: string) { return this.call<EngagementRow[]>(`/api/clients/${id}/engagements`) }
  listInvoices(id: string, status?: string) { return this.call<InvoiceRow[]>(`/api/clients/${id}/invoices${status ? `?status=${status}` : ''}`) }
  createInvoice(id: string, engagementId: string, amount: number, month = '', notes = '') {
    return this.call<InvoiceRow>(`/api/clients/${id}/invoices`, { method: 'POST', body: JSON.stringify({ engagement_id: engagementId, amount, month, notes }) })
  }
  markInvoicePaid(id: string, invoiceId: string) {
    return this.call<InvoiceRow>(`/api/clients/${id}/invoices/${invoiceId}/mark-paid`, { method: 'POST' })
  }
  listSyndicationRoutes(id: string) { return this.call<RouteRow[]>(`/api/clients/${id}/syndication/routes`) }
  runSyndication() { return this.call<{ posted: number; failed: number; skipped: number }>(`/api/clients/_/syndication/run`, { method: 'POST' }) }
}

// ─── Factory ──────────────────────────────────────────────────────────────────
export function makeClient(): BWaveClient {
  const apiUrl = process.env.BWAVE_API_URL?.trim()
  if (apiUrl) {
    console.warn(`[mcp] data layer: HttpClient → ${apiUrl}`)
    return new HttpClient(apiUrl, process.env.MCP_SERVICE_TOKEN?.trim())
  }
  console.warn('[mcp] data layer: EmbeddedClient (in-process db)')
  return new EmbeddedClient()
}
