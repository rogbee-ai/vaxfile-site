export {}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function mapRangeToDateFrom(range: string): string {
  if (range === '24h') return '-1d'
  if (range === '7d') return '-7d'
  if (range === '30d') return '-30d'
  return 'all'
}

function getDateFilterSql(dateFrom: string): string {
  if (dateFrom === 'all') return 'true'
  if (dateFrom === '-1d') return "timestamp >= now() - INTERVAL '1 day'"
  if (dateFrom === '-7d') return "timestamp >= now() - INTERVAL '7 day'"
  return "timestamp >= now() - INTERVAL '30 day'"
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

function parseErrorTypes(payload: unknown): Array<{ name: string; count: number }> {
  if (!payload || typeof payload !== 'object') return []
  const results = (payload as { results?: unknown }).results
  if (!Array.isArray(results)) return []

  return results
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const r = row as Record<string, unknown>
      const name = String(r.name ?? r.exception_type ?? r['$exception_type'] ?? 'Unknown')
      const count = Number(r.count ?? r.value ?? 0) || 0
      return { name, count }
    })
    .filter((row): row is { name: string; count: number } => row !== null)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const requestUrl = new URL(req.url)
    const range = requestUrl.searchParams.get('range') ?? 'all'
    const normalizedRange = ['24h', '7d', '30d', 'all'].includes(range) ? range : 'all'
    const dateFrom = mapRangeToDateFrom(normalizedRange)
    const dateFilterSql = getDateFilterSql(dateFrom)

    const apiUrl = getApiUrl()
    const token = getAuthToken()

    const totalErrorsQuery = {
      kind: 'HogQLQuery',
      query: `
        SELECT count()
        FROM events
        WHERE event = '$exception'

          AND (${dateFilterSql})
      `,
    }

    const errorTypesQuery = {
      kind: 'HogQLQuery',
      query: `
        SELECT properties.$exception_type AS name, count() AS count
        FROM events
        WHERE event = '$exception'

          AND (${dateFilterSql})
        GROUP BY name
        ORDER BY count DESC
        LIMIT 5
      `,
    }

    const [totalErrorsRaw, errorTypesRaw] = await Promise.all([
      posthogQuery(apiUrl, token, totalErrorsQuery),
      posthogQuery(apiUrl, token, errorTypesQuery),
    ])

    const totalErrors = readScalarFromResponse(totalErrorsRaw)
    const errorTypes = parseErrorTypes(errorTypesRaw)
    const totalCrashes = errorTypes
      .filter((entry) => entry.name.toLowerCase().includes('crash'))
      .reduce((sum, entry) => sum + entry.count, 0)

    return new Response(
      JSON.stringify({
        totalErrors,
        totalCrashes,
        errorTypes,
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
