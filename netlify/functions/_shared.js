/* Shared DB connection + HTTP helpers for Netlify functions. */
const { Pool } = require('pg');

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
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
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

module.exports = { db, ok, fail, preflight, readBody };