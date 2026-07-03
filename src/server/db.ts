// Local SQLite via `libsql` (synchronous, better-sqlite3-compatible client).
// Single canonical database on the Hetzner primary; no cloud sync.
// (Turso embedded-replica sync was retired 2026-06-08 — Hetzner is the sole
//  source of truth, backed up via local snapshots + Google Drive + server snapshots.)
import Database from 'libsql'
import { join, isAbsolute } from 'path'

// Anchor the db file on the project root (process.cwd()), not on this module's
// location. The previous `__dirname/../../../data.db` resolved to the project
// root only for the built layout (dist/server/db.js); under tsx (src/server/db.ts)
// it overshot to the PARENT of the project, so dev and prod silently opened
// different databases. npm run dev / start / build all run from the project root,
// so cwd is stable. DATABASE_PATH overrides for non-standard deployments.
const dbPath = process.env.DATABASE_PATH
  ? (isAbsolute(process.env.DATABASE_PATH) ? process.env.DATABASE_PATH : join(process.cwd(), process.env.DATABASE_PATH))
  : join(process.cwd(), 'data.db')

const db = new Database(dbPath)
console.log(`[db] SQLite (local) at ${dbPath}`)

db.exec(`PRAGMA journal_mode = WAL`)
db.exec(`PRAGMA foreign_keys = ON`)

