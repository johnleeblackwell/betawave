import './env.js'  // must be first — loads .env before any module reads process.env
import express from 'express'
import cors from 'cors'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'

import clientsRouter from './routes/clients.js'
import sourcesRouter from './routes/sources.js'
import contentRouter from './routes/content.js'
import schedulesRouter from './routes/schedules.js'
import templatesRouter from './routes/templates.js'
import locationsRouter from './routes/locations.js'
import jobsRouter from './routes/jobs.js'
import reportsRouter from './routes/reports.js'
import publicReportsRouter from './routes/public-reports.js'
import { clientRouter as citationClientRouter, brandRouter as citationBrandRouter } from './routes/citation-tracker.js'
import { clientRespondRouter, respondRouter } from './routes/respond.js'
import socialRouter from './routes/social.js'
import prospectsRouter from './routes/prospects.js'
import engagementsRouter from './routes/engagements.js'
import invoicesRouter from './routes/invoices.js'
import leadGeneratorsRouter, { inviteRouter, myRouter } from './routes/lead-generators.js'
import myDashboardRouter from './routes/my-dashboard.js'
import commissionsRouter from './routes/commissions.js'
import shopRouter, { shopPublicRouter, storefrontRouter } from './routes/shop.js'
import discoveryRouter from './routes/discovery.js'
import syndicationRouter from './routes/syndication.js'
import agentsRouter from './routes/agents.js'
import sitesRouter from './routes/sites.js'
import siteServer from './services/site-server.js'
import { startScheduler } from './services/scheduler.js'
import { startJobRunner } from './services/job-runner.js'
import { authMiddleware, loginHandler, logoutHandler, meHandler } from './middleware/auth.js'
import { upsertUser } from './services/users.js'
import { settingsRouter } from './routes/settings.js'
import { loadKeysIntoEnv } from './services/secrets.js'
import { telegramRouter } from './routes/telegram.js'
import { pseoRouter } from './routes/pseo.js'
import { consultantRouter } from './routes/consultant.js'
import waitlistRouter from './routes/waitlist.js'
import { maybeSeedDemo } from './seedDemo.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = Number(process.env.PORT || 3001)

app.use(cors())
// Raw body for Stripe webhook signature verification (must be before express.json())
app.use('/api/shop/webhook', express.raw({ type: 'application/json' }))
app.use(express.json())
// For no-JS form fallback on the aim.report landing page (/r/:niche/capture).
app.use(express.urlencoded({ extended: true }))

// Public endpoints (before authMiddleware)
app.options('/api/waitlist', cors())
app.use('/api/waitlist', waitlistRouter)

// Auth guard — runs before all routes. Disabled if APP_PASSWORD not set.
app.use(authMiddleware)
app.get('/login', loginHandler)
app.post('/login', loginHandler)
app.get('/logout', logoutHandler)
app.get('/api/me', meHandler)

// Owner-only user provisioning (operators are blocked from /api/admin by the
// operatorGuard; owner cookie + MCP service token pass the auth guard).
app.post('/api/admin/users', (req, res) => {
  const { email, password, role = 'operator', client_id = null } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'email and password required' })
  const u = upsertUser(email, password, role, client_id)
  res.json({ ok: true, user: { id: u.id, email: u.email, role: u.role, client_id: u.client_id } })
})

// API routes
app.use('/api/clients', clientsRouter)
app.use('/api/clients/:clientId/sources', sourcesRouter)
app.use('/api/clients/:clientId/content', contentRouter)
app.use('/api/clients/:clientId/schedules', schedulesRouter)
app.use('/api/clients/:clientId/locations', locationsRouter)
app.use('/api/templates', templatesRouter)
app.use('/api/jobs', jobsRouter)
app.use('/api/reports', reportsRouter)
// Citation Tracker — client-level (brand setup) and brand-level (queries/runs/competitors)
app.use('/api/clients/:clientId/citation-tracker', citationClientRouter)
app.use('/api/citation-tracker', citationBrandRouter)
// Instance settings — BYO API keys (owner-only)
app.use('/api/settings', settingsRouter)
// Respond — client-level summary/inbox and global account/comment/conversation management
app.use('/api/clients/:clientId/respond', clientRespondRouter)
app.use('/api/clients/:clientId/telegram', telegramRouter)
app.use('/api/clients/:clientId/pseo', pseoRouter)
app.use('/api/clients/:clientId/consultant', consultantRouter)
app.use('/api/clients/:clientId/social', socialRouter)
app.use('/api/clients/:clientId/prospects', prospectsRouter)
app.use('/api/clients/:clientId/engagements', engagementsRouter)
app.use('/api/clients/:clientId/invoices', invoicesRouter)
// Affiliates — global lead generator pool (admin) + invite acceptance (public)
app.use('/api/lead-generators', leadGeneratorsRouter)
app.use('/api/commissions', commissionsRouter)
// Shop — admin SKU/purchase management (per-client) + public checkout/webhook/storefront
app.use('/api/clients/:clientId/shop', shopRouter)
app.use('/api/shop', shopPublicRouter)
app.use('/shop', storefrontRouter)
// Discovery Layer — client-scoped: verticals, organisations, contacts, prospects, scoring, LLM provider
app.use('/api/clients/:clientId/discovery', discoveryRouter)
// Syndication — RSS-source → X-destination auto-poster (no approval queue)
app.use('/api/clients/:clientId/syndication', syndicationRouter)
app.use('/api/clients/:clientId/agent', agentsRouter)
app.use('/api/clients/:clientId/sites', sitesRouter)
app.use('/site', siteServer)
app.use('/invite', inviteRouter)
app.use('/my', myRouter)
app.use('/my', myDashboardRouter)
app.use('/api/respond', respondRouter)
// Public /r/:niche landing + capture + download — must come before SPA catch-all.
app.use('/', publicReportsRouter)

// Validate RSS feed URL
app.get('/api/validate-rss', async (req, res) => {
  const { url } = req.query as { url: string }
  if (!url) return res.status(400).json({ error: 'url required' })
  const { validateRSSUrl } = await import('./services/rss.js')
  const result = await validateRSSUrl(url)
  res.json(result)
})

// Health check
app.get('/api/health', (_req, res) => {
  const hasKey = !!process.env.ANTHROPIC_API_KEY
  res.json({ ok: true, api_key_configured: hasKey })
})

// Serve built frontend in production
const clientDist = join(__dirname, '../../dist/client')
if (existsSync(clientDist)) {
  app.use(express.static(clientDist))
  app.get('*', (_req, res) => res.sendFile(join(clientDist, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`\n✅ Betawave / βWave`)
  console.log(`   API: http://localhost:${PORT}/api`)
  loadKeysIntoEnv()   // push any BYO keys from the DB into process.env before services start
  maybeSeedDemo()     // first-run only: seed the βWave demo client if the DB is empty (SEED_DEMO=false to skip)
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(`\n⚠️  ANTHROPIC_API_KEY not set — copy .env.example to .env and add your key\n`)
  }
  startScheduler()
  startJobRunner()
})
