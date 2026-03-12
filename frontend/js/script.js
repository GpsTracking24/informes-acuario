// -------------------- API URLS --------------------
const API_REPORT_PLATES = "http://localhost:3002/api/report/plates";
const API_REPORT_EVENTS = "http://localhost:3002/api/report/plate-events";
const API_FLEETS = "http://localhost:3002/api/fleets";
const API_EXPORT_PDF = "http://localhost:3002/api/export/pdf";
const API_EXPORT_EXCEL = "http://localhost:3002/api/export/excel";

// -------------------- STATE --------------------
const state = {
  fleetId: "",
  desde: "",
  hasta: "",
  activeReport: "speed",
  loaded: false,
};

let rangePicker = null;

let selectedRange = {
  desde: "",
  hasta: ""
};

// -------------------- HELPERS --------------------
function todayLocalISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

function setHint(msg, isError = false) {
  const el = document.getElementById("hint");
  el.textContent = msg || "";
  el.className = "hint" + (isError ? " bad" : "");
  el.style.display = msg ? "block" : "none";
}

function showRangeInputs(show) {
  document
    .getElementById("rangePickerBox")
    .classList.toggle("hidden", !show);
}

function getDateRange() {
  const period = document.getElementById("period").value;
  const now = new Date();

  if (period === "hoy") {
    const d = todayLocalISO(now);
    return { desde: d, hasta: d };
  }

  if (period === "ayer") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    const s = todayLocalISO(d);
    return { desde: s, hasta: s };
  }

  if (period === "7dias") {
    const end = todayLocalISO(now);
    const startD = new Date(now);
    startD.setDate(startD.getDate() - 6);
    const start = todayLocalISO(startD);
    return { desde: start, hasta: end };
  }

  if (period === "mes") {
    const end = todayLocalISO(now);
    const start = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`;
    return { desde: start, hasta: end };
  }

  return {
    desde: selectedRange.desde,
    hasta: selectedRange.hasta
  };
}

function initRangePicker() {
  rangePicker = flatpickr("#dateRange", {
    mode: "range",
    dateFormat: "d.m.Y",
    locale: "es",

    onClose(selectedDates) {
      if (selectedDates.length === 2) {

        const desde = selectedDates[0];
        const hasta = selectedDates[1];

        selectedRange.desde =
          `${desde.getFullYear()}-${String(desde.getMonth()+1).padStart(2,"0")}-${String(desde.getDate()).padStart(2,"0")}`;

        selectedRange.hasta =
          `${hasta.getFullYear()}-${String(hasta.getMonth()+1).padStart(2,"0")}-${String(hasta.getDate()).padStart(2,"0")}`;

      } else {
        selectedRange.desde = "";
        selectedRange.hasta = "";
      }
    }
  });
}

async function loadFleets() {
  const sel = document.getElementById("fleet");
  const resp = await fetch(API_FLEETS);
  const data = await resp.json();
  if (!data.ok) throw new Error(data.error || "Error cargando flotas");

  sel.innerHTML =
    `<option value="">Seleccione flota</option>` +
    data.fleets.map((f) => `<option value="${f.idfleet}">${f.fleet_name}</option>`).join("");
}

function fmtDT(v) {
  if (!v) return "";
  return String(v).replace("T", " ").replace(".000Z", "");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// -------------------- TITULOS --------------------
const titles = {
  speed: "Informe exceso de velocidad",
  geofence: "Informe geocercas",
  parking: "Informe estacionamientos",
  engine_hours: "Informe horas de motor",
  up_time: "Informe tiempo de subida",
  down_time: "Informe tiempo de bajada",
};

function updateTitle() {
  document.getElementById("title").textContent = titles[state.activeReport] || "Informe";
}

function getCurrentReportType() {
  return state.activeReport;
}

function activateTab(reportType) {
  state.activeReport = reportType;

  document.querySelectorAll(".report-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.report === reportType);
  });

  updateTitle();
}

async function getAvailableReports(fleetId, desde, hasta) {
  const reportTypes = [
    "speed",
    "geofence",
    "parking",
    "engine_hours",
    "up_time",
    "down_time",
  ];

  const results = await Promise.all(
    reportTypes.map(async (reportType) => {
      const url = `${API_REPORT_PLATES}?report_type=${encodeURIComponent(
        reportType
      )}&fleet_id=${encodeURIComponent(fleetId)}&desde=${desde}&hasta=${hasta}`;

      try {
        const resp = await fetch(url);
        const data = await resp.json();

        return {
          reportType,
          ok: !!data.ok,
          count: Array.isArray(data.plates) ? data.plates.length : 0,
        };
      } catch {
        return {
          reportType,
          ok: false,
          count: 0,
        };
      }
    })
  );

  return results.filter((r) => r.ok && r.count > 0).map((r) => r.reportType);
}

function updateVisibleTabs(availableReports) {
  const tabsBox = document.getElementById("reportTabs");
  const tabs = document.querySelectorAll(".report-tab");

  tabs.forEach((btn) => {
    const visible = availableReports.includes(btn.dataset.report);
    btn.classList.toggle("hidden", !visible);
  });

  tabsBox.classList.toggle("hidden", availableReports.length === 0);
}

// -------------------- RENDERERS --------------------
function renderParkingSummary(rows, desde, hasta) {
  const el = document.getElementById("result");
  if (!rows?.length) {
    el.innerHTML = `<p>No hay estacionamientos en ese rango.</p>`;
    return;
  }

  const totalDurSec = rows.reduce((acc, r) => acc + hhmmssToSec(r.duracion), 0);
  const totalTiempoTotalSec = rows.reduce((acc, r) => acc + hhmmssToSec(r.tiempo_total), 0);
  const totalEntreSec = rows.reduce((acc, r) => acc + hhmmssToSec(r.tiempo_entre), 0);

  el.innerHTML = `
    <table class="table table-report">
      <thead>
        <tr>
          <th class="col-btn"></th>
          <th>PLACA</th>
          <th>COMIENZO</th>
          <th>FIN</th>
          <th>DURACIÓN</th>
          <th>TIEMPO TOTAL</th>
          <th>UBICACIÓN</th>
          <th>TIEMPO ENTRE</th>
          <th>COORDENADAS</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr class="plate-row" data-plate-id="${r.idplate}">
            <td class="col-btn"><button class="toggle" data-open="0">+</button></td>
            <td class="nowrap"><b>${escapeHtml(r.placa)}</b></td>
            <td class="nowrap">${escapeHtml(fmtDT(r.comienzo))}</td>
            <td class="nowrap">${escapeHtml(fmtDT(r.fin))}</td>
            <td class="nowrap">${escapeHtml(r.duracion || "00:00:00")}</td>
            <td class="nowrap">${escapeHtml(r.tiempo_total || "00:00:00")}</td>
            <td>${escapeHtml(r.ubicacion || "")}</td>
            <td class="nowrap">${escapeHtml(r.tiempo_entre || "00:00:00")}</td>
            <td class="nowrap">${escapeHtml(r.coordenadas || "")}</td>
          </tr>
        `).join("")}
        <tr class="total-row">
          <td class="col-btn"></td>
          <td class="nowrap"><b>TOTAL</b></td>
          <td></td>
          <td></td>
          <td class="nowrap"><b>${secToDiasHMS(totalDurSec)}</b></td>
          <td class="nowrap"><b>${secToDiasHMS(totalTiempoTotalSec)}</b></td>
          <td></td>
          <td class="nowrap"><b>${secToDiasHMS(totalEntreSec)}</b></td>
          <td></td>
        </tr>
      </tbody>
    </table>
  `;

  el.querySelectorAll(".toggle").forEach((btn) => {
    btn.addEventListener("click", (e) => onToggleDetails(e, desde, hasta));
  });
}

