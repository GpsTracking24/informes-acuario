const express = require("express");
const ExcelJS = require("exceljs");
const { chromium } = require("playwright");

const router = express.Router();

const REPORT_ORDER = [
  "speed",
  "geofence",
  "parking",
  "engine_hours",
  "up_time",
  "down_time",
];

const REPORT_META = {
  speed: {
    title: "EXCESOS DE VELOCIDAD",
    shortName: "EXCESOS DE VELOCIDAD",
    hasDetail: true,
  },
  geofence: {
    title: "GEOCERCAS",
    shortName: "GEOCERCAS",
    hasDetail: true,
  },
  parking: {
    title: "ESTACIONAMIENTOS",
    shortName: "ESTACIONAMIENTOS",
    hasDetail: true,
  },
  engine_hours: {
    title: "HORAS DE MOTOR",
    shortName: "HORAS DE MOTOR",
    hasDetail: false,
  },
  up_time: {
    title: "TIEMPO DE SUBIDA",
    shortName: "TIEMPO DE SUBIDA",
    hasDetail: true,
  },
  down_time: {
    title: "TIEMPO DE BAJADA",
    shortName: "TIEMPO DE BAJADA",
    hasDetail: true,
  },
};

function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtDT(v) {
  if (!v) return "";
  return String(v).replace("T", " ").replace(".000Z", "");
}

function hhmmssToSec(v) {
  if (!v) return 0;
  const parts = String(v).trim().split(":").map(Number);
  if (parts.length !== 3) return 0;
  const [h, m, s] = parts;
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
}

function secToDiasHMS(sec) {
  sec = Math.max(0, Math.floor(sec));

  const dias = Math.floor(sec / 86400);
  const horas = Math.floor((sec % 86400) / 3600);
  const minutos = Math.floor((sec % 3600) / 60);
  const segundos = sec % 60;

  const h = String(horas).padStart(2, "0");
  const m = String(minutos).padStart(2, "0");
  const s = String(segundos).padStart(2, "0");

  if (dias === 0) return `${h}:${m}:${s}`;

  const label = dias === 1 ? "día" : "días";
  return `${dias} ${label} ${h}:${m}:${s}`;
}

