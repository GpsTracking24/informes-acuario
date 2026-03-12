const fetch = require("node-fetch");
const { pool } = require("../db/pool"); // para mapear unique_id -> idplate

async function fetchUnits() {
  const baseUrl = process.env.BASE_URL;
  const key = process.env.MAPON_API_KEY;

  const url = new URL("/api/v1/unit/list.json", baseUrl);
  url.searchParams.set("key", key);

  const resp = await fetch(url.toString(), {
    headers: { "User-Agent": "mapon-local-report/1.0" },
  });

  if (!resp.ok) throw new Error(`Unit list error: ${resp.status}`);

  const json = await resp.json();

  const units = (json?.data?.units || []).map((u) => ({
    placa: u.number, // PLACA
    unique_id: String(u.box_id), // lo usas en /partner/incoming_data?unique_id=...
    unit_id: u.unit_id,
    label: u.label,
  }));

  return units.filter((u) => u.placa && u.unique_id);
}

/**
 * Devuelve unidades para una flota con el formato que usa parkingSync:
 * [{ idplate, carId, placa, unique_id }]
 *
 * carId: en tu scraping es el identificador que estás pasando a mainData.json.
 * En tu caso, normalmente será unique_id (box_id) o unit_id según cómo armes el POST.
 */
async function getUnitsForFleet(page, fleetId) {
  // 1) Mapon: trae todas las unidades (si tu API no filtra por flota)
  const units = await fetchUnits();

  // 2) DB: trae placas/idplate de esa flota
  const [plates] = await pool.query(
    `SELECT idplate, label AS placa FROM plate WHERE fleet_id = ?`,
    [fleetId]
  );

  // 3) cruzamos por placa
  const mapByPlate = new Map(units.map((u) => [String(u.placa).trim(), u]));

  const out = [];
  for (const p of plates) {
    const u = mapByPlate.get(String(p.placa).trim());
    if (!u) continue;

    out.push({
      idplate: p.idplate,
      placa: p.placa,
      unique_id: u.unique_id,
      unit_id: u.unit_id,
      // ✅ ESTE es el que usarás en parkingData:
      carId: u.unique_id, // si tu endpoint usa "car" = unique_id (como en tu captura)
    });
  }

  return out;
}

module.exports = { fetchUnits, getUnitsForFleet };