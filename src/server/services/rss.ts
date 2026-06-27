import RSSParser from 'rss-parser'

const parser = new RSSParser({
  timeout: 8000,
  headers: { 'User-Agent': 'Betawave/1.0 (+https://betawave.co.uk)' }
})

export interface RSSItem {
  title: string
  content: string
  link: string
  pubDate: string
}

export async function fetchRSSItems(url: string): Promise<RSSItem[]> {
  const feed = await parser.parseURL(url)
  return feed.items.map(item => ({
    title: item.title || 'Untitled',
    content: item.contentSnippet || item.content || item.summary || '',
    link: item.link || '',
    pubDate: item.pubDate || ''
  }))
}

export async function validateRSSUrl(url: string): Promise<{ ok: boolean; title?: string; error?: string }> {
  try {
    const feed = await parser.parseURL(url)
    return { ok: true, title: feed.title }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Invalid feed' }
  }
}
