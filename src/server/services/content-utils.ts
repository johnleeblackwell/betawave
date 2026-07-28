/** Shared helpers used by both content.ts (streaming) and scheduler.ts (batch). */

export interface EmbeddableImage { downloadUrl: string; alt: string; credit: string }

/**
 * Splices a sourced image into a blog body as real markdown, right after the
 * H1 title (or at the very top if there's no H1) — the ONE place callers should
 * insert an image, so it always lands somewhere sensible regardless of how the
 * rest of the piece is structured. `body` is unchanged if `image` is null (no
 * provider configured, all providers failed, or the client's image_source is
 * 'none') — callers don't need their own conditional.
 */
export function embedImageMarkdown(body: string, image: EmbeddableImage | null): string {
  if (!image) return body
  const imgBlock = `![${image.alt.replace(/[[\]]/g, '')}](${image.downloadUrl})\n*${image.credit}*`
  const lines = body.split('\n')
  const h1Index = lines.findIndex(l => /^#\s+/.test(l))
  if (h1Index === -1) return `${imgBlock}\n\n${body}`
  lines.splice(h1Index + 1, 0, '', imgBlock)
  return lines.join('\n')
}

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
    figure { margin: 1.5em 0; }
    figure img { width: 100%; height: auto; border-radius: 8px; display: block; }
    figcaption { font-size: 0.8em; color: #64748b; margin-top: 6px; }
  </style></head><body>` +
    md
      .replace(/^# (.+)$/m, '<h1>$1</h1>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      // The one place an image is spliced into a body — see embedImageMarkdown()
      // above. Must run before the generic paragraph wrap, or the markdown image
      // syntax just prints as literal text inside a <p>.
      .replace(/^!\[(.*?)\]\((.*?)\)$/gm, '<figure><img src="$2" alt="$1" /></figure>')
      .replace(/^\*([^*]+)\*$/gm, '<figcaption>$1</figcaption>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(?!<h|<p|<figure|<figcaption)(.+)$/gm, '<p>$1</p>')
    + '</body></html>'
}
