# βWave — Own your marketing engine. Don't rent it.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)
[![SQLite](https://img.shields.io/badge/Database-SQLite-lightgrey)](https://sqlite.org)

**βWave** is the marketing engine a small business runs *instead of* paying an agency or stacking up a dozen SaaS subscriptions. It writes and publishes your content, finds and messages the right prospects one at a time (never spam), handles the replies, and tracks whether AI assistants actually recommend you — all on your own server, with your own API keys.

Install it yourself and it costs nothing per month. Bring your own keys, own your data, run it forever. Or have someone run it for you.

> **βWave β Free** — own your stack, own your data, own your growth. Everything that reaches a real person is human-gated: βWave does the grunt work, you keep the judgement.

---

## What it does

| Module | What you get |
|--------|-------------|
| **Content** | AI-generated social posts, blog drafts, and platform-native copy (X, LinkedIn, Instagram, TikTok, Facebook) with your brand voice |
| **Syndicate** | Schedule and publish to X (Twitter), Facebook, Instagram, LinkedIn, Telegram, Reddit, and Medium from one queue |
| **Respond** | Human-gated X engagement — review AI-suggested replies and reposts before anything goes live |
| **Citation Tracker** | Monitor how often your brand appears in AI assistant answers (ChatGPT, Perplexity, Gemini, Claude) |
| **Discovery** | Prospect local businesses, score leads, generate outreach copy |
| **Snapshots** | Pixel-perfect PDF performance reports for clients (Puppeteer/EJS) |
| **Settings** | BYO API keys stored encrypted at rest — override any key without restarting |

---

## Why self-host?

- **No subscription fees** — your server, your keys, your costs (~£5/mo VPS + your LLM usage)
- **Privacy** — your client data never touches a third-party SaaS platform
- **Local inference** — point it at Ollama, LM Studio, GLM-5, or any OpenAI-compatible endpoint
- **White-label** — rebrand the entire UI via `.env` for your own agency or clients
- **Multi-tenant** — manage multiple clients with scoped operator logins

---

## Quick start

```bash
git clone https://github.com/johnleeblackwell/betawave.git
cd betawave
npm install
cp .env.example .env
# Edit .env — add at least one LLM key (and APP_PASSWORD if you want a login screen)
npm start
```

Open `http://localhost:3001`.

Prefer Docker? See **[INSTALL.md](INSTALL.md)** for the container path, plus reverse proxy config (Caddy/nginx), custom LLM providers, and the update workflow.

---

## Documentation

Per-module guides live in **[docs/](docs/README.md)**: [Syndicate](docs/syndicate.md) (incl. Facebook/Instagram app setup) · [Discovery](docs/discovery.md) · [Site & pSEO](docs/sites.md) · [Citations](docs/citations.md) · [Respond](docs/respond.md) · [Settings & roles](docs/settings.md)

---

## LLM support

βWave works with any OpenAI-compatible API:

| Provider | Key env var | Notes |
|----------|------------|-------|
| Anthropic (Claude) | `ANTHROPIC_API_KEY` | Default. Best quality. |
| OpenAI | `OPENAI_API_KEY` | GPT-4o + DALL·E images |
| Groq | `CUSTOM_LLM_BASE_URL` + key + model | Fast, free tier available |
| GLM-5 (Zhipu AI) | `CUSTOM_LLM_BASE_URL` + key + model | Privacy-friendly |
| LM Studio / Ollama | `CUSTOM_LLM_BASE_URL` | Fully local, no API cost |

Switch providers from the Settings UI — no restart required.

---

## Tech stack

- **Backend** — Node.js / Express / TypeScript (`tsx`)
- **Frontend** — React 19 / Vite / TypeScript
- **Database** — SQLite (via `libsql`) — single file, zero config, easy backup
- **PDF generation** — Puppeteer + EJS
- **Auth** — HMAC-signed cookies (owner) + scrypt user accounts (operators)

---

## Updating

```bash
cd betawave
./scripts/update.sh   # backs up DB → git pull → docker compose up --build
```

---

## Project status

βWave is young and moving fast. It runs in production every day — it's what the maintainer uses to run real businesses — but modules mature at different rates: Content, Syndicate, Snapshots and Citations are the most battle-tested; some platform integrations are newer. If something's rough, [open an issue](https://github.com/johnleeblackwell/betawave/issues) — you'll be talking to the person who wrote it. Stars and PRs are the fuel that keeps it open and free.

---

## Who builds βWave

βWave is built by John Blackwell, who has spent 20+ years in search — building websites in the late '90s, technical SEO through the 2000s, and now generative / AI search. The through-line is the same across every generation of the channel: helping businesses get found.

Self-hosting is **free forever** and always will be. Two commercial options exist for people who'd rather buy time than spend it:

- **Being cited by AI** — the Citation Tracker is the visible tip of a bigger discipline: engineering a brand into the answers ChatGPT, Perplexity, Claude and Google's AI give. If you want that done properly, that's **[geo.bz](https://geo.bz)**.
- **Done-for-you βWave** — don't want to self-host? **[betawave.co.uk](https://betawave.co.uk)** sets it up and runs it for you, your data staying yours throughout.

Neither is a catch. The software is complete on its own — the paid options are just the two things software can't do for you: expertise, and time.

---

## License

[GNU Affero General Public License v3.0](LICENSE) — free to self-host and modify. If you run a modified version as a network service, you must release your changes under the same licence.