function renderEngineHoursSummary(rows) {
  const el = document.getElementById("result");

  if (!rows?.length) {
    el.innerHTML = `<p>No hay datos de horas de motor en ese rango.</p>`;
    return;
  }

  el.innerHTML = `
    <table class="table table-report">
      <thead>
        <tr>
          <th>PLACA</th>
          <th>COMIENZO</th>
          <th>UBICACIÓN INICIAL</th>
          <th>FIN</th>
          <th>UBICACIÓN FINAL</th>
          <th>HORAS MOTOR INICIO</th>
          <th>HORAS MOTOR FIN</th>
          <th>HORAS MOTOR</th>
          <th>TIEMPO TOTAL</th>
          <th>KILOMETRAJE</th>
          <th>KILOMETRAJE INICIAL</th>
          <th>KILOMETRAJE FINAL</th>
          <th>EN MOVIMIENTO</th>
          <th>RALENTÍ</th>
          <th>TIEMPO ENTRE</th>
          <th>VELOCIDAD MEDIA</th>
          <th>VELOCIDAD MÁXIMA</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td class="plate">${escapeHtml(r.placa)}</td>
            <td class="datecol">${escapeHtml(fmtDT(r.comienzo))}</td>
            <td class="loc">${escapeHtml(r.ubicacion_inicial || "")}</td>
            <td class="datecol">${escapeHtml(fmtDT(r.fin))}</td>
            <td class="loc">${escapeHtml(r.ubicacion_final || "")}</td>
            <td class="timecol">${escapeHtml(r.horas_motor_inicio || "00:00:00")}</td>
            <td class="timecol">${escapeHtml(r.horas_motor_fin || "00:00:00")}</td>
            <td class="timecol">${escapeHtml(r.horas_motor || "00:00:00")}</td>
            <td class="timecol">${escapeHtml(r.tiempo_total || "00:00:00")}</td>
            <td class="kmcol">${escapeHtml(r.kilometraje || "N/D")}</td>
            <td class="kmcol">${escapeHtml(r.kilometraje_inicial || "N/D")}</td>
            <td class="kmcol">${escapeHtml(r.kilometraje_final || "N/D")}</td>
            <td class="timecol">${escapeHtml(r.en_movimiento || "00:00:00")}</td>
            <td class="timecol">${escapeHtml(r.ralenti || "00:00:00")}</td>
            <td class="timecol">${escapeHtml(r.tiempo_entre || "00:00:00")}</td>
            <td class="speedcol">${escapeHtml(r.velocidad_media || "0 km/h")}</td>
            <td class="speedcol">${escapeHtml(r.velocidad_maxima || "0 km/h")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderEventSummary(rows, desde, hasta) {
  const el = document.getElementById("result");

  if (!rows?.length) {
    el.innerHTML = `<p>No hay eventos en ese rango.</p>`;
    return;
  }

  el.innerHTML = `
    <table class="table table-report">
      <thead>
        <tr>
          <th class="col-btn"></th>
          <th>PLACA</th>
          <th>FECHA - HORA</th>
          <th>TEXTO DEL EVENTO</th>
          <th>LOCALIZACIÓN</th>
          <th>CANTIDAD</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr class="plate-row" data-plate-id="${r.idplate}">
            <td class="col-btn"><button class="toggle" data-open="0">+</button></td>
            <td class="plate col-placa">${escapeHtml(r.placa)}</td>
            <td class="datecol">${escapeHtml(fmtDT(r.first_time))}</td>
            <td class="col-texto"></td>
            <td class="col-loc"></td>
            <td class="num">${escapeHtml(r.cantidad ?? 0)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  el.querySelectorAll(".toggle").forEach((btn) => {
    btn.addEventListener("click", (e) => onToggleDetails(e, desde, hasta));
  });
}

function renderTripTimeSummary(rows, desde, hasta, reportType) {
  const el = document.getElementById("result");

  if (!rows?.length) {
    const label = reportType === "up_time" ? "tiempo de subida" : "tiempo de bajada";
    el.innerHTML = `<p>No hay datos de ${label} en ese rango.</p>`;
    return;
  }

  const totalKm = rows.reduce((acc, r) => {
    const v = parseInt(String(r.kilometraje || "0").replace(/[^\d.-]/g, ""), 10);
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);

  const totalDuracionSec = rows.reduce((acc, r) => acc + hhmmssToSec(r.duracion_viaje), 0);
  const totalTiempoTotalSec = rows.reduce((acc, r) => acc + hhmmssToSec(r.tiempo_total), 0);
  const totalDetenidoSec = rows.reduce((acc, r) => acc + hhmmssToSec(r.tiempo_detenido), 0);

  const totalVelMax = rows.reduce((max, r) => {
    const v = parseInt(String(r.velocidad_maxima || "0").replace(/[^\d.-]/g, ""), 10);
    return Math.max(max, Number.isFinite(v) ? v : 0);
  }, 0);

  const totalVelMedia = (() => {
    let totalSec = 0;
    let weightedSum = 0;

    for (const r of rows) {
      const sec = hhmmssToSec(r.duracion_viaje);
      const vel = parseInt(String(r.velocidad_media || "0").replace(/[^\d.-]/g, ""), 10);

      if (Number.isFinite(sec) && Number.isFinite(vel) && sec > 0) {
        totalSec += sec;
        weightedSum += vel * sec;
      }
    }

    if (totalSec === 0) return 0;
    return Math.round(weightedSum / totalSec);
  })();

  el.innerHTML = `
    <table class="table table-report">
      <thead>
        <tr>
          <th class="col-btn"></th>
          <th>PLACA</th>
          <th>VIAJE</th>
          <th>VIAJE DESDE</th>
          <th>VIAJE HASTA</th>
          <th>COMIENZO</th>
          <th>FIN</th>
          <th>KILOMETRAJE</th>
          <th>DURACIÓN DEL VIAJE</th>
          <th>TIEMPO TOTAL</th>
          <th>TIEMPO DETENIDO</th>
          <th>VELOCIDAD MEDIA</th>
          <th>VELOCIDAD MÁXIMA</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr class="plate-row" data-plate-id="${r.idplate}">
            <td class="col-btn"><button class="toggle" data-open="0">+</button></td>
            <td class="plate">${escapeHtml(r.placa)}</td>
            <td class="loc">${escapeHtml(r.viaje || "-----")}</td>
            <td class="loc">${escapeHtml(r.viaje_desde || "-----")}</td>
            <td class="loc">${escapeHtml(r.viaje_hasta || "-----")}</td>
            <td class="datecol">${escapeHtml(fmtDT(r.comienzo))}</td>
            <td class="datecol">${escapeHtml(fmtDT(r.fin))}</td>
            <td class="kmcol">${escapeHtml(r.kilometraje || "0 km")}</td>
            <td class="timecol">${escapeHtml(r.duracion_viaje || "00:00:00")}</td>
            <td class="timecol">${escapeHtml(r.tiempo_total || "00:00:00")}</td>
            <td class="timecol">${escapeHtml(r.tiempo_detenido || "00:00:00")}</td>
            <td class="speedcol">${escapeHtml(r.velocidad_media || "0 km/h")}</td>
            <td class="speedcol">${escapeHtml(r.velocidad_maxima || "0 km/h")}</td>
          </tr>
        `).join("")}
        <tr class="total-row">
          <td class="col-btn"></td>
          <td class="nowrap"><b>TOTAL</b></td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
          <td class="kmcol"><b>${totalKm} km</b></td>
          <td class="timecol"><b>${secToDiasHMS(totalDuracionSec)}</b></td>
          <td class="timecol"><b>${secToDiasHMS(totalTiempoTotalSec)}</b></td>
          <td class="timecol"><b>${secToDiasHMS(totalDetenidoSec)}</b></td>
          <td class="speedcol"><b>${totalVelMedia} km/h</b></td>
          <td class="speedcol"><b>${totalVelMax} km/h</b></td>
        </tr>
      </tbody>
    </table>
  `;

  el.querySelectorAll(".toggle").forEach((btn) => {
    btn.addEventListener("click", (e) => onToggleDetails(e, desde, hasta));
  });
}

function renderGeofenceSummary(rows, desde, hasta) {
  const el = document.getElementById("result");

  if (!rows?.length) {
    el.innerHTML = `<p>No hay datos de geocercas en ese rango.</p>`;
    return;
  }

  const totalKm = rows.reduce((acc, r) => {
    const v = parseInt(String(r.kilometraje || "0").replace(/[^\d.-]/g, ""), 10);
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);

  const totalVisitas = rows.reduce((acc, r) => acc + Number(r.visitas || 0), 0);
  const totalDurSec = rows.reduce((acc, r) => acc + hhmmssToSec(r.duracion), 0);
  const totalEstSec = rows.reduce((acc, r) => acc + hhmmssToSec(r.duracion_estacionamiento), 0);

  const totalVelMax = rows.reduce((max, r) => {
    const v = parseInt(String(r.velocidad_maxima || "0").replace(/[^\d.-]/g, ""), 10);
    return Math.max(max, Number.isFinite(v) ? v : 0);
  }, 0);

  const totalVelMedia = (() => {
    let totalSec = 0;
    let weightedSum = 0;

    for (const r of rows) {
      const sec = hhmmssToSec(r.duracion);
      const vel = parseInt(String(r.velocidad_media || "0").replace(/[^\d.-]/g, ""), 10);

      if (Number.isFinite(sec) && Number.isFinite(vel) && sec > 0) {
        totalSec += sec;
        weightedSum += vel * sec;
      }
    }

    return totalSec > 0 ? Math.round(weightedSum / totalSec) : 0;
  })();

  el.innerHTML = `
    <table class="table table-report">
      <thead>
        <tr>
          <th class="col-btn"></th>
          <th>AGRUPACIÓN</th>
          <th>GEOCERCA</th>
          <th>HORA DE ENTRADA</th>
          <th>HORA DE SALIDA</th>
          <th>DURACIÓN</th>
          <th>DURACIÓN DE ESTACIONAMIENTO</th>
          <th>KILOMETRAJE</th>
          <th>VISITAS</th>
          <th>VELOCIDAD MEDIA</th>
          <th>VELOCIDAD MÁXIMA</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr class="plate-row" data-plate-id="${r.idplate}">
            <td class="col-btn"><button class="toggle" data-open="0">+</button></td>
            <td class="plate">${escapeHtml(r.placa)}</td>
            <td class="loc">-----</td>
            <td class="datecol">${escapeHtml(fmtDT(r.hora_entrada))}</td>
            <td class="datecol">${escapeHtml(fmtDT(r.hora_salida))}</td>
            <td class="timecol">${escapeHtml(r.duracion || "00:00:00")}</td>
            <td class="timecol">${escapeHtml(r.duracion_estacionamiento || "00:00:00")}</td>
            <td class="kmcol">${escapeHtml(r.kilometraje || "0 km")}</td>
            <td class="num">${escapeHtml(r.visitas || 0)}</td>
            <td class="speedcol">${escapeHtml(r.velocidad_media || "0 km/h")}</td>
            <td class="speedcol">${escapeHtml(r.velocidad_maxima || "0 km/h")}</td>
          </tr>
        `).join("")}
        <tr class="total-row">
          <td class="col-btn"></td>
          <td class="nowrap"><b>TOTAL</b></td>
          <td></td>
          <td></td>
          <td></td>
          <td class="timecol"><b>${secToDiasHMS(totalDurSec)}</b></td>
          <td class="timecol"><b>${secToDiasHMS(totalEstSec)}</b></td>
          <td class="kmcol"><b>${totalKm} km</b></td>
          <td class="num"><b>${totalVisitas}</b></td>
          <td class="speedcol"><b>${totalVelMedia} km/h</b></td>
          <td class="speedcol"><b>${totalVelMax} km/h</b></td>
        </tr>
      </tbody>
    </table>
  `;

  el.querySelectorAll(".toggle").forEach((btn) => {
    btn.addEventListener("click", (e) => onToggleDetails(e, desde, hasta));
  });
}

