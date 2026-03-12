const { parseGps } = require("./parsers");
const { reverseGeocode } = require("./geocode");
const { getValidEventCodes } = require("../db/eventTypes");

async function setLatestLogFile(page) {
  const select = page.locator('select[name="logFileID"]').first();

  if ((await select.count()) === 0) {
    throw new Error("No encontré select[name='logFileID']");
  }

  const values = await select.locator("option").evaluateAll((opts) =>
    opts.map((o) => (o.value || "").trim()).filter(Boolean)
  );

  console.log("[DEBUG] opciones disponibles:", values);

  if (!values.length) {
    throw new Error("logFileID no tiene opciones");
  }

  const chosen = values.length > 1 ? values[1] : values[0];

  await select.selectOption(chosen);

  await page.evaluate((value) => {
    const el = document.querySelector('select[name="logFileID"]');
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, chosen);

  await page.waitForTimeout(500);

  const selectedValue = await select.inputValue().catch(() => "");
  console.log("[DEBUG] logFileID seteado a:", selectedValue);
}

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

async function fetchIncomingRowsCurrentSelection(page, uniqueId, logFileID) {

  const response = await page.request.post(
    "https://mapon.com/partner/ajax.php?module=incoming_data&sub=load",
    {
      form: {
        unique_id: uniqueId,
        logFileID: logFileID,
        keyword: "",
        decodeHex: "on",
        custom_time_zone: "0",
        model: "CALAMP",
        data_timezone: "America/Lima",
        box_model: "CALAMP",
        method: "data",
        type: "json",
        sort: ""
      }
    }
  );

  const raw = await response.text();

  console.log("[DEBUG] respuesta ajax preview:", raw.slice(0,300));

  const json = JSON.parse(raw);

  const rows = Array.isArray(json?.data) ? json.data : [];

  console.log("[DEBUG] filas recibidas:", rows.length);

  return rows.map(row => {
    const els = Array.isArray(row?.els) ? row.els : [];
    return els.map(extractCellText);
  });
}

async function generateReportForDevice({ page, plateId, placa, uniqueId, desde, hasta }) {
  const baseUrl = process.env.BASE_URL;
  const incomingUrl = `${baseUrl}/partner/incoming_data/?box_model=CALAMP&unique_id=${uniqueId}`;

  await page.goto(incomingUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);
  await setLatestLogFile(page);

  if (page.url().includes("login")) {
    throw new Error(`Sesión no válida para ${placa}`);
  }

  const logFileID = await page.locator('select[name="logFileID"]').inputValue();

const allRows = await fetchIncomingRowsCurrentSelection(
  page,
  uniqueId,
  logFileID
);
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