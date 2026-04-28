const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

function getDateFrom(range) {
  if (range === "24h") {
    return "-1d";
  }

  if (range === "30d") {
    return "-30d";
  }

  return "all";
}

async function posthogQuery(projectId, apiKey, query) {
  const response = await fetch(
    `https://eu.posthog.com/api/projects/${projectId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PostHog query failed: ${response.status} ${text}`);
  }

  return response.json();
}

function extractCount(result) {
  if (!result || !Array.isArray(result.results) || result.results.length === 0) {
    return 0;
  }

  const first = result.results[0];
  if (typeof first === "number") {
    return first;
  }

  if (first && typeof first.count === "number") {
    return first.count;
  }

  return Number(first) || 0;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: "",
    };
  }

  try {
    const projectId = process.env.POSTHOG_PROJECT_ID;
    const apiKey = process.env.POSTHOG_API_KEY;

    if (!projectId || !apiKey) {
      throw new Error("Missing PostHog environment variables");
    }

    const range = event.queryStringParameters?.range || "all";
    if (!["24h", "30d", "all"].includes(range)) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Invalid range. Use 24h, 30d, or all." }),
      };
    }

    const dateFrom = getDateFrom(range);

    const signUpsQuery = {
      kind: "EventsQuery",
      select: ["count() AS count"],
      event: "sign_up",
      filter_test_accounts: true,
      ...(dateFrom === "all" ? {} : { dateRange: { date_from: dateFrom } }),
    };

    const appOpensQuery = {
      kind: "EventsQuery",
      select: ["uniq(person_id) AS count"],
      event: "app_open",
      filter_test_accounts: true,
      ...(dateFrom === "all" ? {} : { dateRange: { date_from: dateFrom } }),
    };

    const vaccinesLoggedCountQuery = {
      kind: "EventsQuery",
      select: ["count() AS count"],
      event: "vaccine_logged",
      filter_test_accounts: true,
      ...(dateFrom === "all" ? {} : { dateRange: { date_from: dateFrom } }),
    };

    const vaccineTrendQuery = {
      kind: "EventsQuery",
      select: ["toStartOfDay(timestamp) AS date", "count() AS count"],
      event: "vaccine_logged",
      filter_test_accounts: true,
      groupBy: ["date"],
      orderBy: ["date ASC"],
      ...(dateFrom === "all" ? {} : { dateRange: { date_from: dateFrom } }),
    };

    const [signUpsResult, appOpensResult, vaccinesCountResult, vaccineTrendResult] =
      await Promise.all([
        posthogQuery(projectId, apiKey, signUpsQuery),
        posthogQuery(projectId, apiKey, appOpensQuery),
        posthogQuery(projectId, apiKey, vaccinesLoggedCountQuery),
        posthogQuery(projectId, apiKey, vaccineTrendQuery),
      ]);

    const vaccineTrend = Array.isArray(vaccineTrendResult?.results)
      ? vaccineTrendResult.results.map((row) => {
          if (Array.isArray(row)) {
            return { date: row[0], count: Number(row[1]) || 0 };
          }
          return {
            date: row.date || row[0],
            count: Number(row.count ?? row[1]) || 0,
          };
        })
      : [];

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        signUps: extractCount(signUpsResult),
        appOpens: extractCount(appOpensResult),
        vaccinesLogged: extractCount(vaccinesCountResult),
        vaccineTrend,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Failed to load event metrics",
        details: error.message || "Unknown error",
      }),
    };
  }
};
