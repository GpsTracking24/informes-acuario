// backend/scraping/parkingData.js
const fetch = require("node-fetch");

async function fetchParkingStops({ unitIdOrCarId, desde, hasta }) {
  const baseUrl = process.env.BASE_URL;       // ej: https://mapon.com
  const key = process.env.MAPON_API_KEY;

const fromDT = `${desde}T00:00:00Z`;
const toDT = `${hasta}T23:59:59Z`;

  const url = new URL("/api/v1/route/list.json", baseUrl);
  url.searchParams.set("key", key);
  url.searchParams.set("from", fromDT);
  url.searchParams.set("till", toDT);

  // ⚠️ IMPORTANTE:
  // route/list.json espera unit_id (como en la doc/captura).
  // En tu unitsApi tú tienes unit_id y unique_id (box_id).
  // Usa unit_id aquí (recomendado).
  url.searchParams.set("unit_id", String(unitIdOrCarId));

  const resp = await fetch(url.toString(), {
    headers: { "User-Agent": "mapon-local-report/1.0" },
  });

  if (!resp.ok) throw new Error(`route/list error: ${resp.status}`);

  const json = await resp.json();

  // ✅ Estructura real
  const units = json?.data?.units || [];
  const routes = units.flatMap((u) => u.routes || []);

  // ✅ SOLO PARADAS
  const stops = routes.filter((r) => r.type === "stop");

  // Mapeo a estructura "parsed" que usa parkingSync (start_time, end_time, duration_sec, address, lat, lng)
  return stops
    .map((s) => {
      const start = s.start || {};
      const end = s.end || {};

      if (!start.time || !end.time) return null;

      const startMs = new Date(start.time).getTime();
      const endMs = new Date(end.time).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;

      return {
        start_time: start.time,
        end_time: end.time,
        duration_sec: Math.floor((endMs - startMs) / 1000),
        address: start.address || null,
        lat: start.lat ?? null,
        lng: start.lng ?? null,
      };
    })
    .filter(Boolean);
}

module.exports = { fetchParkingStops };