function renderPlates(rows, desde, hasta, reportType) {
  if (reportType === "parking") return renderParkingSummary(rows, desde, hasta);
  if (reportType === "engine_hours") return renderEngineHoursSummary(rows);
  if (reportType === "up_time" || reportType === "down_time") {
    return renderTripTimeSummary(rows, desde, hasta, reportType);
  }
  if (reportType === "geofence") return renderGeofenceSummary(rows, desde, hasta);
  return renderEventSummary(rows, desde, hasta);
}

// -------------------- DETAILS (toggle) --------------------
async function onToggleDetails(e, desde, hasta) {
  const b = e.currentTarget;
  const tr = b.closest("tr");
  const plateId = tr.getAttribute("data-plate-id");
  const reportType = getCurrentReportType();

  if (b.dataset.loading === "1") return;
  b.dataset.loading = "1";

  try {
    const open = b.getAttribute("data-open") === "1";

    document
      .querySelectorAll(`tr.detail-row[data-parent="${plateId}"]`)
      .forEach((x) => x.remove());

    if (open) {
      b.textContent = "+";
      b.setAttribute("data-open", "0");
      return;
    }

    b.textContent = "-";
    b.setAttribute("data-open", "1");

   let colspan = 6;

if (reportType === "parking") {
  colspan = 8;
} else if (reportType === "up_time" || reportType === "down_time") {
  colspan = 12;
} else if (reportType === "geofence") {
  colspan = 10;
}

    const loading = document.createElement("tr");
    loading.className = "detail-row";
    loading.setAttribute("data-parent", plateId);
    loading.innerHTML = `
      <td class="col-btn"></td>
      <td colspan="${colspan}">Cargando...</td>
    `;
    tr.insertAdjacentElement("afterend", loading);

    const url = `${API_REPORT_EVENTS}?report_type=${encodeURIComponent(
      reportType
    )}&plate_id=${encodeURIComponent(plateId)}&desde=${desde}&hasta=${hasta}`;

    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || "Error cargando detalle");

    loading.remove();

    if (reportType === "parking") {
      const placa = tr.querySelector("td:nth-child(2)")?.innerText?.trim() || "";

      const rowsHtml = (data.events || [])
        .map((ev) => {
          const comienzo = fmtDT(ev.comienzo);
          const fin = fmtDT(ev.fin);
          const coord = ev.coordenadas || "";

          return `
            <tr class="detail-row" data-parent="${plateId}">
              <td class="col-btn"></td>
              <td class="nowrap"><b>${escapeHtml(placa)}</b></td>
              <td class="nowrap">${escapeHtml(comienzo)}</td>
              <td class="nowrap">${escapeHtml(fin)}</td>
              <td class="nowrap">${escapeHtml(ev.duracion || "")}</td>
              <td class="nowrap">${escapeHtml(ev.tiempo_total || "")}</td>
              <td>${escapeHtml(ev.ubicacion || "")}</td>
              <td class="nowrap">${escapeHtml(ev.tiempo_entre || "")}</td>
              <td class="nowrap">${escapeHtml(coord)}</td>
            </tr>
          `;
        })
        .join("");

      tr.insertAdjacentHTML("afterend", rowsHtml);
      return;
    }

    if (reportType === "up_time" || reportType === "down_time") {
      const placa = tr.querySelector("td:nth-child(2)")?.innerText?.trim() || "";

      const rowsHtml = (data.events || [])
        .map((ev) => {
          return `
            <tr class="detail-row" data-parent="${plateId}">
              <td class="col-btn"></td>
              <td class="plate">${escapeHtml(placa)}</td>
              <td class="loc">${escapeHtml(ev.viaje || "")}</td>
              <td class="loc">${escapeHtml(ev.viaje_desde || "")}</td>
              <td class="loc">${escapeHtml(ev.viaje_hasta || "")}</td>
              <td class="datecol">${escapeHtml(fmtDT(ev.comienzo))}</td>
              <td class="datecol">${escapeHtml(fmtDT(ev.fin))}</td>
              <td class="kmcol">${escapeHtml(ev.kilometraje || "0 km")}</td>
              <td class="timecol">${escapeHtml(ev.duracion_viaje || "00:00:00")}</td>
              <td class="timecol">${escapeHtml(ev.tiempo_total || "00:00:00")}</td>
              <td class="timecol">${escapeHtml(ev.tiempo_detenido || "00:00:00")}</td>
              <td class="speedcol">${escapeHtml(ev.velocidad_media || "0 km/h")}</td>
              <td class="speedcol">${escapeHtml(ev.velocidad_maxima || "0 km/h")}</td>
            </tr>
          `;
        })
        .join("");

      tr.insertAdjacentHTML("afterend", rowsHtml);
      return;
    }

    if (reportType === "geofence") {
      const placa = tr.querySelector("td:nth-child(2)")?.innerText?.trim() || "";

      const rowsHtml = (data.events || [])
        .map((ev) => {
          return `
            <tr class="detail-row" data-parent="${plateId}">
              <td class="col-btn"></td>
              <td class="plate">${escapeHtml(placa)}</td>
              <td class="loc">${escapeHtml(ev.geocerca || "")}</td>
              <td class="datecol">${escapeHtml(fmtDT(ev.hora_entrada))}</td>
              <td class="datecol">${escapeHtml(fmtDT(ev.hora_salida))}</td>
              <td class="timecol">${escapeHtml(ev.duracion || "00:00:00")}</td>
              <td class="timecol">${escapeHtml(ev.duracion_estacionamiento || "00:00:00")}</td>
              <td class="kmcol">${escapeHtml(ev.kilometraje || "0 km")}</td>
              <td class="num">${escapeHtml(ev.visitas || 1)}</td>
              <td class="speedcol">${escapeHtml(ev.velocidad_media || "0 km/h")}</td>
              <td class="speedcol">${escapeHtml(ev.velocidad_maxima || "0 km/h")}</td>
            </tr>
          `;
        })
        .join("");

      tr.insertAdjacentHTML("afterend", rowsHtml);
      return;
    }

    const placa = tr.querySelector(".col-placa")?.innerText?.trim() || "";

const rowsHtml = (data.events || [])
  .map((ev) => {
    const fecha = fmtDT(ev.event_time);
    const texto = `GENERÓ UN ${ev.evento}, VELOCIDAD = ${ev.speed ?? 0} km/h, FECHA: ${fecha}`;

    return `
      <tr class="detail-row" data-parent="${plateId}">
        <td class="col-btn"></td>
        <td class="col-placa nowrap"><b>${escapeHtml(placa)}</b></td>
        <td class="col-fecha nowrap">${escapeHtml(fecha)}</td>
        <td class="col-texto">${escapeHtml(texto)}</td>
        <td class="col-loc">${escapeHtml(ev.location || "")}</td>
        <td class="col-cant nowrap">1</td>
      </tr>
    `;
  })
  .join("");

tr.insertAdjacentHTML("afterend", rowsHtml);
  } catch (err) {
    const errRow = document.createElement("tr");
    errRow.className = "detail-row";
    errRow.setAttribute("data-parent", plateId);

    const reportTypeNow = getCurrentReportType();
    let colspan = 5;

    if (reportTypeNow === "parking") {
      colspan = 8;
    } else if (reportTypeNow === "up_time" || reportTypeNow === "down_time") {
      colspan = 12;
    } else if (reportTypeNow === "geofence") {
      colspan = 10;
    }

    errRow.innerHTML = `
      <td class="col-btn"></td>
      <td colspan="${colspan}"><span class="bad">${escapeHtml(err.message || "Error")}</span></td>
    `;

    tr.insertAdjacentElement("afterend", errRow);
  } finally {
    b.dataset.loading = "0";
  }
}

