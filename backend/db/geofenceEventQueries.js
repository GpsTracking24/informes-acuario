const { pool } = require("./pool");

async function upsertGeofenceEvent(e) {
  const sql = `
    INSERT INTO geofence_event (
      mapon_unit_id,
      event_time,
      alert_type,
      zone_name,
      direction,
      message,
      raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      alert_type = VALUES(alert_type),
      message = VALUES(message),
      raw_json = VALUES(raw_json)
  `;

  const params = [
    e.mapon_unit_id,
    e.event_time,
    e.alert_type,
    e.zone_name,
    e.direction,
    e.message,
    e.raw_json,
  ];

  const [res] = await pool.query(sql, params);
  return res;
}

module.exports = { upsertGeofenceEvent };