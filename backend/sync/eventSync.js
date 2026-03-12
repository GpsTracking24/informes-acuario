const { pool } = require("../db/pool");
const { insertEventsBatch } = require("../db/eventInsert");
const { generateReportForDevice } = require("../scraping/incomingData");
const { newBrowser, newContext } = require("../scraping/browser");
const { login } = require("../scraping/login");

function toMysqlDatetime(str) {
  return (str || "").replace("T", " ").replace("Z", "");
}

function todayLocalISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function getLastEventTime(plateId) {
  const [rows] = await pool.query(
    "SELECT MAX(event_time) AS last_time FROM event WHERE plate_id = ?",
    [plateId]
  );
  return rows[0]?.last_time || null;
}

async function getActivePlates() {
  const [rows] = await pool.query(`
    SELECT
      idplate,
      label,
      box_id
    FROM plate
    WHERE active = 1
      AND box_id IS NOT NULL
      AND box_id <> ''
  `);

  return rows;
}

async function syncEventsForPlate(page, plate) {
  const { idplate, label, box_id } = plate;

  const lastTime = await getLastEventTime(idplate);

  const desde = lastTime
    ? new Date(lastTime).toISOString().slice(0, 10)
    : "2026-02-24";

  const hasta = todayLocalISO();

  const { rows } = await generateReportForDevice({
    page,
    plateId: idplate,
    placa: label,
    uniqueId: box_id,
    desde,
    hasta,
  });

  console.log(`[${label}] scraped=${rows.length}`);

  const toInsert = [];

  for (const r of rows) {
    const code = r.code_event != null ? Number(r.code_event) : null;
    if (code == null || Number.isNaN(code)) continue;

    const eventTime = toMysqlDatetime(r.event_time);
    if (!eventTime) continue;

    if (lastTime && new Date(eventTime) <= new Date(lastTime)) continue;

    toInsert.push({
      plate_id: idplate,
      code_event: code,
      event_time: eventTime,
      speed: r.speed ?? 0,
      lat: r.lat ?? null,
      lng: r.lng ?? null,
      location: r.location ?? null,
      event_text: r.event_text ?? null,
      created_at: r.created_at ? toMysqlDatetime(r.created_at) : null,
    });
  }

  console.log(`[${label}] toInsert=${toInsert.length}`);

  const inserted = await insertEventsBatch(toInsert);

  return {
    plate: label,
    scraped: rows.length,
    inserted,
  };
}

async function eventSyncAll() {
  const plates = await getActivePlates();

  let browser;
  let context;
  let page;

  let totalPlates = 0;
  let totalScraped = 0;
  let totalInserted = 0;
  let totalErrors = 0;

  try {
    browser = await newBrowser();
    context = await newContext(browser);
    page = await context.newPage();

    if (!context._options?.storageState) {
      await login(page);
    }

    console.log("[eventSyncAll] placas activas:", plates.length);

    for (const plate of plates) {
      try {
        const result = await syncEventsForPlate(page, plate);
        totalPlates++;
        totalScraped += Number(result.scraped || 0);
        totalInserted += Number(result.inserted || 0);
      } catch (err) {
        totalErrors++;
        console.error(`[eventSyncAll] Error con placa ${plate.label}:`, err.message);
      }
    }

    return {
      totalPlates,
      totalScraped,
      totalInserted,
      totalErrors,
    };
  } finally {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

module.exports = { syncEventsForPlate, eventSyncAll };