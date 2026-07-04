# Discovery — find prospects who are invisible in AI search

Discovery is a prospecting CRM with a twist: it ranks potential clients by how **invisible they are in AI assistant answers** (ChatGPT, Perplexity, Gemini, Claude). The businesses AI never mentions are the ones with the most to gain from your services — Discovery hands you that list, worst-first, with a built-in outreach pipeline.

> Discovery is an **owner/agency tool**. Client-scoped operator logins can't see it — it's your funnel for finding new business, not something clients need.

## The workflow

```
1. Vertical  →  2. Organisations  →  3. Contacts  →  4. Citation run  →  5. Ranked prospects  →  6. Outreach pipeline
```

### 1. Create a vertical
A vertical is a target market segment ("Cosmetic Dentists", "Law Firms"). Use **📦 Templates** for curated starter sets:
- **Owner-operated** — dentists, aesthetics clinics, local home improvement, law firms, vets (single-site businesses)
- **Multi-unit local services** — home improvement, trades, beauty chains (3+ locations)
- **Professional services** — legal, accountancy, healthcare, property

Seeding is idempotent — click it twice, nothing duplicates. Or add custom verticals with your own slug/name/description.

### 2. Import organisations
Open the vertical → **Organisations → Bulk import**. Paste CSV:
```
name,website,location_count,sub_segment,hq_location,hq_postcode
```
Build this list from LinkedIn Sales Navigator, a local directory, or any lead source.

### 3. Import contacts
**Contacts → Leadswift CSV import** (works with any CSV in this shape, not just Leadswift):
```
full_name,role,email,linkedin_url,organization_domain
```
Contacts auto-match to organisations **by domain** — import orgs first.

### 4. Run a citation scan
Run a citation run against the vertical's queries (see [Citations](citations.md)). Discovery scores every organisation's visibility across the AI engines.

### 5. Work the ranked prospect list
The **Prospects** tab fills with organisations ranked by visibility score — **lowest visibility = highest pain = top of your call list**. Each row shows the score bar, locations, and contact count.

### 6. Track your outreach
Every prospect has an inline status dropdown:

`scored → approved → diagnostic → sent → engaged → hot → proposal → won` (or `cold` / `skipped`)

Transitions auto-stamp timestamps (`sent_at`, `hot_at`, `won_at`) so you can measure your funnel later.

## Why this works as an outreach hook

Your opening message writes itself: *"I asked ChatGPT who the best [vertical] in [city] is — you weren't mentioned. Your competitors were. Here's the screenshot."* Discovery generates that evidence at scale.
