# Site — client websites, SEO content, and publishing

The Site tab manages a client's website and the pipeline that generates and publishes SEO content onto it. Two hosting models are supported, usable separately or together:

| Model | For |
|---|---|
| **Managed site** (Astro + Netlify) | You host a fast static site for the client. Recommended — full pipeline automation, ~free hosting |
| **WordPress connect** | The client already has WordPress; βWave publishes into it via the REST API |

## Sub-tabs

`⚙️ Settings · 🚀 Generate · 📍 Locations · 📝 Templates · 📤 Publish`

Generate/Locations/Templates/Publish are **owner-only** (they're the programmatic-SEO engine — an agency capability). Operators see Settings only.

## Setting up a managed site (one-time, ~5 minutes)

1. **Settings → Managed Site** → enter a Netlify subdomain name → **Create Netlify Site** (needs `NETLIFY_ACCESS_TOKEN` in your instance settings).
2. **Materialise Site** — copies the Astro site template and installs dependencies.
3. From then on: **Preview Build** (a real URL on a throwaway subdomain, production untouched) or **Publish Live** (updates the real domain, with a confirmation prompt).
4. Point the client's custom domain at Netlify when ready.

## Connecting WordPress instead

**Settings → WordPress Publishing** → site URL + username + **application password** (WP Admin → Users → Profile → Application Passwords) → **Test Connection**. Generated content can then publish straight to WP as drafts or published posts.

## The pSEO engine (Generate / Locations / Templates)

Programmatic SEO generates one targeted page per query/location combination:

1. **Templates** — a prompt template with variables (e.g. "best {service} in {location}")
2. **Locations** — the places to multiply across
3. **Generate** — runs the batch; every page lands as a **draft** in the content library, never auto-published

## Publishing (the safety model)

The **Publish** sub-tab lists every generated page with its status. Select pages, then:

- **👀 Preview** — builds the site and deploys to a **draft URL**. The live domain is not touched. Share it, review it, sleep on it.
- **🔴 Publish Live** — same build, deployed to production, behind a confirmation prompt.

**Draft-by-default is enforced in code, not convention** — nothing in βWave deploys over a live site unless you explicitly chose Live. Deployment History at the bottom shows every build/deploy with URLs.

## RSS feed → social loop

Managed sites expose an RSS feed of published content. Register it as a [Syndicate](syndicate.md) source and every page you publish automatically becomes platform-native social posts. That's the full loop: **generate → publish → syndicate → track** (links carry UTM tags; see the analytics in your GA property).
