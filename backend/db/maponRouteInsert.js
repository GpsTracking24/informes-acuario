const { pool } = require('./pool');

async function upsertMaponRoute(route) {
  const sql = `
    INSERT INTO mapon_route (
      fleet_id,
      mapon_unit_id,
      mapon_route_id,
      start_time,
      start_address,
      start_lat,
      start_lng,
      end_time,
      end_address,
      end_lat,
      end_lng,
      distance_m,
      avg_speed,
      max_speed,
      start_total_distance,
      end_total_distance,
      start_total_engine_hours,
      end_total_engine_hours,
      driver_id,
      raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      fleet_id = VALUES(fleet_id),
      start_time = VALUES(start_time),
      start_address = VALUES(start_address),
      start_lat = VALUES(start_lat),
      start_lng = VALUES(start_lng),
      end_time = VALUES(end_time),
      end_address = VALUES(end_address),
      end_lat = VALUES(end_lat),
      end_lng = VALUES(end_lng),
      distance_m = VALUES(distance_m),
      avg_speed = VALUES(avg_speed),
      max_speed = VALUES(max_speed),
      start_total_distance = VALUES(start_total_distance),
      end_total_distance = VALUES(end_total_distance),
      start_total_engine_hours = VALUES(start_total_engine_hours),
      end_total_engine_hours = VALUES(end_total_engine_hours),
      driver_id = VALUES(driver_id),
      raw_json = VALUES(raw_json),
      updated_at = CURRENT_TIMESTAMP
  `;

  const params = [
    route.fleet_id,
    route.mapon_unit_id,
    route.mapon_route_id,
    route.start_time,
    route.start_address,
    route.start_lat,
    route.start_lng,
    route.end_time,
    route.end_address,
    route.end_lat,
    route.end_lng,
    route.distance_m,
    route.avg_speed,
    route.max_speed,
    route.start_total_distance,
    route.end_total_distance,
    route.start_total_engine_hours,
    route.end_total_engine_hours,
    route.driver_id,
    route.raw_json
  ];

  await pool.query(sql, params);
}

module.exports = {
  upsertMaponRoute
};