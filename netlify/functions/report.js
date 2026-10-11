/* POST /api/report — device pushes its GPS fix (paired via code + token). */
const { db, ok, fail, preflight, readBody } = require('./_shared');

const PRUNE_AFTER_MS = 10 * 60 * 1000; // keep a short rolling trail per device

async function snapToRoad(lat, lng) {
  // Phase 2: snap noisy GPS to the nearest road via the Google Roads API.
  // Skipped until GMAPS_KEY is configured; falls back to the raw fix.
  if (!process.env.GMAPS_KEY) return null;
  try {
    const url = `https://roads.googleapis.com/v1/snapToRoads?path=${lat},${lng}&interpolate=true&key=${process.env.GMAPS_KEY}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    const pt = data && data.snappedPoints && data.snappedPoints[0];
    if (!pt || !pt.location) return null;
    // interpolate the snapped lon/lat when the API returns an index
    const loc = { latitude: pt.location.latitude, longitude: pt.location.longitude };
    return { lat: loc.latitude, lng: loc.longitude, snapped: true };
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');

  const body = readBody(event);
  if (!body) return fail(400, 'Invalid JSON body');

  const code = String(body.code || '').trim();
  const token = String(body.token || '').trim();
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const heading = Number(body.heading);
  const speed = Number(body.speed);
  const accuracy = Number(body.accuracy);

  if (!/^[A-Z0-9]{6}$/.test(code)) return fail(400, 'code must be 6 characters');
  if (!/^[0-9a-f]{48}$/.test(token)) return fail(400, 'token must be valid');
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return fail(400, 'lat is invalid');
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return fail(400, 'lng is invalid');

  const row = await db().query('SELECT token FROM live_devices WHERE code = $1', [code]);
  if (row.rowCount === 0) return fail(404, 'Unknown pairing code');
  if (row.rows[0].token !== token) return fail(401, 'Invalid device token');

  const snapped = await snapToRoad(lat, lng);
  const useLat = snapped ? snapped.lat : lat;
  const useLng = snapped ? snapped.lng : lng;

  await db().query(
    `INSERT INTO live_positions(device_code, lat, lng, heading, speed, accuracy)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [code, useLat, useLng, Number.isFinite(heading) ? heading : null,
     Number.isFinite(speed) ? speed : null, Number.isFinite(accuracy) ? accuracy : null]
  );
  await db().query('UPDATE live_devices SET last_seen = now() WHERE code = $1', [code]);
  await db().query(
    `DELETE FROM live_positions
     WHERE device_code = $1 AND ts < now() - interval '${Math.round(PRUNE_AFTER_MS / 1000)} seconds'`,
    [code]
  );

  return ok({ ok: true, snapped: !!snapped });
};