// -------------------- GENERATE --------------------
async function loadActiveReport() {
  const { fleetId, desde, hasta, activeReport } = state;

  const url = `${API_REPORT_PLATES}?report_type=${encodeURIComponent(
    activeReport
  )}&fleet_id=${encodeURIComponent(fleetId)}&desde=${desde}&hasta=${hasta}`;

  const resp = await fetch(url);
  const data = await resp.json();
  if (!data.ok) throw new Error(data.error || "Error generando reporte");

  setHint("");
  renderPlates(data.plates, desde, hasta, activeReport);
  showDownloads(true);
}

async function onGenerate() {
  try {
    const fleetId = document.getElementById("fleet").value;
    if (!fleetId) return setHint("Seleccione una flota.", true);

    const { desde, hasta } = getDateRange();

    if (!desde || !hasta) return setHint("Seleccione un periodo válido.", true);
    if (desde > hasta) return setHint("Desde no puede ser mayor que Hasta.", true);

    state.fleetId = fleetId;
    state.desde = desde;
    state.hasta = hasta;
    state.loaded = true;

    showDownloads(false);
    document.getElementById("result").innerHTML = "";
    setHint("Cargando informes...");

    const availableReports = await getAvailableReports(fleetId, desde, hasta);

    updateVisibleTabs(availableReports);

    if (!availableReports.length) {
      setHint("");
      document.getElementById("result").innerHTML = "<p>No hay datos para mostrar en ese rango.</p>";
      return;
    }

    if (!availableReports.includes(state.activeReport)) {
      state.activeReport = availableReports[0];
    }

    activateTab(state.activeReport);
    await loadActiveReport();
  } catch (e) {
    console.error(e);
    setHint(e.message || "Error", true);
    showDownloads(false);
  }
}

