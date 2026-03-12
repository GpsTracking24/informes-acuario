const fetch = require("node-fetch");

async function fetchRoutes({ unitIdOrCarId, fromDT, toDT }) {
  const baseUrl = process.env.BASE_URL;
  const key = process.env.MAPON_API_KEY;

  const url = new URL("/api/v1/route/list.json", baseUrl);
  url.searchParams.set("key", key);
  url.searchParams.set("from", fromDT);
  url.searchParams.set("till", toDT);
  url.searchParams.set("unit_id", String(unitIdOrCarId));

  const resp = await fetch(url.toString(), {
    headers: { "User-Agent": "mapon-local-report/1.0" },
  });

  if (!resp.ok) {
    throw new Error(`route/list error: ${resp.status}`);
  }

  const json = await resp.json();

  const units = json?.data?.units || [];
  const routes = units.flatMap((u) => u.routes || []);
 const onlyRoutes = routes
  .filter((r) => r.type === "route")
  .filter((r) => r?.start?.time && r?.end?.time);
  return onlyRoutes.map((r) => ({
    mapon_route_id: r.route_id,
    mapon_unit_id: Number(unitIdOrCarId),

    start_time: r?.start?.time || null,
    start_address: r?.start?.address || null,
    start_lat: r?.start?.lat ?? null,
    start_lng: r?.start?.lng ?? null,

    end_time: r?.end?.time || null,
    end_address: r?.end?.address || null,
    end_lat: r?.end?.lat ?? null,
    end_lng: r?.end?.lng ?? null,

    distance_m: r?.distance ?? null,
    avg_speed: r?.avg_speed ?? null,
    max_speed: r?.max_speed ?? null,

    start_total_distance: r?.start?.can?.total_distance ?? null,
    end_total_distance: r?.end?.can?.total_distance ?? null,

    start_total_engine_hours: r?.start?.can?.total_engine_hours ?? null,
    end_total_engine_hours: r?.end?.can?.total_engine_hours ?? null,

    driver_id: r?.driver_id ?? null,
    raw_json: r,
  }));
}

module.exports = { fetchRoutes };