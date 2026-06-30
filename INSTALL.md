# Installing βWave

βWave runs on your own machine or server. Your data never leaves your infrastructure.

## Requirements

- [Docker](https://docs.docker.com/get-docker/) + Docker Compose (included with Docker Desktop)
- 1 GB RAM minimum, 2 GB recommended
- At least one LLM API key (or a local model — see below)

## Quick start

```bash
# 1. Clone the repo
git clone https://github.com/johnleeblackwell/betawave bwave
cd bwave

# 2. Configure
cp .env.example .env
nano .env          # set APP_PASSWORD and at least one LLM key

# 3. Create the data directory
mkdir -p data

# 4. Start
docker compose up -d

# 5. Open the app
open http://localhost:3001
```

Log in with a blank email and the `APP_PASSWORD` you set.

On first boot βWave seeds a **demo client** so you land in a working app, not an empty one — brand voice, a content library, and AI-citation tracking already set up. Explore it, then edit or delete it and add your own business. To start with a clean slate instead, set `SEED_DEMO=false` in `.env`.

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

All data lives in `./data/data.db` (SQLite). Back it up like any file:

```bash
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
