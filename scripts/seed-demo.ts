/**
 * Seed the demo client from the command line.
 *
 *   npx tsx scripts/seed-demo.ts            # seed (idempotent — safe to re-run)
 *   npx tsx scripts/seed-demo.ts --quiet    # same, less output
 *
 * This is a thin wrapper around src/server/seedDemo.ts, which is also what
 * SEED_DEMO=true runs on first boot. There is deliberately ONE seeder.
 *
 * An earlier version of this file was a second, independent implementation
 * written without checking what already existed. It produced a thinner result —
 * no prospects funnel, no respond inbox, no schedule — while duplicating the
 * parts that did overlap, which is the worst of both: two things to maintain
 * and the one you happen to run decides what the demo looks like.
 *
 * If you want to populate a DIFFERENT client, don't reach for a second seeder:
 * seedDemo() targets the demo client by design, because seeding synthetic
 * contacts into a real client's pipeline is a mistake you only make once.
 */
import { seedDemo } from '../src/server/seedDemo.js'

const quiet = process.argv.includes('--quiet')

try {
  const r = seedDemo(!quiet, { discovery: true })
  console.log(`\n✅ Seeded "${r.client}" — ${r.posts} posts · ${r.queries} citation queries · ${r.competitors} competitors`)
  console.log('   Open the app and look at Reach → Discovery → Today\'s outreach, and Measure.')
  console.log('   Delete the client in the UI when you are done with it.\n')
} catch (e: any) {
  console.error('seed failed:', e?.message || e)
  process.exit(1)
}
