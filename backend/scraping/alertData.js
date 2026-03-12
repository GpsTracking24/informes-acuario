const fetch = require("node-fetch");

function maponDateToMysql(dt) {
  if (!dt) return null;
  return new Date(dt).toISOString().slice(0, 19).replace("T", " ");
}

function parseAlertVal(alertVal) {
  if (!alertVal) {
    return { zone_name: null, direction: null };
  }

  const [zone_name, directionRaw] = String(alertVal).split("|");
  const direction = directionRaw === "IN" || directionRaw === "OUT"
    ? directionRaw
    : null;

  return {
    zone_name: zone_name || null,
    direction,
  };
}

async function fetchObjectAlerts({ fromDT, toDT }) {
  const baseUrl = process.env.BASE_URL;
  const key = process.env.MAPON_API_KEY;

  const url = new URL("/api/v1/alert/list.json", baseUrl);
  url.searchParams.set("key", key);
  url.searchParams.set("from", fromDT);
  url.searchParams.set("till", toDT);

  const resp = await fetch(url.toString(), {
    headers: { "User-Agent": "mapon-local-report/1.0" },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`alert/list error: ${resp.status} - ${text}`);
  }

  const json = await resp.json();
  const rows = json?.data || [];

  return rows
    .filter((a) => a?.alert_type === "in_object")
    .map((a) => {
      const parsed = parseAlertVal(a.alert_val);

      return {
        mapon_unit_id: Number(a.unit_id),
        event_time: maponDateToMysql(a.time),
        alert_type: a.alert_type,
        zone_name: parsed.zone_name,
        direction: parsed.direction,
        message: a.msg || null,
        raw_json: JSON.stringify(a),
      };
    })
    .filter((a) => a.mapon_unit_id && a.event_time && a.zone_name && a.direction);
}

module.exports = { fetchObjectAlerts };