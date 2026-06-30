// @ts-nocheck
/**
 * CLI wrapper — seed the βWave demo client manually.
 *
 *   npm run seed:demo
 *
 * (The same seed also runs automatically on first boot unless SEED_DEMO=false.
 *  Real logic lives in src/server/seedDemo.ts so both paths share it.)
 */
import '../src/server/env.js'
import { seedDemo } from '../src/server/seedDemo.js'

const r = seedDemo(true)

console.log('')
console.log('─'.repeat(48))
console.log(`  Demo ready. Open the app and explore the`)
console.log(`  "${r.client}" client:`)
console.log(`    • Content — ${r.posts} ready-to-edit draft posts`)
console.log(`    • Citation Tracker — ${r.queries} queries vs ${r.competitors} rivals`)
console.log(`    • Brand DNA — voice, audience, style pre-filled`)
console.log(`  Add your own AI key in Settings to generate live.`)
console.log('─'.repeat(48))
