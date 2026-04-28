const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function mapRangeToDateFrom(range: string): string {
  if (range === '24h') return '-1d'
  if (range === '30d') return '-30d'
  return 'all'
}

function getApiUrl(): string {
  const projectId = Deno.env.get('POSTHOG_PROJECT_ID')
  if (!projectId) {
    throw new Error('Missing POSTHOG_PROJECT_ID')
  }
  return `https://eu.posthog.com/api/projects/${projectId}/query`
}

function getAuthToken(): string {
  const apiKey = Deno.env.get('POSTHOG_API_KEY')
  if (!apiKey) {
    throw new Error('Missing POSTHOG_API_KEY')
  }
  return apiKey
}

async function posthogQuery(
  url: string,
  token: string,
  query: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`PostHog API error (${response.status}): ${body}`)
  }

  return response.json()
}

function readScalarFromResponse(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 0
  const results = (payload as { results?: unknown }).results
  if (Array.isArray(results)) {
    const first = results[0]
    if (typeof first === 'number') return first
    if (first && typeof first === 'object' && 'count' in first) {
      return Number((first as { count: unknown }).count) || 0
    }
  }
  if ('result' in (payload as Record<string, unknown>)) {
    return Number((payload as Record<string, unknown>).result) || 0
  }
  return 0
}

function readVaccineTrend(payload: unknown): Array<{ day: string; value: number }> {
  if (!payload || typeof payload !== 'object') return []
  const results = (payload as { results?: unknown }).results
  if (!Array.isArray(results)) return []

  return results
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const r = row as Record<string, unknown>
      const day = String(r.day ?? r.date ?? '')
      const value = Number(r.value ?? r.count ?? 0) || 0
      if (!day) return null
      return { day, value }
    })
    .filter((row): row is { day: string; value: number } => row !== null)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const range = url.searchParams.get('range') ?? 'all'
    const normalizedRange = ['24h', '30d', 'all'].includes(range) ? range : 'all'
    const dateFrom = mapRangeToDateFrom(normalizedRange)

    const apiUrl = getApiUrl()
    const token = getAuthToken()

    const signUpsQuery = {
      kind: 'HogQLQuery',
      query: `
        SELECT count()
        FROM events
        WHERE event = 'sign_up'

          AND (${dateFrom === 'all' ? 'true' : `timestamp >= now() - INTERVAL '${dateFrom === '-1d' ? '1 day' : '30 day'}'`})
      `,
    }

    const appOpensQuery = {
      kind: 'HogQLQuery',
      query: `
        SELECT uniq(distinct_id)
        FROM events
        WHERE event = 'app_open'

          AND (${dateFrom === 'all' ? 'true' : `timestamp >= now() - INTERVAL '${dateFrom === '-1d' ? '1 day' : '30 day'}'`})
      `,
    }

    const vaccinesLoggedQuery = {
      kind: 'HogQLQuery',
      query: `
        SELECT count()
        FROM events
        WHERE event = 'vaccine_logged'

          AND (${dateFrom === 'all' ? 'true' : `timestamp >= now() - INTERVAL '${dateFrom === '-1d' ? '1 day' : '30 day'}'`})
      `,
    }

    const vaccineTrendQuery = {
      kind: 'HogQLQuery',
      query: `
        SELECT toDate(timestamp) AS day, count() AS value
        FROM events
        WHERE event = 'vaccine_logged'

          AND (${dateFrom === 'all' ? 'true' : `timestamp >= now() - INTERVAL '${dateFrom === '-1d' ? '1 day' : '30 day'}'`})
        GROUP BY day
        ORDER BY day ASC
      `,
    }

    const [signUpsRaw, appOpensRaw, vaccinesLoggedRaw, vaccineTrendRaw] = await Promise.all([
      posthogQuery(apiUrl, token, signUpsQuery),
      posthogQuery(apiUrl, token, appOpensQuery),
      posthogQuery(apiUrl, token, vaccinesLoggedQuery),
      posthogQuery(apiUrl, token, vaccineTrendQuery),
    ])

    return new Response(
      JSON.stringify({
        signUps: readScalarFromResponse(signUpsRaw),
        appOpens: readScalarFromResponse(appOpensRaw),
        vaccinesLogged: readScalarFromResponse(vaccinesLoggedRaw),
        vaccineTrend: readVaccineTrend(vaccineTrendRaw),
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal Server Error',
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    )
  }
})
