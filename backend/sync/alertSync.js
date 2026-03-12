const { fetchObjectAlerts } = require("../scraping/alertData");
const { upsertGeofenceEvent } = require("../db/geofenceEventQueries");

function toIsoSeconds(date) {
  return date.toISOString().slice(0, 19) + "Z";
}

async function alertSyncAll() {
  const now = new Date();
  const from = new Date(now.getTime() - 15 * 60 * 1000);

  const fromDT = toIsoSeconds(from);
  const toDT = toIsoSeconds(now);

  const alerts = await fetchObjectAlerts({ fromDT, toDT });

  let totalSaved = 0;
  let totalErrors = 0;

  for (const a of alerts) {
    try {
      await upsertGeofenceEvent(a);
      totalSaved++;
    } catch (err) {
      totalErrors++;
      console.error("[alertSync] error:", err.message, a);
    }
  }

  return {
    totalAlerts: alerts.length,
    totalSaved,
    totalErrors,
    fromDT,
    toDT,
  };
}

module.exports = { alertSyncAll };