const { pool } = require("./pool");

function buildPeriodFilter(period) {
  switch (period) {
    case "hoy":
      return `
        mr.end_time >= CURDATE()
        AND mr.end_time < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
      `;
    case "ayer":
      return `
        mr.end_time >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
        AND mr.end_time < CURDATE()
      `;
    case "semana":
      return `
        mr.end_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      `;
    case "mes":
      return `
        mr.end_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      `;
    default:
      return `
        mr.end_time >= CURDATE()
        AND mr.end_time < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
      `;
  }
}

async function getMotorHoursReport({ fleetId, period }) {
  const periodWhere = buildPeriodFilter(period);

  const params = [];
  let fleetWhere = "";

  if (fleetId && String(fleetId) !== "0") {
    fleetWhere = " AND mr.fleet_id = ? ";
    params.push(Number(fleetId));
  }

  const sql = `
    SELECT
      p.label AS agrupacion,
      mr.fleet_id,
      mr.mapon_unit_id,

      mr.start_time AS comienzo,
      mr.start_address AS ubicacion_inicial,

      mr.end_time AS fin,
      mr.end_address AS ubicacion_final,

      mr.start_total_engine_hours AS horas_motor_inicio,
      mr.end_total_engine_hours AS horas_motor_fin,

      (mr.end_total_engine_hours - mr.start_total_engine_hours) AS horas_motor,

      SEC_TO_TIME(TIMESTAMPDIFF(SECOND, mr.start_time, mr.end_time)) AS tiempo_total,

      ROUND(mr.distance_m / 1000, 0) AS kilometraje,
      mr.start_total_distance AS kilometraje_inicial,
      mr.end_total_distance AS kilometraje_final,

      mr.avg_speed AS velocidad_media,
      mr.max_speed AS velocidad_maxima

    FROM mapon_route mr
    INNER JOIN (
      SELECT mapon_unit_id, MAX(end_time) AS max_end_time
      FROM mapon_route
      WHERE ${periodWhere}
      ${fleetId && String(fleetId) !== "0" ? " AND fleet_id = ? " : ""}
      GROUP BY mapon_unit_id
    ) last_route
      ON last_route.mapon_unit_id = mr.mapon_unit_id
     AND last_route.max_end_time = mr.end_time

    LEFT JOIN plate p
      ON p.id_plate_platform = mr.mapon_unit_id

    WHERE 1=1
      ${fleetWhere}

    ORDER BY p.label ASC
  `;

  const finalParams =
    fleetId && String(fleetId) !== "0"
      ? [Number(fleetId), Number(fleetId)]
      : [];

  const [rows] = await pool.query(sql, finalParams);
  return rows;
}

module.exports = {
  getMotorHoursReport,
};