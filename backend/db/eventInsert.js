const { pool } = require("./pool");

async function insertEventsBatch(rows) {
  if (!rows.length) return 0;

  const values = [];
  const placeholders = rows.map((r) => {
    values.push(
      r.plate_id,
      r.code_event,
      r.event_time,
      r.speed ?? 0,
      r.location ?? null,
      r.event_text ?? null,
      r.created_at ?? null,
      r.lat ?? null,
      r.lng ?? null
    );
    return "(?,?,?,?,?,?,?,?,?)";
  }).join(",");

  const sql = `
    INSERT IGNORE INTO event
    (
      plate_id,
      code_event,
      event_time,
      speed,
      location,
      event_text,
      created_at,
      lat,
      lng
    )
    VALUES ${placeholders}
  `;

  const [res] = await pool.query(sql, values);
  return res.affectedRows || 0;
}

module.exports = { insertEventsBatch };