/* POST /api/assign — assign (or clear) the school route for a live device.
   routeId: a route id string from 1..6 (dashboard ROUTES), or null/"" to clear. */
const { db, ok, fail, preflight, readBody } = require('./_shared');

const ROUTE_IDS = ['1', '2', '3', '4', '5', '6'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');

  const body = readBody(event);
  if (!body) return fail(400, 'Invalid JSON body');

  const code = String(body.code || '').trim();
  if (!/^[A-Z0-9]{6}$/.test(code)) return fail(400, 'code must be 6 characters');

  const raw = body.routeId === null || body.routeId === undefined ? '' : String(body.routeId).trim();
  const routeId = raw === '' ? null : raw;
  if (routeId !== null && !ROUTE_IDS.includes(routeId)) return fail(400, 'routeId must be a valid route id');

  const res = await db().query(
    'UPDATE live_devices SET route_id = $2 WHERE code = $1',
    [code, routeId]
  );
  if (res.rowCount === 0) return fail(404, 'Unknown pairing code');

  return ok({ code, routeId });
};