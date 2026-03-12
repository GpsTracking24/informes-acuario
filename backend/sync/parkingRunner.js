// backend/sync/parkingRunner.js
const { pool } = require("../db/pool");
const { getUnitsForFleet } = require("../scraping/unitsApi");
const { fetchParkingStops } = require("../scraping/parkingData");
const { insertParking } = require("../db/parkingInsert");

// Si tienes una tabla fleet en BD, esto sirve.
// Si no la tienes, dime el nombre real de tu tabla de flotas.
async function getAllFleets() {
  const [rows] = await pool.query(`SELECT idfleet FROM fleet`);
  return rows.map(r => r.idfleet);
}

async function parkingSyncFleetOnce({ fleetId, desde, hasta }) {
  const units = await getUnitsForFleet(null, fleetId);

  let affected = 0;

  for (const u of units) {
    // ✅ route/list espera unit_id (Mapon)
    const stops = await fetchParkingStops({
      unitIdOrCarId: u.unit_id,
      desde,
      hasta,
    });

    for (const p of stops) {
      // doble seguro
      if (!p?.start_time || !p?.end_time) continue;

      const r = await insertParking(pool, fleetId, u.idplate, p);
      // mysql2: r[0] a veces trae affectedRows, depende cómo lo uses.
      // Lo dejamos simple:
      affected += 1;
    }
  }

  return { ok: true, fleetId, affectedInsertedAttempts: affected };
}

async function parkingSyncAllFleetsOnce({ desde, hasta }) {
  const fleets = await getAllFleets();

  const results = [];
  for (const fleetId of fleets) {
    const r = await parkingSyncFleetOnce({ fleetId, desde, hasta });
    results.push(r);
  }

  return { ok: true, desde, hasta, fleets: results };
}

module.exports = { parkingSyncAllFleetsOnce, parkingSyncFleetOnce };