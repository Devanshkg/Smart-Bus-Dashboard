/* POST /api/register — add a new live bus and get a pairing code + device token. */
const crypto = require('crypto');
const QRCode = require('qrcode');
const { db, ok, fail, preflight, readBody } = require('./_shared');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const CODE_LEN = 6;

function makeCode() {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) {
    s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return s;
}

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

function uniqueCode() {
  return makeCode();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');

  const body = readBody(event);
  if (!body) return fail(400, 'Invalid JSON body');

  const label = String(body.label || '').trim();
  if (!label) return fail(400, 'label is required');
  if (label.length > 64) return fail(400, 'label must be 64 characters or fewer');

  const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color.toLowerCase() : '#2563EB';

  let code = uniqueCode();
  // very unlikely collision; retry a few times just in case
  for (let tries = 0; tries < 5; tries++) {
    const existing = await db().query('SELECT 1 FROM live_devices WHERE code = $1', [code]);
    if (existing.rowCount === 0) break;
    code = uniqueCode();
  }

  const token = makeToken();
  await db().query(
    'INSERT INTO live_devices(code, token, label, color) VALUES ($1, $2, $3, $4)',
    [code, token, label, color]
  );

  const qrPath = `/live.html?c=${code}&t=${token}`;
  let qrDataURL = null;
  try {
    const host = (event.headers && event.headers.host) || 'localhost';
    const proto = /localhost|127\.0\.0\.1|^\[?::/.test(host) ? 'http' : 'https';
    qrDataURL = await QRCode.toDataURL(proto + '://' + host + qrPath, {
      width: 190, margin: 1, errorCorrectionLevel: 'M'
    });
  } catch {
    qrDataURL = null;
  }

  return ok({ code, token, label, color, qrPath, qrDataURL });
};