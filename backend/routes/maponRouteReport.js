const express = require('express');
const router = express.Router();
const { getLatestRoutesPerUnit } = require('../db/maponRouteQueries');

router.get('/', async (req, res) => {
  try {
    const rows = await getLatestRoutesPerUnit();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo reporte de rutas' });
  }
});

module.exports = router;