async function onTabClick(e) {
  const reportType = e.currentTarget.dataset.report;
  activateTab(reportType);

  if (!state.loaded) return;

  try {
    setHint("Cargando reporte...");
    await loadActiveReport();
  } catch (e) {
    console.error(e);
    setHint(e.message || "Error", true);
    showDownloads(false);
  }
}

// -------------------- EXPORT --------------------
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function showDownloads(show) {
  document.getElementById("btnPdf").classList.toggle("hidden", !show);
  document.getElementById("btnExcel").classList.toggle("hidden", !show);
}

async function downloadFile(kind) {
  const { fleetId, desde, hasta } = state;

  if (!fleetId) return setHint("Seleccione una flota.", true);
  if (!desde || !hasta) return setHint("Seleccione un periodo válido.", true);

  let url;

  if (kind === "pdf") {
    url = `${API_EXPORT_PDF}?fleet_id=${encodeURIComponent(fleetId)}&desde=${desde}&hasta=${hasta}`;
  } else {
    url = `${API_EXPORT_EXCEL}?fleet_id=${encodeURIComponent(fleetId)}&desde=${desde}&hasta=${hasta}`;
  }

  setHint(`Descargando ${kind.toUpperCase()}...`);

  const resp = await fetch(url);
  if (!resp.ok) {
    let msg = `Error descargando ${kind}`;
    try {
      const j = await resp.json();
      msg = j.error || msg;
    } catch {}
    return setHint(msg, true);
  }

  const blob = await resp.blob();
  const ext = kind === "pdf" ? "pdf" : "xlsx";
  const suffix = "general";

  downloadBlob(blob, `reporte_${suffix}_${fleetId}_${desde}_a_${hasta}.${ext}`);
  setHint("Listo ✅");
}

// -------------------- INIT --------------------
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadFleets();
  } catch (e) {
    setHint(e.message, true);
  }

  initRangePicker();
  showRangeInputs(document.getElementById("period").value === "rango");

  updateTitle();
  showDownloads(false);
  setHint("");

  document.getElementById("period").addEventListener("change", (e) => {
    const isRange = e.target.value === "rango";

    showRangeInputs(isRange);

    if (!isRange) {
      selectedRange.desde = "";
      selectedRange.hasta = "";

      if (rangePicker) rangePicker.clear();
    }
  });

  document.getElementById("btnSelect").addEventListener("click", onGenerate);
  document.getElementById("btnPdf").addEventListener("click", () => downloadFile("pdf"));
  document.getElementById("btnExcel").addEventListener("click", () => downloadFile("excel"));

  document.querySelectorAll(".report-tab").forEach((btn) => {
    btn.addEventListener("click", onTabClick);
  });
});