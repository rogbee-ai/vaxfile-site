export {}
Deno.serve(async (req) => {
  try {
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    const toEmail = Deno.env.get('NOTIFY_EMAIL')
    if (!resendApiKey || !toEmail) throw new Error('Missing RESEND_API_KEY or NOTIFY_EMAIL')
    const payload = await req.json()
    const user = payload.record ?? payload
    const email = user.email ?? 'unknown'
    const createdAt = user.created_at ?? new Date().toISOString()
    const id = user.id ?? 'unknown'
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'VaxFile <onboarding@resend.dev>',
        to: [toEmail],
        subject: '🎉 New VaxFile user',
        html: `<p>A new user just signed up for VaxFile.</p><table style="font-family:monospace;border-collapse:collapse"><tr><td style="padding:4px 12px 4px 0;color:#666">Email</td><td>${email}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#666">User ID</td><td>${id}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#666">Signed up</td><td>${createdAt}</td></tr></table>`,
      }),
    })
    if (!response.ok) { const body = await response.text(); throw new Error(`Resend error (${response.status}): ${body}`) }
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
  } catch (error) {
    console.error(error)
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Internal Server Error' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
