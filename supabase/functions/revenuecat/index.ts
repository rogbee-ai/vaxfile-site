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

    const response = await fetch(
      `https://api.revenuecat.com/v2/projects/${projectId}/metrics/overview`,
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

    const data = await response.json() as { metrics: Array<{ id: string; name: string; value: number; last_updated_at: string }> }

    const metrics: Record<string, number> = {}
    for (const m of data.metrics ?? []) {
      metrics[m.id] = m.value
    }

    return new Response(
      JSON.stringify({
        activeSubscribers: metrics['active_subscriptions'] ?? metrics['active_subscribers'] ?? null,
        allTimeCustomers: metrics['all_time_customers'] ?? null,
        mrr: metrics['mrr'] ?? null,
        revenue: metrics['revenue'] ?? null,
        rawMetrics: data.metrics,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal Server Error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
