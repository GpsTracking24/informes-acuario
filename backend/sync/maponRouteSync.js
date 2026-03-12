const { pool } = require("../db/pool");
const { fetchRoutes } = require("../scraping/routeData");
const { upsertMaponRoute } = require("../db/maponRouteInsert");

function formatDateUTC(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function toIsoSeconds(date) {
  return date.toISOString().slice(0, 19) + "Z";
}

async function getActivePlates() {
  const [rows] = await pool.query(`
    SELECT idplate, id_plate_platform, fleet_id, label
    FROM plate
    WHERE active = 1
      AND id_plate_platform IS NOT NULL
  `);
  return rows;
}

async function syncRoutesForAllUnits() {
  const plates = await getActivePlates();

  const now = new Date();
  const from = new Date(now.getTime() - 15 * 60 * 1000);

  const fromDT = toIsoSeconds(from);
  const toDT = toIsoSeconds(now);

  let totalUnits = 0;
  let totalRoutes = 0;
  let totalSaved = 0;
  let totalErrors = 0;

  for (const plate of plates) {
    totalUnits += 1;

    try {
      const routes = await fetchRoutes({
        unitIdOrCarId: plate.id_plate_platform,
        fromDT,
        toDT,
      });

      totalRoutes += routes.length;

      for (const route of routes) {
        if (!route || route.type !== "route") continue;

  if (!route?.start?.time || !route?.end?.time) {
    console.warn(
      `[maponRouteSync] Ruta omitida por falta de start/end time. unit=${plate.id_plate_platform}, route_id=${route?.route_id}`
    );
    continue;
  }
        await upsertMaponRoute({
          fleet_id: plate.fleet_id || null,
          mapon_unit_id: plate.id_plate_platform,
          mapon_route_id: route.mapon_route_id,

          start_time: route.start_time ? formatDateUTC(new Date(route.start_time)) : null,
          start_address: route.start_address,
          start_lat: route.start_lat,
          start_lng: route.start_lng,

          end_time: route.end_time ? formatDateUTC(new Date(route.end_time)) : null,
          end_address: route.end_address,
          end_lat: route.end_lat,
          end_lng: route.end_lng,

          distance_m: route.distance_m,
          avg_speed: route.avg_speed,
          max_speed: route.max_speed,

          start_total_distance: route.start_total_distance,
          end_total_distance: route.end_total_distance,

          start_total_engine_hours: route.start_total_engine_hours,
          end_total_engine_hours: route.end_total_engine_hours,

          driver_id: route.driver_id,
          raw_json: JSON.stringify(route.raw_json),
        });

        totalSaved += 1;
      }
    } catch (err) {
      totalErrors += 1;
      console.error(
        `[maponRouteSync] Error con unidad ${plate.id_plate_platform} (${plate.label}):`,
        err.message
      );
    }
  }

  return {
    totalUnits,
    totalRoutes,
    totalSaved,
    totalErrors,
    fromDT,
    toDT,
  };
}

module.exports = { syncRoutesForAllUnits };