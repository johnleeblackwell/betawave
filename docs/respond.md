# Respond — human-gated social engagement

Respond is βWave's engagement inbox: it **listens** for mentions of your connected accounts and helps you **reply** — with a hard rule baked into the code:

> **Nothing is ever sent without explicit human approval.** There is no auto-reply mode. AI drafts; a human clicks approve; only then does anything post.

## How it works (X today)

- **Ears** — βWave polls @mentions of each active X destination into a unified inbox (`social_comments`). Polling is deliberately infrequent by default (every 6 hours — X API reads cost money on usage-based billing; tune with `RESPOND_POLL_MINUTES`).
- **Drafts** — for each mention, the LLM suggests a reply in the client's brand voice.
- **Approval** — you (or a client-scoped operator) review in the Respond tab: approve, edit, or discard. Only `approved` replies ever send.
- **Mouth** — approved replies post back on the next scheduler tick, paced with a gap between sends so replies never burst unnaturally.

## Compliance by design

- No auto-reply — approval is enforced at the database level, not the UI
- Paced sending — max replies per tick, minimum gap between them
- Budget-aware polling — API failures and billing issues log and skip; they never crash the scheduler
- Operators can work the inbox for their own client only (see roles in [Settings](settings.md))

## Roadmap honesty

Reply **drafting** works for other platforms' comment shapes, but **sending** is only wired for X today. Instagram/Facebook/Google Business Profile reply-sending are planned — they need their own OAuth scopes and review processes.
