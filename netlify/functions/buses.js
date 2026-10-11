/* GET /api/buses — live device list with latest fix, offline flag, ETA to school. */
const { db, ok, fail, preflight } = require('./_shared');

const SCHOOL = { lat: 13.170998, lng: 77.596295 };
const OFFLINE_AFTER_S = Math.max(3, +(process.env.OFFLINE_AFTER_S || 45));
const FALLBACK_SPEED_MS = 9; // ~32 km/h city bus heuristic when no Directions key
const ETA_CACHE_TTL_MS = 30 * 1000;

// in-memory per-lambda-instance Directions cache per device code
const etaCache = new Map();

function distanceMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

async function etaFromDirections(lat, lng) {
  const key = `d:${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = etaCache.get(key);
  if (cached && Date.now() - cached.t < ETA_CACHE_TTL_MS) return cached.etaMins;
  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${lat},${lng}&destination=${SCHOOL.lat},${SCHOOL.lng}&mode=driving&key=${process.env.GMAPS_KEY}`;
    const resp = await fetch(url);
    const data = await resp.json();
    const route = data && data.routes && data.routes[0];
    const leg = route && route.legs && route.legs[0];
    if (!leg || !leg.duration) return null;
    const etaMins = leg.duration.value / 60;
    etaCache.set(key, { t: Date.now(), etaMins });
    return etaMins;
  } catch {
    return null;
  }
}

function etaFallback(lat, lng, speed) {
  const v = Number.isFinite(speed) && speed > 2 && speed < 40 ? speed : FALLBACK_SPEED_MS;
  const mins = distanceMeters(lat, lng, SCHOOL.lat, SCHOOL.lng) / v / 60;
  return { etaMins: Math.max(0, Math.round(mins)), source: 'fallback' };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'GET') return fail(405, 'Method not allowed');

  const { rows } = await db().query(`
    SELECT d.code, d.label, d.color, d.route_id, d.created_at, d.last_seen,
           (d.last_seen IS NULL OR d.last_seen < now() - interval '${OFFLINE_AFTER_S} seconds') AS offline,
           p.lat, p.lng, p.heading, p.speed, p.accuracy, p.ts AS pos_ts
    FROM live_devices d
    LEFT JOIN LATERAL (
      SELECT * FROM live_positions WHERE device_code = d.code ORDER BY ts DESC LIMIT 1
    ) p ON true
    ORDER BY d.created_at ASC
  `);

  const buses = [];
  for (const r of rows) {
    const bus = {
      code: r.code,
      label: r.label,
      color: r.color,
      route_id: r.route_id || null,
      created_at: r.created_at,
      last_seen: r.last_seen,
      offline: r.offline,
      waiting: r.lat === null, // registered but no fix yet
      pos: r.lat === null ? null : {
        lat: r.lat, lng: r.lng, heading: r.heading,
        speed: r.speed, accuracy: r.accuracy, ts: r.pos_ts
      },
      etaMins: null,
      etaSource: null
    };
    if (r.lat !== null && !r.offline) {
      if (process.env.GMAPS_KEY) {
        const etaMins = await etaFromDirections(r.lat, r.lng);
        if (etaMins !== null) {
          bus.etaMins = Math.round(etaMins);
          bus.etaSource = 'google';
        }
      }
      if (bus.etaMins === null) {
        const fb = etaFallback(r.lat, r.lng, r.speed);
        bus.etaMins = fb.etaMins;
        bus.etaSource = fb.source;
      }
    }
    buses.push(bus);
  }

  return ok({ buses });
};