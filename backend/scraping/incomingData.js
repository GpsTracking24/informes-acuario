const { parseGps } = require("./parsers");
const { reverseGeocode } = require("./geocode");
const { getValidEventCodes } = require("../db/eventTypes");
const { login } = require("./login");

function normalizeDateISO(d) {
  if (!d) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
    const [dd, mm, yyyy] = d.split("/");
    return `${yyyy}-${mm}-${dd}`;
  }

  if (/^\d{2}\.\d{2}\.\d{4}$/.test(d)) {
    const [dd, mm, yyyy] = d.split(".");
    return `${yyyy}-${mm}-${dd}`;
  }

  return d;
}

function inRange(dateTime, desdeRaw, hastaRaw) {
  const desdeISO = normalizeDateISO(desdeRaw);
  const hastaISO = normalizeDateISO(hastaRaw);

  if (!desdeISO || !hastaISO) return true;
  if (!dateTime) return false;

  const dt = String(dateTime).replace(" ", "T");
  const start = `${desdeISO}T00:00:00`;
  const end = `${hastaISO}T23:59:59`;

  return dt >= start && dt <= end;
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCellText(cell) {
  if (!cell) return "";
  if (cell.text != null && String(cell.text).trim() !== "") {
    return String(cell.text).trim();
  }
  if (cell.innerHTML != null) {
    return stripHtml(cell.innerHTML);
  }
  return "";
}

function parseNumericEventId(raw) {
  const txt = stripHtml(raw || "");
  const match = txt.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function mapMaponEventToInternalCode(eventId, inputsText, validCodes) {
  if (eventId != null && validCodes.has(Number(eventId))) {
    return Number(eventId);
  }

  const txt = String(inputsText || "").toUpperCase();

  if (txt.includes("IGNITION") && validCodes.has(30)) return 30;
  if (txt.includes("DIN1") && validCodes.has(31)) return 31;
  if (txt.includes("DIN2") && validCodes.has(32)) return 32;

  return null;
}

async function ensureSession(page) {
  const baseUrl = process.env.BASE_URL || "https://mapon.com";
  await login(page, `${baseUrl}/partner/`);
}

async function fetchIncomingRowsDirect(page, uniqueId, logFileID) {
  const response = await page.request.post(
    "https://mapon.com/partner/ajax.php?module=incoming_data&sub=load",
    {
      form: {
        unique_id: String(uniqueId),
        logFileID: String(logFileID),
        keyword: "",
        decodeHex: "on",
        custom_time_zone: "0",
        model: "CALAMP",
        data_timezone: "America/Lima",
        box_model: "CALAMP",
        method: "data",
        type: "json",
        sort: "",
      },
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
      },
    }
  );

  const raw = await response.text();

  console.log("[DEBUG] ajax status:", response.status());
  console.log("[DEBUG] ajax content-type:", response.headers()["content-type"] || "");
  console.log(
    "[DEBUG] ajax postData:",
    `unique_id=${uniqueId}&logFileID=${logFileID}&keyword=&decodeHex=on&custom_time_zone=0&model=CALAMP&data_timezone=America/Lima&box_model=CALAMP&method=data&type=json&sort=`
  );
  console.log("[DEBUG] ajax raw:", raw.slice(0, 500));

  const json = JSON.parse(raw);
  const rows = Array.isArray(json?.data) ? json.data : [];

  if (
    rows.length === 1 &&
    Array.isArray(rows[0]?.els) &&
    rows[0].els.some((c) => String(c?.text || "").includes("No results")) 
  ) {
    return [];
  }

  if (
    rows.length === 1 &&
    Array.isArray(rows[0]?.els) &&
    rows[0].els.some((c) => String(c?.text || "").includes("Box no found"))
  ) {
    return [];
  }

  console.log("[DEBUG] filas recibidas:", rows.length);

  return rows.map((row) => {
    const els = Array.isArray(row?.els) ? row.els : [];
    return els.map(extractCellText);
  });
}

async function generateReportForDevice({ page, plateId, placa, uniqueId, desde, hasta }) {
  await ensureSession(page);

  const logFileID = normalizeDateISO(hasta) || new Date().toISOString().slice(0, 10);
  console.log(`[${placa}] usando logFileID:`, logFileID);

  const allRows = await fetchIncomingRowsDirect(page, uniqueId, logFileID);
  const validCodes = await getValidEventCodes();

  const IDX_CREATED = 0;
  const IDX_UTC = 1;
  const IDX_EVENT_ID = 2;
  const IDX_GPS = 3;
  const IDX_INPUTS = 4;

  const out = [];

  for (const r of allRows) {
    const createdAt = (r[IDX_CREATED] || "").trim();
    const utcTimestamp = (r[IDX_UTC] || "").trim();
    const rawEventId = (r[IDX_EVENT_ID] || "").trim();
    const gpsText = r[IDX_GPS] || "";
    const inputsText = r[IDX_INPUTS] || "";

    const gps = parseGps(gpsText);
    if (!gps) continue;

    const numericEventId = parseNumericEventId(rawEventId);
    const codeEvent = mapMaponEventToInternalCode(numericEventId, inputsText, validCodes);
    if (codeEvent == null) continue;

    const eventTime = gps.timestamp || utcTimestamp || createdAt || null;
    if (desde && hasta && !inRange(eventTime, desde, hasta)) continue;

    let address = null;

    if (gps.lat != null && gps.lon != null) {
      try {
        address = await reverseGeocode(gps.lat, gps.lon);
      } catch (err) {
        console.warn(`[${placa}] reverseGeocode error:`, err.message);
      }
    }

    out.push({
      plate_id: plateId,
      code_event: codeEvent,
      event_time: eventTime,
      speed: gps.speed_kmh != null ? gps.speed_kmh : 0,
      lat: gps.lat != null ? gps.lat : null,
      lng: gps.lon != null ? gps.lon : null,
      location: address || (gps.lat != null && gps.lon != null ? `${gps.lat}, ${gps.lon}` : null),
      event_text: inputsText ? String(inputsText).trim() : null,
      created_at: createdAt || null,
    });
  }

  return { rows: out };
}

module.exports = { generateReportForDevice };