# Installing βWave

βWave runs on your own machine or server. Your data never leaves your infrastructure.

## Requirements

- [Node.js 20+](https://nodejs.org)
- 1 GB RAM minimum, 2 GB recommended
- At least one LLM API key (or a local model — see below)

### System libraries for Snapshots (Linux, Node path)

The **Snapshots** module renders PDF reports with headless Chromium (via Puppeteer). On a fresh Linux server Chromium won't launch until its shared libraries are installed — you'll see `error while loading shared libraries: libnss3.so`. Install them once:

```bash
# Debian / Ubuntu
sudo apt-get update && sudo apt-get install -y --no-install-recommends \
  libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
  libpango-1.0-0 libcairo2 libasound2t64 libatspi2.0-0t64 fonts-liberation
```

(On Ubuntu 22.04 and earlier, drop the `t64` suffixes — e.g. `libasound2`, `libatk1.0-0`.) The **Docker** path bundles these already; you only need this for a bare-metal / VPS Node install. Everything except Snapshots works without them.

## Quick start (Node)

```bash
# 1. Clone the repo
git clone https://github.com/johnleeblackwell/betawave bwave
cd bwave

# 2. Install dependencies
npm install

# 3. Configure
cp .env.example .env
nano .env          # add at least one LLM key (and APP_PASSWORD if you want a login screen)

# 4. Start
npm start

# 5. Open the app
open http://localhost:3001
```

If you set `APP_PASSWORD`, log in with a blank email and that password. If you left it blank, the app opens straight in.

A fresh install is a genuine blank slate — no synthetic data, nothing to delete before you add your own business. If you specifically want a populated example client (e.g. to record a demo), set `SEED_DEMO=true` in `.env`.

---

## Quick start (Docker)

Prefer a container instead of installing Node yourself?

```bash
git clone https://github.com/johnleeblackwell/betawave bwave
cd bwave
cp .env.example .env
nano .env          # set APP_PASSWORD and at least one LLM key
mkdir -p data
docker compose up -d
open http://localhost:3001
```

Requires [Docker](https://docs.docker.com/get-docker/) + Docker Compose (included with Docker Desktop). The rest of this guide (updates, backups, reverse proxy) applies to both paths — the update script and white-labelling rebuild step just use Docker commands, swap in `npm start` if you're running Node directly.

---

## Choosing an LLM

βWave works with any of these — you only need one:

| Provider | Key variable | Notes |
|---|---|---|
| **Anthropic (Claude)** | `ANTHROPIC_API_KEY` | Default. Best quality. [Get key](https://console.anthropic.com) |
| **OpenAI** | `OPENAI_API_KEY` | GPT-4o-mini + DALL·E images |
| **GLM-5 (Zhipu AI)** | `CUSTOM_LLM_BASE_URL` + `CUSTOM_LLM_API_KEY` + `CUSTOM_LLM_MODEL` | Privacy-friendly, China-hosted. Base URL: `https://open.bigmodel.cn/api/paas/v4` |
| **Groq** | same custom fields | Very fast inference. Base URL: `https://api.groq.com/openai/v1` |
| **LM Studio / LocalAI** | same custom fields | Fully local, zero API cost. Base URL: `http://host.docker.internal:1234/v1` |
| **Any OpenAI-compatible API** | same custom fields | If it speaks the OpenAI chat format, it works |

For the custom provider, set these three in `.env`:
```
CUSTOM_LLM_BASE_URL=https://your-provider.com/v1
CUSTOM_LLM_API_KEY=your-key
CUSTOM_LLM_MODEL=model-name
```
Then select **Custom** as the provider in Settings → LLM.

---

## Updates

```bash
bash scripts/update.sh
```

This backs up your database, pulls the latest code, rebuilds the container, and restarts the app. Your data is preserved.

---

## Data

All data lives in a single SQLite file. Back it up like any file:

- **Node path** — `./data.db` in the project root (no `DATABASE_PATH` set)
- **Docker path** — `./data/data.db` (mounted volume; `DATABASE_PATH=/app/data/data.db` inside the container)

```bash
# Node path
cp data.db "data.db.$(date +%Y%m%d)"

# Docker path
cp data/data.db "data/data.db.$(date +%Y%m%d)"
```

---

## Reverse proxy (optional)

To serve βWave at a domain with HTTPS, put nginx or Caddy in front:

**Caddy** (simplest — auto-HTTPS):
```
your.domain.com {
  reverse_proxy localhost:3001
}
```

**nginx**:
```nginx
server {
    listen 80;
    server_name your.domain.com;
    location / { proxy_pass http://localhost:3001; }
}
```

---

## White-labelling

Change the app name, logo, and colours in `.env`:

```
VITE_BRAND_NAME=MyAgencyTool
VITE_BRAND_PRIMARY=#your-colour
```

Then rebuild: `docker compose up -d --build`
