export {}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

const featureMeta: Record<string, { label: string; icon: string }> = {
  multiple_children: { label: 'Add 2nd child', icon: '👶' },
  doc_scan: { label: 'Doc scan (OCR)', icon: '📄' },
  other_country: { label: 'Other country', icon: '🌍' },
}

function mapRangeToDateFrom(range: string): string {
  if (range === '24h') return '-1d'
  if (range === '30d') return '-30d'
  return 'all'
}

function getDateFilterSql(dateFrom: string): string {
  if (dateFrom === 'all') return 'true'
  if (dateFrom === '-1d') return "timestamp >= now() - INTERVAL '1 day'"
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

type FakeDoor = { feature: string; label: string; count: number; icon: string }
type FakeDoorTrendPoint = { day: string; value: number }

function parseFakeDoors(payload: unknown): FakeDoor[] {
  if (!payload || typeof payload !== 'object') return []
  const results = (payload as { results?: unknown }).results
  if (!Array.isArray(results)) return []

  const rows = results
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const r = row as Record<string, unknown>
      const feature = String(r.feature ?? r.properties_feature ?? '')
      const count = Number(r.count ?? r.value ?? 0) || 0
      if (!feature) return null

      const meta = featureMeta[feature] ?? { label: feature, icon: '✨' }
      return {
        feature,
        label: meta.label,
        count,
        icon: meta.icon,
      }
    })
    .filter((row): row is FakeDoor => row !== null)
    .sort((a, b) => b.count - a.count)

  return rows
}

function parseFakeDoorTrend(payload: unknown): FakeDoorTrendPoint[] {
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
    .filter((row): row is FakeDoorTrendPoint => row !== null)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const requestUrl = new URL(req.url)
    const range = requestUrl.searchParams.get('range') ?? 'all'
    const normalizedRange = ['24h', '30d', 'all'].includes(range) ? range : 'all'
    const dateFrom = mapRangeToDateFrom(normalizedRange)
    const dateFilterSql = getDateFilterSql(dateFrom)

    const apiUrl = getApiUrl()
    const token = getAuthToken()

    const fakeDoorsQuery = {
      kind: 'HogQLQuery',
      query: `
        SELECT properties.feature AS feature, count() AS count
        FROM events
        WHERE event = 'premium_intent'
          AND filter_test_accounts = true
          AND (${dateFilterSql})
        GROUP BY feature
        ORDER BY count DESC
      `,
      filter_test_accounts: true,
    }

    const fakeDoorTrendQuery = {
      kind: 'HogQLQuery',
      query: `
        SELECT toDate(timestamp) AS day, count() AS value
        FROM events
        WHERE event = 'premium_intent'
          AND filter_test_accounts = true
          AND (${dateFilterSql})
        GROUP BY day
        ORDER BY day ASC
      `,
      filter_test_accounts: true,
    }

    const [fakeDoorsRaw, fakeDoorTrendRaw] = await Promise.all([
      posthogQuery(apiUrl, token, fakeDoorsQuery),
      posthogQuery(apiUrl, token, fakeDoorTrendQuery),
    ])

    const fakeDoors = parseFakeDoors(fakeDoorsRaw)
    const fakeDoorTrend = parseFakeDoorTrend(fakeDoorTrendRaw)
    const totalIntentTaps = fakeDoors.reduce((sum, item) => sum + item.count, 0)

    return new Response(
      JSON.stringify({
        fakeDoors,
        fakeDoorTrend,
        totalIntentTaps,
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
