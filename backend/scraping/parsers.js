// backend/scraping/parsers.js

const GPS_RE =
  /\[(?<dt>[^\]]+)\]\s*Sat:\s*(?<sat>\d+),\s*(?<lat>-?\d+(?:\.\d+)?),\s*(?<lon>-?\d+(?:\.\d+)?),\s*(?<speed>\d+(?:\.\d+)?)\s*km\/h,\s*(?<head>\d+)(?:°)?/i;

function parseGps(text) {
  const m = String(text || "").match(GPS_RE);
  if (!m?.groups) return null;

  return {
    timestamp: m.groups.dt.trim(),
    satellites: Number(m.groups.sat),
    lat: Number(m.groups.lat),
    lon: Number(m.groups.lon),
    speed_kmh: Number(m.groups.speed),
    heading: Number(m.groups.head),
  };
}

module.exports = {
  parseGps,
};