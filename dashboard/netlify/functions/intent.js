const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

const FEATURE_META = {
  multiple_children: { label: "Add 2nd child", icon: "👶" },
  doc_scan: { label: "Doc scan (OCR)", icon: "📄" },
  other_country: { label: "Other country", icon: "🌍" },
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

function normalizeFeatureRows(rows) {
  const countsByFeature = {
    multiple_children: 0,
    doc_scan: 0,
    other_country: 0,
  };

  for (const row of rows || []) {
    let feature;
    let count;

    if (Array.isArray(row)) {
      feature = row[0];
      count = Number(row[1]) || 0;
    } else {
      feature = row.feature ?? row[0];
      count = Number(row.count ?? row[1]) || 0;
    }

    if (feature in countsByFeature) {
      countsByFeature[feature] += count;
    }
  }

  return Object.entries(FEATURE_META).map(([feature, meta]) => ({
    feature,
    label: meta.label,
    count: countsByFeature[feature] || 0,
    icon: meta.icon,
  }));
}

function normalizeTrendRows(rows) {
  return (rows || []).map((row) => {
    if (Array.isArray(row)) {
      return { day: row[0], value: Number(row[1]) || 0 };
    }

    return {
      day: row.day || row.date || row[0],
      value: Number(row.value ?? row.count ?? row[1]) || 0,
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

    const featureBreakdownQuery = {
      kind: "EventsQuery",
      event: "premium_intent",
      select: ["properties.feature AS feature", "count() AS count"],
      groupBy: ["feature"],
      filter_test_accounts: true,
      ...(dateFrom === "all" ? {} : { dateRange: { date_from: dateFrom } }),
    };

    const trendQuery = {
      kind: "EventsQuery",
      event: "premium_intent",
      select: ["toStartOfDay(timestamp) AS day", "count() AS value"],
      groupBy: ["day"],
      orderBy: ["day ASC"],
      filter_test_accounts: true,
      ...(dateFrom === "all" ? {} : { dateRange: { date_from: dateFrom } }),
    };

    const [featureResult, trendResult] = await Promise.all([
      posthogQuery(projectId, apiKey, featureBreakdownQuery),
      posthogQuery(projectId, apiKey, trendQuery),
    ]);

    const fakeDoors = normalizeFeatureRows(featureResult?.results);
    const fakeDoorTrend = normalizeTrendRows(trendResult?.results);
    const totalIntentTaps = fakeDoors.reduce((sum, item) => sum + item.count, 0);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        fakeDoors,
        fakeDoorTrend,
        totalIntentTaps,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Failed to load premium intent metrics",
        details: error.message || "Unknown error",
      }),
    };
  }
};
