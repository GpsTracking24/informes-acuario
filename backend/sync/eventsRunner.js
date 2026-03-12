const { pool } = require("../db/pool");
const { syncEventsForPlate } = require("./eventSync");

async function getActivePlates() {
  const [rows] = await pool.query(
    "SELECT idplate, label, id_plate_platform, box_id FROM plate WHERE active=1 AND box_id IS NOT NULL"
  );
  return rows;
}

async function runWithConcurrency(items, limit, fn) {
  const results = [];
  let index = 0;

  const workers = Array.from({ length: limit }, async () => {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await fn(items[i]);
      } catch (e) {
        results[i] = { error: e.message };
      }
    }
  });

  await Promise.all(workers);
  return results;
}

async function syncAllEventsOnce() {
  const plates = await getActivePlates();

  const results = await runWithConcurrency(
    plates,
    2, // concurrencia
    syncEventsForPlate
  );

  return {
    plates: plates.length,
    results
  };
}

module.exports = { syncAllEventsOnce };