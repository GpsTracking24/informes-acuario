// db/parkingInsert.js
async function insertParking(db, fleet_id, plate_id, parking) {
  await db.query(
    `INSERT IGNORE INTO parking
     (fleet_id, plate_id, start_time, end_time, duration_sec, address, lat, lng)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fleet_id,
      plate_id,
      parking.start_time,
      parking.end_time,
      parking.duration_sec,
      parking.address || null,
      parking.lat,
      parking.lng,
    ]
  );
}

module.exports = { insertParking };