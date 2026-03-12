const { pool } = require("./pool");

async function upsertGeofence(g) {

  const sql = `
  INSERT INTO geofence
  (
    mapon_geofence_id,
    name,
    wkt,
    created_at,
    updated_at,
    raw_json
  )
  VALUES (?, ?, ?, ?, ?, ?)

  ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    wkt = VALUES(wkt),
    created_at = VALUES(created_at),
    updated_at = VALUES(updated_at),
    raw_json = VALUES(raw_json)
  `;

  const params = [
    g.mapon_geofence_id,
    g.name,
    g.wkt,
    g.created_at,
    g.updated_at,
    g.raw_json
  ];

  const [res] = await pool.query(sql, params);

  return res;
}

module.exports = { upsertGeofence };