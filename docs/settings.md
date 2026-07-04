# Settings, API keys, and user roles

## Bring-your-own API keys

βWave never resells inference — you plug in your own provider keys and pay providers directly.

**Settings (🔑, owner-only) → API keys.** Supported: Anthropic, OpenAI, Perplexity, Gemini, plus an Ollama base URL for local inference.

How keys are handled:
- Stored **encrypted at rest** (AES-256-GCM in the `app_secrets` table; the master key derives from `BWAVE_SECRET` and is never stored in the database)
- A key saved in the UI **overrides** the same key in `.env` immediately — no restart
- Clearing a UI key falls back to the `.env` value
- `.env` remains the bootstrap/default layer (see `INSTALL.md` for the full variable list)

Other instance-level keys (in `.env`): `NETLIFY_ACCESS_TOKEN` (managed sites), stock photo keys (Pexels/Pixabay/Unsplash — free tiers, used for auto-sourced post images), `SMTP_*` (email).

## Local inference

Point `OLLAMA_BASE_URL` at Ollama, LM Studio, or any OpenAI-compatible endpoint and per-client LLM settings can route generation locally — zero marginal cost, full privacy. Citation tracking still needs real engine keys (the whole point is asking the actual assistants).

## Roles

| Role | Login | Scope |
|---|---|---|
| **Owner** | password only (email blank) | Everything |
| **Operator** | email + password | ONE client's workspace, enforced server-side deny-by-default |

Operators are client-side users — a client's marketing manager working their own inbox and content. They cannot see: other clients, the clients list, Discovery/prospecting, pSEO generation or publishing, admin, affiliates, instance settings. This is enforced on every request in middleware, not just hidden in the UI — new endpoints are denied to operators unless explicitly allow-listed.

Create operators: owner-only `POST /api/admin/users` (UI: Settings → Users where available).

## White-labelling

`VITE_BRAND_NAME` and `VITE_BRAND_LOGO_URL` in `.env` rebrand the entire UI — run it under your own agency's name for your clients.