function parseKmValue(v) {
  const n = parseFloat(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseSpeedValue(v) {
  const n = parseFloat(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function sheetNameSafe(name) {
  return String(name).slice(0, 31);
}

async function fetchJson(url) {
  const resp = await fetch(url);
  let data = null;

  try {
    data = await resp.json();
  } catch {
    throw new Error(`Respuesta inválida desde ${url}`);
  }

  if (!resp.ok || !data?.ok) {
    throw new Error(data?.error || `Error consultando ${url}`);
  }

  return data;
}

function buildBaseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

async function getFleetName(baseUrl, fleetId) {
  const data = await fetchJson(`${baseUrl}/api/fleets`);
  const fleet = Array.isArray(data.fleets)
    ? data.fleets.find((f) => Number(f.idfleet) === Number(fleetId))
    : null;

  return fleet?.fleet_name || `Flota ${fleetId}`;
}

async function getReportSummary(baseUrl, reportType, fleetId, desde, hasta) {
  const url =
    `${baseUrl}/api/report/plates` +
    `?report_type=${encodeURIComponent(reportType)}` +
    `&fleet_id=${encodeURIComponent(fleetId)}` +
    `&desde=${encodeURIComponent(desde)}` +
    `&hasta=${encodeURIComponent(hasta)}`;

  const data = await fetchJson(url);
  return Array.isArray(data.plates) ? data.plates : [];
}

async function getReportDetail(baseUrl, reportType, plateId, desde, hasta) {
  const url =
    `${baseUrl}/api/report/plate-events` +
    `?report_type=${encodeURIComponent(reportType)}` +
    `&plate_id=${encodeURIComponent(plateId)}` +
    `&desde=${encodeURIComponent(desde)}` +
    `&hasta=${encodeURIComponent(hasta)}`;

  const data = await fetchJson(url);
  return Array.isArray(data.events) ? data.events : [];
}

async function getSingleReportData(baseUrl, reportType, fleetId, desde, hasta) {
  const meta = REPORT_META[reportType];
  if (!meta) throw new Error(`Tipo de reporte no soportado: ${reportType}`);

  const summary = await getReportSummary(baseUrl, reportType, fleetId, desde, hasta);

  let detail = [];

  if (meta.hasDetail && summary.length) {
    const chunks = [];

    for (const row of summary) {
      const plateId = row.idplate;
      if (!plateId) continue;

      const events = await getReportDetail(baseUrl, reportType, plateId, desde, hasta);

      const normalized = (events || []).map((ev) => ({
        ...ev,
        idplate: ev.idplate ?? row.idplate,
        placa: ev.placa ?? row.placa,
      }));

      chunks.push(...normalized);
    }

    detail = chunks;
  }

  const hasData =
    (Array.isArray(summary) && summary.length > 0) ||
    (Array.isArray(detail) && detail.length > 0);

  return {
    type: reportType,
    title: meta.title,
    shortName: meta.shortName,
    summary,
    detail,
    hasData,
  };
}

async function getAllReportsData(baseUrl, fleetId, desde, hasta) {
  const all = [];

  for (const type of REPORT_ORDER) {
    const report = await getSingleReportData(baseUrl, type, fleetId, desde, hasta);
    if (report.hasData) all.push(report);
  }

  return all;
}

/* -------------------- TABLAS PDF/EXCEL -------------------- */

function getSummaryTableSpec(reportType) {
  switch (reportType) {
    case "speed":
      return {
        columns: ["PLACA", "CANTIDAD", "PRIMER EVENTO", "ÚLTIMO EVENTO"],
        rows: (rows) =>
          rows.map((r) => [
            r.placa || "",
            Number(r.cantidad || 0),
            fmtDT(r.first_time),
            fmtDT(r.last_time),
          ]),
      };

    case "parking":
      return {
        columns: [
          "PLACA",
          "COMIENZO",
          "FIN",
          "DURACIÓN",
          "TIEMPO TOTAL",
          "UBICACIÓN",
          "TIEMPO ENTRE",
          "COORDENADAS",
        ],
        rows: (rows) =>
          rows.map((r) => [
            r.placa || "",
            fmtDT(r.comienzo),
            fmtDT(r.fin),
            r.duracion || "",
            r.tiempo_total || "",
            r.ubicacion || "",
            r.tiempo_entre || "",
            r.coordenadas || "",
          ]),
      };

    case "geofence":
      return {
        columns: [
          "AGRUPACIÓN",
          "GEOCERCA",
          "HORA ENTRADA",
          "HORA SALIDA",
          "DURACIÓN",
          "DURACIÓN ESTACIONAMIENTO",
          "KILOMETRAJE",
          "VISITAS",
          "VELOCIDAD MEDIA",
          "VELOCIDAD MÁXIMA",
        ],
        rows: (rows) =>
          rows.map((r) => [
            r.placa || "",
            "-----",
            fmtDT(r.hora_entrada),
            fmtDT(r.hora_salida),
            r.duracion || "00:00:00",
            r.duracion_estacionamiento || "00:00:00",
            r.kilometraje || "0 km",
            r.visitas || 0,
            r.velocidad_media || "0 km/h",
            r.velocidad_maxima || "0 km/h",
          ]),
      };

    case "engine_hours":
      return {
        columns: [
          "PLACA",
          "COMIENZO",
          "UBICACIÓN INICIAL",
          "FIN",
          "UBICACIÓN FINAL",
          "HORAS MOTOR INICIO",
          "HORAS MOTOR FIN",
          "HORAS MOTOR",
          "TIEMPO TOTAL",
          "KILOMETRAJE",
          "KILOMETRAJE INICIAL",
          "KILOMETRAJE FINAL",
          "EN MOVIMIENTO",
          "RALENTÍ",
          "TIEMPO ENTRE",
          "VELOCIDAD MEDIA",
          "VELOCIDAD MÁXIMA",
        ],
        rows: (rows) =>
          rows.map((r) => [
            r.placa || "",
            fmtDT(r.comienzo),
            r.ubicacion_inicial || "",
            fmtDT(r.fin),
            r.ubicacion_final || "",
            r.horas_motor_inicio || "00:00:00",
            r.horas_motor_fin || "00:00:00",
            r.horas_motor || "00:00:00",
            r.tiempo_total || "00:00:00",
            r.kilometraje || "N/D",
            r.kilometraje_inicial || "N/D",
            r.kilometraje_final || "N/D",
            r.en_movimiento || "00:00:00",
            r.ralenti || "00:00:00",
            r.tiempo_entre || "00:00:00",
            r.velocidad_media || "0 km/h",
            r.velocidad_maxima || "0 km/h",
          ]),
      };

    case "up_time":
    case "down_time":
      return {
        columns: [
          "PLACA",
          "VIAJE",
          "VIAJE DESDE",
          "VIAJE HASTA",
          "COMIENZO",
          "FIN",
          "KILOMETRAJE",
          "DURACIÓN DEL VIAJE",
          "TIEMPO TOTAL",
          "TIEMPO DETENIDO",
          "VELOCIDAD MEDIA",
          "VELOCIDAD MÁXIMA",
        ],
        rows: (rows) =>
          rows.map((r) => [
            r.placa || "",
            r.viaje || "-----",
            r.viaje_desde || "-----",
            r.viaje_hasta || "-----",
            fmtDT(r.comienzo),
            fmtDT(r.fin),
            r.kilometraje || "0 km",
            r.duracion_viaje || "00:00:00",
            r.tiempo_total || "00:00:00",
            r.tiempo_detenido || "00:00:00",
            r.velocidad_media || "0 km/h",
            r.velocidad_maxima || "0 km/h",
          ]),
      };

    default:
      return {
        columns: ["SIN DATOS"],
        rows: () => [],
      };
  }
}

function buildSpeedDetailText(ev) {
  const fecha = fmtDT(ev.event_time);
  return `GENERÓ UN ${ev.evento || "EVENTO"}, VELOCIDAD = ${ev.speed ?? 0} km/h, FECHA: ${fecha}`;
}

function getDetailTableSpec(reportType) {
  switch (reportType) {
    case "speed":
      return {
        columns: ["PLACA", "FECHA Y HORA", "TEXTO DEL EVENTO", "LOCALIZACIÓN", "CANTIDAD"],
        rows: (rows) =>
          rows.map((r) => [
            r.placa || "",
            fmtDT(r.event_time),
            buildSpeedDetailText(r),
            r.location || "",
            1,
          ]),
      };

    case "parking":
      return {
        columns: [
          "PLACA",
          "COMIENZO",
          "FIN",
          "DURACIÓN",
          "TIEMPO TOTAL",
          "UBICACIÓN",
          "TIEMPO ENTRE",
          "COORDENADAS",
        ],
        rows: (rows) =>
          rows.map((r) => [
            r.placa || "",
            fmtDT(r.comienzo),
            fmtDT(r.fin),
            r.duracion || "",
            r.tiempo_total || "",
            r.ubicacion || "",
            r.tiempo_entre || "",
            r.coordenadas || "",
          ]),
      };

    case "geofence":
      return {
        columns: [
          "PLACA",
          "GEOCERCA",
          "HORA ENTRADA",
          "HORA SALIDA",
          "DURACIÓN",
          "DURACIÓN ESTACIONAMIENTO",
          "KILOMETRAJE",
          "VISITAS",
          "VELOCIDAD MEDIA",
          "VELOCIDAD MÁXIMA",
        ],
        rows: (rows) =>
          rows.map((r) => [
            r.placa || "",
            r.geocerca || "",
            fmtDT(r.hora_entrada),
            fmtDT(r.hora_salida),
            r.duracion || "00:00:00",
            r.duracion_estacionamiento || "00:00:00",
            r.kilometraje || "0 km",
            r.visitas || 1,
            r.velocidad_media || "0 km/h",
            r.velocidad_maxima || "0 km/h",
          ]),
      };

    case "engine_hours":
      return {
        columns: [
          "PLACA",
          "COMIENZO",
          "UBICACIÓN INICIAL",
          "FIN",
          "UBICACIÓN FINAL",
          "HORAS MOTOR INICIO",
          "HORAS MOTOR FIN",
          "HORAS MOTOR",
          "TIEMPO TOTAL",
          "KILOMETRAJE",
          "KILOMETRAJE INICIAL",
          "KILOMETRAJE FINAL",
          "EN MOVIMIENTO",
          "RALENTÍ",
          "TIEMPO ENTRE",
          "VELOCIDAD MEDIA",
          "VELOCIDAD MÁXIMA",
        ],
        rows: (rows) =>
          rows.map((r) => [
            r.placa || "",
            fmtDT(r.comienzo),
            r.ubicacion_inicial || "",
            fmtDT(r.fin),
            r.ubicacion_final || "",
            r.horas_motor_inicio || "00:00:00",
            r.horas_motor_fin || "00:00:00",
            r.horas_motor || "00:00:00",
            r.tiempo_total || "00:00:00",
            r.kilometraje || "N/D",
            r.kilometraje_inicial || "N/D",
            r.kilometraje_final || "N/D",
            r.en_movimiento || "00:00:00",
            r.ralenti || "00:00:00",
            r.tiempo_entre || "00:00:00",
            r.velocidad_media || "0 km/h",
            r.velocidad_maxima || "0 km/h",
          ]),
      };

    case "up_time":
    case "down_time":
      return {
        columns: [
          "PLACA",
          "VIAJE",
          "VIAJE DESDE",
          "VIAJE HASTA",
          "COMIENZO",
          "FIN",
          "KILOMETRAJE",
          "DURACIÓN DEL VIAJE",
          "TIEMPO TOTAL",
          "TIEMPO DETENIDO",
          "VELOCIDAD MEDIA",
          "VELOCIDAD MÁXIMA",
        ],
        rows: (rows) =>
          rows.map((r) => [
            r.placa || "",
            r.viaje || "",
            r.viaje_desde || "",
            r.viaje_hasta || "",
            fmtDT(r.comienzo),
            fmtDT(r.fin),
            r.kilometraje || "0 km",
            r.duracion_viaje || "00:00:00",
            r.tiempo_total || "00:00:00",
            r.tiempo_detenido || "00:00:00",
            r.velocidad_media || "0 km/h",
            r.velocidad_maxima || "0 km/h",
          ]),
      };

    default:
      return {
        columns: ["SIN DATOS"],
        rows: () => [],
      };
  }
}

/* -------------------- PDF BUILDERS -------------------- */

function buildHtmlTable(columns, rows) {
  return `
    <table>
      <thead>
        <tr>
          ${columns.map((c) => `<th>${esc(c)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${rows.length
          ? rows
              .map(
                (row) => `
          <tr>
            ${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}
          </tr>
        `
              )
              .join("")
          : `
          <tr>
            <td colspan="${columns.length}" class="empty-note">Sin datos.</td>
          </tr>
        `}
      </tbody>
    </table>
  `;
}

function buildReportSectionHtml(report, index) {
  const table = buildUnifiedRowsForReport(report);

  return `
    <section class="report-section ${index > 0 ? "page-break" : ""}">
      <div class="report-title">${esc(report.title)}</div>

      <table>
        <thead>
          <tr>
            ${table.columns.map((c) => `<th>${esc(c)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${
            table.rows.length
              ? table.rows.map((row) => `
                <tr class="${
  row.kind === "summary"
    ? "summary-row"
    : row.kind === "total"
    ? "total-row"
    : "detail-row"
}">
                  ${row.cells.map((cell) => `<td>${esc(cell)}</td>`).join("")}
                </tr>
              `).join("")
              : `
                <tr>
                  <td colspan="${table.columns.length}" class="empty-note">Sin datos.</td>
                </tr>
              `
          }
        </tbody>
      </table>
    </section>
  `;
}

function groupDetailsByPlate(detailRows) {
  const map = new Map();

  for (const row of detailRows || []) {
    const key = row.placa || row.label || row.idplate;
    if (!key) continue;

    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }

  return map;
}

function buildTotalRow(reportType, summaryRows) {
  if (!Array.isArray(summaryRows) || !summaryRows.length) return null;

  if (reportType === "parking") {
    const totalDurSec = summaryRows.reduce((acc, r) => acc + hhmmssToSec(r.duracion), 0);
    const totalTiempoTotalSec = summaryRows.reduce((acc, r) => acc + hhmmssToSec(r.tiempo_total), 0);
    const totalEntreSec = summaryRows.reduce((acc, r) => acc + hhmmssToSec(r.tiempo_entre), 0);

    return {
      kind: "total",
      cells: [
        "TOTAL",
        "",
        "",
        secToDiasHMS(totalDurSec),
        secToDiasHMS(totalTiempoTotalSec),
        "",
        secToDiasHMS(totalEntreSec),
        "",
      ],
    };
  }

  if (reportType === "geofence") {
    const totalKm = summaryRows.reduce((acc, r) => acc + parseKmValue(r.kilometraje), 0);
    const totalVisitas = summaryRows.reduce((acc, r) => acc + Number(r.visitas || 0), 0);
    const totalDurSec = summaryRows.reduce((acc, r) => acc + hhmmssToSec(r.duracion), 0);
    const totalEstSec = summaryRows.reduce((acc, r) => acc + hhmmssToSec(r.duracion_estacionamiento), 0);

    const totalVelMax = summaryRows.reduce((max, r) => {
      return Math.max(max, parseSpeedValue(r.velocidad_maxima));
    }, 0);

    let totalSec = 0;
    let weightedSum = 0;

    for (const r of summaryRows) {
      const sec = hhmmssToSec(r.duracion);
      const vel = parseSpeedValue(r.velocidad_media);
      if (sec > 0) {
        totalSec += sec;
        weightedSum += vel * sec;
      }
    }

    const totalVelMedia = totalSec > 0 ? Math.round(weightedSum / totalSec) : 0;

    return {
      kind: "total",
      cells: [
        "TOTAL",
        "",
        "",
        "",
        secToDiasHMS(totalDurSec),
        secToDiasHMS(totalEstSec),
        `${totalKm} km`,
        totalVisitas,
        `${totalVelMedia} km/h`,
        `${totalVelMax} km/h`,
      ],
    };
  }

  if (reportType === "up_time" || reportType === "down_time") {
    const totalKm = summaryRows.reduce((acc, r) => acc + parseKmValue(r.kilometraje), 0);
    const totalDuracionSec = summaryRows.reduce((acc, r) => acc + hhmmssToSec(r.duracion_viaje), 0);
    const totalTiempoTotalSec = summaryRows.reduce((acc, r) => acc + hhmmssToSec(r.tiempo_total), 0);
    const totalDetenidoSec = summaryRows.reduce((acc, r) => acc + hhmmssToSec(r.tiempo_detenido), 0);

    const totalVelMax = summaryRows.reduce((max, r) => {
      return Math.max(max, parseSpeedValue(r.velocidad_maxima));
    }, 0);

    let totalSec = 0;
    let weightedSum = 0;

    for (const r of summaryRows) {
      const sec = hhmmssToSec(r.duracion_viaje);
      const vel = parseSpeedValue(r.velocidad_media);
      if (sec > 0) {
        totalSec += sec;
        weightedSum += vel * sec;
      }
    }

    const totalVelMedia = totalSec > 0 ? Math.round(weightedSum / totalSec) : 0;

    return {
      kind: "total",
      cells: [
        "TOTAL",
        "",
        "",
        "",
        "",
        "",
        `${totalKm} km`,
        secToDiasHMS(totalDuracionSec),
        secToDiasHMS(totalTiempoTotalSec),
        secToDiasHMS(totalDetenidoSec),
        `${totalVelMedia} km/h`,
        `${totalVelMax} km/h`,
      ],
    };
  }

  return null;
}

function buildUnifiedRowsForReport(report) {
  if (report.type === "parking") {
    const detailByPlate = groupDetailsByPlate(report.detail);

    const rows = [];
    for (const r of report.summary || []) {
      rows.push({
        kind: "summary",
        cells: [
          r.placa || "",
          fmtDT(r.comienzo),
          fmtDT(r.fin),
          r.duracion || "",
          r.tiempo_total || "",
          r.ubicacion || "",
          r.tiempo_entre || "",
          r.coordenadas || "",
        ],
      });

      const details = detailByPlate.get(r.placa) || [];
      for (const d of details) {
        rows.push({
          kind: "detail",
          cells: [
            d.placa || r.placa || "",
            fmtDT(d.comienzo),
            fmtDT(d.fin),
            d.duracion || "",
            d.tiempo_total || "",
            d.ubicacion || "",
            d.tiempo_entre || "",
            d.coordenadas || "",
          ],
        });
      }
    }

        const totalRow = buildTotalRow(report.type, report.summary || []);
    if (totalRow) rows.push(totalRow);

    return {
      columns: [
        "PLACA",
        "COMIENZO",
        "FIN",
        "DURACIÓN",
        "TIEMPO TOTAL",
        "UBICACIÓN",
        "TIEMPO ENTRE",
        "COORDENADAS",
      ],
      rows,
    };
  }

  if (report.type === "speed") {
    const detailByPlate = groupDetailsByPlate(report.detail);

    const rows = [];
    for (const r of report.summary || []) {
      rows.push({
        kind: "summary",
        cells: [
          r.placa || "",
          fmtDT(r.first_time),
          "",
          "-----",
          Number(r.cantidad || 0),
        ],
      });

      const details = detailByPlate.get(r.placa) || [];
      for (const d of details) {
        rows.push({
          kind: "detail",
          cells: [
            d.placa || r.placa || "",
            fmtDT(d.event_time),
            buildSpeedDetailText(d),
            d.location || "",
            1,
          ],
        });
      }
    }

    return {
      columns: ["PLACA", "FECHA Y HORA", "TEXTO DEL EVENTO", "LOCALIZACIÓN", "CANTIDAD"],
      rows,
    };
  }

  if (report.type === "geofence") {
    const detailByPlate = groupDetailsByPlate(report.detail);

    const rows = [];
    for (const r of report.summary || []) {
      rows.push({
        kind: "summary",
        cells: [
          r.placa || "",
          "-----",
          fmtDT(r.hora_entrada),
          fmtDT(r.hora_salida),
          r.duracion || "00:00:00",
          r.duracion_estacionamiento || "00:00:00",
          r.kilometraje || "0 km",
          r.visitas || 0,
          r.velocidad_media || "0 km/h",
          r.velocidad_maxima || "0 km/h",
        ],
      });

      const details = detailByPlate.get(r.placa) || [];
      for (const d of details) {
        rows.push({
          kind: "detail",
          cells: [
            d.placa || r.placa || "",
            d.geocerca || "",
            fmtDT(d.hora_entrada),
            fmtDT(d.hora_salida),
            d.duracion || "00:00:00",
            d.duracion_estacionamiento || "00:00:00",
            d.kilometraje || "0 km",
            d.visitas || 1,
            d.velocidad_media || "0 km/h",
            d.velocidad_maxima || "0 km/h",
          ],
        });
      }
    }

        const totalRow = buildTotalRow(report.type, report.summary || []);
    if (totalRow) rows.push(totalRow);

    return {
      columns: [
        "AGRUPACIÓN",
        "GEOCERCA",
        "HORA ENTRADA",
        "HORA SALIDA",
        "DURACIÓN",
        "DURACIÓN ESTACIONAMIENTO",
        "KILOMETRAJE",
        "VISITAS",
        "VELOCIDAD MEDIA",
        "VELOCIDAD MÁXIMA",
      ],
      rows,
    };
  }

  if (report.type === "engine_hours") {
    const rows = (report.summary || []).map((r) => ({
      kind: "summary",
      cells: [
        r.placa || "",
        fmtDT(r.comienzo),
        r.ubicacion_inicial || "",
        fmtDT(r.fin),
        r.ubicacion_final || "",
        r.horas_motor_inicio || "00:00:00",
        r.horas_motor_fin || "00:00:00",
        r.horas_motor || "00:00:00",
        r.tiempo_total || "00:00:00",
        r.kilometraje || "N/D",
        r.kilometraje_inicial || "N/D",
        r.kilometraje_final || "N/D",
        r.en_movimiento || "00:00:00",
        r.ralenti || "00:00:00",
        r.tiempo_entre || "00:00:00",
        r.velocidad_media || "0 km/h",
        r.velocidad_maxima || "0 km/h",
      ],
    }));

    return {
      columns: [
        "PLACA",
        "COMIENZO",
        "UBICACIÓN INICIAL",
        "FIN",
        "UBICACIÓN FINAL",
        "HORAS MOTOR INICIO",
        "HORAS MOTOR FIN",
        "HORAS MOTOR",
        "TIEMPO TOTAL",
        "KILOMETRAJE",
        "KILOMETRAJE INICIAL",
        "KILOMETRAJE FINAL",
        "EN MOVIMIENTO",
        "RALENTÍ",
        "TIEMPO ENTRE",
        "VELOCIDAD MEDIA",
        "VELOCIDAD MÁXIMA",
      ],
      rows,
    };
  }

  if (report.type === "up_time" || report.type === "down_time") {
    const detailByPlate = groupDetailsByPlate(report.detail);

    const rows = [];
    for (const r of report.summary || []) {
      rows.push({
        kind: "summary",
        cells: [
          r.placa || "",
          r.viaje || "-----",
          r.viaje_desde || "-----",
          r.viaje_hasta || "-----",
          fmtDT(r.comienzo),
          fmtDT(r.fin),
          r.kilometraje || "0 km",
          r.duracion_viaje || "00:00:00",
          r.tiempo_total || "00:00:00",
          r.tiempo_detenido || "00:00:00",
          r.velocidad_media || "0 km/h",
          r.velocidad_maxima || "0 km/h",
        ],
      });

      const details = detailByPlate.get(r.placa) || [];
      for (const d of details) {
        rows.push({
          kind: "detail",
          cells: [
            d.placa || r.placa || "",
            d.viaje || "",
            d.viaje_desde || "",
            d.viaje_hasta || "",
            fmtDT(d.comienzo),
            fmtDT(d.fin),
            d.kilometraje || "0 km",
            d.duracion_viaje || "00:00:00",
            d.tiempo_total || "00:00:00",
            d.tiempo_detenido || "00:00:00",
            d.velocidad_media || "0 km/h",
            d.velocidad_maxima || "0 km/h",
          ],
        });
      }
    }

        const totalRow = buildTotalRow(report.type, report.summary || []);
    if (totalRow) rows.push(totalRow);

    return {
      columns: [
        "PLACA",
        "VIAJE",
        "VIAJE DESDE",
        "VIAJE HASTA",
        "COMIENZO",
        "FIN",
        "KILOMETRAJE",
        "DURACIÓN DEL VIAJE",
        "TIEMPO TOTAL",
        "TIEMPO DETENIDO",
        "VELOCIDAD MEDIA",
        "VELOCIDAD MÁXIMA",
      ],
      rows,
    };
  }

  return {
    columns: ["SIN DATOS"],
    rows: [],
  };
}

function buildUnifiedPdfHtml({ fleetName, desde, hasta, reports }) {
  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>
    @page {
      size: A4 landscape;
      margin: 14mm 8mm 16mm 8mm;
    }

    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #4a4a4a;
      font-size: 10px;
      margin: 0;
    }

    .main-title {
      text-align: center;
      font-size: 22px;
      font-weight: 700;
      margin-top: 2px;
      margin-bottom: 22px;
    }

    .report-section {
      width: 100%;
    }

    .page-break {
      page-break-before: always;
    }

    .report-title {
      text-align: center;
      font-size: 16px;
      font-weight: 700;
      text-transform: uppercase;
      margin-bottom: 14px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 10px;
      margin-bottom: 14px;
    }

    th, td {
      border: 1px solid #cfcfcf;
      padding: 6px 6px;
      vertical-align: top;
      word-wrap: break-word;
      overflow-wrap: anywhere;
    }

    th {
      background: #d9d9d9;
      text-align: center;
      font-weight: 700;
    }

    .summary-row td {
      background: #e9e9e9;
    }

    .detail-row td {
      background: #ffffff;
    }

    .empty-note {
      text-align: center;
      color: #777;
      padding: 12px 0;
    }

    .total-row td {
  background: #f0f0f0;
  font-weight: 700;
  border-top: 2px solid #9c9c9c;
}
  </style>
</head>
<body>
  <div class="main-title">ACUARIO GENERAL</div>

  ${reports.map((report, idx) => buildReportSectionHtml(report, idx)).join("")}
</body>
</html>
`;
}

/* -------------------- EXCEL HELPERS -------------------- */

function addReportSheetsToWorkbook(wb, report) {
  const table = buildUnifiedRowsForReport(report);

  const ws = wb.addWorksheet(sheetNameSafe(report.shortName));

  ws.properties.outlineProperties = {
    summaryBelow: true,
    summaryRight: false,
  };

  ws.addRow(table.columns);

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };

  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "D9D9D9" },
    };
    cell.border = {
      top: { style: "thin", color: { argb: "CFCFCF" } },
      left: { style: "thin", color: { argb: "CFCFCF" } },
      bottom: { style: "thin", color: { argb: "CFCFCF" } },
      right: { style: "thin", color: { argb: "CFCFCF" } },
    };
  });

  for (const row of table.rows || []) {
    const excelRow = ws.addRow(row.cells);

    excelRow.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "CFCFCF" } },
        left: { style: "thin", color: { argb: "CFCFCF" } },
        bottom: { style: "thin", color: { argb: "CFCFCF" } },
        right: { style: "thin", color: { argb: "CFCFCF" } },
      };
      cell.alignment = { vertical: "top", wrapText: true };
    });

    if (row.kind === "summary") {
      excelRow.font = { bold: true };

      excelRow.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "E9E9E9" },
        };
      });
    }

    if (row.kind === "detail") {
      excelRow.outlineLevel = 1;
      excelRow.hidden = true;
    }

    if (row.kind === "total") {
      excelRow.font = { bold: true };

      excelRow.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "F0F0F0" },
        };
        cell.border = {
          top: { style: "medium", color: { argb: "9C9C9C" } },
          left: { style: "thin", color: { argb: "CFCFCF" } },
          bottom: { style: "thin", color: { argb: "CFCFCF" } },
          right: { style: "thin", color: { argb: "CFCFCF" } },
        };
      });

      excelRow.hidden = false;
      excelRow.outlineLevel = 0;
    }
  }

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: table.columns.length },
  };

  ws.views = [{ state: "frozen", ySplit: 1 }];

  ws.columns = table.columns.map((col, idx) => {
    let maxLen = String(col).length;

    for (const row of table.rows || []) {
      const val = row.cells[idx] == null ? "" : String(row.cells[idx]);
      if (val.length > maxLen) maxLen = val.length;
    }

    return {
      width: Math.min(Math.max(maxLen + 2, 14), 38),
    };
  });
}

/* -------------------- PDF --------------------
   Si NO envías report_type:
   genera un PDF consolidado con todos los informes que tengan datos.
   Si envías report_type:
   genera PDF solo de ese informe.
*/
router.get("/pdf", async (req, res) => {
  try {
    const fleetId = Number(req.query.fleet_id);
    const { desde, hasta, report_type: reportType } = req.query;

    if (!fleetId || !desde || !hasta) {
      return res.status(400).json({
        ok: false,
        error: "Faltan parámetros: fleet_id, desde, hasta",
      });
    }

    const baseUrl = buildBaseUrl(req);
    const fleetName = await getFleetName(baseUrl, fleetId);

    let reports = [];

    if (reportType) {
      const one = await getSingleReportData(baseUrl, reportType, fleetId, desde, hasta);
      if (one.hasData) reports.push(one);
    } else {
      reports = await getAllReportsData(baseUrl, fleetId, desde, hasta);
    }

    if (!reports.length) {
      return res.status(404).json({
        ok: false,
        error: "El informe no tiene datos para exportar",
      });
    }

    const html = buildUnifiedPdfHtml({
      fleetName,
      desde,
      hasta,
      reports,
    });

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.setContent(html, { waitUntil: "load" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div></div>`,
      footerTemplate: `
        <div style="width:100%; font-size:10px; color:#666; text-align:center; padding:0 8mm;">
          Page <span class="pageNumber"></span> of <span class="totalPages"></span>
        </div>
      `,
      margin: {
        top: "12mm",
        right: "8mm",
        bottom: "14mm",
        left: "8mm",
      },
    });

    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="reporte_general_${fleetId}_${desde}_a_${hasta}.pdf"`
    );
    res.send(pdfBuffer);
  } catch (e) {
    console.error("pdf export error:", e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

/* -------------------- EXCEL --------------------
   Si envías report_type:
   exporta solo ese informe.
   Si NO envías report_type:
   exporta todos los informes con datos.
*/
router.get("/excel", async (req, res) => {
  try {
    const fleetId = Number(req.query.fleet_id);
    const { desde, hasta, report_type: reportType } = req.query;

    if (!fleetId || !desde || !hasta) {
      return res.status(400).json({
        ok: false,
        error: "Faltan parámetros: fleet_id, desde, hasta",
      });
    }

    const baseUrl = buildBaseUrl(req);

    let reports = [];

    if (reportType) {
      const one = await getSingleReportData(baseUrl, reportType, fleetId, desde, hasta);
      if (one.hasData) reports.push(one);
    } else {
      reports = await getAllReportsData(baseUrl, fleetId, desde, hasta);
    }

    if (!reports.length) {
      return res.status(404).json({
        ok: false,
        error: "El informe no tiene datos para exportar",
      });
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = "Acuario-Informes";

    reports.forEach((report) => addReportSheetsToWorkbook(wb, report));

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="reporte_general_${fleetId}_${desde}_a_${hasta}.xlsx"`
    );

    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error("excel export error:", e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

module.exports = router;