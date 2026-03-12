const { pool } = require("./pool");

let cachedSet = null;
let cachedAt = 0;

async function getValidEventCodes() {
  const now = Date.now();

  if (cachedSet && now - cachedAt < 5 * 60_000) {
    return cachedSet;
  }

  const [rows] = await pool.query("SELECT code_event FROM event_type");

  cachedSet = new Set(rows.map(r => Number(r.code_event)));
  cachedAt = now;

  return cachedSet;
}

module.exports = { getValidEventCodes };