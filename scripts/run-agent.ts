import { config } from 'dotenv'
config({ override: true })

import { runAgent } from '../src/server/services/colonyAgent.js'

const clientId = process.argv[2]
if (!clientId) {
  console.error('Usage: npx tsx scripts/run-agent.ts <clientId>')
  console.error('Available clients:')
  const db = await import('../src/server/db.js')
  const clients = db.default.prepare('SELECT id, name, business_name FROM clients').all() as any[]
  for (const c of clients) {
    console.error(`  ${c.id}  ${c.business_name || c.name}`)
  }
  process.exit(1)
}

console.log(`\n  Running colony agent for ${clientId}...\n`)
const result = await runAgent(clientId)
console.log(JSON.stringify(result, null, 2))
console.log(`\n  Done. Posts generated: ${result.postsGenerated}`)
if (result.upload.localPath) {
  console.log(`  Site output: ${result.upload.localPath}`)
}
if (result.upload.url) {
  console.log(`  Arweave: ${result.upload.url}`)
}
