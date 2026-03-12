const express = require("express");
const router = express.Router();
const { pool } = require("../db/pool");

router.get("/", async (_req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT idfleet, fleet_name FROM fleet WHERE active=1 ORDER BY fleet_name"
    );
    res.json({ ok: true, fleets: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

module.exports = router;