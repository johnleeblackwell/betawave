/**
 * Streamable HTTP entry point — the remote / cloud microservice transport.
 *
 * Implements the official MCP **Streamable HTTP** transport (the 2025 spec
 * successor to the old HTTP+SSE transport; it streams server→client over SSE
 * under the hood). Runs STATELESS: a fresh McpServer + transport per POST, no
 * session store — so it scales horizontally behind a load balancer with no
 * sticky sessions.
 *
 * Endpoint:  POST /mcp   (JSON-RPC over Streamable HTTP)
 *            GET/DELETE /mcp → 405 (no server-initiated streams in stateless mode)
 *            GET /healthz    → liveness probe for container orchestrators
 *
 * Auth: requireAuth() — service token and/or OAuth (see auth.ts). OPEN if
 * neither is configured (localhost only).
 *
 * Run:  npm run mcp:http     (defaults to port 3030, override with MCP_HTTP_PORT)
 */
import '../../src/server/env.js'

import express from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { buildServer } from './server.js'
import { makeClient } from './data.js'
import { requireAuth, authConfigured } from './auth.js'

const PORT = Number(process.env.MCP_HTTP_PORT || 3030)
const dataClient = makeClient()

const app = express()
app.use(express.json())

app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'bwave-mcp', transport: 'streamable-http' }))

// Stateless MCP endpoint: build a new server+transport per request.
app.post('/mcp', requireAuth(), async (req, res) => {
  try {
    const server = buildServer(dataClient)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => { transport.close(); server.close() })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (err) {
    console.error('[mcp] request error:', err)
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null })
    }
  }
})

const methodNotAllowed = (_req: express.Request, res: express.Response) =>
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (stateless server)' }, id: null })
app.get('/mcp', methodNotAllowed)
app.delete('/mcp', methodNotAllowed)

app.listen(PORT, () => {
  console.error(`\n✅ βWave MCP (Streamable HTTP)`)
  console.error(`   Endpoint: http://localhost:${PORT}/mcp`)
  console.error(`   Health:   http://localhost:${PORT}/healthz`)
  if (!authConfigured()) {
    console.error(`   ⚠️  AUTH OPEN — no MCP_SERVICE_TOKEN or MCP_OAUTH_ISSUER set. Localhost only; do NOT expose publicly.\n`)
  } else {
    console.error(`   🔒 Auth enabled.\n`)
  }
})
