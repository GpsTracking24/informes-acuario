// backend/sync/parkingSync.js
const { fetchParkingStops } = require("../scraping/parkingData");
const { insertParkingRows } = require("../db/parkingInsert");
const { getUnitsForFleet } = require("../scraping/unitsApi");

async function parkingSync({ fleetId, desde, hasta }) {
  // ✅ Ya no necesitamos browser/page/login
  const units = await getUnitsForFleet(null, fleetId);

  console.log("🅿️ fleet:", fleetId, "units:", units?.length);
  console.log("🅿️ sample unit:", units?.[0]);

  let total = 0;

  for (const u of units) {
    // ✅ Usa unit_id para route/list.json (recomendado)
    const stops = await fetchParkingStops({
      unitIdOrCarId: u.unit_id,
      desde,
      hasta,
    });
console.log("🚗 Unidad:", u.placa);
console.log("🛑 Stops encontrados:", stops.length);
console.log("🛑 Primer stop:", stops[0]);

continue;
    const rows = stops.map((x) => ({
      fleet_id: fleetId,
      plate_id: u.idplate,
      start_time: x.start_time,
      end_time: x.end_time,
      duration_sec: x.duration_sec,
      address: x.address,
      lat: x.lat,
      lng: x.lng,
    }));

    const r = await insertParkingRows(rows);
    total += r?.affectedRows || 0;
  }

  return { ok: true, affectedRows: total };
}

module.exports = { parkingSync };