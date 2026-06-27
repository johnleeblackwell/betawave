/**
 * stdio entry point — for Claude Desktop and any local MCP client.
 *
 * Import order is load-bearing:
 *   1. quiet.js — redirect console.log → stderr BEFORE db.ts logs to stdout
 *      (stdout is the JSON-RPC channel; a stray write breaks the protocol).
 *   2. env.js   — load .env so db.ts / services read the right config.
 *   3. everything else.
 *
 * Run:  npm run mcp:stdio
 */
import './quiet.js'
import '../../src/server/env.js'

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildServer } from './server.js'
import { makeClient } from './data.js'

async function main() {
  const server = buildServer(makeClient())
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // Banner goes to stderr (quiet.js) so it never touches the protocol stream.
  console.error('[mcp] βWave MCP server running on stdio')
}

main().catch((err) => {
  console.error('[mcp] fatal:', err)
  process.exit(1)
})
