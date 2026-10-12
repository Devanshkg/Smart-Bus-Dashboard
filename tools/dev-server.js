/* Local dev harness for the Smart Bus Dashboard.
   Serves the static site AND mounts the Netlify function handlers at the same
   /api/* paths the deployed site uses, so the whole Add Bus -> device -> map
   flow works on localhost without the Netlify runtime.

   Usage: npm run dev   ("node tools/dev-server.js")
   Reads .env.local (DATABASE_URL, GMAPS_KEY...) if present. */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..');

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  });
  return out;
}

Object.entries(loadEnv(path.join(ROOT, '.env.local'))).forEach(([k, v]) => {
  if (process.env[k] === undefined) process.env[k] = v;
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const HANDLERS = {
  '/api/register': require('../netlify/functions/register.js').handler,
  '/api/report': require('../netlify/functions/report.js').handler,
  '/api/buses': require('../netlify/functions/buses.js').handler,
  '/api/assign': require('../netlify/functions/assign.js').handler,
  '/api/me': require('../netlify/functions/me.js').handler
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const pathname = u.pathname;

  if (HANDLERS[pathname]) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    const event = {
      httpMethod: req.method,
      body: body || null,
      headers: req.headers,
      queryStringParameters: Object.fromEntries(u.searchParams)
    };
    try {
      const out = await HANDLERS[pathname](event);
      res.writeHead(out.statusCode, out.headers || { 'Content-Type': 'application/json' });
      res.end(out.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'internal: ' + e.message }));
    }
    return;
  }

  const rel = pathname === '/' ? '/index.html' : pathname;
  const fpath = path.normalize(path.join(ROOT, rel));
  if (!fpath.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  try {
    const data = fs.readFileSync(fpath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fpath)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found: ' + rel);
  }
});

const PORT = +(process.env.PORT || 4174);
server.listen(PORT, () => {
  console.log('Smart Bus Dashboard dev server: http://localhost:' + PORT);
  console.log('API mounted at /api/register, /api/report, /api/buses, /api/assign, /api/me');
});