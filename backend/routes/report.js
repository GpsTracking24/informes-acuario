const express = require("express");
const router = express.Router();
const { pool } = require("../db/pool");
const { buildReportFilter } = require("./reportFilter");

const fetch = require("node-fetch");

function mysqlDateTimeToUtcString(dt) {
  if (!dt) return null;
  return String(dt).replace(" ", "T") + "Z";
}

async function getMileageAtDateTime(unitId, datetimeUtc) {
  const baseUrl = process.env.BASE_URL;
  const key = process.env.MAPON_API_KEY;

  const url = new URL("/api/v1/unit_data/history_point.json", baseUrl);
  url.searchParams.set("key", key);
  url.searchParams.set("unit_id", String(unitId));
  url.searchParams.set("datetime", datetimeUtc);
  url.searchParams.set("include[]", "mileage");

  const resp = await fetch(url.toString(), {
    headers: { "User-Agent": "mapon-local-report/1.0" },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`history_point error: ${resp.status} - ${text}`);
  }

  const json = await resp.json();

  return json?.data?.units?.[0]?.mileage?.value ?? null;
}
// Día Perú => rango UTC en DB
function limaDayToUtcRange(desde, hasta) {
  const fromUTC = `${desde} 05:00:00`; // 00:00 Perú = 05:00 UTC

  const d = new Date(`${hasta}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const toUTC = `${y}-${m}-${day} 04:59:59`; // 23:59:59 Perú

  return { fromUTC, toUTC };
}

// GET /api/report/plates
router.get("/plates", async (req, res) => {
  try {
    const fleetId = Number(req.query.fleet_id);
    const desde = req.query.desde;
    const hasta = req.query.hasta;
    const reportType = req.query.report_type || "speed";

    if (!fleetId || !desde || !hasta) {
      return res.status(400).json({ ok: false, error: "Faltan parámetros" });
    }

    // ✅ PARKING
    if (reportType === "parking") {
      const { fromUTC, toUTC } = limaDayToUtcRange(desde, hasta);

      const [rows] = await pool.query(
        `
        SELECT
          p.idplate,
          p.label AS placa,

          DATE_SUB(MIN(pk.start_time), INTERVAL 5 HOUR) AS comienzo,
          DATE_SUB(MAX(pk.end_time),   INTERVAL 5 HOUR) AS fin,

          SEC_TO_TIME(SUM(pk.duration_sec)) AS duracion,

          SEC_TO_TIME(
            TIMESTAMPDIFF(SECOND, MIN(pk.start_time), MAX(pk.end_time))
          ) AS tiempo_total,

          SEC_TO_TIME(
            GREATEST(
              0,
              TIMESTAMPDIFF(SECOND, MIN(pk.start_time), MAX(pk.end_time)) - SUM(pk.duration_sec)
            )
          ) AS tiempo_entre,

          SUBSTRING_INDEX(
            GROUP_CONCAT(pk.address ORDER BY pk.start_time ASC SEPARATOR '||'),
            '||',
            1
          ) AS ubicacion,

          SUBSTRING_INDEX(
            GROUP_CONCAT(CONCAT(pk.lat, ',', pk.lng) ORDER BY pk.start_time ASC SEPARATOR '||'),
            '||',
            1
          ) AS coordenadas

        FROM parking pk
        JOIN plate p ON p.idplate = pk.plate_id
        WHERE p.fleet_id = ?
          AND pk.start_time >= ?
          AND pk.end_time   <= ?
        GROUP BY p.idplate, p.label
        ORDER BY MAX(pk.end_time) DESC
        `,
        [fleetId, fromUTC, toUTC]
      );

      return res.json({ ok: true, plates: rows });
    }

if (reportType === "engine_hours") {
  const { fromUTC, toUTC } = limaDayToUtcRange(desde, hasta);

  const [rows] = await pool.query(
    `
    SELECT
      r.idplate,
      r.placa,
      r.mapon_unit_id,
       r.comienzo AS comienzo_utc_raw,
  r.fin AS fin_utc_raw,

      DATE_SUB(r.comienzo, INTERVAL 5 HOUR) AS comienzo,
      r.ubicacion_inicial,

      DATE_SUB(r.fin, INTERVAL 5 HOUR) AS fin,
      r.ubicacion_final,

      SEC_TO_TIME(
        COALESCE(
          TIMESTAMPDIFF(
            SECOND,
            (
              SELECT mi1.ignition_on
              FROM mapon_ignition mi1
              WHERE mi1.mapon_unit_id = r.mapon_unit_id
                AND mi1.ignition_on <= r.comienzo
                AND mi1.ignition_off >= r.comienzo
              ORDER BY mi1.ignition_on DESC
              LIMIT 1
            ),
            r.comienzo
          ),
          0
        )
      ) AS horas_motor_inicio,

      SEC_TO_TIME(
        COALESCE(
          TIMESTAMPDIFF(
            SECOND,
            (
              SELECT mi1.ignition_on
              FROM mapon_ignition mi1
              WHERE mi1.mapon_unit_id = r.mapon_unit_id
                AND mi1.ignition_on <= r.comienzo
                AND mi1.ignition_off >= r.comienzo
              ORDER BY mi1.ignition_on DESC
              LIMIT 1
            ),
            r.comienzo
          ),
          0
        ) +
        COALESCE((
          SELECT SUM(
            TIMESTAMPDIFF(
              SECOND,
              GREATEST(mi2.ignition_on, r.comienzo),
              LEAST(mi2.ignition_off, r.fin)
            )
          )
          FROM mapon_ignition mi2
          WHERE mi2.mapon_unit_id = r.mapon_unit_id
            AND mi2.ignition_on <= r.fin
            AND mi2.ignition_off >= r.comienzo
        ), 0)
      ) AS horas_motor_fin,

      SEC_TO_TIME(
        COALESCE((
          SELECT SUM(
            TIMESTAMPDIFF(
              SECOND,
              GREATEST(mi2.ignition_on, r.comienzo),
              LEAST(mi2.ignition_off, r.fin)
            )
          )
          FROM mapon_ignition mi2
          WHERE mi2.mapon_unit_id = r.mapon_unit_id
            AND mi2.ignition_on <= r.fin
            AND mi2.ignition_off >= r.comienzo
        ), 0)
      ) AS horas_motor,

      SEC_TO_TIME(r.tiempo_movimiento_sec) AS en_movimiento,

      SEC_TO_TIME(
        GREATEST(
          COALESCE((
            SELECT SUM(
              TIMESTAMPDIFF(
                SECOND,
                GREATEST(mi2.ignition_on, r.comienzo),
                LEAST(mi2.ignition_off, r.fin)
              )
            )
            FROM mapon_ignition mi2
            WHERE mi2.mapon_unit_id = r.mapon_unit_id
              AND mi2.ignition_on <= r.fin
              AND mi2.ignition_off >= r.comienzo
          ), 0) - r.tiempo_movimiento_sec,
          0
        )
      ) AS ralenti,

      SEC_TO_TIME(
        GREATEST(
          TIMESTAMPDIFF(SECOND, r.comienzo, r.fin)
          -
          COALESCE((
            SELECT SUM(
              TIMESTAMPDIFF(
                SECOND,
                GREATEST(mi2.ignition_on, r.comienzo),
                LEAST(mi2.ignition_off, r.fin)
              )
            )
            FROM mapon_ignition mi2
            WHERE mi2.mapon_unit_id = r.mapon_unit_id
              AND mi2.ignition_on <= r.fin
              AND mi2.ignition_off >= r.comienzo
          ), 0),
          0
        )
      ) AS tiempo_entre,

      SEC_TO_TIME(TIMESTAMPDIFF(SECOND, r.comienzo, r.fin)) AS tiempo_total,

      ROUND(r.kilometraje_m / 1000, 0) AS kilometraje,
      CONCAT(ROUND(r.velocidad_media, 0), ' km/h') AS velocidad_media,
      CONCAT(ROUND(r.velocidad_maxima, 0), ' km/h') AS velocidad_maxima

    FROM (
      SELECT
        p.idplate,
        p.label AS placa,
        mr.mapon_unit_id,

        MIN(mr.start_time) AS comienzo,
        MAX(mr.end_time) AS fin,

        SUBSTRING_INDEX(
          GROUP_CONCAT(mr.start_address ORDER BY mr.start_time ASC SEPARATOR '||'),
          '||',
          1
        ) AS ubicacion_inicial,

        SUBSTRING_INDEX(
          GROUP_CONCAT(mr.end_address ORDER BY mr.end_time DESC SEPARATOR '||'),
          '||',
          1
        ) AS ubicacion_final,

        SUM(mr.distance_m) AS kilometraje_m,
        AVG(mr.avg_speed) AS velocidad_media,
        MAX(mr.max_speed) AS velocidad_maxima,
        SUM(TIMESTAMPDIFF(SECOND, mr.start_time, mr.end_time)) AS tiempo_movimiento_sec

      FROM mapon_route mr
      JOIN plate p
        ON p.id_plate_platform = mr.mapon_unit_id
      WHERE p.fleet_id = ?
        AND mr.end_time >= ?
        AND mr.end_time <= ?
      GROUP BY p.idplate, p.label, mr.mapon_unit_id
    ) r

    ORDER BY r.placa ASC
    `,
    [fleetId, fromUTC, toUTC]
  );

  const enrichedRows = await Promise.all(
    rows.map(async (row) => {
  try {

    const comienzoUtc = mysqlDateTimeToUtcString(row.comienzo_utc_raw);
    const finUtc = mysqlDateTimeToUtcString(row.fin_utc_raw);

    const kmInicial = await getMileageAtDateTime(row.mapon_unit_id, comienzoUtc);
    const kmFinal = await getMileageAtDateTime(row.mapon_unit_id, finUtc);

    const kmInicialRounded = kmInicial != null ? Math.round(kmInicial) : null;
    const kmFinalRounded = kmFinal != null ? Math.round(kmFinal) : null;

    const kmRecorrido =
      kmInicialRounded != null && kmFinalRounded != null
        ? kmFinalRounded - kmInicialRounded
        : null;

    return {
      ...row,

      kilometraje_inicial:
        kmInicialRounded != null ? `${kmInicialRounded} km` : "N/D",

      kilometraje_final:
        kmFinalRounded != null ? `${kmFinalRounded} km` : "N/D",

      kilometraje:
        kmRecorrido != null ? `${kmRecorrido} km` : "N/D",
    };

  } catch (err) {

    console.error(
      `[history_point] Error unidad ${row.mapon_unit_id}:`,
      err.message
    );

    return {
      ...row,
      kilometraje_inicial: "N/D",
      kilometraje_final: "N/D",
      kilometraje: "N/D",
    };
  }
})
  );

  return res.json({ ok: true, plates: enrichedRows });
}
    // ✅ UP TIME (resumen por placa)
    if (reportType === "up_time") {
      const { fromUTC, toUTC } = limaDayToUtcRange(desde, hasta);

      const [rows] = await pool.query(
        `
        SELECT
          d.idplate,
          d.placa,

          CONCAT(MIN(d.viaje_desde), ' - ', MAX(d.viaje_hasta)) AS viaje,
MIN(d.viaje_desde) AS viaje_desde,
MAX(d.viaje_hasta) AS viaje_hasta,

          DATE_SUB(MIN(d.comienzo), INTERVAL 5 HOUR) AS comienzo,
          DATE_SUB(MAX(d.fin), INTERVAL 5 HOUR) AS fin,

          CONCAT(ROUND(SUM(d.kilometraje_num), 0), ' km') AS kilometraje,
          SEC_TO_TIME(SUM(d.duracion_sec)) AS duracion_viaje,

          SEC_TO_TIME(TIMESTAMPDIFF(SECOND, MIN(d.comienzo), MAX(d.fin))) AS tiempo_total,

          SEC_TO_TIME(
            GREATEST(
              TIMESTAMPDIFF(SECOND, MIN(d.comienzo), MAX(d.fin)) - SUM(d.duracion_sec),
              0
            )
          ) AS tiempo_detenido,

          CONCAT(
            ROUND(
              CASE
                WHEN SUM(d.duracion_sec) > 0
                THEN (SUM(d.kilometraje_num * 1000) / SUM(d.duracion_sec)) * 3.6
                ELSE 0
              END,
              0
            ),
            ' km/h'
          ) AS velocidad_media,

          CONCAT(ROUND(MAX(d.velocidad_maxima_num), 0), ' km/h') AS velocidad_maxima

        FROM (
          SELECT
            p.idplate,
            p.label AS placa,
            e_out.mapon_unit_id,

            e_out.zone_name AS viaje_desde,
            e_in.zone_name AS viaje_hasta,

            e_out.event_time AS comienzo,
            e_in.event_time AS fin,

            TIMESTAMPDIFF(SECOND, e_out.event_time, e_in.event_time) AS duracion_sec,

            CASE
              WHEN e_out.mileage_km IS NOT NULL AND e_in.mileage_km IS NOT NULL
              THEN GREATEST(e_in.mileage_km - e_out.mileage_km, 0)
              ELSE 0
            END AS kilometraje_num,

            COALESCE((
              SELECT MAX(r.max_speed)
              FROM mapon_route r
              WHERE r.mapon_unit_id = e_out.mapon_unit_id
                AND r.start_time >= e_out.event_time
                AND r.end_time <= e_in.event_time
            ), 0) AS velocidad_maxima_num

          FROM geofence_event e_out
          JOIN geofence g_out
            ON g_out.name = e_out.zone_name
          JOIN plate p
            ON p.id_plate_platform = e_out.mapon_unit_id
          JOIN geofence_event e_in
            ON e_in.id = (
              SELECT e2.id
              FROM geofence_event e2
              JOIN geofence g2
                ON g2.name = e2.zone_name
              WHERE e2.mapon_unit_id = e_out.mapon_unit_id
                AND e2.event_time > e_out.event_time
                AND e2.direction = 'IN'
                AND g2.zone_type = 'destino'
              ORDER BY e2.event_time ASC
              LIMIT 1
            )
          WHERE g_out.zone_type = 'origen'
            AND e_out.direction = 'OUT'
            AND e_out.event_time BETWEEN ? AND ?
            AND p.fleet_id = ?
        ) d

        GROUP BY d.idplate, d.placa
        ORDER BY d.placa ASC
        `,
        [fromUTC, toUTC, fleetId]
      );

      return res.json({ ok: true, plates: rows });
    }

    // ✅ DOWN TIME (resumen por placa)
    if (reportType === "down_time") {
      const { fromUTC, toUTC } = limaDayToUtcRange(desde, hasta);

      const [rows] = await pool.query(
        `
        SELECT
          d.idplate,
          d.placa,

          CONCAT(MIN(d.viaje_desde), ' - ', MAX(d.viaje_hasta)) AS viaje,
MIN(d.viaje_desde) AS viaje_desde,
MAX(d.viaje_hasta) AS viaje_hasta,

          DATE_SUB(MIN(d.comienzo), INTERVAL 5 HOUR) AS comienzo,
          DATE_SUB(MAX(d.fin), INTERVAL 5 HOUR) AS fin,

          CONCAT(ROUND(SUM(d.kilometraje_num), 0), ' km') AS kilometraje,
          SEC_TO_TIME(SUM(d.duracion_sec)) AS duracion_viaje,

          SEC_TO_TIME(TIMESTAMPDIFF(SECOND, MIN(d.comienzo), MAX(d.fin))) AS tiempo_total,

          SEC_TO_TIME(
            GREATEST(
              TIMESTAMPDIFF(SECOND, MIN(d.comienzo), MAX(d.fin)) - SUM(d.duracion_sec),
              0
            )
          ) AS tiempo_detenido,

          CONCAT(
            ROUND(
              CASE
                WHEN SUM(d.duracion_sec) > 0
                THEN (SUM(d.kilometraje_num * 1000) / SUM(d.duracion_sec)) * 3.6
                ELSE 0
              END,
              0
            ),
            ' km/h'
          ) AS velocidad_media,

          CONCAT(ROUND(MAX(d.velocidad_maxima_num), 0), ' km/h') AS velocidad_maxima

        FROM (
          SELECT
            p.idplate,
            p.label AS placa,
            e_out.mapon_unit_id,

            e_out.zone_name AS viaje_desde,
            e_in.zone_name AS viaje_hasta,

            e_out.event_time AS comienzo,
            e_in.event_time AS fin,

            TIMESTAMPDIFF(SECOND, e_out.event_time, e_in.event_time) AS duracion_sec,

            CASE
              WHEN e_out.mileage_km IS NOT NULL AND e_in.mileage_km IS NOT NULL
              THEN GREATEST(e_in.mileage_km - e_out.mileage_km, 0)
              ELSE 0
            END AS kilometraje_num,

            COALESCE((
              SELECT MAX(r.max_speed)
              FROM mapon_route r
              WHERE r.mapon_unit_id = e_out.mapon_unit_id
                AND r.start_time >= e_out.event_time
                AND r.end_time <= e_in.event_time
            ), 0) AS velocidad_maxima_num

          FROM geofence_event e_out
          JOIN geofence g_out
            ON g_out.name = e_out.zone_name
          JOIN plate p
            ON p.id_plate_platform = e_out.mapon_unit_id
          JOIN geofence_event e_in
            ON e_in.id = (
              SELECT e2.id
              FROM geofence_event e2
              JOIN geofence g2
                ON g2.name = e2.zone_name
              WHERE e2.mapon_unit_id = e_out.mapon_unit_id
                AND e2.event_time > e_out.event_time
                AND e2.direction = 'IN'
                AND g2.zone_type = 'origen'
              ORDER BY e2.event_time ASC
              LIMIT 1
            )
          WHERE g_out.zone_type = 'destino'
            AND e_out.direction = 'OUT'
            AND e_out.event_time BETWEEN ? AND ?
            AND p.fleet_id = ?
        ) d

        GROUP BY d.idplate, d.placa
        ORDER BY d.placa ASC
        `,
        [fromUTC, toUTC, fleetId]
      );

      return res.json({ ok: true, plates: rows });
    }
        // ✅ GEOFENCE (resumen por placa y día)
    if (reportType === "geofence") {
      const { fromUTC, toUTC } = limaDayToUtcRange(desde, hasta);

      const [rows] = await pool.query(
        `
        SELECT
          x.idplate,
          x.placa,
          DATE_SUB(x.fecha_dia, INTERVAL 5 HOUR) AS fecha_dia,

          DATE_SUB(MIN(x.hora_entrada), INTERVAL 5 HOUR) AS hora_entrada,
          DATE_SUB(MAX(x.hora_salida), INTERVAL 5 HOUR) AS hora_salida,

          SEC_TO_TIME(SUM(x.duracion_sec)) AS duracion,
          SEC_TO_TIME(SUM(x.estacionado_sec)) AS duracion_estacionamiento,

          CONCAT(ROUND(SUM(x.kilometraje_km), 0), ' km') AS kilometraje,
          COUNT(*) AS visitas,

          CONCAT(
            ROUND(
              CASE
                WHEN SUM(x.duracion_sec) > 0
                THEN SUM(x.vel_media_num * x.duracion_sec) / SUM(x.duracion_sec)
                ELSE 0
              END,
              0
            ),
            ' km/h'
          ) AS velocidad_media,

          CONCAT(ROUND(MAX(x.vel_max_num), 0), ' km/h') AS velocidad_maxima

        FROM (
          SELECT
            p.idplate,
            p.label AS placa,
            e_in.mapon_unit_id,
            DATE(e_in.event_time) AS fecha_dia,

            e_in.zone_name AS geocerca,
            e_in.event_time AS hora_entrada,
            e_out.event_time AS hora_salida,

            TIMESTAMPDIFF(SECOND, e_in.event_time, e_out.event_time) AS duracion_sec,

            GREATEST(
              TIMESTAMPDIFF(SECOND, e_in.event_time, e_out.event_time)
              -
              COALESCE((
                SELECT SUM(TIMESTAMPDIFF(SECOND, r.start_time, r.end_time))
                FROM mapon_route r
                WHERE r.mapon_unit_id = e_in.mapon_unit_id
                  AND r.start_time >= e_in.event_time
                  AND r.end_time <= e_out.event_time
              ), 0),
              0
            ) AS estacionado_sec,

            CASE
              WHEN e_in.mileage_km IS NOT NULL AND e_out.mileage_km IS NOT NULL
              THEN GREATEST(e_out.mileage_km - e_in.mileage_km, 0)
              ELSE 0
            END AS kilometraje_km,

            COALESCE((
              SELECT
                CASE
                  WHEN SUM(TIMESTAMPDIFF(SECOND, r.start_time, r.end_time)) > 0
                  THEN (SUM(r.distance_m) / SUM(TIMESTAMPDIFF(SECOND, r.start_time, r.end_time))) * 3.6
                  ELSE 0
                END
              FROM mapon_route r
              WHERE r.mapon_unit_id = e_in.mapon_unit_id
                AND r.start_time >= e_in.event_time
                AND r.end_time <= e_out.event_time
            ), 0) AS vel_media_num,

            COALESCE((
              SELECT MAX(r.max_speed)
              FROM mapon_route r
              WHERE r.mapon_unit_id = e_in.mapon_unit_id
                AND r.start_time >= e_in.event_time
                AND r.end_time <= e_out.event_time
            ), 0) AS vel_max_num

          FROM geofence_event e_in
          JOIN plate p
            ON p.id_plate_platform = e_in.mapon_unit_id
          JOIN geofence_event e_out
            ON e_out.id = (
              SELECT e2.id
              FROM geofence_event e2
              WHERE e2.mapon_unit_id = e_in.mapon_unit_id
                AND e2.zone_name = e_in.zone_name
                AND e2.direction = 'OUT'
                AND e2.event_time > e_in.event_time
              ORDER BY e2.event_time ASC
              LIMIT 1
            )
          WHERE e_in.direction = 'IN'
            AND e_in.event_time BETWEEN ? AND ?
            AND e_out.event_time BETWEEN ? AND ?
            AND p.fleet_id = ?
        ) x

        GROUP BY x.idplate, x.placa, x.fecha_dia
        ORDER BY x.placa ASC, x.fecha_dia ASC
        `,
        [fromUTC, toUTC, fromUTC, toUTC, fleetId]
      );

      return res.json({ ok: true, plates: rows });
    }
    // ✅ EVENTS
    const fromDT = `${desde} 00:00:00`;
    const toDT = `${hasta} 23:59:59`;
    const { whereSql, params } = buildReportFilter(reportType);

    const [rows] = await pool.query(
      `
      SELECT
        p.idplate,
        p.label AS placa,
        COUNT(*) AS cantidad,
        MIN(e.event_time) AS first_time,
        MAX(e.event_time) AS last_time
      FROM event e
      JOIN plate p ON p.idplate = e.plate_id
      WHERE p.fleet_id = ?
        AND e.event_time BETWEEN ? AND ?
        ${whereSql}
      GROUP BY p.idplate, p.label
      ORDER BY cantidad DESC, last_time DESC
      `,
      [fleetId, fromDT, toDT, ...params]
    );

    return res.json({ ok: true, plates: rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// GET /api/report/plate-events
router.get("/plate-events", async (req, res) => {
  try {
    const plateId = Number(req.query.plate_id);
    const desde = req.query.desde;
    const hasta = req.query.hasta;
    const reportType = req.query.report_type || "speed";

    if (!plateId || !desde || !hasta) {
      return res.status(400).json({ ok: false, error: "Faltan parámetros" });
    }

    // ✅ PARKING detalle
    if (reportType === "parking") {
      const { fromUTC, toUTC } = limaDayToUtcRange(desde, hasta);

      const [rows] = await pool.query(
        `
        SELECT
          DATE_SUB(pk.start_time, INTERVAL 5 HOUR) AS comienzo,
          DATE_SUB(pk.end_time,   INTERVAL 5 HOUR) AS fin,

          SEC_TO_TIME(pk.duration_sec) AS duracion,

          SEC_TO_TIME(
            TIMESTAMPDIFF(SECOND, MIN(pk.start_time) OVER (), pk.end_time)
          ) AS tiempo_total,

          SEC_TO_TIME(
            GREATEST(
              0,
              IFNULL(
                TIMESTAMPDIFF(
                  SECOND,
                  LAG(pk.end_time) OVER (ORDER BY pk.start_time),
                  pk.start_time
                ),
                0
              )
            )
          ) AS tiempo_entre,

          pk.address AS ubicacion,
          CONCAT(pk.lat, ',', pk.lng) AS coordenadas

        FROM parking pk
        WHERE pk.plate_id = ?
          AND pk.start_time >= ?
          AND pk.end_time   <= ?
        ORDER BY pk.start_time ASC
        `,
        [plateId, fromUTC, toUTC]
      );

      return res.json({ ok: true, events: rows });
    }

    // ✅ ENGINE HOURS detalle
    if (reportType === "engine_hours") {
      const { fromUTC, toUTC } = limaDayToUtcRange(desde, hasta);

      const [rows] = await pool.query(
        `
        SELECT
          DATE_SUB(mr.start_time, INTERVAL 5 HOUR) AS comienzo,
          mr.start_address AS ubicacion_inicial,

          DATE_SUB(mr.end_time, INTERVAL 5 HOUR) AS fin,
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
        JOIN plate p
          ON p.id_plate_platform = mr.mapon_unit_id
        WHERE p.idplate = ?
          AND mr.end_time >= ?
          AND mr.end_time <= ?
        ORDER BY mr.end_time DESC
        `,
        [plateId, fromUTC, toUTC]
      );

      return res.json({ ok: true, events: rows });
    }
        // ✅ UP TIME detalle
    if (reportType === "up_time") {
      const { fromUTC, toUTC } = limaDayToUtcRange(desde, hasta);

      const [rows] = await pool.query(
        `
        SELECT
          CONCAT(e_out.zone_name, ' - ', e_in.zone_name) AS viaje,
          e_out.zone_name AS viaje_desde,
          e_in.zone_name AS viaje_hasta,

          DATE_SUB(e_out.event_time, INTERVAL 5 HOUR) AS comienzo,
          DATE_SUB(e_in.event_time, INTERVAL 5 HOUR) AS fin,

          CONCAT(
            CASE
              WHEN e_out.mileage_km IS NOT NULL AND e_in.mileage_km IS NOT NULL
              THEN ROUND(GREATEST(e_in.mileage_km - e_out.mileage_km, 0), 0)
              ELSE 0
            END,
            ' km'
          ) AS kilometraje,

          SEC_TO_TIME(TIMESTAMPDIFF(SECOND, e_out.event_time, e_in.event_time)) AS duracion_viaje,
          SEC_TO_TIME(TIMESTAMPDIFF(SECOND, e_out.event_time, e_in.event_time)) AS tiempo_total,

          '00:00:00' AS tiempo_detenido,

          CONCAT(
            ROUND(
              COALESCE((
                SELECT
                  CASE
                    WHEN SUM(TIMESTAMPDIFF(SECOND, r.start_time, r.end_time)) > 0
                    THEN (SUM(r.distance_m) / SUM(TIMESTAMPDIFF(SECOND, r.start_time, r.end_time))) * 3.6
                    ELSE 0
                  END
                FROM mapon_route r
                WHERE r.mapon_unit_id = e_out.mapon_unit_id
                  AND r.start_time >= e_out.event_time
                  AND r.end_time <= e_in.event_time
              ), 0),
              0
            ),
            ' km/h'
          ) AS velocidad_media,

          CONCAT(
            ROUND(
              COALESCE((
                SELECT MAX(r.max_speed)
                FROM mapon_route r
                WHERE r.mapon_unit_id = e_out.mapon_unit_id
                  AND r.start_time >= e_out.event_time
                  AND r.end_time <= e_in.event_time
              ), 0),
              0
            ),
            ' km/h'
          ) AS velocidad_maxima

        FROM geofence_event e_out
        JOIN geofence g_out
          ON g_out.name = e_out.zone_name
        JOIN plate p
          ON p.id_plate_platform = e_out.mapon_unit_id
        JOIN geofence_event e_in
          ON e_in.id = (
            SELECT e2.id
            FROM geofence_event e2
            JOIN geofence g2
              ON g2.name = e2.zone_name
            WHERE e2.mapon_unit_id = e_out.mapon_unit_id
              AND e2.event_time > e_out.event_time
              AND e2.direction = 'IN'
              AND g2.zone_type = 'destino'
            ORDER BY e2.event_time ASC
            LIMIT 1
          )
        WHERE g_out.zone_type = 'origen'
          AND e_out.direction = 'OUT'
          AND e_out.event_time BETWEEN ? AND ?
          AND p.idplate = ?
        ORDER BY e_out.event_time ASC
        `,
        [fromUTC, toUTC, plateId]
      );

      return res.json({ ok: true, events: rows });
    }

    // ✅ DOWN TIME detalle
    if (reportType === "down_time") {
      const { fromUTC, toUTC } = limaDayToUtcRange(desde, hasta);

      const [rows] = await pool.query(
        `
        SELECT
          CONCAT(e_out.zone_name, ' - ', e_in.zone_name) AS viaje,
          e_out.zone_name AS viaje_desde,
          e_in.zone_name AS viaje_hasta,

          DATE_SUB(e_out.event_time, INTERVAL 5 HOUR) AS comienzo,
          DATE_SUB(e_in.event_time, INTERVAL 5 HOUR) AS fin,

          CONCAT(
            CASE
              WHEN e_out.mileage_km IS NOT NULL AND e_in.mileage_km IS NOT NULL
              THEN ROUND(GREATEST(e_in.mileage_km - e_out.mileage_km, 0), 0)
              ELSE 0
            END,
            ' km'
          ) AS kilometraje,

          SEC_TO_TIME(TIMESTAMPDIFF(SECOND, e_out.event_time, e_in.event_time)) AS duracion_viaje,
          SEC_TO_TIME(TIMESTAMPDIFF(SECOND, e_out.event_time, e_in.event_time)) AS tiempo_total,

          '00:00:00' AS tiempo_detenido,

          CONCAT(
            ROUND(
              COALESCE((
                SELECT
                  CASE
                    WHEN SUM(TIMESTAMPDIFF(SECOND, r.start_time, r.end_time)) > 0
                    THEN (SUM(r.distance_m) / SUM(TIMESTAMPDIFF(SECOND, r.start_time, r.end_time))) * 3.6
                    ELSE 0
                  END
                FROM mapon_route r
                WHERE r.mapon_unit_id = e_out.mapon_unit_id
                  AND r.start_time >= e_out.event_time
                  AND r.end_time <= e_in.event_time
              ), 0),
              0
            ),
            ' km/h'
          ) AS velocidad_media,

          CONCAT(
            ROUND(
              COALESCE((
                SELECT MAX(r.max_speed)
                FROM mapon_route r
                WHERE r.mapon_unit_id = e_out.mapon_unit_id
                  AND r.start_time >= e_out.event_time
                  AND r.end_time <= e_in.event_time
              ), 0),
              0
            ),
            ' km/h'
          ) AS velocidad_maxima

        FROM geofence_event e_out
        JOIN geofence g_out
          ON g_out.name = e_out.zone_name
        JOIN plate p
          ON p.id_plate_platform = e_out.mapon_unit_id
        JOIN geofence_event e_in
          ON e_in.id = (
            SELECT e2.id
            FROM geofence_event e2
            JOIN geofence g2
              ON g2.name = e2.zone_name
            WHERE e2.mapon_unit_id = e_out.mapon_unit_id
              AND e2.event_time > e_out.event_time
              AND e2.direction = 'IN'
              AND g2.zone_type = 'origen'
            ORDER BY e2.event_time ASC
            LIMIT 1
          )
        WHERE g_out.zone_type = 'destino'
          AND e_out.direction = 'OUT'
          AND e_out.event_time BETWEEN ? AND ?
          AND p.idplate = ?
        ORDER BY e_out.event_time ASC
        `,
        [fromUTC, toUTC, plateId]
      );

      return res.json({ ok: true, events: rows });
    }

        // ✅ GEOFENCE detalle
    if (reportType === "geofence") {
      const { fromUTC, toUTC } = limaDayToUtcRange(desde, hasta);

      const [rows] = await pool.query(
        `
        SELECT
          e_in.zone_name AS geocerca,
          DATE_SUB(e_in.event_time, INTERVAL 5 HOUR) AS hora_entrada,
          DATE_SUB(e_out.event_time, INTERVAL 5 HOUR) AS hora_salida,

          SEC_TO_TIME(TIMESTAMPDIFF(SECOND, e_in.event_time, e_out.event_time)) AS duracion,

          SEC_TO_TIME(
            GREATEST(
              TIMESTAMPDIFF(SECOND, e_in.event_time, e_out.event_time)
              -
              COALESCE((
                SELECT SUM(TIMESTAMPDIFF(SECOND, r.start_time, r.end_time))
                FROM mapon_route r
                WHERE r.mapon_unit_id = e_in.mapon_unit_id
                  AND r.start_time >= e_in.event_time
                  AND r.end_time <= e_out.event_time
              ), 0),
              0
            )
          ) AS duracion_estacionamiento,

          CONCAT(
            CASE
              WHEN e_in.mileage_km IS NOT NULL AND e_out.mileage_km IS NOT NULL
              THEN ROUND(GREATEST(e_out.mileage_km - e_in.mileage_km, 0), 0)
              ELSE 0
            END,
            ' km'
          ) AS kilometraje,

          1 AS visitas,

          CONCAT(
            ROUND(
              COALESCE((
                SELECT
                  CASE
                    WHEN SUM(TIMESTAMPDIFF(SECOND, r.start_time, r.end_time)) > 0
                    THEN (SUM(r.distance_m) / SUM(TIMESTAMPDIFF(SECOND, r.start_time, r.end_time))) * 3.6
                    ELSE 0
                  END
                FROM mapon_route r
                WHERE r.mapon_unit_id = e_in.mapon_unit_id
                  AND r.start_time >= e_in.event_time
                  AND r.end_time <= e_out.event_time
              ), 0),
              0
            ),
            ' km/h'
          ) AS velocidad_media,

          CONCAT(
            ROUND(
              COALESCE((
                SELECT MAX(r.max_speed)
                FROM mapon_route r
                WHERE r.mapon_unit_id = e_in.mapon_unit_id
                  AND r.start_time >= e_in.event_time
                  AND r.end_time <= e_out.event_time
              ), 0),
              0
            ),
            ' km/h'
          ) AS velocidad_maxima

        FROM geofence_event e_in
        JOIN plate p
          ON p.id_plate_platform = e_in.mapon_unit_id
        JOIN geofence_event e_out
          ON e_out.id = (
            SELECT e2.id
            FROM geofence_event e2
            WHERE e2.mapon_unit_id = e_in.mapon_unit_id
              AND e2.zone_name = e_in.zone_name
              AND e2.direction = 'OUT'
              AND e2.event_time > e_in.event_time
            ORDER BY e2.event_time ASC
            LIMIT 1
          )
        WHERE e_in.direction = 'IN'
          AND e_in.event_time BETWEEN ? AND ?
          AND e_out.event_time BETWEEN ? AND ?
          AND p.idplate = ?
        ORDER BY e_in.event_time ASC
        `,
        [fromUTC, toUTC, fromUTC, toUTC, plateId]
      );

      return res.json({ ok: true, events: rows });
    }

    // ✅ EVENTS (NO TOCAR)
    const fromDT = `${desde} 00:00:00`;
    const toDT = `${hasta} 23:59:59`;
    const { whereSql, params } = buildReportFilter(reportType);

    const [rows] = await pool.query(
      `
      SELECT
        e.event_time,
        e.code_event,
        e.speed,
        e.location,
        et.event_type_name AS evento
      FROM event e
      JOIN event_type et ON et.code_event = e.code_event
      WHERE e.plate_id = ?
        AND e.event_time BETWEEN ? AND ?
        ${whereSql}
      ORDER BY e.event_time ASC
      `,
      [plateId, fromDT, toDT, ...params]
    );

    return res.json({ ok: true, events: rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

module.exports = router;