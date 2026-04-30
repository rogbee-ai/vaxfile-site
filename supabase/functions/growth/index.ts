import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function getFromDate(range: string): string {
  const now = new Date()

  if (range === '24h') {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  }

  if (range === '7d') {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  }

  if (range === '30d') {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
  }

  // all
  return new Date(0).toISOString()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const TEST_USER_ID = Deno.env.get('TEST_USER_ID')

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const url = new URL(req.url)
    const range = url.searchParams.get('range') ?? 'all'
    const normalizedRange = ['24h', '7d', '30d', 'all'].includes(range) ? range : 'all'
    const fromDate = getFromDate(normalizedRange)

    let usersCountQuery = supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', fromDate)

    let childrenQuery = supabase
      .from('profiles')
      .select('country_code', { count: 'exact' })
      .gte('created_at', fromDate)

    let logsCountQuery = supabase
      .from('vaccination_logs')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', fromDate)

    let usersTrendQuery = supabase
      .from('users')
      .select('created_at')
      .gte('created_at', fromDate)

    if (TEST_USER_ID) {
      usersCountQuery = usersCountQuery.neq('id', TEST_USER_ID)
      childrenQuery = childrenQuery.neq('user_id', TEST_USER_ID)
      usersTrendQuery = usersTrendQuery.neq('id', TEST_USER_ID)
    }

    const [
      { count: newUsers, error: usersCountError },
      { data: childrenRows, count: childrenAdded, error: childrenError },
      { count: vaccinesLogged, error: logsError },
      { data: usersTrendRows, error: usersTrendError },
    ] = await Promise.all([
      usersCountQuery,
      childrenQuery,
      logsCountQuery,
      usersTrendQuery,
    ])

    if (usersCountError || childrenError || logsError || usersTrendError) {
      throw usersCountError || childrenError || logsError || usersTrendError
    }

    const usersByDay = new Map<string, number>()
    for (const row of usersTrendRows ?? []) {
      const day = String(row.created_at).slice(0, 10)
      usersByDay.set(day, (usersByDay.get(day) ?? 0) + 1)
    }

    const usersTrend = Array.from(usersByDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, value]) => ({ day, value }))

    const countryCounts = new Map<string, number>()
    for (const row of childrenRows ?? []) {
      const country = row.country_code ?? 'Unknown'
      countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1)
    }

    const childrenByCountry = Array.from(countryCounts.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count)

    return new Response(
      JSON.stringify({
        newUsers: newUsers ?? 0,
        childrenAdded: childrenAdded ?? 0,
        vaccinesLogged: vaccinesLogged ?? 0,
        usersTrend,
        childrenByCountry,
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
