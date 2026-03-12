const { syncCatalog } = require("./catalogSync");
const { parkingSyncAllFleetsOnce } = require("./parkingRunner");
const { syncRoutesForAllUnits } = require("./maponRouteSync");
const { ignitionSyncAllUnits } = require("./ignitionSync");
const { geofenceSyncAll } = require("./geofenceSync");
const { alertSyncAll } = require("./alertSync");
const { eventSyncAll } = require("./eventSync");

console.log("✅ scheduler.js cargado");

let running = false;

function todayISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startScheduler() {
  const run = async () => {
    if (running) {
      console.log("⏳ Ya hay un ciclo ejecutándose, se omite este tick.");
      return;
    }

    running = true;

    try {
      console.log("🔄 Iniciando ciclo...");

      const desde = todayISO();
      const hasta = todayISO();

      const cat = await syncCatalog();
      console.log("📂 syncCatalog:", cat);

      const pk = await parkingSyncAllFleetsOnce({ desde, hasta });
      console.log("🅿️ syncParking:", pk);

      const rt = await syncRoutesForAllUnits();
      console.log("🛣️ syncRoutes:", rt);

      const ig = await ignitionSyncAllUnits();
      console.log("🔑 syncIgnitions:", ig);

      const gf = await geofenceSyncAll();
      console.log("📍 syncGeofence:", gf);

      const al = await alertSyncAll();
      console.log("🚨 syncAlerts:", al);

      const ev = await eventSyncAll({ desde, hasta });
      console.log("⚡ syncEvents:", ev);

    } catch (err) {
      console.error("❌ Scheduler error:", err);
    } finally {
      running = false;
    }
  };

  run();
  setInterval(run, 60_000);
}

module.exports = { startScheduler };