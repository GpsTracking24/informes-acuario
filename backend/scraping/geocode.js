const fetch = require("node-fetch");
const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "cache.sqlite");
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS geocache (
    lat REAL,
    lon REAL,
    address TEXT,
    PRIMARY KEY (lat, lon)
  );
`);

function roundCoord(x, nd = 5) {
  const p = Math.pow(10, nd);
  return Math.round(x * p) / p;
}

async function reverseGeocode(lat, lon) {
  const rlat = roundCoord(lat, 5);
  const rlon = roundCoord(lon, 5);

  const row = db.prepare("SELECT address FROM geocache WHERE lat=? AND lon=?").get(rlat, rlon);
  if (row?.address) return row.address;

  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(rlat));
  url.searchParams.set("lon", String(rlon));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");

  const resp = await fetch(url.toString(), {
    headers: { "User-Agent": "mapon-local-report/1.0" }
  });

  if (!resp.ok) throw new Error(`Geocode error: ${resp.status}`);

  const data = await resp.json();
  const address = data.display_name || null;

  db.prepare("INSERT OR REPLACE INTO geocache(lat, lon, address) VALUES(?,?,?)")
    .run(rlat, rlon, address);

  // respeta rate limit (1 req/seg aprox)
  await new Promise(r => setTimeout(r, 1100));

  return address;
}

module.exports = { reverseGeocode };
