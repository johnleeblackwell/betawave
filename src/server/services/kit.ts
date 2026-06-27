// @ts-nocheck
// Kit (ConvertKit) integration — pushes captured leads into a specific form.
//
// Env vars:
//   KIT_API_KEY   — v4 API key (account-level)
//   KIT_FORM_ID   — default form ID to subscribe leads to (per-report override possible later)
//
// No-op (returns { ok: false, reason: 'not_configured' }) if either env var is missing,
// so the app degrades gracefully when Kit hasn't been set up yet.

interface KitResult {
  ok: boolean
  reason?: 'not_configured' | 'http_error' | 'exception'
  status?: number
  data?: any
}

export async function subscribeToKit(
  email: string,
  opts: { name?: string; formId?: string; tags?: string[] } = {}
): Promise<KitResult> {
  const apiKey = process.env.KIT_API_KEY
  const formId = opts.formId || process.env.KIT_FORM_ID

  if (!apiKey || !formId) {
    return { ok: false, reason: 'not_configured' }
  }

  try {
    // Kit v4 subscriber endpoint — add to a form and tag in one shot.
    // https://developers.kit.com/api-reference/subscribers/create-a-subscriber
    const res = await fetch(`https://api.kit.com/v4/forms/${encodeURIComponent(formId)}/subscribers`, {
      method: 'POST',
      headers: {
        'X-Kit-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email_address: email,
        first_name: opts.name || undefined,
        ...(opts.tags?.length ? { tag_ids: opts.tags } : {}),
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, reason: 'http_error', status: res.status, data }
    return { ok: true, data }
  } catch (err: any) {
    return { ok: false, reason: 'exception', data: err.message || String(err) }
  }
}
