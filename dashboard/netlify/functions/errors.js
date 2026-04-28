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

function normalizeErrorTypes(rows) {
  return (rows || []).slice(0, 5).map((row) => {
    if (Array.isArray(row)) {
      return {
        name: row[0] || "Unknown",
        count: Number(row[1]) || 0,
      };
    }

    return {
      name: row.name || row.exception_type || row[0] || "Unknown",
      count: Number(row.count ?? row[1]) || 0,
    };
  });
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
    const dateFilter = dateFrom === "all" ? {} : { dateRange: { date_from: dateFrom } };

    const totalErrorsQuery = {
      kind: "EventsQuery",
      event: "$exception",
      select: ["count() AS count"],
      filter_test_accounts: true,
      ...dateFilter,
    };

    const errorTypesQuery = {
      kind: "EventsQuery",
      event: "$exception",
      select: ["properties.$exception_type AS name", "count() AS count"],
      groupBy: ["name"],
      orderBy: ["count DESC"],
      limit: 5,
      filter_test_accounts: true,
      ...dateFilter,
    };

    const [totalErrorsResult, errorTypesResult] = await Promise.all([
      posthogQuery(projectId, apiKey, totalErrorsQuery),
      posthogQuery(projectId, apiKey, errorTypesQuery),
    ]);

    const totalErrors = extractCount(totalErrorsResult);
    const errorTypes = normalizeErrorTypes(errorTypesResult?.results);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        totalErrors,
        totalCrashes: totalErrors,
        errorTypes,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Failed to load error metrics",
        details: error.message || "Unknown error",
      }),
    };
  }
};
