const { pool } = require("./pool");

async function upsertMaponIgnition(row) {
  const sql = `
    INSERT INTO mapon_ignition (
      fleet_id,
      plate_id,
      mapon_unit_id,
      ignition_on,
      ignition_off,
      duration_sec,
      raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      fleet_id = VALUES(fleet_id),
      plate_id = VALUES(plate_id),
      ignition_on = VALUES(ignition_on),
      ignition_off = VALUES(ignition_off),
      duration_sec = VALUES(duration_sec),
      raw_json = VALUES(raw_json),
      updated_at = CURRENT_TIMESTAMP
  `;

  const params = [
    row.fleet_id,
    row.plate_id,
    row.mapon_unit_id,
    row.ignition_on,
    row.ignition_off,
    row.duration_sec,
    row.raw_json,
  ];

  await pool.query(sql, params);
}

module.exports = { upsertMaponIgnition };