export {}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const apiKey = Deno.env.get('REVENUECAT_API_KEY')
    const projectId = Deno.env.get('REVENUECAT_PROJECT_ID')

    if (!apiKey || !projectId) {
      throw new Error('Missing REVENUECAT_API_KEY or REVENUECAT_PROJECT_ID')
    }

    const url = new URL(req.url)
    const debug = url.searchParams.get('debug') === '1'

    const response = await fetch(
      `https://api.revenuecat.com/v2/projects/${projectId}/charts/non-subscription_purchases`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      },
    )

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`RevenueCat API error (${response.status}): ${body}`)
    }

    const data = await response.json() as { summary?: { total?: Record<string, number> } }
    const totalPurchases = data.summary?.total?.['Non-subscription Purchases'] ?? null

    return new Response(
      JSON.stringify({ rcTotalPurchases: totalPurchases }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal Server Error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
