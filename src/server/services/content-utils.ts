/** Shared helpers used by both content.ts (streaming) and scheduler.ts (batch). */

export function extractTitle(text: string): string {
  const match = text.match(/^#\s+(.+)/m)
  return match ? match[1].trim() : text.split('\n')[0].slice(0, 80).trim()
}

/** Parses and removes the IMAGE_QUERY line Claude appends to blog posts. */
export function extractImageQuery(text: string): { body: string; imageQuery: string } {
  const match = text.match(/\nIMAGE_QUERY:\s*(.+)$/m)
  if (!match) return { body: text.trim(), imageQuery: '' }
  return {
    body: text.slice(0, match.index).trim(),
    imageQuery: match[1].trim(),
  }
}

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
  'from','is','are','was','were','that','this','how','why','what','when',
  'where','who','will','can','your','our','their',
])

/** Strips stop words and punctuation from a title for cleaner stock-photo searches. */
export function cleanTitleForSearch(title: string): string {
  return title
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 4)
    .join(' ')
}

export function markdownToHtml(md: string): string {
  return `<!DOCTYPE html><html><head><style>
    body { font-family: Georgia, serif; max-width: 680px; margin: 40px auto; color: #1a1a2e; line-height: 1.7; padding: 0 20px; }
    h1 { color: #0f172a; font-size: 2em; margin-bottom: 8px; }
    h2 { color: #1e3a5f; font-size: 1.3em; margin-top: 2em; border-bottom: 2px solid #d97706; padding-bottom: 4px; }
    p { margin: 1em 0; }
    strong { color: #0f172a; }
    a { color: #d97706; }
  </style></head><body>` +
    md
      .replace(/^# (.+)$/m, '<h1>$1</h1>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(?!<[h|p])(.+)$/gm, '<p>$1</p>')
    + '</body></html>'
}
