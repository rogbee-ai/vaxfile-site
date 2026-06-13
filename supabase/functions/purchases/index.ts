export {}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

const featureMeta: Record<string, { label: string; icon: string }> = {
  second_child: { label: 'Add 2nd child', icon: '👶' },
  other_country: { label: 'Other country', icon: '🌍' },
  calendar_integration: { label: 'Calendar', icon: '📅' },
  scan_records: { label: 'Doc scan', icon: '📄' },
}

function getDateFilterSql(range: string): string {
  if (range === '24h') return "timestamp >= now() - INTERVAL '1 day'"
  if (range === '7d') return "timestamp >= now() - INTERVAL '7 day'"
  if (range === '30d') return "timestamp >= now() - INTERVAL '30 day'"
  if (range === 'since_v2' || range === '2026-06-12') return "timestamp >= '2026-06-12 00:00:00'"
  return 'true'
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

type FeatureCount = { feature: string; label: string; icon: string; count: number }
type TrendPoint = { day: string; value: number }

function parseFeatureCounts(payload: unknown): FeatureCount[] {
  if (!payload || typeof payload !== 'object') return []
  const results = (payload as { results?: unknown }).results
  if (!Array.isArray(results)) return []

  return results
    .map((row) => {
      if (!Array.isArray(row)) return null
      const feature = String(row[0] ?? '')
      const count = Number(row[1] ?? 0) || 0
      if (!feature) return null

      const meta = featureMeta[feature] ?? { label: feature, icon: '✨' }
      return {
        feature,
        label: meta.label,
        icon: meta.icon,
        count,
      }
    })
    .filter((row): row is FeatureCount => row !== null)
    .sort((a, b) => b.count - a.count)
}

function parseTrend(payload: unknown): TrendPoint[] {
  if (!payload || typeof payload !== 'object') return []
  const results = (payload as { results?: unknown }).results
  if (!Array.isArray(results)) return []

  return results
    .map((row) => {
      if (!Array.isArray(row)) return null
      const day = String(row[0] ?? '')
      const value = Number(row[1] ?? 0) || 0
      if (!day) return null
      return { day, value }
    })
    .filter((row): row is TrendPoint => row !== null)
}

function sumCounts(rows: FeatureCount[]): number {
  return rows.reduce((sum, row) => sum + row.count, 0)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const requestUrl = new URL(req.url)
    const range = requestUrl.searchParams.get('range') ?? 'all'
    const normalizedRange = ['24h', '7d', '30d', 'all', 'since_v2'].includes(range) ? range : 'all'
    const platform = requestUrl.searchParams.get('platform') ?? 'all'
    const testUserId = Deno.env.get('TEST_USER_ID') ?? ''
    const platformFilter = platform !== 'all'
      ? `AND JSONExtractString(properties, 'platform') = '${platform}'`
      : ''
    const testUserFilter = testUserId ? `AND distinct_id != '${testUserId}'` : ''
    const dateFilterSql = getDateFilterSql(normalizedRange)

    const apiUrl = getApiUrl()
    const token = getAuthToken()

    const upsellByFeatureQuery = {
      kind: 'HogQLQuery',
      query: `
        SELECT JSONExtractString(properties, 'feature') AS feature, count() AS count
        FROM events
        WHERE event = 'premium_upsell_shown'
          AND (${dateFilterSql})
          ${testUserFilter}
          ${platformFilter}
        GROUP BY feature
        ORDER BY count DESC
      `,
    }

    const purchaseTappedByFeatureQuery = {
      kind: 'HogQLQuery',
      query: `
        SELECT JSONExtractString(properties, 'feature') AS feature, count() AS count
        FROM events
        WHERE event = 'premium_purchase_tapped'
          AND (${dateFilterSql})
          ${testUserFilter}
          ${platformFilter}
        GROUP BY feature
        ORDER BY count DESC
      `,
    }

    const purchasedByFeatureQuery = {
      kind: 'HogQLQuery',
      query: `
        SELECT JSONExtractString(properties, 'feature') AS feature, count() AS count
        FROM events
        WHERE event = 'premium_purchased'
          AND (${dateFilterSql})
          ${testUserFilter}
          ${platformFilter}
        GROUP BY feature
        ORDER BY count DESC
      `,
    }

    const purchasedTrendQuery = {
      kind: 'HogQLQuery',
      query: `
        SELECT toDate(timestamp) AS day, count() AS value
        FROM events
        WHERE event = 'premium_purchased'
          AND (${dateFilterSql})
          ${testUserFilter}
          ${platformFilter}
        GROUP BY day
        ORDER BY day ASC
      `,
    }

    const [
      upsellByFeatureRaw,
      purchaseTappedByFeatureRaw,
      purchasedByFeatureRaw,
      purchasedTrendRaw,
    ] = await Promise.all([
      posthogQuery(apiUrl, token, upsellByFeatureQuery),
      posthogQuery(apiUrl, token, purchaseTappedByFeatureQuery),
      posthogQuery(apiUrl, token, purchasedByFeatureQuery),
      posthogQuery(apiUrl, token, purchasedTrendQuery),
    ])

    const upsellByFeature = parseFeatureCounts(upsellByFeatureRaw)
    const purchaseTappedByFeature = parseFeatureCounts(purchaseTappedByFeatureRaw)
    const purchasedByFeature = parseFeatureCounts(purchasedByFeatureRaw)
    const purchasedTrend = parseTrend(purchasedTrendRaw)

    return new Response(
      JSON.stringify({
        upsellByFeature,
        purchaseTappedByFeature,
        purchasedByFeature,
        purchasedTrend,
        totalUpsells: sumCounts(upsellByFeature),
        totalPurchaseTapped: sumCounts(purchaseTappedByFeature),
        totalPurchased: sumCounts(purchasedByFeature),
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