// Generic key-value store for persisted app state (e.g. last daily-cap reset
// date — must survive restarts, unlike an in-memory variable).
db.exec(`CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT)`)

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    business_name TEXT NOT NULL,
    industry TEXT NOT NULL,
    expertise_areas TEXT NOT NULL DEFAULT '[]',
    tone_of_voice TEXT NOT NULL DEFAULT 'professional',
    target_audience TEXT NOT NULL DEFAULT '',
    style_notes TEXT DEFAULT '',
    contact_email TEXT DEFAULT '',
    smtp_host TEXT DEFAULT '',
    smtp_port INTEGER DEFAULT 587,
    smtp_user TEXT DEFAULT '',
    smtp_pass TEXT DEFAULT '',
    smtp_from TEXT DEFAULT '',
    wp_url TEXT DEFAULT '',
    wp_username TEXT DEFAULT '',
    wp_app_password TEXT DEFAULT '',
    wp_post_status TEXT DEFAULT 'draft',
    image_source TEXT DEFAULT 'auto',
    image_keywords TEXT DEFAULT '',
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    type TEXT NOT NULL,
    url TEXT DEFAULT '',
    keywords TEXT DEFAULT '[]',
    label TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS content (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    excerpt TEXT DEFAULT '',
    status TEXT DEFAULT 'draft',
    image_query TEXT DEFAULT '',
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'blog',
    frequency TEXT NOT NULL DEFAULT 'weekly',
    day_of_week INTEGER DEFAULT 1,
    time_of_day TEXT DEFAULT '09:00',
    auto_publish_email INTEGER DEFAULT 0,
    auto_publish_wp INTEGER DEFAULT 0,
    enabled INTEGER DEFAULT 1,
    next_run INTEGER,
    last_run INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  -- Parameterised prompt templates for pSEO pages, niche reports, and reusable blog/newsletter formats.
  -- client_id NULL  ⇒  install-wide template (available to all clients).
  -- variables is a JSON array of placeholder names expected in prompt_template (e.g. ["location","niche"]).
  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    client_id TEXT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'blog',
    prompt_template TEXT NOT NULL,
    variables TEXT NOT NULL DEFAULT '[]',
    output_format TEXT NOT NULL DEFAULT 'markdown',
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT DEFAULT '',
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  -- Geo locations per client (for pSEO batches — e.g. a chain's 13 locations).
  CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    region TEXT DEFAULT '',
    country TEXT DEFAULT 'UK',
    lat REAL,
    lng REAL,
    meta TEXT NOT NULL DEFAULT '{}',
    active INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    UNIQUE (client_id, slug)
  );

  -- Background batch jobs: pSEO generation runs, niche report builds, scheduled posts.
  -- params holds the input payload as JSON; result holds the summary/errors as JSON.
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    client_id TEXT,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    total INTEGER DEFAULT 0,
    completed INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    params TEXT NOT NULL DEFAULT '{}',
    result TEXT NOT NULL DEFAULT '{}',
    error TEXT DEFAULT '',
    created_at INTEGER DEFAULT (unixepoch()),
    started_at INTEGER,
    completed_at INTEGER,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client_id);
  CREATE INDEX IF NOT EXISTS idx_locations_client ON locations(client_id);
  CREATE INDEX IF NOT EXISTS idx_templates_kind ON templates(kind);

  -- Niche reports — lead-magnet products exposed at aim.report/{niche}.
  -- body_html is the full rendered report delivered after email capture.
  -- hero_copy is the landing-page pitch above the email form.
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    client_id TEXT,
    niche TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    subtitle TEXT DEFAULT '',
    hero_copy TEXT DEFAULT '',
    body_md TEXT DEFAULT '',
    body_html TEXT DEFAULT '',
    image_query TEXT DEFAULT '',
    template_id TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE SET NULL
  );

  -- Email captures for a niche report. kit_synced tracks whether we've pushed
  -- the contact to Kit (ConvertKit). source is a free-text tag (e.g. 'landing', 'twitter').
  CREATE TABLE IF NOT EXISTS report_leads (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT DEFAULT '',
    source TEXT DEFAULT 'landing',
    consent_marketing INTEGER DEFAULT 1,
    kit_synced INTEGER DEFAULT 0,
    ip TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_report_leads_report ON report_leads(report_id);
  CREATE INDEX IF NOT EXISTS idx_report_leads_email ON report_leads(email);

  -- ─────────────────────────────────────────────────────────────────────────
  -- MEASURE MODULE — Citation Tracker (Phase 1)
  -- Tracks brand mentions across Anthropic, OpenAI, Perplexity, and Gemini.
  -- ─────────────────────────────────────────────────────────────────────────

  -- One tracked brand per client (1:1 in MVP). Holds budget + schedule config.
  CREATE TABLE IF NOT EXISTS tracked_brands (
    id              TEXT PRIMARY KEY,
    client_id       TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    primary_url     TEXT DEFAULT '',
    industry        TEXT DEFAULT '',
    locations_json  TEXT DEFAULT '[]',
    weekly_budget_gbp REAL DEFAULT 30.0,
    status          TEXT DEFAULT 'active',
    schedule_cron   TEXT DEFAULT '0 23 * * 0',
    last_run_at     INTEGER,
    next_run_at     INTEGER,
    created_at      INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  -- Category queries to ask each engine. Max 20 enforced at API layer.
  CREATE TABLE IF NOT EXISTS tracked_queries (
    id          TEXT PRIMARY KEY,
    brand_id    TEXT NOT NULL,
    text        TEXT NOT NULL,
    category    TEXT DEFAULT '',
    priority    INTEGER DEFAULT 1,
    active      INTEGER DEFAULT 1,
    created_at  INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (brand_id) REFERENCES tracked_brands(id) ON DELETE CASCADE
  );

  -- Competitor brands to detect in engine responses. Max 10 enforced at API layer.
  CREATE TABLE IF NOT EXISTS tracked_competitors (
    id           TEXT PRIMARY KEY,
    brand_id     TEXT NOT NULL,
    name         TEXT NOT NULL,
    url          TEXT DEFAULT '',
    aliases_json TEXT DEFAULT '[]',
    active       INTEGER DEFAULT 1,
    created_at   INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (brand_id) REFERENCES tracked_brands(id) ON DELETE CASCADE
  );

  -- One row per weekly sweep. Pairs with a jobs row for worker bookkeeping.
  CREATE TABLE IF NOT EXISTS citation_runs (
    id           TEXT PRIMARY KEY,
    brand_id     TEXT NOT NULL,
    job_id       TEXT,
    run_at       INTEGER NOT NULL,
    status       TEXT DEFAULT 'pending',
    total_calls  INTEGER DEFAULT 0,
    completed    INTEGER DEFAULT 0,
    failed       INTEGER DEFAULT 0,
    cost_gbp     REAL DEFAULT 0,
    budget_gbp   REAL,
    engines_json TEXT DEFAULT '[]',
    notes        TEXT DEFAULT '',
    FOREIGN KEY (brand_id) REFERENCES tracked_brands(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
  );

  -- One row per (query × engine) pair within a run.
  -- Classification columns (brand_mentioned … competitor_mentions_json) are
  -- filled by the citation-classifier worker in a separate pass.
  CREATE TABLE IF NOT EXISTS citation_results (
    id                      TEXT PRIMARY KEY,
    run_id                  TEXT NOT NULL,
    query_id                TEXT,
    engine                  TEXT NOT NULL,
    raw_response            TEXT DEFAULT '',
    cited_sources           TEXT DEFAULT '',
    input_tokens            INTEGER DEFAULT 0,
    output_tokens           INTEGER DEFAULT 0,
    cost_gbp                REAL DEFAULT 0,
    latency_ms              INTEGER DEFAULT 0,
    http_status             INTEGER DEFAULT 0,
    classified_at           INTEGER,
    brand_mentioned         INTEGER,
    brand_position          TEXT,
    brand_quote             TEXT DEFAULT '',
    sentiment               TEXT,
    competitor_mentions_json TEXT DEFAULT '[]',
    error                   TEXT DEFAULT '',
    created_at              INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (run_id) REFERENCES citation_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (query_id) REFERENCES tracked_queries(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_citation_results_run    ON citation_results(run_id);
  CREATE INDEX IF NOT EXISTS idx_citation_results_query  ON citation_results(query_id);
  CREATE INDEX IF NOT EXISTS idx_citation_results_engine ON citation_results(engine, brand_mentioned);
  CREATE INDEX IF NOT EXISTS idx_citation_runs_brand     ON citation_runs(brand_id);
  CREATE INDEX IF NOT EXISTS idx_tracked_queries_brand   ON tracked_queries(brand_id);
  CREATE INDEX IF NOT EXISTS idx_tracked_competitors_brand ON tracked_competitors(brand_id);
`)

// ─── Respond module schema ────────────────────────────────────────────────────
db.exec(`

  -- One row per connected account/location per platform.
  -- A multi-location client (e.g. a chain × 13 locations) will have many rows —
  -- one per Instagram account, one per GBP location, one per WhatsApp number, etc.
  CREATE TABLE IF NOT EXISTS social_accounts (
    id               TEXT PRIMARY KEY,
    client_id        TEXT NOT NULL,
    platform         TEXT NOT NULL,          -- 'instagram'|'gbp'|'whatsapp'|'twitter'|'tiktok'
    account_name     TEXT NOT NULL,          -- human label, e.g. "Riverside Dental Central"
    location_label   TEXT DEFAULT '',        -- e.g. "Northgate" — helps staff identify which location
    external_id      TEXT DEFAULT '',        -- platform's own ID (page_id, location_name, phone_number_id…)
    username         TEXT DEFAULT '',        -- @handle or phone number for display
    access_token     TEXT DEFAULT '',        -- encrypted at rest in production; plaintext for MVP
    refresh_token    TEXT DEFAULT '',
    token_expires_at INTEGER,               -- unix timestamp; NULL = non-expiring
    webhook_verified INTEGER DEFAULT 0,     -- 1 once Meta webhook challenge passed
    status           TEXT DEFAULT 'pending', -- 'active'|'pending'|'disconnected'|'error'
    error_message    TEXT DEFAULT '',
    last_fetched_at  INTEGER,
    created_at       INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  -- Comments / reviews — for platforms where interactions are discrete items
  -- (GBP reviews, Instagram post comments, Twitter mentions, TikTok comments).
  -- Each row is one inbound item. A reply is a separate row in social_replies.
  CREATE TABLE IF NOT EXISTS social_comments (
    id               TEXT PRIMARY KEY,
    account_id       TEXT NOT NULL,
    platform         TEXT NOT NULL,
    external_id      TEXT NOT NULL,          -- platform's comment/review ID (unique per platform+account)
    author_name      TEXT DEFAULT '',
    author_external_id TEXT DEFAULT '',
    content          TEXT DEFAULT '',
    rating           INTEGER,                -- 1–5 for GBP reviews; NULL for comments
    post_id          TEXT DEFAULT '',        -- Instagram post ID, TikTok video ID, etc.
    post_url         TEXT DEFAULT '',
    parent_id        TEXT DEFAULT '',        -- for nested comment threads
    status           TEXT DEFAULT 'pending', -- 'pending'|'replied'|'ignored'|'archived'
    sentiment        TEXT,                   -- 'positive'|'neutral'|'negative' — filled by classifier
    classified_at    INTEGER,
    published_at     INTEGER,               -- when the comment was posted on the platform
    fetched_at       INTEGER DEFAULT (unixepoch()),
    created_at       INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (account_id) REFERENCES social_accounts(id) ON DELETE CASCADE
  );

  -- Replies to comments/reviews.
  -- Draft → approved → sent lifecycle.
  CREATE TABLE IF NOT EXISTS social_replies (
    id               TEXT PRIMARY KEY,
    comment_id       TEXT NOT NULL,
    draft_content    TEXT DEFAULT '',
    approved_content TEXT DEFAULT '',
    status           TEXT DEFAULT 'draft',   -- 'draft'|'approved'|'sending'|'sent'|'failed'
    error_message    TEXT DEFAULT '',
    drafted_by       TEXT DEFAULT 'ai',      -- 'ai'|'human'
    approved_at      INTEGER,
    sent_at          INTEGER,
    external_id      TEXT DEFAULT '',        -- platform's reply ID once posted
    created_at       INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (comment_id) REFERENCES social_comments(id) ON DELETE CASCADE
  );

  -- WhatsApp (and future DM platforms) use a conversation/thread model
  -- rather than comment model — multiple back-and-forth messages per contact.
  CREATE TABLE IF NOT EXISTS social_conversations (
    id               TEXT PRIMARY KEY,
    account_id       TEXT NOT NULL,
    platform         TEXT NOT NULL DEFAULT 'whatsapp',
    contact_id       TEXT NOT NULL,          -- WhatsApp phone number or platform user ID
    contact_name     TEXT DEFAULT '',
    contact_phone    TEXT DEFAULT '',        -- E.164 format for WhatsApp
    status           TEXT DEFAULT 'open',    -- 'open'|'replied'|'resolved'|'archived'
    unread_count     INTEGER DEFAULT 0,
    last_message_at  INTEGER,
    last_message_preview TEXT DEFAULT '',
    created_at       INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (account_id) REFERENCES social_accounts(id) ON DELETE CASCADE
  );

  -- Individual messages within a conversation.
  CREATE TABLE IF NOT EXISTS social_messages (
    id               TEXT PRIMARY KEY,
    conversation_id  TEXT NOT NULL,
    account_id       TEXT NOT NULL,
    external_id      TEXT DEFAULT '',        -- WhatsApp message ID
    direction        TEXT NOT NULL,          -- 'inbound'|'outbound'
    content          TEXT DEFAULT '',
    media_url        TEXT DEFAULT '',        -- image/video/audio attachment URL
    media_type       TEXT DEFAULT '',        -- 'image'|'video'|'audio'|'document'
    status           TEXT DEFAULT 'delivered', -- 'pending'|'sent'|'delivered'|'read'|'failed'
    draft_content    TEXT DEFAULT '',        -- AI draft for the next outbound reply
    error_message    TEXT DEFAULT '',
    sent_at          INTEGER,
    created_at       INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (conversation_id) REFERENCES social_conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id)      REFERENCES social_accounts(id)      ON DELETE CASCADE
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_social_accounts_client    ON social_accounts(client_id);
  CREATE INDEX IF NOT EXISTS idx_social_accounts_platform  ON social_accounts(platform, status);
  CREATE INDEX IF NOT EXISTS idx_social_comments_account   ON social_comments(account_id);
  CREATE INDEX IF NOT EXISTS idx_social_comments_status    ON social_comments(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_social_comments_external  ON social_comments(platform, external_id);
  CREATE INDEX IF NOT EXISTS idx_social_replies_comment    ON social_replies(comment_id);
  CREATE INDEX IF NOT EXISTS idx_social_convs_account      ON social_conversations(account_id);
  CREATE INDEX IF NOT EXISTS idx_social_convs_status       ON social_conversations(status, last_message_at);
  CREATE INDEX IF NOT EXISTS idx_social_messages_conv      ON social_messages(conversation_id);
`)

// ─────────────────────────────────────────────────────────────────────────────
// AFFILIATES MODULE — Prospect pipeline, deal tracking, invoice anchoring
// Prospects live per-client. Engagements and invoices attach to prospects.
// source_lead_gen links to lead_generators (added in Commit 2).
// ─────────────────────────────────────────────────────────────────────────────
db.exec(`
  -- A prospect is a potential client sourced for a specific client account.
  -- status moves: lead → qualified → proposal_sent → signed → active → churned
  CREATE TABLE IF NOT EXISTS prospects (
    id                    TEXT PRIMARY KEY,
    client_id             TEXT NOT NULL,
    name                  TEXT NOT NULL,
    email                 TEXT DEFAULT '',
    phone                 TEXT DEFAULT '',
    company               TEXT DEFAULT '',
    status                TEXT NOT NULL DEFAULT 'lead',
    source_lead_gen       TEXT DEFAULT '',   -- FK → lead_generators.id (enforced after Commit 2)
    attribution_timestamp INTEGER,           -- unix timestamp when lead gen was tagged
    notes                 TEXT DEFAULT '',
    created_at            INTEGER DEFAULT (unixepoch()),
    updated_at            INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_prospects_client ON prospects(client_id);
  CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);
  CREATE INDEX IF NOT EXISTS idx_prospects_lead_gen ON prospects(source_lead_gen);

  -- An engagement is a signed deal between the operator and a client, sourced via a prospect.
  -- type: 'founder_retainer' | 'monthly_retainer' | 'annual_retainer' | 'one_off'
  -- payment_cadence: 'monthly' | 'annual' | 'one_off'
  -- value is the recurring monthly amount (or total for one_off / annual).
  -- first_payment_amount is the actual first invoice value (may differ from value
  -- if annual — e.g. value=3750/mo, first_payment_amount=45000 for annual).
  CREATE TABLE IF NOT EXISTS engagements (
    id                    TEXT PRIMARY KEY,
    client_id             TEXT NOT NULL,
    prospect_id           TEXT,              -- which prospect became this client
    type                  TEXT NOT NULL DEFAULT 'monthly_retainer',
    value                 REAL NOT NULL,     -- monthly rate or one-off total
    payment_cadence       TEXT NOT NULL DEFAULT 'monthly',
    first_payment_amount  REAL,             -- actual first invoice (calculated on sign)
    signed_at             INTEGER,          -- unix timestamp when deal was signed
    status                TEXT NOT NULL DEFAULT 'active',  -- active | paused | churned | cancelled
    notes                 TEXT DEFAULT '',
    created_at            INTEGER DEFAULT (unixepoch()),
    updated_at            INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (client_id)   REFERENCES clients(id)   ON DELETE CASCADE,
    FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_engagements_client   ON engagements(client_id);
  CREATE INDEX IF NOT EXISTS idx_engagements_prospect ON engagements(prospect_id);
  CREATE INDEX IF NOT EXISTS idx_engagements_status   ON engagements(status);

  -- An invoice is one payment event against an engagement.
  -- The commission engine checks invoice.paid_at to trigger payouts.
  -- month is YYYY-MM (e.g. '2026-05') — which retainer month this invoice covers.
  CREATE TABLE IF NOT EXISTS invoices (
    id            TEXT PRIMARY KEY,
    client_id     TEXT NOT NULL,
    engagement_id TEXT NOT NULL,
    amount        REAL NOT NULL,
    month         TEXT DEFAULT '',   -- 'YYYY-MM'
    status        TEXT NOT NULL DEFAULT 'pending',  -- pending | paid | overdue | cancelled
    paid_at       INTEGER,          -- unix timestamp when payment confirmed
    notes         TEXT DEFAULT '',
    created_at    INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (client_id)     REFERENCES clients(id)     ON DELETE CASCADE,
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_invoices_client     ON invoices(client_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_engagement ON invoices(engagement_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_status     ON invoices(status, paid_at);
`)

// ─────────────────────────────────────────────────────────────────────────────
// AFFILIATES MODULE — Global lead generator pool
// Lead generators are global (no client_id). Authorization is per-client via
// lead_gen_client_access. Credentials (Slack/WhatsApp) in lead_gen_credentials.
// ─────────────────────────────────────────────────────────────────────────────
db.exec(`
  -- One row per lead generator. Global — not scoped to any client.
  -- status: invited (link sent, not yet accepted) → active (accepted) → inactive (manually disabled)
  -- last_new_sale_date is the 6-month inactivity gate anchor.
  CREATE TABLE IF NOT EXISTS lead_generators (
    id                  TEXT PRIMARY KEY,
    email               TEXT UNIQUE NOT NULL,
    name                TEXT DEFAULT '',
    status              TEXT NOT NULL DEFAULT 'invited',   -- invited | active | inactive
    invite_token        TEXT DEFAULT '',   -- signed JWT; cleared after acceptance
    invite_expires_at   INTEGER,          -- unix timestamp
    last_new_sale_date  INTEGER,          -- unix timestamp; NULL = never made a sale
    session_token       TEXT DEFAULT '',  -- HMAC session cookie value (set on invite acceptance)
    created_at          INTEGER DEFAULT (unixepoch()),
    invited_at          INTEGER DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_lead_gen_email  ON lead_generators(email);
  CREATE INDEX IF NOT EXISTS idx_lead_gen_status ON lead_generators(status);

  -- Which clients a lead gen is authorized to source prospects for.
  -- Admin grants and revokes access via this table.
  CREATE TABLE IF NOT EXISTS lead_gen_client_access (
    id            TEXT PRIMARY KEY,
    lead_gen_id   TEXT NOT NULL,
    client_id     TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active',  -- active | revoked
    authorized_at INTEGER DEFAULT (unixepoch()),
    UNIQUE (lead_gen_id, client_id),
    FOREIGN KEY (lead_gen_id) REFERENCES lead_generators(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id)   REFERENCES clients(id)         ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_lgca_lead_gen ON lead_gen_client_access(lead_gen_id);
  CREATE INDEX IF NOT EXISTS idx_lgca_client   ON lead_gen_client_access(client_id);

  -- Optional notification credentials per lead gen.
  -- Slack OR WhatsApp (or both). One row per channel.
  CREATE TABLE IF NOT EXISTS lead_gen_credentials (
    id                 TEXT PRIMARY KEY,
    lead_gen_id        TEXT NOT NULL,
    channel            TEXT NOT NULL,  -- 'slack' | 'whatsapp'
    slack_webhook_url  TEXT DEFAULT '', -- Slack incoming webhook
    whatsapp_phone     TEXT DEFAULT '', -- E.164 format
    created_at         INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (lead_gen_id) REFERENCES lead_generators(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_lgcred_lead_gen ON lead_gen_credentials(lead_gen_id);
`)

// ─────────────────────────────────────────────────────────────────────────────
// AFFILIATES MODULE — Commission ledger + payout settlements
// commission_ledger: one row per commission event (20% first, 10% recurring).
// payout_ledger: one row per lead gen per month — the settlement record.
// ─────────────────────────────────────────────────────────────────────────────
db.exec(`
  -- One row per commission event.
  -- commission_type: 'first_20' (20% of first payment) | 'recurring_10' (10% monthly)
  -- status: pending → paid | suspended (inactivity gate)
  -- month is YYYY-MM — which retainer month this commission relates to
  CREATE TABLE IF NOT EXISTS commission_ledger (
    id                   TEXT PRIMARY KEY,
    lead_gen_id          TEXT NOT NULL,
    client_id            TEXT NOT NULL,
    engagement_id        TEXT NOT NULL,
    invoice_id           TEXT,                -- which invoice triggered this commission
    commission_type      TEXT NOT NULL,       -- 'first_20' | 'recurring_10'
    first_payment_amount REAL,               -- the amount the 20% was calculated on
    amount               REAL NOT NULL,       -- actual commission (20% or 10% of invoice)
    month                TEXT NOT NULL,       -- 'YYYY-MM'
    status               TEXT NOT NULL DEFAULT 'pending',  -- pending | paid | suspended
    inactivity_flag      INTEGER DEFAULT 0,   -- 1 if suspended due to 6-month gate
    paid_date            INTEGER,             -- unix timestamp of payout settlement
    payout_id            TEXT DEFAULT '',     -- FK to payout_ledger.id once settled
    notes                TEXT DEFAULT '',
    created_at           INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (lead_gen_id)   REFERENCES lead_generators(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id)     REFERENCES clients(id)          ON DELETE CASCADE,
    FOREIGN KEY (engagement_id) REFERENCES engagements(id)      ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_commission_lead_gen    ON commission_ledger(lead_gen_id, status);
  CREATE INDEX IF NOT EXISTS idx_commission_engagement  ON commission_ledger(engagement_id);
  CREATE INDEX IF NOT EXISTS idx_commission_month       ON commission_ledger(month);
  CREATE INDEX IF NOT EXISTS idx_commission_invoice     ON commission_ledger(invoice_id);

  -- One row per lead gen per calendar month — the settled payout record.
  -- total_earned = sum of all commissions due that month
  -- total_paid   = sum actually paid (may differ if some were suspended)
  -- suspended_flag = true if inactivity gate was active for any part of the month
  CREATE TABLE IF NOT EXISTS payout_ledger (
    id             TEXT PRIMARY KEY,
    lead_gen_id    TEXT NOT NULL,
    month          TEXT NOT NULL,       -- 'YYYY-MM'
    total_earned   REAL NOT NULL DEFAULT 0,
    total_paid     REAL NOT NULL DEFAULT 0,
    suspended_flag INTEGER DEFAULT 0,
    settlement_date INTEGER,            -- unix timestamp when settled
    audit_notes    TEXT DEFAULT '',
    created_at     INTEGER DEFAULT (unixepoch()),
    UNIQUE (lead_gen_id, month),
    FOREIGN KEY (lead_gen_id) REFERENCES lead_generators(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_payout_lead_gen ON payout_ledger(lead_gen_id, month);
`)

// ─────────────────────────────────────────────────────────────────────────────
// SHOP MODULE — multi-product-type catalog
// shop_skus: per-client products (gift_card | service | subscription | product)
// shop_purchases: one row per purchase (Stripe checkout → webhook)
// gift_card_redemptions: redemption events for gift_card type only
//
// Note: shop_skus + shop_purchases are created/migrated in the later
// "Shop generalisation" block below. Only gift_card_redemptions is created here
// because it's gift-card-specific and always referenced by purchase_id.
// ─────────────────────────────────────────────────────────────────────────────
db.exec(`
  -- Redemption events. May be partial (e.g. £30 used from a £50 card).
  -- References shop_purchases.id (a purchase of product_type='gift_card').
  CREATE TABLE IF NOT EXISTS gift_card_redemptions (
    id              TEXT PRIMARY KEY,
    purchase_id     TEXT NOT NULL,
    redeemed_at     INTEGER DEFAULT (unixepoch()),
    redeemed_by     TEXT DEFAULT '',
    value_redeemed  REAL NOT NULL,
    notes           TEXT DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_gc_redemptions_purchase ON gift_card_redemptions(purchase_id);
`)

// Backfill: add FK constraint annotation on prospects.source_lead_gen
// (SQLite doesn't support ADD CONSTRAINT after creation, but we enforce at app layer)

// Migrations: add columns introduced after initial schema
const existingCols = (db.prepare('PRAGMA table_info(clients)').all() as any[]).map(c => c.name)
if (!existingCols.includes('smtp_host')) {
  db.exec(`ALTER TABLE clients ADD COLUMN smtp_host TEXT DEFAULT ''`)
  db.exec(`ALTER TABLE clients ADD COLUMN smtp_port INTEGER DEFAULT 587`)
  db.exec(`ALTER TABLE clients ADD COLUMN smtp_user TEXT DEFAULT ''`)
  db.exec(`ALTER TABLE clients ADD COLUMN smtp_pass TEXT DEFAULT ''`)
  db.exec(`ALTER TABLE clients ADD COLUMN smtp_from TEXT DEFAULT ''`)
}
if (!existingCols.includes('wp_url')) {
  db.exec(`ALTER TABLE clients ADD COLUMN wp_url TEXT DEFAULT ''`)
  db.exec(`ALTER TABLE clients ADD COLUMN wp_username TEXT DEFAULT ''`)
  db.exec(`ALTER TABLE clients ADD COLUMN wp_app_password TEXT DEFAULT ''`)
  db.exec(`ALTER TABLE clients ADD COLUMN wp_post_status TEXT DEFAULT 'draft'`)
}
if (!existingCols.includes('image_source')) {
  db.exec(`ALTER TABLE clients ADD COLUMN image_source TEXT DEFAULT 'auto'`)
  db.exec(`ALTER TABLE clients ADD COLUMN image_keywords TEXT DEFAULT ''`)
}
if (!existingCols.includes('location')) {
  db.exec(`ALTER TABLE clients ADD COLUMN location TEXT DEFAULT ''`)
}
if (!existingCols.includes('blocked_topics')) {
  // JSON array of compliance-blocked topics; empty defaults to global filter
  db.exec(`ALTER TABLE clients ADD COLUMN blocked_topics TEXT DEFAULT '[]'`)
}

const existingContentCols = (db.prepare('PRAGMA table_info(content)').all() as any[]).map(c => c.name)
if (!existingContentCols.includes('image_query')) {
  db.exec(`ALTER TABLE content ADD COLUMN image_query TEXT DEFAULT ''`)
}

const existingScheduleCols = (db.prepare('PRAGMA table_info(schedules)').all() as any[]).map(c => c.name)
if (!existingScheduleCols.includes('topic_hint')) {
  db.exec(`ALTER TABLE schedules ADD COLUMN topic_hint TEXT DEFAULT ''`)
}
if (!existingScheduleCols.includes('wp_post_status')) {
  db.exec(`ALTER TABLE schedules ADD COLUMN wp_post_status TEXT DEFAULT ''`)
  db.exec(`ALTER TABLE schedules ADD COLUMN wp_category_id INTEGER DEFAULT 0`)
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISCOVERY LAYER — client-scoped outbound funnel
// All tables prefixed `dl_` to keep namespace clean from the affiliates module.
// Every dl_ row belongs to a client (any white-label tenant).
// ═══════════════════════════════════════════════════════════════════════════════
db.exec(`
  -- Vertical metadata — per client. (slug unique per client)
  CREATE TABLE IF NOT EXISTS verticals (
    id                       TEXT PRIMARY KEY,
    client_id                TEXT NOT NULL DEFAULT '',
    slug                     TEXT NOT NULL,
    name                     TEXT NOT NULL,
    description              TEXT DEFAULT '',
    multi_unit_min_locations INTEGER DEFAULT 3,
    status                   TEXT DEFAULT 'active',
    created_at               INTEGER DEFAULT (unixepoch())
  );

  -- Target organisations within a (client, vertical)
  CREATE TABLE IF NOT EXISTS dl_organizations (
    id                      TEXT PRIMARY KEY,
    client_id               TEXT NOT NULL DEFAULT '',
    vertical_id             TEXT NOT NULL,
    name                    TEXT NOT NULL,
    website                 TEXT DEFAULT '',
    domain                  TEXT DEFAULT '',
    location_count          INTEGER DEFAULT 0,
    hq_location             TEXT DEFAULT '',
    hq_postcode             TEXT DEFAULT '',
    companies_house_number  TEXT DEFAULT '',
    sub_segment             TEXT DEFAULT '',
    status                  TEXT DEFAULT 'active',
    notes                   TEXT DEFAULT '',
    created_at              INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (vertical_id) REFERENCES verticals(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_dl_orgs_vertical ON dl_organizations(vertical_id);
  CREATE INDEX IF NOT EXISTS idx_dl_orgs_domain   ON dl_organizations(domain);

  -- Named decision-makers within an organisation (Leadswift / Companies House / web scrape)
  CREATE TABLE IF NOT EXISTS dl_contacts (
    id                TEXT PRIMARY KEY,
    organization_id   TEXT NOT NULL,
    full_name         TEXT NOT NULL,
    role              TEXT DEFAULT '',
    email             TEXT DEFAULT '',
    linkedin_url      TEXT DEFAULT '',
    source            TEXT DEFAULT '',                -- 'leadswift' | 'companies_house' | 'website'
    source_confidence INTEGER DEFAULT 50,             -- 0-100
    gdpr_basis        TEXT DEFAULT 'legitimate_interest_b2b',
    status            TEXT DEFAULT 'active',          -- active | unsubscribed | bounced | excluded
    created_at        INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (organization_id) REFERENCES dl_organizations(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_dl_contacts_org   ON dl_contacts(organization_id);
  CREATE INDEX IF NOT EXISTS idx_dl_contacts_email ON dl_contacts(email);

  -- Qualified prospects (top-quartile by visibility score) — the "top 100"
  -- status: scored → approved → diagnostic → sent → engaged → hot → proposal → won | cold | skipped
  CREATE TABLE IF NOT EXISTS dl_prospects (
    id                    TEXT PRIMARY KEY,
    client_id             TEXT NOT NULL DEFAULT '',
    organization_id       TEXT NOT NULL UNIQUE,
    vertical_id           TEXT NOT NULL,
    visibility_score      REAL DEFAULT 0,             -- 0-1, lower = worse = better target
    score_calculated_at   INTEGER,
    rank                  INTEGER DEFAULT 0,
    status                TEXT DEFAULT 'scored',
    diagnostic_id         TEXT,
    approved_at           INTEGER,
    sent_at               INTEGER,
    hot_at                INTEGER,                    -- escalated to founder
    won_at                INTEGER,
    lost_at               INTEGER,
    notes                 TEXT DEFAULT '',
    created_at            INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (organization_id) REFERENCES dl_organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (vertical_id)     REFERENCES verticals(id)        ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_dl_prospects_status   ON dl_prospects(status);
  CREATE INDEX IF NOT EXISTS idx_dl_prospects_vertical ON dl_prospects(vertical_id, visibility_score);

  -- Generated diagnostic PDFs (one per prospect — Section 1-5 per OPORD §3.c.3.1)
  CREATE TABLE IF NOT EXISTS dl_diagnostics (
    id                      TEXT PRIMARY KEY,
    organization_id         TEXT NOT NULL,
    pdf_path                TEXT DEFAULT '',
    signed_url              TEXT DEFAULT '',
    signed_url_expires      INTEGER,
    queries_audited_json    TEXT DEFAULT '[]',
    competitors_cited_json  TEXT DEFAULT '[]',
    missing_queries_json    TEXT DEFAULT '[]',
    structural_problems_json TEXT DEFAULT '[]',
    score_snapshot          REAL DEFAULT 0,
    quote_gbp               REAL DEFAULT 12500,
    generated_at            INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (organization_id) REFERENCES dl_organizations(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_dl_diag_org ON dl_diagnostics(organization_id);

  -- Outbound email sends (sender address configured per deployment)
  CREATE TABLE IF NOT EXISTS dl_sends (
    id                  TEXT PRIMARY KEY,
    prospect_id         TEXT NOT NULL,
    contact_id          TEXT NOT NULL,
    sender_email        TEXT NOT NULL DEFAULT '',
    subject             TEXT NOT NULL,
    body                TEXT NOT NULL,
    ses_message_id      TEXT DEFAULT '',
    sent_at             INTEGER,
    opened              INTEGER DEFAULT 0,             -- count
    first_opened_at     INTEGER,
    clicked             INTEGER DEFAULT 0,
    first_clicked_at    INTEGER,
    replied             INTEGER DEFAULT 0,
    bounced             INTEGER DEFAULT 0,
    follow_up_sent_at   INTEGER,
    created_at          INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (prospect_id) REFERENCES dl_prospects(id) ON DELETE CASCADE,
    FOREIGN KEY (contact_id)  REFERENCES dl_contacts(id)  ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_dl_sends_prospect ON dl_sends(prospect_id);
  CREATE INDEX IF NOT EXISTS idx_dl_sends_contact  ON dl_sends(contact_id);
  CREATE INDEX IF NOT EXISTS idx_dl_sends_sent_at  ON dl_sends(sent_at);

  -- Tracking pixel hits
  CREATE TABLE IF NOT EXISTS dl_opens (
    id        TEXT PRIMARY KEY,
    send_id   TEXT NOT NULL,
    ts        INTEGER DEFAULT (unixepoch()),
    ip        TEXT DEFAULT '',
    ua        TEXT DEFAULT '',
    FOREIGN KEY (send_id) REFERENCES dl_sends(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_dl_opens_send ON dl_opens(send_id);

  -- Tracked link clicks (signed redirects)
  CREATE TABLE IF NOT EXISTS dl_clicks (
    id          TEXT PRIMARY KEY,
    send_id     TEXT NOT NULL,
    target_url  TEXT NOT NULL,
    ts          INTEGER DEFAULT (unixepoch()),
    ip          TEXT DEFAULT '',
    ua          TEXT DEFAULT '',
    FOREIGN KEY (send_id) REFERENCES dl_sends(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_dl_clicks_send ON dl_clicks(send_id);

  -- Founder approval queue (batches of 5-10 prospects)
  -- channel switches from 'email' (D+0) to 'whatsapp' (D+2 onward)
  CREATE TABLE IF NOT EXISTS dl_approvals (
    id                    TEXT PRIMARY KEY,
    batch_label           TEXT DEFAULT '',
    items_json            TEXT NOT NULL DEFAULT '[]',  -- array of {prospect_id, contact_id, draft_subject, draft_body, pdf_url}
    channel               TEXT DEFAULT 'email',         -- email | whatsapp
    notification_sent_at  INTEGER,
    notification_target   TEXT DEFAULT '',              -- email addr or whatsapp number
    status                TEXT DEFAULT 'pending',       -- pending | approved | skipped | edited | expired
    decision_json         TEXT DEFAULT '{}',            -- per-item APPROVE/SKIP/EDIT decisions
    decision_at           INTEGER,
    magic_token           TEXT NOT NULL,
    magic_token_expires   INTEGER NOT NULL,
    created_at            INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_dl_approvals_status ON dl_approvals(status);
  CREATE INDEX IF NOT EXISTS idx_dl_approvals_token  ON dl_approvals(magic_token);

  -- Formal proposal sent to a hot prospect (single-page, signature-ready)
  CREATE TABLE IF NOT EXISTS dl_proposals (
    id                  TEXT PRIMARY KEY,
    prospect_id         TEXT NOT NULL,
    contact_id          TEXT NOT NULL,
    total_gbp           REAL NOT NULL DEFAULT 12500,
    scope_json          TEXT DEFAULT '[]',
    pdf_path            TEXT DEFAULT '',
    sign_token          TEXT NOT NULL,
    sign_token_expires  INTEGER NOT NULL,
    generated_at        INTEGER DEFAULT (unixepoch()),
    sent_at             INTEGER,
    signed_at           INTEGER,
    FOREIGN KEY (prospect_id) REFERENCES dl_prospects(id) ON DELETE CASCADE,
    FOREIGN KEY (contact_id)  REFERENCES dl_contacts(id)  ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_dl_proposals_prospect ON dl_proposals(prospect_id);
  CREATE INDEX IF NOT EXISTS idx_dl_proposals_token    ON dl_proposals(sign_token);

  -- Async e-signature record (UK-law-compliant: signature text + IP + UA + timestamp + countersigned PDF)
  CREATE TABLE IF NOT EXISTS dl_signatures (
    id                       TEXT PRIMARY KEY,
    proposal_id              TEXT NOT NULL,
    signer_name              TEXT NOT NULL,
    signer_email             TEXT NOT NULL,
    signature_text           TEXT NOT NULL,
    signature_ip             TEXT DEFAULT '',
    signature_ua             TEXT DEFAULT '',
    signed_at                INTEGER DEFAULT (unixepoch()),
    countersigned_pdf_path   TEXT DEFAULT '',
    FOREIGN KEY (proposal_id) REFERENCES dl_proposals(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_dl_sigs_proposal ON dl_signatures(proposal_id);

  -- Stripe payment events (op end-state: at least one paid_at row by D+30)
  CREATE TABLE IF NOT EXISTS dl_payments (
    id                       TEXT PRIMARY KEY,
    proposal_id              TEXT NOT NULL,
    amount_gbp               REAL NOT NULL,
    stripe_session_id        TEXT DEFAULT '',
    stripe_payment_intent    TEXT DEFAULT '',
    status                   TEXT DEFAULT 'pending',  -- pending | paid | failed | refunded
    paid_at                  INTEGER,
    created_at               INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (proposal_id) REFERENCES dl_proposals(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_dl_payments_proposal ON dl_payments(proposal_id);

  -- Visibility score history per org per citation run
  -- score = (citations_earned / citations_available) weighted by engine
  CREATE TABLE IF NOT EXISTS dl_visibility_scores (
    id                   TEXT PRIMARY KEY,
    client_id            TEXT NOT NULL DEFAULT '',
    organization_id      TEXT NOT NULL,
    run_id               TEXT NOT NULL,
    vertical_id          TEXT NOT NULL,
    score                REAL NOT NULL,
    citations_earned     INTEGER DEFAULT 0,
    citations_available  INTEGER DEFAULT 0,
    per_engine_json      TEXT DEFAULT '{}',
    calculated_at        INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (organization_id) REFERENCES dl_organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (vertical_id)     REFERENCES verticals(id)        ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_dl_vis_org_run   ON dl_visibility_scores(organization_id, run_id);
  CREATE INDEX IF NOT EXISTS idx_dl_vis_vertical  ON dl_visibility_scores(vertical_id, calculated_at);
`)

// ─────────────────────────────────────────────────────────────────────────────
// Citation Tracker — extend with vertical scoping (OPORD 001 §V2)
// ─────────────────────────────────────────────────────────────────────────────
const trackedBrandCols = (db.prepare('PRAGMA table_info(tracked_brands)').all() as any[]).map(c => c.name)
if (!trackedBrandCols.includes('vertical_id')) {
  db.exec(`ALTER TABLE tracked_brands ADD COLUMN vertical_id TEXT DEFAULT ''`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tracked_brands_vertical ON tracked_brands(vertical_id)`)
}

const trackedQueryCols = (db.prepare('PRAGMA table_info(tracked_queries)').all() as any[]).map(c => c.name)
if (!trackedQueryCols.includes('vertical_id')) {
  db.exec(`ALTER TABLE tracked_queries ADD COLUMN vertical_id TEXT DEFAULT ''`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tracked_queries_vertical ON tracked_queries(vertical_id)`)
}
if (!trackedQueryCols.includes('archetype')) {
  // 'informational' | 'commercial' | 'comparative'
  db.exec(`ALTER TABLE tracked_queries ADD COLUMN archetype TEXT DEFAULT ''`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovery Layer migrations — back-fill client_id on tables that pre-date
// the multi-tenant refactor. CREATE TABLE IF NOT EXISTS doesn't add columns
// to existing tables, so we have to ALTER them in.
// ─────────────────────────────────────────────────────────────────────────────
const ensureCol = (table: string, col: string, ddl: string) => {
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map(c => c.name)
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`)
}
ensureCol('verticals',            'client_id', `TEXT NOT NULL DEFAULT ''`)
ensureCol('dl_organizations',     'client_id', `TEXT NOT NULL DEFAULT ''`)
ensureCol('dl_prospects',         'client_id', `TEXT NOT NULL DEFAULT ''`)
ensureCol('dl_visibility_scores', 'client_id', `TEXT NOT NULL DEFAULT ''`)

// Deferred indexes — must run AFTER the ensureCol back-fill so the columns exist
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_verticals_client    ON verticals(client_id);
  CREATE INDEX IF NOT EXISTS idx_dl_orgs_client      ON dl_organizations(client_id);
  CREATE INDEX IF NOT EXISTS idx_dl_prospects_client ON dl_prospects(client_id);
`)

// Now safe to clean up legacy global rows (client_id = '') from before refactor
db.exec(`
  DELETE FROM dl_visibility_scores WHERE client_id = '' OR client_id IS NULL;
  DELETE FROM dl_prospects         WHERE client_id = '' OR client_id IS NULL;
  DELETE FROM dl_organizations     WHERE client_id = '' OR client_id IS NULL;
  DELETE FROM verticals            WHERE client_id = '' OR client_id IS NULL;
`)

// ─────────────────────────────────────────────────────────────────────────────
// Per-client Discovery + LLM provider config (added to clients table)
// ─────────────────────────────────────────────────────────────────────────────
const clientCols = (db.prepare('PRAGMA table_info(clients)').all() as any[]).map(c => c.name)

if (!clientCols.includes('discovery_enabled')) {
  db.exec(`ALTER TABLE clients ADD COLUMN discovery_enabled INTEGER DEFAULT 0`)
}
if (!clientCols.includes('discovery_sender_email')) {
  db.exec(`ALTER TABLE clients ADD COLUMN discovery_sender_email TEXT DEFAULT ''`)
}
if (!clientCols.includes('discovery_sender_name')) {
  db.exec(`ALTER TABLE clients ADD COLUMN discovery_sender_name TEXT DEFAULT ''`)
}
if (!clientCols.includes('discovery_whatsapp_number')) {
  db.exec(`ALTER TABLE clients ADD COLUMN discovery_whatsapp_number TEXT DEFAULT ''`)
}
if (!clientCols.includes('daily_citation_budget_gbp')) {
  db.exec(`ALTER TABLE clients ADD COLUMN daily_citation_budget_gbp REAL DEFAULT 1.0`)
}
// LLM provider preferences for content generation (NOT for citation probes —
// those must hit the real engines users search on). Empty = use env defaults.
if (!clientCols.includes('llm_content_provider')) {
  // 'anthropic' | 'deepseek' | 'qwen' | 'ollama' | 'openai'
  db.exec(`ALTER TABLE clients ADD COLUMN llm_content_provider TEXT DEFAULT 'anthropic'`)
}
if (!clientCols.includes('llm_content_model')) {
  db.exec(`ALTER TABLE clients ADD COLUMN llm_content_model TEXT DEFAULT ''`)
}
if (!clientCols.includes('llm_content_api_key')) {
  db.exec(`ALTER TABLE clients ADD COLUMN llm_content_api_key TEXT DEFAULT ''`)
}
if (!clientCols.includes('llm_content_base_url')) {
  // Used for ollama (http://localhost:11434/v1) or self-hosted endpoints
  db.exec(`ALTER TABLE clients ADD COLUMN llm_content_base_url TEXT DEFAULT ''`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Client identity + mission + module activation
// (Add Client wizard refactor — replaces content-tool assumptions with
// PRRM-aware fields. Old fields kept for backward compat.)
// ─────────────────────────────────────────────────────────────────────────────
if (!clientCols.includes('primary_domain')) {
  db.exec(`ALTER TABLE clients ADD COLUMN primary_domain TEXT DEFAULT ''`)
}
if (!clientCols.includes('logo_url')) {
  db.exec(`ALTER TABLE clients ADD COLUMN logo_url TEXT DEFAULT ''`)
}
if (!clientCols.includes('geography')) {
  // 'UK' | 'US' | 'EU' | 'GLOBAL' — drives compliance + outbound timing defaults
  db.exec(`ALTER TABLE clients ADD COLUMN geography TEXT DEFAULT 'UK'`)
}
if (!clientCols.includes('time_zone')) {
  db.exec(`ALTER TABLE clients ADD COLUMN time_zone TEXT DEFAULT 'Europe/London'`)
}
if (!clientCols.includes('mission')) {
  // One-sentence: what is this business trying to achieve?
  db.exec(`ALTER TABLE clients ADD COLUMN mission TEXT DEFAULT ''`)
}
if (!clientCols.includes('icp')) {
  // Ideal customer profile (replaces target_audience)
  db.exec(`ALTER TABLE clients ADD COLUMN icp TEXT DEFAULT ''`)
}
if (!clientCols.includes('offerings')) {
  // What the business sells/does (replaces expertise_areas free-text)
  db.exec(`ALTER TABLE clients ADD COLUMN offerings TEXT DEFAULT ''`)
}
if (!clientCols.includes('brand_voice')) {
  // Long-form voice description (replaces tone_of_voice picker)
  db.exec(`ALTER TABLE clients ADD COLUMN brand_voice TEXT DEFAULT ''`)
}
if (!clientCols.includes('never_say')) {
  db.exec(`ALTER TABLE clients ADD COLUMN never_say TEXT DEFAULT ''`)
}
if (!clientCols.includes('always_say')) {
  db.exec(`ALTER TABLE clients ADD COLUMN always_say TEXT DEFAULT ''`)
}
if (!clientCols.includes('modules_enabled')) {
  // JSON: { produce, reach, respond, measure, affiliates, shop }
  // Default = produce+reach+respond+measure ON, affiliates+shop OFF
  db.exec(`ALTER TABLE clients ADD COLUMN modules_enabled TEXT DEFAULT '{"produce":1,"reach":1,"respond":1,"measure":1,"affiliates":0,"shop":0}'`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Shop generalisation — gift_card_* tables become shop_* with product_type.
// Supports: gift_card | service | subscription | product
// ─────────────────────────────────────────────────────────────────────────────
const tableNames = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(t => t.name)

if (tableNames.includes('gift_card_skus') && !tableNames.includes('shop_skus')) {
  db.exec(`ALTER TABLE gift_card_skus RENAME TO shop_skus`)
}
if (tableNames.includes('gift_card_purchases') && !tableNames.includes('shop_purchases')) {
  db.exec(`ALTER TABLE gift_card_purchases RENAME TO shop_purchases`)
}
// gift_card_redemptions stays as-is — only applies to gift_card type.
// We update its FK target manually to shop_purchases on rename (SQLite doesn't auto-update).
// (FK constraints in SQLite are loose anyway — the index works on the new table name.)

// Re-create the renamed tables IF NOT EXISTS for fresh installs
db.exec(`
  CREATE TABLE IF NOT EXISTS shop_skus (
    id                      TEXT PRIMARY KEY,
    client_id               TEXT NOT NULL,
    product_type            TEXT NOT NULL DEFAULT 'gift_card',
    denomination            REAL,                      -- gift_card: face value GBP. Other types: NULL (use price below)
    label                   TEXT DEFAULT '',
    description             TEXT DEFAULT '',
    price_gbp               REAL,                      -- non-gift-card price. NULL for gift_card (uses denomination)
    expiry_months           INTEGER DEFAULT 24,        -- gift_card only
    personalization_enabled INTEGER DEFAULT 1,         -- gift_card only
    max_stock               INTEGER,                   -- NULL = unlimited
    active                  INTEGER DEFAULT 1,
    stripe_price_id         TEXT DEFAULT '',
    -- Service-specific
    signature_required      INTEGER DEFAULT 0,         -- async sign flow before fulfilment
    delivery_terms          TEXT DEFAULT '',           -- short description shown at checkout
    -- Subscription-specific
    billing_interval        TEXT DEFAULT '',           -- 'month' | 'year' | 'week' (empty for non-subs)
    trial_days              INTEGER DEFAULT 0,
    created_at              INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS shop_purchases (
    id                       TEXT PRIMARY KEY,
    sku_id                   TEXT NOT NULL,
    client_id                TEXT NOT NULL,
    product_type             TEXT NOT NULL DEFAULT 'gift_card',
    buyer_email              TEXT NOT NULL,
    buyer_name               TEXT DEFAULT '',
    recipient_name           TEXT DEFAULT '',
    gift_message             TEXT DEFAULT '',
    redemption_code          TEXT,                      -- gift_card only (UNIQUE enforced via index below)
    amount                   REAL NOT NULL,
    expiry_date              INTEGER,                   -- gift_card only
    status                   TEXT NOT NULL DEFAULT 'active',
    stripe_session_id        TEXT DEFAULT '',
    stripe_payment_intent    TEXT DEFAULT '',
    stripe_subscription_id   TEXT DEFAULT '',           -- subscription only
    -- Service signature flow
    signature_token          TEXT DEFAULT '',
    signed_at                INTEGER,
    signed_pdf_url           TEXT DEFAULT '',
    purchase_date            INTEGER DEFAULT (unixepoch()),
    fulfilled_at             INTEGER,                   -- when admin marked as delivered
    created_at               INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (sku_id)    REFERENCES shop_skus(id) ON DELETE RESTRICT,
    FOREIGN KEY (client_id) REFERENCES clients(id)   ON DELETE CASCADE
  );
`)

// Back-fill new columns on previously-existing shop_skus / shop_purchases
const skuCols = (db.prepare('PRAGMA table_info(shop_skus)').all() as any[]).map(c => c.name)
if (!skuCols.includes('product_type')) {
  db.exec(`ALTER TABLE shop_skus ADD COLUMN product_type TEXT NOT NULL DEFAULT 'gift_card'`)
}
if (!skuCols.includes('description')) {
  db.exec(`ALTER TABLE shop_skus ADD COLUMN description TEXT DEFAULT ''`)
}
if (!skuCols.includes('price_gbp')) {
  db.exec(`ALTER TABLE shop_skus ADD COLUMN price_gbp REAL`)
}
if (!skuCols.includes('signature_required')) {
  db.exec(`ALTER TABLE shop_skus ADD COLUMN signature_required INTEGER DEFAULT 0`)
}
if (!skuCols.includes('delivery_terms')) {
  db.exec(`ALTER TABLE shop_skus ADD COLUMN delivery_terms TEXT DEFAULT ''`)
}
if (!skuCols.includes('billing_interval')) {
  db.exec(`ALTER TABLE shop_skus ADD COLUMN billing_interval TEXT DEFAULT ''`)
}
if (!skuCols.includes('trial_days')) {
  db.exec(`ALTER TABLE shop_skus ADD COLUMN trial_days INTEGER DEFAULT 0`)
}

const purchaseCols = (db.prepare('PRAGMA table_info(shop_purchases)').all() as any[]).map(c => c.name)
if (!purchaseCols.includes('product_type')) {
  db.exec(`ALTER TABLE shop_purchases ADD COLUMN product_type TEXT NOT NULL DEFAULT 'gift_card'`)
}
if (!purchaseCols.includes('stripe_subscription_id')) {
  db.exec(`ALTER TABLE shop_purchases ADD COLUMN stripe_subscription_id TEXT DEFAULT ''`)
}
if (!purchaseCols.includes('signature_token')) {
  db.exec(`ALTER TABLE shop_purchases ADD COLUMN signature_token TEXT DEFAULT ''`)
}
if (!purchaseCols.includes('signed_at')) {
  db.exec(`ALTER TABLE shop_purchases ADD COLUMN signed_at INTEGER`)
}
if (!purchaseCols.includes('signed_pdf_url')) {
  db.exec(`ALTER TABLE shop_purchases ADD COLUMN signed_pdf_url TEXT DEFAULT ''`)
}
if (!purchaseCols.includes('fulfilled_at')) {
  db.exec(`ALTER TABLE shop_purchases ADD COLUMN fulfilled_at INTEGER`)
}

// Indexes — re-declare on shop_* names, idempotent
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_shop_skus_client      ON shop_skus(client_id, product_type, active);
  CREATE INDEX IF NOT EXISTS idx_shop_purchases_client ON shop_purchases(client_id, product_type, status);
  CREATE INDEX IF NOT EXISTS idx_shop_purchases_code   ON shop_purchases(redemption_code);
  CREATE INDEX IF NOT EXISTS idx_shop_purchases_stripe ON shop_purchases(stripe_session_id);
`)

// One-time migration tracker — runs each block once across server restarts
db.exec(`CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, ran_at INTEGER DEFAULT (unixepoch()))`)

// Back-fill api_token column on syndication_sources for installs predating Apify support
{
  const cols = (db.prepare(`PRAGMA table_info(syndication_sources)`).all() as any[]).map(c => c.name)
  if (cols.length > 0 && !cols.includes('api_token')) {
    db.exec(`ALTER TABLE syndication_sources ADD COLUMN api_token TEXT DEFAULT ''`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNDICATION MODULE — RSS-source → X(Twitter)-destination auto-poster
// Generalised: any RSS source (IG-via-bridge / Substack / WordPress / YouTube)
// → any destination (X today; LinkedIn / Threads / Bluesky later).
// Posts flow without approval queue per directive — source is already public.
// ─────────────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS syndication_sources (
    id          TEXT PRIMARY KEY,
    client_id   TEXT NOT NULL,
    label       TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'rss',  -- 'rss' | 'apify_instagram' | 'ig_graph' | 'manual'
    url         TEXT NOT NULL DEFAULT '',     -- RSS feed URL (rss); IG handle (apify_instagram)
    handle      TEXT DEFAULT '',              -- e.g. '@yourbrand' for display only
    api_token   TEXT DEFAULT '',              -- per-source auth (Apify API token, etc.)
    active      INTEGER DEFAULT 1,
    last_polled INTEGER,
    last_item_id TEXT DEFAULT '',             -- de-dup anchor
    created_at  INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_syn_sources_client ON syndication_sources(client_id, active);

  CREATE TABLE IF NOT EXISTS syndication_destinations (
    id            TEXT PRIMARY KEY,
    client_id     TEXT NOT NULL,
    label         TEXT NOT NULL,
    platform      TEXT NOT NULL DEFAULT 'x',   -- 'x' | 'linkedin' | 'threads' | 'bluesky'
    handle        TEXT DEFAULT '',             -- e.g. '@yourbrand'
    -- X (Twitter) OAuth 1.0a credentials
    api_key       TEXT DEFAULT '',
    api_secret    TEXT DEFAULT '',
    access_token  TEXT DEFAULT '',
    access_secret TEXT DEFAULT '',
    active        INTEGER DEFAULT 1,
    created_at    INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_syn_dests_client ON syndication_destinations(client_id, active);

  CREATE TABLE IF NOT EXISTS syndication_routes (
    id              TEXT PRIMARY KEY,
    client_id       TEXT NOT NULL,
    source_id       TEXT NOT NULL,
    destination_id  TEXT NOT NULL,
    rewrite_prompt  TEXT DEFAULT '',    -- per-route LLM prompt override; blank = use default
    active          INTEGER DEFAULT 1,
    posts_today     INTEGER DEFAULT 0,
    daily_cap       INTEGER DEFAULT 10,
    created_at      INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (client_id)      REFERENCES clients(id)                 ON DELETE CASCADE,
    FOREIGN KEY (source_id)      REFERENCES syndication_sources(id)     ON DELETE CASCADE,
    FOREIGN KEY (destination_id) REFERENCES syndication_destinations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_syn_routes_client ON syndication_routes(client_id, active);

  CREATE TABLE IF NOT EXISTS syndications (
    id              TEXT PRIMARY KEY,
    client_id       TEXT NOT NULL,
    route_id        TEXT NOT NULL,
    source_id       TEXT NOT NULL,
    destination_id  TEXT NOT NULL,
    source_item_id  TEXT NOT NULL,         -- the source post id (RSS guid / IG shortcode)
    source_url      TEXT DEFAULT '',
    source_text     TEXT DEFAULT '',
    rewritten_text  TEXT NOT NULL,
    posted_id       TEXT DEFAULT '',       -- X post id after successful send
    posted_url      TEXT DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'pending', -- pending | posted | failed | skipped
    error           TEXT DEFAULT '',
    posted_at       INTEGER,
    created_at      INTEGER DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_syndications_route  ON syndications(route_id, posted_at DESC);
  -- NON-unique on purpose: a failed item must be re-insertable to retry, and
  -- pool items re-promote after cooldown. (A UNIQUE index here crash-looped the
  -- service once dedupe-retry produced duplicate (route_id, source_item_id) rows.)
  CREATE INDEX IF NOT EXISTS idx_syndications_item ON syndications(route_id, source_item_id, posted_at DESC);
`)

// ─────────────────────────────────────────────────────────────────────────────
// SYNDICATION POOL — evergreen content library for intelligent rotation
// ─────────────────────────────────────────────────────────────────────────────
// The pool stores every blog post / βWave draft as a candidate for future tweets.
// The LLM picker selects the most seasonally-appropriate item at post time rather
// than blindly taking the latest RSS item. Items can be re-promoted after the
// cooldown window (default 60 days) so a rich blog archive stays active.
//
// Migration note: we drop the UNIQUE dedupe index on syndications so re-promoted
// pool items can produce a second syndications row after the cooldown.
db.exec(`
  CREATE TABLE IF NOT EXISTS syndication_pool (
    id              TEXT PRIMARY KEY,
    client_id       TEXT NOT NULL,
    source_type     TEXT NOT NULL DEFAULT 'rss',  -- 'rss' | 'betawave'
    source_item_id  TEXT NOT NULL,                -- RSS guid or content.id
    url             TEXT DEFAULT '',
    title           TEXT NOT NULL DEFAULT '',
    body            TEXT DEFAULT '',
    pub_date        INTEGER,
    last_tweeted_at INTEGER,
    tweet_count     INTEGER DEFAULT 0,
    created_at      INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    UNIQUE(client_id, source_item_id)
  );
  CREATE INDEX IF NOT EXISTS idx_syn_pool_client ON syndication_pool(client_id, last_tweeted_at);
`)

// Drop the unique constraint on syndications so pool items can be re-promoted
// after the cooldown window without violating the index.
{
  const indexes = (db.prepare(`PRAGMA index_list(syndications)`).all() as any[]).map(r => r.name)
  if (indexes.includes('idx_syndications_dedupe')) {
    db.exec(`DROP INDEX idx_syndications_dedupe`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_syndications_item ON syndications(route_id, source_item_id, posted_at DESC)`)
  }
}

// ─── Syndication destination throttle ────────────────────────────────────────
// Add min_minutes_between_posts so routes feeding the same X handle queue
// instead of burst-posting. Default 60 = ~hourly cadence, sensible for X.
{
  const cols = (db.prepare(`PRAGMA table_info(syndication_destinations)`).all() as any[]).map(c => c.name)
  if (!cols.includes('min_minutes_between_posts')) {
    db.exec(`ALTER TABLE syndication_destinations ADD COLUMN min_minutes_between_posts INTEGER DEFAULT 60`)
    // Backfill existing rows (SQLite ALTER TABLE leaves them NULL unless DEFAULT is constant — be explicit)
    db.exec(`UPDATE syndication_destinations SET min_minutes_between_posts = 60 WHERE min_minutes_between_posts IS NULL`)
  }
}

// Pre-refactor clients got the new-client default when
// ALTER TABLE ADD COLUMN ran, which has shop:0 and affiliates:0. They should
// have all modules on (canonical demo behaviour). Runs once.
const did_v2_backfill = db.prepare(`SELECT 1 FROM _migrations WHERE id = ?`).get('modules_enabled_v2_backfill_2026_05_09')
if (!did_v2_backfill) {
  db.exec(`
    UPDATE clients
    SET modules_enabled = '{"produce":1,"reach":1,"respond":1,"measure":1,"affiliates":1,"shop":1}'
    WHERE modules_enabled IS NULL
       OR modules_enabled = ''
       OR modules_enabled = '{}'
       OR modules_enabled = '{"produce":1,"reach":1,"respond":1,"measure":1,"affiliates":0,"shop":0}'
  `)
  db.prepare(`INSERT INTO _migrations (id) VALUES (?)`).run('modules_enabled_v2_backfill_2026_05_09')
}

// ─────────────────────────────────────────────────────────────────────────────
// SITE BUILDER MODULE — Jamstack static site generation + built-in hosting
// ─────────────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT 'Website',
    slug TEXT NOT NULL DEFAULT '',
    custom_domain TEXT DEFAULT '',
    template_id TEXT,
    status TEXT DEFAULT 'draft',
    build_output_path TEXT DEFAULT '',
    last_built_at INTEGER,
    last_deployed_at INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS site_templates (
    id TEXT PRIMARY KEY,
    client_id TEXT,
    name TEXT NOT NULL,
    ejs_content TEXT NOT NULL,
    is_default INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS site_deployments (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    connector_id TEXT,
    type TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    log TEXT DEFAULT '',
    url TEXT DEFAULT '',
    commit_message TEXT DEFAULT '',
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sites_client ON sites(client_id);
  CREATE INDEX IF NOT EXISTS idx_sites_slug ON sites(slug);
  CREATE INDEX IF NOT EXISTS idx_site_deployments_site ON site_deployments(site_id, created_at DESC);
`)

// ─── Sites: Astro + Netlify columns (migration-safe) ─────────────────────────
// Adds stack/domain/Netlify credentials to the existing sites table so the
// same row supports legacy EJS builds AND Astro+Netlify deploys.
{
  const cols = (db.prepare(`PRAGMA table_info(sites)`).all() as any[]).map(c => c.name)
  const add = (col: string, sql: string) => {
    if (!cols.includes(col)) db.exec(`ALTER TABLE sites ADD COLUMN ${sql}`)
  }
  add('stack',             `stack TEXT NOT NULL DEFAULT 'legacy_ejs'`)        // 'legacy_ejs' | 'astro_netlify'
  add('domain',            `domain TEXT DEFAULT ''`)                          // canonical https URL
  add('site_dir',          `site_dir TEXT DEFAULT ''`)                        // local path to materialised astro-sites/{slug}
  add('netlify_site_id',   `netlify_site_id TEXT DEFAULT ''`)
  add('netlify_site_name', `netlify_site_name TEXT DEFAULT ''`)               // e.g. my-site (subdomain on netlify.app)
  add('git_remote',        `git_remote TEXT DEFAULT ''`)                      // optional — e.g. git@github.com:user/my-site.git
  add('accent_colour',     `accent_colour TEXT DEFAULT '#d97706'`)
  add('tagline',           `tagline TEXT DEFAULT ''`)
  add('last_deploy_url',   `last_deploy_url TEXT DEFAULT ''`)
  add('pseo_collection',   `pseo_collection TEXT DEFAULT 'posts'`)              // which content collection pSEO pages get written into (e.g. 'news' for a news-style site)
}

// Drop the UNIQUE constraint on client_id so one client can own multiple sites
// (e.g. main brand site + a separate content property). The original
// constraint was a UNIQUE INDEX created implicitly by the column definition.
{
  const indexes = (db.prepare(`PRAGMA index_list(sites)`).all() as any[])
  const uniqueClient = indexes.find((i: any) => i.unique === 1 && i.name.includes('autoindex'))
  // SQLite can't drop an implicit UNIQUE — we'd need a table rebuild. For now
  // we live with the implicit UNIQUE and instead create additional sites via a
  // dedicated `extra_sites` row pattern. Detected here so we know the situation.
  if (uniqueClient) {
    // No-op — handled at application layer by routing the content domain to a dedicated
    // standalone client row rather than fighting SQLite's implicit UNIQUE.
  }
}

// ─── Snapshot Generator (AI Visibility Snapshot) ─────────────────────
// One-shot generator per prospect — not per-brand-weekly like Citation Tracker.
// snapshots: one row per generated PDF. snapshot_engine_results: one row per
// (query × engine) pair within a snapshot. Denormalised vs Citation Tracker
// because each prospect is independent — no cross-run aggregation needed.
db.exec(`
  CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY,
    practice_name TEXT NOT NULL,
    practice_slug TEXT NOT NULL,
    city TEXT DEFAULT '',
    region TEXT DEFAULT '',
    country_code TEXT DEFAULT '',
    market TEXT NOT NULL,
    website_url TEXT DEFAULT '',
    gbp_url TEXT DEFAULT '',
    target_queries_json TEXT DEFAULT '[]',
    depth TEXT DEFAULT 'outreach',
    status TEXT DEFAULT 'pending',
    total_cost_gbp REAL DEFAULT 0,
    pdf_path TEXT DEFAULT '',
    html_path TEXT DEFAULT '',
    top_competitors_json TEXT DEFAULT '[]',
    citation_count INTEGER DEFAULT 0,
    citation_total INTEGER DEFAULT 0,
    error TEXT DEFAULT '',
    created_at INTEGER DEFAULT (unixepoch()),
    completed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS snapshot_engine_results (
    id TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL,
    query TEXT NOT NULL,
    engine TEXT NOT NULL,
    raw_response TEXT DEFAULT '',
    excerpt TEXT DEFAULT '',
    brand_cited INTEGER DEFAULT 0,
    competitors_json TEXT DEFAULT '[]',
    cost_gbp REAL DEFAULT 0,
    latency_ms INTEGER DEFAULT 0,
    http_status INTEGER DEFAULT 0,
    error TEXT DEFAULT '',
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_snapshots_created ON snapshots(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_snapshots_market ON snapshots(market, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_snapshot_engine_results_snap ON snapshot_engine_results(snapshot_id);
`)

// ─── Content: gap-closer provenance (migration-safe) ─────────────────────────
// Tags drafts auto-generated by services/citation-gap-content.ts so the
// Content Library can show where a piece came from, and so re-runs don't
// draft the same gap twice.
{
  const cols = (db.prepare(`PRAGMA table_info(content)`).all() as any[]).map(c => c.name)
  const add = (col: string, sql: string) => {
    if (!cols.includes(col)) db.exec(`ALTER TABLE content ADD COLUMN ${sql}`)
  }
  add('source',     `source TEXT DEFAULT ''`)      // '' | 'citation-gap'
  add('source_ref', `source_ref TEXT DEFAULT ''`)   // e.g. '<citation_run_id>:<query_id>'
}

export default db
