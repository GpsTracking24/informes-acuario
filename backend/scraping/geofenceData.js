const fetch = require("node-fetch");

function maponDateToMysql(dt) {
  if (!dt) return null;
  return new Date(dt).toISOString().slice(0,19).replace("T"," ");
}

async function fetchGeofences() {

  const baseUrl = process.env.BASE_URL;
  const key = process.env.MAPON_API_KEY;

  const url = new URL("/api/v1/object/list.json", baseUrl);
  url.searchParams.set("key", key);

  const resp = await fetch(url.toString(), {
    headers: { "User-Agent": "mapon-local-report/1.0" }
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`object/list error: ${resp.status} - ${text}`);
  }

  const json = await resp.json();

  const objects = json?.data?.objects || [];

  return objects.map(o => ({
    mapon_geofence_id: o.id,
    name: o.name || null,
    wkt: o.wkt || null,
    created_at: maponDateToMysql(o.created),
    updated_at: maponDateToMysql(o.updated),
    raw_json: JSON.stringify(o)
  }));
}

module.exports = { fetchGeofences };