/* Shared DB connection + HTTP helpers for Netlify functions. */
const { Pool } = require('pg');

/* jose is ESM-only; a static require lets Netlify's bundler include it. The
   nodejs24.x runtime supports require() of ESM. */
let josePkg = null;
function jose() {
  if (!josePkg) josePkg = require('jose');
  return josePkg;
}

let pool;

function db() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function done(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function ok(body) {
  return done(200, body);
}

function fail(statusCode, error) {
  return done(statusCode, { error });
}

function preflight() {
  return { statusCode: 204, headers: CORS, body: '' };
}

function readBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return null;
  }
}

/* ---- Neon Auth (Managed Better Auth) JWT verification ------------------- */

let jwks;

async function jwksFor() {
  if (!jwks) {
    if (!process.env.NEON_AUTH_JWKS_URL) throw new Error('NEON_AUTH_JWKS_URL is not set');
    const { createRemoteJWKSet } = jose();
    jwks = createRemoteJWKSet(new URL(process.env.NEON_AUTH_JWKS_URL));
  }
  return jwks;
}

function bearer(event) {
  const h = (event && event.headers) || {};
  const raw = h.authorization || h.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return m ? m[1] : null;
}

/* Verify the request's bearer JWT. Returns { userId, email } or null. */
async function requireUser(event) {
  const token = bearer(event);
  if (!token) return null;
  try {
    const { jwtVerify } = jose();
    const { payload } = await jwtVerify(token, await jwksFor(), {
      issuer: process.env.NEON_AUTH_ISSUER || process.env.NEON_AUTH_URL
    });
    return { userId: payload.sub, email: payload.email, role: payload.role };
  } catch {
    return null;
  }
}

/* First school membership for a user, or null. */
async function membership(client, userId) {
  const { rows } = await client.query(
    `SELECT m.school_id, m.role, s.name AS school_name, s.google_maps_api_key
       FROM school_members m JOIN schools s ON s.id = m.school_id
      WHERE m.user_id = $1
      ORDER BY m.created_at ASC LIMIT 1`,
    [userId]
  );
  if (rows.length === 0) return null;
  return {
    schoolId: rows[0].school_id,
    role: rows[0].role,
    schoolName: rows[0].school_name,
    googleMapsApiKey: rows[0].google_maps_api_key || null
  };
}

module.exports = { db, ok, fail, preflight, readBody, requireUser, membership };