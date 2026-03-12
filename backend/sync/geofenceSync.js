const { fetchGeofences } = require("../scraping/geofenceData");
const { upsertGeofence } = require("../db/geofenceQueries");

async function geofenceSyncAll() {
  const zones = await fetchGeofences();

  let totalSaved = 0;
  let totalErrors = 0;
  let totalSkipped = 0;

  for (const g of zones) {
    if (!g || !g.mapon_geofence_id) {
      totalSkipped++;
      console.warn("[geofenceSync] geocerca omitida por datos incompletos:", g);
      continue;
    }

    try {
      await upsertGeofence(g);
      totalSaved++;
    } catch (err) {
      totalErrors++;
      console.error("[geofenceSync] error:", err.message, g);
    }
  }

  return {
    totalGeofences: zones.length,
    totalSaved,
    totalErrors,
    totalSkipped,
  };
}

module.exports = { geofenceSyncAll };