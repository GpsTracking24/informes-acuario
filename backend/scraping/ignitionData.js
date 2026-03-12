const fetch = require("node-fetch");

async function fetchIgnitions({ unitIdOrCarId, fromDT, toDT }) {
  const baseUrl = process.env.BASE_URL;
  const key = process.env.MAPON_API_KEY;

  const url = new URL("/api/v1/unit_data/ignitions.json", baseUrl);
  url.searchParams.set("key", key);
  url.searchParams.set("from", fromDT);
  url.searchParams.set("till", toDT);
  url.searchParams.set("unit_id", String(unitIdOrCarId));

  const resp = await fetch(url.toString(), {
    headers: { "User-Agent": "mapon-local-report/1.0" },
  });

  if (!resp.ok) {
    throw new Error(`unit_data/ignitions error: ${resp.status}`);
  }

  const json = await resp.json();

  const units = json?.data?.units || [];
  const ignitions = units.flatMap((u) => u.ignitions || []);

  return ignitions
    .map((ig) => {
      if (!ig?.on || !ig?.off) return null;

      const onMs = new Date(ig.on).getTime();
      const offMs = new Date(ig.off).getTime();

      if (!Number.isFinite(onMs) || !Number.isFinite(offMs) || offMs <= onMs) {
        return null;
      }

      return {
        mapon_unit_id: Number(unitIdOrCarId),
        ignition_on: ig.on,
        ignition_off: ig.off,
        duration_sec: Math.floor((offMs - onMs) / 1000),
        raw_json: ig,
      };
    })
    .filter(Boolean);
}

module.exports = { fetchIgnitions };