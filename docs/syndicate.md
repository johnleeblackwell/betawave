# Syndicate — automatic reposting to your social channels

Syndicate turns content you already publish (a blog RSS feed, an Instagram account) into platform-native posts on your other channels, automatically, on a schedule. Set it up once; the scheduler runs every 30 minutes.

```
Source (RSS / Instagram) → LLM rewrite in your brand voice → Destination (X, Facebook, Instagram, Telegram, Reddit, Medium)
```

## Concepts

| Thing | What it is |
|---|---|
| **Source** | Where content comes from: an RSS feed URL or an Instagram handle |
| **Destination** | A connected account posts go **to** — each stores its own credentials |
| **Route** | Source → Destination link. Each route has a daily cap and optional custom rewrite prompt |
| **Pool** | For RSS sources, items build an evergreen library; each tick an LLM picks the most timely item that hasn't run recently, so old-but-good posts recirculate |

Every syndicated link is automatically tagged with `utm_source=<platform>&utm_medium=social&utm_campaign=syndication`, so your analytics show exactly which platform drove each visit.

## Setting up destinations

### X (Twitter)
1. Create an app at [developer.x.com](https://developer.x.com) (free tier is enough for posting).
2. Generate all four values under *Keys and tokens*: API Key, API Secret, Access Token, Access Token Secret (with **Read and Write** permissions).
3. Syndicate → Destinations → Add → platform **X**, paste all four.
4. Click **Test** — it should greet you with your handle.

### Facebook Page
1. Create an app at [developers.facebook.com](https://developers.facebook.com) (type: Business).
2. Link your Facebook Page to the app, then generate a **long-lived Page access token** (Graph API Explorer → select your Page → Generate token with `pages_manage_posts`, then exchange for long-lived).
3. Find your **Page ID** (Page → About → Page transparency, or Graph Explorer `me/accounts`).
4. Add destination → platform **Facebook Page** → paste Page ID as *account_id* + the token.
5. **Test** should return your Page's name.

Posts with an image go up as photo posts (better reach); text-only posts go to the Page feed with the link previewed as a card.

### Instagram
Requirements are stricter — Meta's rules, not ours:
- Your Instagram must be a **Business or Creator account**, **linked to a Facebook Page**.
- Same Meta app + Page token as above, but the token needs `instagram_content_publish`.
- Your **IG Business user ID** comes from Graph Explorer: `me/accounts?fields=instagram_business_account`.
- **Instagram refuses text-only posts.** If a source item has no image, βWave automatically sources a free stock photo (Pexels → Pixabay → Unsplash) matched to the post title. Configure stock API keys in Settings for best results.
- Captions never include links (they're not clickable on IG); the rewrite engine knows this and writes hook-first captions with hashtags instead.

### Telegram / Reddit / Medium
Guided setup notes appear directly in the destination form for each.

## Per-platform rewriting

The same source item becomes a *different* post per platform — not one post copied everywhere:
- **X**: ≤280 chars, one idea, link appended (auto-previews as a card)
- **Facebook**: 40–80 conversational words, ends with a question when natural, link appended
- **Instagram**: 100–150 word caption, first line is the hook, emojis, hashtag block, no link

Override any route's voice with a custom rewrite prompt on the route.

## Safety rails
- **Daily cap** per route (default 10) — never burst-posts
- **Destination throttle** — minimum gap between posts to the same account (default 60 min), even across multiple routes
- **Dedupe** — an item never posts twice to the same destination
- **Preview** — dry-run any route to see exactly what the next post would be before it goes live
