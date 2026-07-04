# βWave — Own your marketing engine. Don't rent it.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)
[![SQLite](https://img.shields.io/badge/Database-SQLite-lightgrey)](https://sqlite.org)

**βWave** is a self-hosted marketing engine for small businesses and creators — content generation, social syndication, AI citation tracking, and growth automation in one place.

Install it on your own server. Bring your own API keys. Pay nothing per month. Or have someone run it for you.

> **βWave β Free** — own your stack, own your data, own your growth.

---

## What it does

| Module | What you get |
|--------|-------------|
| **Content** | AI-generated social posts, blog drafts, and platform-native copy (X, LinkedIn, Instagram, TikTok, Facebook) with your brand voice |
| **Syndicate** | Schedule and publish to X (Twitter), Telegram, Reddit, and Medium from one queue |
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

## Quick start (Docker)

```bash
git clone https://github.com/johnleeblackwell/betawave.git
cd betawave
cp .env.example .env
# Edit .env — set APP_PASSWORD and at least one LLM key
docker compose up -d
```

Open `http://localhost:3001` — log in with a blank email and your `APP_PASSWORD`.

See **[INSTALL.md](INSTALL.md)** for full setup, reverse proxy config (Caddy/nginx), custom LLM providers, and the update workflow.

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

## Done-For-You

Don't want to run it yourself? **[betawave.co.uk](https://betawave.co.uk)** — fully managed, white-glove setup, your data stays yours.

---

## License

[GNU Affero General Public License v3.0](LICENSE) — free to self-host and modify. If you run a modified version as a network service, you must release your changes under the same licence.
