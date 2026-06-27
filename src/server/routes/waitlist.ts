import { Router } from 'express'

const router = Router()

router.post('/', async (req, res) => {
  const { email } = req.body || {}
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' })
  }

  const apiKey = process.env.RESEND_API_KEY
  const audienceId = process.env.RESEND_AUDIENCE_ID

  if (!apiKey || !audienceId) {
    console.error('Waitlist: RESEND_API_KEY or RESEND_AUDIENCE_ID not set in env')
    return res.status(503).json({ error: 'Waitlist temporarily unavailable' })
  }

  try {
    const r = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: email.toLowerCase().trim(), unsubscribed: false }),
    })

    if (!r.ok) {
      const body = await r.text()
      // 409 = contact already exists — treat as success to avoid leaking info
      if (r.status === 409) return res.json({ ok: true })
      console.error('Resend waitlist error:', r.status, body)
      return res.status(502).json({ error: 'Could not add to waitlist' })
    }

    return res.json({ ok: true })
  } catch (err) {
    console.error('Waitlist fetch error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

export default router
