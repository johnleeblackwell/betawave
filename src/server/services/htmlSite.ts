interface Post {
  title: string
  body: string
  excerpt: string
  slug: string
  date: string
  type: 'blog' | 'newsletter'
}

interface ColonyConfig {
  name: string
  tagline: string
  bio: string
  tone: string
  audience: string
}

export function renderColonySite(posts: Post[], config: ColonyConfig): Map<string, string> {
  const files = new Map<string, string>()

  // --- Index page ---
  files.set('index.html', renderIndex(posts, config))

  // --- Individual post pages ---
  for (const post of posts) {
    files.set(`posts/${post.slug}.html`, renderPost(post, posts, config))
  }

  // --- RSS feed ---
  files.set('feed.xml', renderFeed(posts, config))

  return files
}

function renderIndex(posts: Post[], config: ColonyConfig): string {
  const postCards = posts.map(p => `
    <article class="post-card">
      <time>${p.date}</time>
      <h2><a href="posts/${p.slug}.html">${p.title}</a></h2>
      <p>${p.excerpt}</p>
      <span class="tag ${p.type}">${p.type}</span>
    </article>
  `).join('\n')

  return htmlWrap(config.name, `
    <header class="hero">
      <h1>${escapeHtml(config.name)}</h1>
      <p class="tagline">${escapeHtml(config.tagline)}</p>
      <p class="bio">${escapeHtml(config.bio)}</p>
    </header>
    <section class="posts">
      ${postCards || '<p class="empty">No content yet. The colony is forming.</p>'}
    </section>
  `, config)
}

function renderPost(post: Post, allPosts: Post[], config: ColonyConfig): string {
  const related = allPosts
    .filter(p => p.slug !== post.slug)
    .slice(0, 3)

  const relatedHtml = related.length
    ? `<aside class="related"><h3>More from this colony</h3>
      ${related.map(p => `<a href="posts/${p.slug}.html" class="related-link">${p.title}</a>`).join('')}
    </aside>`
    : ''

  const bodyHtml = renderBody(post.body)

  return htmlWrap(`${post.title} — ${config.name}`, `
    <article class="post-full">
      <header>
        <time>${post.date}</time>
        <h1>${post.title}</h1>
        <span class="tag ${post.type}">${post.type}</span>
      </header>
      <div class="content">${bodyHtml}</div>
    </article>
    ${relatedHtml}
    <nav class="post-nav">
      <a href="../index.html">← Back to colony</a>
    </nav>
  `, config)
}

function renderFeed(posts: Post[], config: ColonyConfig): string {
  const items = posts.map(p => `
    <entry>
      <title>${escapeHtml(p.title)}</title>
      <link href="posts/${p.slug}.html"/>
      <id>urn:colony:${p.slug}</id>
      <published>${p.date}</published>
      <summary>${escapeHtml(p.excerpt)}</summary>
    </entry>
  `).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeHtml(config.name)}</title>
  <subtitle>${escapeHtml(config.tagline)}</subtitle>
  <link href="feed.xml" rel="self"/>
  <updated>${posts[0]?.date || new Date().toISOString()}</updated>
  ${items}
</feed>`
}

function renderBody(md: string): string {
  return md
    .replace(/^# (.+)$/m, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hlup])(.+)$/gm, '<p>$1</p>')
}

function htmlWrap(title: string, content: string, config: ColonyConfig): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(config.tagline)}"/>
<meta name="generator" content="ColonyAgent/βWAVE"/>
<style>
  :root{--bg:#0a0a0f;--card:#12121a;--border:#2a2a45;--text:#e8e8f0;--muted:#6a6a8a;--accent:#00d4aa;--radius:8px}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.7;padding:2rem 1rem}
  .container{max-width:720px;margin:0 auto}
  a{color:var(--accent);text-decoration:none}
  a:hover{text-decoration:underline}
  .hero{margin:4rem 0 3rem;text-align:center}
  .hero h1{font-size:2.5rem;font-weight:800;letter-spacing:-0.03em;background:linear-gradient(135deg,#00d4aa,#22d3ee);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
  .tagline{color:var(--muted);font-size:1.1rem;margin-top:0.5rem}
  .bio{color:var(--muted);font-size:0.9rem;margin-top:1rem;max-width:500px;margin-left:auto;margin-right:auto}
  .posts{display:flex;flex-direction:column;gap:1.5rem}
  .post-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1.5rem;transition:border-color 0.2s}
  .post-card:hover{border-color:var(--accent)}
  .post-card time{font-size:0.8rem;color:var(--muted)}
  .post-card h2{margin:0.5rem 0;font-size:1.2rem}
  .post-card p{color:var(--muted);font-size:0.9rem}
  .tag{display:inline-block;font-size:0.75rem;padding:0.15rem 0.5rem;border-radius:100px;margin-top:0.5rem;background:rgba(0,212,170,0.1);color:var(--accent);border:1px solid rgba(0,212,170,0.2)}
  .tag.newsletter{background:rgba(167,139,250,0.1);color:#a78bfa;border-color:rgba(167,139,250,0.2)}
  .post-full header{margin-bottom:2rem}
  .post-full time{color:var(--muted);font-size:0.85rem}
  .post-full h1{font-size:2rem;margin:0.5rem 0}
  .content{font-size:1rem;line-height:1.8}
  .content h2{font-size:1.4rem;margin:2rem 0 0.75rem;color:var(--accent)}
  .content h3{font-size:1.15rem;margin:1.5rem 0 0.5rem}
  .content p{margin:1rem 0;color:#c0c0d0}
  .content ul{margin:0.5rem 0 0.5rem 1.5rem;color:#c0c0d0}
  .content strong{color:var(--text)}
  .related{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1.5rem;margin:2rem 0}
  .related h3{margin-bottom:0.75rem;font-size:1rem}
  .related-link{display:block;padding:0.4rem 0;font-size:0.9rem;border-bottom:1px solid var(--border)}
  .related-link:last-child{border-bottom:none}
  .post-nav{margin:2rem 0;font-size:0.9rem}
  .empty{color:var(--muted);text-align:center;padding:3rem}
  footer{text-align:center;color:var(--muted);font-size:0.8rem;margin:3rem 0;border-top:1px solid var(--border);padding-top:2rem}
</style>
</head>
<body>
<div class="container">
${content}
<footer><p>Generated by βWAVE Colony Agent · Metacuum substrate</p></footer>
</div>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}
