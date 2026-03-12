const { pool } = require("../db/pool");
const { fetchIgnitions } = require("../scraping/ignitionData");
const { upsertMaponIgnition } = require("../db/maponIgnitionInsert");

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

async function ignitionSyncAllUnits() {
  const plates = await getActivePlates();

  const now = new Date();
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const fromDT = toIsoSeconds(from);
  const toDT = toIsoSeconds(now);

  let totalUnits = 0;
  let totalIgnitions = 0;
  let totalSaved = 0;
  let totalErrors = 0;

  for (const plate of plates) {
    totalUnits += 1;

    try {
      const ignitions = await fetchIgnitions({
        unitIdOrCarId: plate.id_plate_platform,
        fromDT,
        toDT,
      });

      totalIgnitions += ignitions.length;

      for (const ig of ignitions) {
        await upsertMaponIgnition({
          fleet_id: plate.fleet_id || null,
          plate_id: plate.idplate || null,
          mapon_unit_id: plate.id_plate_platform,
          ignition_on: formatDateUTC(new Date(ig.ignition_on)),
          ignition_off: formatDateUTC(new Date(ig.ignition_off)),
          duration_sec: ig.duration_sec,
          raw_json: JSON.stringify(ig.raw_json),
        });

        totalSaved += 1;
      }
    } catch (err) {
      totalErrors += 1;
      console.error(
        `[ignitionSync] Error con unidad ${plate.id_plate_platform} (${plate.label}):`,
        err.message
      );
    }
  }

  return {
    totalUnits,
    totalIgnitions,
    totalSaved,
    totalErrors,
    fromDT,
    toDT,
  };
}

module.exports = { ignitionSyncAllUnits };