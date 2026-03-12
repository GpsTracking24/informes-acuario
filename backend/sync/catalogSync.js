const { pool } = require("../db/pool");

async function maponGet(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Mapon ${resp.status} - ${url}`);
  return resp.json();
}

async function syncCatalog() {
  const key = process.env.MAPON_API_KEY;
  if (!key) throw new Error("Falta MAPON_API_KEY en .env");

  // 1) Fleets
  const fleetsJson = await maponGet(`https://mapon.com/api/v1/unit_groups/list.json?key=${key}`);
  const fleets = fleetsJson.data || [];

  const fleetIds = [];
  for (const f of fleets) {
    fleetIds.push(f.id);
    await pool.query(
      `
      INSERT INTO fleet (idfleet, fleet_name, active)
      VALUES (?, ?, 1)
      ON DUPLICATE KEY UPDATE
        fleet_name = VALUES(fleet_name),
        active = 1
      `,
      [f.id, f.name]
    );
  }

  // Desactivar fleets que ya no existen
  if (fleetIds.length > 0) {
    await pool.query(
      `UPDATE fleet SET active=0 WHERE idfleet NOT IN (${fleetIds.map(() => "?").join(",")})`,
      fleetIds
    );
  } else {
    console.warn("⚠️ Mapon devolvió 0 flotas; no se desactivó nada.");
  }

  // 2) Mapa unit_id -> fleet_id (usando list_units por flota)
  const unitToFleet = new Map();
  for (const f of fleets) {
    const j = await maponGet(
      `https://mapon.com/api/v1/unit_groups/list_units.json?key=${key}&id=${f.id}`
    );
    const unitIds = (j.data?.units || []).map(u => u.id);
    for (const uid of unitIds) unitToFleet.set(uid, f.id);
  }

  // 3) Lista global de unidades (para obtener la placa "number" + box_id)
  const unitsJson = await maponGet(`https://mapon.com/api/v1/unit/list.json?key=${key}`);
  const units = unitsJson.data?.units || [];

  const maponUnitIds = [];
  let upserted = 0;

  for (const u of units) {
    const unitId = Number(u.unit_id);
    const boxId = Number(u.box_id);
    const plateLabel = (u.number || "").trim();

    if (!unitId || !plateLabel) continue;

    maponUnitIds.push(unitId);

    // ✅ aquí está el fleet_id correcto
    const fleetId = unitToFleet.get(unitId) ?? null;

    await pool.query(
      `
      INSERT INTO plate (label, id_plate_platform, box_id, fleet_id, active)
      VALUES (?, ?, ?, ?, 1)
      ON DUPLICATE KEY UPDATE
        label = VALUES(label),
        box_id = VALUES(box_id),
        fleet_id = VALUES(fleet_id),
        active = 1
      `,
      [plateLabel, unitId, boxId, fleetId]
    );

    upserted++;
  }

  // Desactivar plates que ya no existen en Mapon
  if (maponUnitIds.length > 0) {
    await pool.query(
      `UPDATE plate SET active=0 WHERE id_plate_platform NOT IN (${maponUnitIds.map(() => "?").join(",")})`,
      maponUnitIds
    );
  } else {
    console.warn("⚠️ Mapon devolvió 0 unidades; no se desactivó nada.");
  }

  return {
    fleets_total: fleets.length,
    units_total: units.length,
    plates_upserted: upserted,
  };
}

module.exports = { syncCatalog };