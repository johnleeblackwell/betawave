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

## LinkedIn outreach drafting

Any contact with a `linkedin_url` gets an **✉️ Message** button: it drafts a
personalised opener, you copy it, open their profile, and send it yourself.

βWave **never sends LinkedIn messages automatically**, and this isn't a
limitation we plan to remove. LinkedIn has no self-serve messaging API, so
"automated sending" would mean scripting the UI — which risks the one account
your outreach depends on. More to the point, a human clicking Send is the
product working as intended, not a step to optimise away.

For broad role-based campaigns, nothing gets filtered out of your target list.
Every captured lead is imported and drafted for; a `priority_score` (title
match, mutual connections, recently hired, recent activity, shared groups) just
**orders** the queue, so the limited number of sends you can realistically make
in a week go to the best-fit people first.

## Contact Magnetism

βWave is named for beta brain waves — the state of engaged, alert attention.
Contact Magnetism is that idea as a feature: a message should open with one
**true, specific** thing about the person, because you actually noticed them.

When real context has been captured for a contact, the drafting prompt grounds
the opener in exactly one genuine detail — something they actually posted, a
real mutual connection, their own words about their work — and is instructed to
**skip the personal opener entirely rather than fake familiarity** if the
context is thin. Nothing is ever invented.

Capturing that context needs the βWave capture extension, which reads what's
already on a LinkedIn page you're viewing (no automated clicking, navigation,
or crawling; no email lookup; no sending).

**The extension isn't a download.** Ask for it at
[betawave.co.uk](https://betawave.co.uk) and you'll be talked through it —
pointing a tool at LinkedIn deserves a real conversation first, not a zip file.

Without it, everything else in Discovery still works; drafts are simply written
from a contact's name, role, and company alone.
