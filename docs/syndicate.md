# Syndicate — automatic reposting to your social channels

Syndicate turns content you already publish (a blog RSS feed, an Instagram account) into platform-native posts on your other channels, automatically, on a schedule. Set it up once; the scheduler runs every 30 minutes.

```
Source (RSS / Instagram) → LLM rewrite in your brand voice → Destination (X, Facebook, Instagram, LinkedIn, Telegram, Reddit, Medium)
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

### Sourcing content FROM Instagram (two options)

If you want to pull your own Instagram posts to rewrite and repost elsewhere, there are two source types — pick based on whether you administratively control the account:

**`ig_graph` — your own account, free.** Uses the same Meta Business app + Page token as posting *to* Instagram above (`me/accounts?fields=instagram_business_account` for the IG Business user ID, same long-lived Page token). No per-call cost, fully within Instagram's terms, but only works for accounts you actually manage.

**`apify_instagram` — any public account, paid.** Uses [Apify](https://apify.com)'s Instagram Profile Scraper to read a public profile you don't administratively control (e.g. for pulling inspiration/reference content, or when account access genuinely isn't available to you). Costs ~£0.001–0.005 per call — a handful of sources polling regularly can exceed Apify's free $5/mo tier fast; the Starter plan ($29/mo prepaid) is worth it once you're running more than one or two sources this way.

Rule of thumb: if you can log into the account's Meta Business settings, use `ig_graph`. If you can't (an agency running someone else's account, a client who won't grant access), `apify_instagram` is the only option.

### LinkedIn (personal profile)
LinkedIn has no in-browser token generator like Meta's Graph API Explorer, so getting your first token is a one-time manual OAuth flow:

1. Create an app at [linkedin.com/developers](https://www.linkedin.com/developers/apps) and add the **"Share on LinkedIn"** product (self-serve, approved instantly — no waiting period). Posting as a **Company Page** instead needs LinkedIn's Community Management API, which requires a manual review that can take days to weeks and isn't guaranteed; the personal-profile route above has no such wait.
2. Visit LinkedIn's authorize URL with your app's `client_id`, a `redirect_uri` you control, and `scope=openid%20profile%20w_member_social`. Approve the prompt.
3. Exchange the returned `code` for an access token: `POST https://www.linkedin.com/oauth/v2/accessToken` with `grant_type=authorization_code`, your `code`, `client_id`, `client_secret`, and `redirect_uri`.
4. Resolve your person URN: `GET https://api.linkedin.com/v2/userinfo` with the access token — the `sub` field is your id; your URN is `urn:li:person:{sub}`.
5. Add destination → platform **LinkedIn** → paste the access token into *access_token* and `urn:li:person:{sub}` into *account_id*.
6. **Test** should post to your feed.

Tokens last ~60 days with no refresh token on standard self-serve apps — when posts start failing with a 401, repeat steps 2–4.

### Telegram / Reddit / Medium
Guided setup notes appear directly in the destination form for each.

## Per-platform rewriting

The same source item becomes a *different* post per platform — not one post copied everywhere:
- **X**: ≤280 chars, one idea, link appended (auto-previews as a card)
- **Facebook**: 40–80 conversational words, ends with a question when natural, link appended
- **Instagram**: 100–150 word caption, first line is the hook, emojis, hashtag block, no link
- **LinkedIn**: 100–200 words, professional/thought-leadership tone, short paragraphs (1–2 sentences each), link appended

Override any route's voice with a custom rewrite prompt on the route.

## Safety rails
- **Daily cap** per route (default 10) — never burst-posts
- **Destination throttle** — minimum gap between posts to the same account (default 60 min), even across multiple routes
- **Dedupe** — an item never posts twice to the same destination
- **Preview** — dry-run any route to see exactly what the next post would be before it goes live
