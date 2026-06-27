// @ts-nocheck
// Generic job runner — polls the jobs table every 15 seconds and dispatches
// pending jobs to the right worker based on job.type. Kept intentionally
// light; per-type concurrency + retries can come later.
import db from '../db.js'
import { runPseoJob } from './pseo.js'
import { runReportJob } from './report.js'
import { runCitationJob } from './citation-tracker.js'
import { runCitationClassifyJob } from './citation-classifier.js'
import { runCitationReportJob } from './citation-report.js'

// Set of in-flight job IDs so a slow job isn't re-picked on the next tick.
const inFlight = new Set<string>()

async function pickAndRun() {
  const pending = db.prepare(`
    SELECT id, type FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 10
  `).all() as any[]

  for (const { id, type } of pending) {
    if (inFlight.has(id)) continue
    inFlight.add(id)

    const worker = workerFor(type)
    if (!worker) {
      // Unknown type — mark failed so it doesn't spin forever
      db.prepare(`UPDATE jobs SET status = 'failed', error = ?, completed_at = unixepoch() WHERE id = ?`)
        .run(`No worker registered for type: ${type}`, id)
      inFlight.delete(id)
      continue
    }

    // Fire and forget — worker updates job row itself
    worker(id)
      .catch((err: any) => {
        console.error(`[job-runner] Job ${id} (${type}) crashed: ${err.message}`)
        db.prepare(`UPDATE jobs SET status = 'failed', error = ?, completed_at = unixepoch() WHERE id = ?`)
          .run(err.message || String(err), id)
      })
      .finally(() => inFlight.delete(id))
  }
}

function workerFor(type: string): ((jobId: string) => Promise<void>) | null {
  switch (type) {
    case 'pseo_batch':       return runPseoJob
    case 'report_generate':  return runReportJob
    case 'citation_run':      return runCitationJob
    case 'citation_classify': return runCitationClassifyJob
    case 'citation_report':   return runCitationReportJob
    default: return null
  }
}

export function startJobRunner() {
  console.log('[job-runner] Started — polling every 15s')
  pickAndRun().catch(console.error)
  setInterval(() => pickAndRun().catch(console.error), 15_000)
}
