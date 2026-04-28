const { createClient } = require("@supabase/supabase-js");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

function getFromDate(range) {
  const now = new Date();

  if (range === "24h") {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  }

  if (range === "30d") {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  return null;
}

function formatDateKey(input) {
  return new Date(input).toISOString().slice(0, 10);
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
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    const testUserId = process.env.TEST_USER_ID;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase environment variables");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const range = event.queryStringParameters?.range || "all";

    if (!["24h", "30d", "all"].includes(range)) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Invalid range. Use 24h, 30d, or all." }),
      };
    }

    const fromDate = getFromDate(range);

    let usersQuery = supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .neq("id", testUserId);

    let childrenQuery = supabase
      .from("children")
      .select("country", { count: "exact" })
      .neq("user_id", testUserId);

    let vaccinesQuery = supabase
      .from("vaccination_logs")
      .select("id", { count: "exact", head: true })
      .neq("user_id", testUserId);

    let usersTrendQuery = supabase
      .from("users")
      .select("created_at")
      .neq("id", testUserId)
      .order("created_at", { ascending: true });

    if (fromDate) {
      usersQuery = usersQuery.gte("created_at", fromDate);
      childrenQuery = childrenQuery.gte("created_at", fromDate);
      vaccinesQuery = vaccinesQuery.gte("created_at", fromDate);
      usersTrendQuery = usersTrendQuery.gte("created_at", fromDate);
    }

    const [
      { count: newUsers, error: usersError },
      { data: childrenData, count: childrenAdded, error: childrenError },
      { count: vaccinesLogged, error: vaccinesError },
      { data: usersTrendRaw, error: usersTrendError },
    ] = await Promise.all([
      usersQuery,
      childrenQuery,
      vaccinesQuery,
      usersTrendQuery,
    ]);

    if (usersError || childrenError || vaccinesError || usersTrendError) {
      throw usersError || childrenError || vaccinesError || usersTrendError;
    }

    const usersByDay = (usersTrendRaw || []).reduce((acc, row) => {
      const key = formatDateKey(row.created_at);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const usersTrend = Object.entries(usersByDay).map(([date, count]) => ({
      date,
      count,
    }));

    const countryTotals = (childrenData || []).reduce((acc, row) => {
      const country = row.country || "Unknown";
      acc[country] = (acc[country] || 0) + 1;
      return acc;
    }, {});

    const childrenByCountry = Object.entries(countryTotals).map(
      ([country, count]) => ({
        country,
        count,
      })
    );

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        newUsers: newUsers || 0,
        childrenAdded: childrenAdded || 0,
        vaccinesLogged: vaccinesLogged || 0,
        usersTrend,
        childrenByCountry,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Failed to load growth metrics",
        details: error.message || "Unknown error",
      }),
    };
  }
};
