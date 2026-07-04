# Citations — track your brand in AI assistant answers

Search is shifting from ten blue links to a single AI answer. The Citations module measures whether that answer mentions **you** — and turns the gaps into a content plan.

## How it works

1. **Tracked brand** — the client's brand name (+ variants/domain) to watch for.
2. **Tracked queries** — the questions that matter: *"best cosmetic dentist in Birmingham"*, *"top tattoo studio near me"*. Add them manually or seed from pSEO queries.
3. **Citation runs** — βWave asks every configured engine each query and records whether the brand was cited, who was cited instead, and the position.

### Engines

| Engine | Key required |
|---|---|
| Anthropic (Claude) | `ANTHROPIC_API_KEY` |
| OpenAI (ChatGPT) | `OPENAI_API_KEY` |
| Perplexity | `PERPLEXITY_API_KEY` |
| Google Gemini | `GEMINI_API_KEY` |

Engines without a key are skipped — run with whatever you have. Keys go in Settings (encrypted at rest, see [Settings](settings.md)).

## Reading the results

- **Citation share** — % of query×engine combinations where the brand appeared. The headline number for client reporting.
- **Per-query breakdown** — which engines cite you, which cite competitors, for every question.
- **Deltas over time** — re-run weekly; the trend is the product you're selling.

## The gap-closer

After a run classifies, βWave **auto-drafts a targeted blog post for every query where the brand was cited by zero engines** — content engineered to answer exactly the question AI engines are answering without you. Drafts land in the content library; nothing auto-publishes. Review, publish via [Site](sites.md), syndicate via [Syndicate](syndicate.md), then re-run the citation scan and watch the share move.

## Two jobs, one module

- **For clients**: proof of work — "your AI visibility went from 8% to 31% since we started."
- **For prospecting**: the [Discovery](discovery.md) module uses citation runs to *rank prospects* by AI invisibility — the businesses no engine mentions are your warmest cold-outreach list.
