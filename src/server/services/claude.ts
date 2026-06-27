import Anthropic from '@anthropic-ai/sdk'
import { complianceGuardPrompt, effectiveBlockList } from './compliance.js'

// Initialised lazily so dotenv has already run by the time the key is read.
// Pass apiKey to use a per-client key (e.g. from llm.ts); omit to use ANTHROPIC_API_KEY.
export function getClient(apiKey?: string) {
  return new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY })
}

// Returns an async iterable that yields text chunks, with an abort controller attached
export function streamGenerate(prompt: string) {
  const controller = new AbortController()

  const stream = getClient().messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    thinking: { type: 'adaptive' } as any,
    messages: [{ role: 'user', content: prompt }]
  })

  async function* iterate() {
    for await (const event of stream) {
      if (controller.signal.aborted) break
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text
      }
      // thinking_delta blocks are silently skipped — benefits generation quality without exposing internals
    }
  }

  const iterable = iterate()
  ;(iterable as any).controller = controller

  // Wire abort to the SDK stream
  controller.signal.addEventListener('abort', () => stream.abort())

  return iterable as AsyncGenerator<string> & { controller: AbortController }
}

// --- Prompt builders ---

interface Client {
  business_name: string
  industry: string
  expertise_areas: string[]
  tone_of_voice: string
  target_audience: string
  style_notes?: string
  location?: string
  blocked_topics?: string[]
}

// Render the location clause naturally — "based in {location}" if set,
// otherwise omit the phrase entirely so we don't produce "based in ."
function locationClause(client: Client): string {
  const loc = (client.location || '').trim()
  return loc ? ` based in ${loc}` : ''
}

// Localised colour for the blog prompt — only inject a "local angle" if
// we actually have a location to anchor it to.
function localAngleLine(client: Client): string {
  const loc = (client.location || '').trim()
  return loc
    ? `5. Includes a ${loc} / local angle where it feels natural — not forced`
    : `5. Stays grounded in real-world detail — avoid generic stock phrasing`
}

interface RecentPost {
  title: string
  excerpt: string
}

export function buildBlogPrompt(client: Client, sourceMaterial: string, topicHint: string): string {
  const blockList = effectiveBlockList(client.blocked_topics)
  const guard = complianceGuardPrompt(blockList)

  return `You are writing an expert blog post for ${client.business_name}, a ${client.industry} business${locationClause(client)}.

BUSINESS PROFILE:
- Expertise: ${client.expertise_areas.join(', ')}
- Tone of voice: ${client.tone_of_voice}
- Target audience: ${client.target_audience}
${client.style_notes ? `- Style notes: ${client.style_notes}` : ''}
${topicHint ? `\nREQUESTED FOCUS: ${topicHint}` : ''}
${sourceMaterial ? `\nCURRENT INDUSTRY MATERIAL TO DRAW FROM:\n${sourceMaterial}` : ''}

Write an engaging, expert blog post of 800–1000 words that:
1. Demonstrates ${client.business_name}'s genuine expertise in ${client.industry}
2. Provides real, actionable value to ${client.target_audience}
3. Uses a ${client.tone_of_voice} tone throughout
4. References relevant insights from the source material above (where present)
${localAngleLine(client)}
6. Has a strong opening hook that makes the reader want to continue

FORMAT:
- First line: # [Compelling title]
- Brief intro paragraph (hook)
- 3–4 sections with ## subheadings
- Short, readable paragraphs (2–4 sentences each)
- Conclusion with a clear call to action for ${client.target_audience}
- Very last line: IMAGE_QUERY: [2–4 words that would find the perfect stock photo for this post on Pexels — specific and visual, e.g. "latte art closeup" not "coffee blog"]

Write only the blog post followed by the IMAGE_QUERY line. No other preamble or meta-commentary.${guard}`
}

export function buildNewsletterPrompt(client: Client, recentPosts: RecentPost[]): string {
  const postList = recentPosts.length
    ? recentPosts.map(p => `- "${p.title}": ${p.excerpt}`).join('\n')
    : 'No recent posts this month — write a general monthly update instead.'

  const blockList = effectiveBlockList(client.blocked_topics)
  const guard = complianceGuardPrompt(blockList)

  return `You are writing a monthly email newsletter for ${client.business_name}, a ${client.industry} business${locationClause(client)}.

BUSINESS PROFILE:
- Expertise: ${client.expertise_areas.join(', ')}
- Tone of voice: ${client.tone_of_voice}
- Audience: ${client.target_audience}
${client.style_notes ? `- Style notes: ${client.style_notes}` : ''}

RECENT CONTENT TO FEATURE:
${postList}

Write a warm, genuinely human newsletter (500–650 words) that:
1. Starts with [SUBJECT: ...] on its own line — write a compelling email subject line
2. Opens with a personal, friendly greeting — like a letter from a real business owner
3. Shares 2–3 valuable insights, tips, or updates relevant to ${client.target_audience}
4. Naturally references the recent content listed above (if any)
5. Feels local and genuine — not corporate or generic
6. Closes with a warm, personal sign-off from ${client.business_name}

FORMAT:
[SUBJECT: Your subject line here]

# Newsletter Title

Dear [reader],

[Opening paragraph — warm, personal, human]

## [Section heading]

[Content]

## [Section heading]

[Content]

[Warm closing]

[Sign-off name/team]

Write only the newsletter. No meta-commentary.${guard}`
}
