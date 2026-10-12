# Plan — School Accounts & Per-School Isolation

Add a sign-up / log-in gate in front of the dashboard. Each school creates an
account and can only ever see its **own** buses, routes, and devices. Backed by
**Neon Auth** (Managed Better Auth), with JWT verification in the Netlify
Functions.

Status: **implemented and dev-verified** (Playwright E2E + curl backend tests).
Not yet committed; Netlify deploy still needs the `NEON_AUTH_*` env vars.

> Deviations from the original plan are marked **«§»** below.

---

## 1. Decisions

| Question | Choice |
| --- | --- |
| Isolation scope | **Full per-school isolation** — every account sees only its own school's data |
| Auth provider | **Neon Auth (Managed Better Auth)** — users live in the `neon_auth` schema on the branch |
| Account model | **Multiple users per school, with roles** (`owner`, `staff`) |
| Deferred for v1 | Email verification, password reset, device QR token expiry/rotation (see §10) |

### Why Neon Auth
- Managed service; user records + sessions stored in a `neon_auth` schema on our
  existing branch (project `broad-haze-02751607`, branch `production`).
- Issues a **JWT** (`access_token`) with claims `sub`, `email`, `role`, `exp`.
- Session cookie is `__Secure-neon-auth.session_token` (HttpOnly, `SameSite=None`,
  `Secure`, `Partitioned`, HTTPS-only, opaque — **not** the JWT). «§» Actual name
  from provisioning.
- Verified server-side against the service **JWKS**, no shared secret needed.

---

## 2. Architecture

```
Browser (static site)
  ├─ auth.html + auth-client.js   ← sign up / sign in, holds session, mints JWT
  └─ index.html / index_g.html    ← redirect here if no session; account menu
        │  Authorization: Bearer <jwt>
        ▼
Netlify Functions (netlify/functions)
  ├─ /api/me       GET  session+school+role   POST onboarding (create school)
  ├─ /api/buses    GET  school-scoped live fleet
  ├─ /api/assign   POST school-scoped route assignment
  ├─ /api/register POST school-scoped device pairing
  └─ /api/report   POST device code+token only  (UNCHANGED, no user auth)
        │  pg
        ▼
Postgres: schools, school_members, routes, stops, live_devices(school_id), live_positions
```

The **server** is the real gate. The client redirect to `auth.html` is UX only —
every data endpoint independently verifies the JWT and scopes by `school_id`.

---

## 3. Provisioning (Neon CLI)

`neon` v8.3.5 is installed and scoped via `.neon`
(`org-soft-brook-93805708` / project `broad-haze-02751607` / branch `production`).
The Neon MCP is returning 401, so **all cloud ops go through the CLI**.

```sh
neon neon-auth enable                       # creates neon_auth schema; note base_url + jwks_url
neon neon-auth status                        # confirm enabled; capture base_url / jwks_url
neon neon-auth domain allow-localhost        # dev: allow http://localhost:4174
neon neon-auth config email-password         # ensure email+password auth enabled
```

At deploy time:

```sh
neon neon-auth domain add <netlify-site-domain>
```

Capture from `enable`/`status`: `base_url` (→ `NEON_AUTH_URL`) and `jwks_url`
(→ `NEON_AUTH_JWKS_URL`).

«§» Provisioned values (project `broad-haze-02751607`, branch `production`):
- base_url `https://ep-curly-fire-b304c0af.neonauth.c-4.ap-southeast-1.aws.neon.tech/neondb/auth`
  → `NEON_AUTH_URL` (**includes** `/neondb/auth`)
- jwks_url `.../neondb/auth/.well-known/jwks.json` → `NEON_AUTH_JWKS_URL`
- **Sign-in API lives at the base URL itself, not under `/auth`**: the REST
  endpoints are `POST {base}/sign-up/email`, `POST {base}/sign-in/email`,
  `GET {base}/token`, `POST {base}/sign-out`. Sign-up/sign-in require an `Origin`
  header. «§»
- **JWT `iss`/`aud` are the origin only** (no `/neondb/auth` path) →
  `NEON_AUTH_ISSUER` = `https://ep-curly-fire-b304c0af.neonauth.c-4.ap-southeast-1.aws.neon.tech`
- **Sign-out gotcha:** `POST {base}/sign-out` requires `Content-Type:
  application/json` with a body `{}` — an empty body returns 400, omitting the
  header returns 415. «§»

> This is the only step that mutates cloud state (creates the `neon_auth` schema
> on `production`). Approved by the user.

---

## 4. Data model — `migrations/003_schools.sql`

```sql
create table if not exists schools (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- user_id == Neon Auth JWT "sub"
create table if not exists school_members (
  school_id  uuid not null references schools(id) on delete cascade,
  user_id    text not null,
  role       text not null check (role in ('owner','staff')),
  created_at timestamptz not null default now(),
  primary key (school_id, user_id)
);

alter table live_devices
  add column if not exists school_id uuid references schools(id) on delete set null;

-- per-school route templates (seeded from data.js: the 6 Stonehill routes)
create table if not exists routes (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references schools(id) on delete cascade,
  code       text not null,          -- 'R1'..'R6'
  name       text not null,
  color      text,
  unique (school_id, code)
);

create table if not exists stops (
  id        uuid primary key default gen_random_uuid(),
  route_id  uuid not null references routes(id) on delete cascade,
  seq       int  not null,
  name      text not null,
  lat       double precision not null,
  lng       double precision not null,
  traffic   text,                    -- per-segment traffic hint
  unique (route_id, seq)
);
```

- Leave the `neon_auth` schema untouched.
- Seed a **Stonehill** school + its 6 routes/stops from `data.js` so the existing
  demo continues to render.
- `live_devices.school_id` is nullable at first; devices created before auth have
  no school and are hidden from all schools until re-registered.

Apply directly with `node` + `pg` (MCP is down); `.env.local` gives `DATABASE_URL`.

---

## 5. Backend (`netlify/functions/`)

Functions are **CommonJS**. `jose` v5 is ESM-only, so either pin `jose@^4` (works
with `require`) or use `const { jwtVerify, createRemoteJWKSet } = await import('jose')`
inside the async handler. Prefer the dynamic `import()`.

### `_shared.js` additions
- Extend CORS to allow the bearer header:
  `'Access-Control-Allow-Headers': 'Content-Type, Authorization'`.
- `async function requireUser(event)` → read `Authorization: Bearer`, verify with
  `jwtVerify(token, createRemoteJWKSet(new URL(NEON_AUTH_JWKS_URL)), { issuer: NEON_AUTH_URL })`,
  return `{ userId: payload.sub, email: payload.email }` or throw a 401.
- `async function membership(client, userId)` → `{ schoolId, role }` or null.
- Helper for a `401`/`403` response.

### Endpoint changes
| Endpoint | Change |
| --- | --- |
| `GET /api/buses` | require user; join `live_devices.school_id = membership.school_id` |
| `POST /api/assign` | require user; reject if device not in caller's school |
| `POST /api/register` | require user; stamp `school_id` on the new device |
| `POST /api/report` | **unchanged** — device `code`+`token` only |
| `GET /api/me` (new) | session + school + role; used by the gate/onboarding |
| `POST /api/me` (new) | onboarding: create `schools` row + `owner` membership |

---

## 6. Frontend

### `auth.html` + `auth-client.js` (new) «§»
- **No SDK / CDN import** — the client calls the Neon Auth REST endpoints directly
  with `credentials: 'include'`: `sign-up/email`, `sign-in/email`, `sign-out`
  (see §3 gotcha), and `token` (mints the JWT from the session cookie).
- Two tabs: **Sign up** (`name`, `email`, `password`) and **Log in** (`email`, `password`).
- `requireSession()` → redirect to the dashboard when a session exists.
- `apiFetch(path, opts)` → adds `Authorization: Bearer <jwt>`; refreshes the JWT
  (`token` endpoint) once when a call gets a 401.
- Keep JWT in memory; token refresh relies on the session cookie.
- `AUTH_BASE` defaults to the Neon base URL, overridable via `window.NEON_AUTH_URL`.

### Gate + account menu (existing pages)
- `index.html` and `index_g.html`: on load, if no session → `location.replace('auth.html')`.
- Header account menu: school name, role, **Sign out**.

### `app.js`
Swap the three data fetches to `apiFetch`:
- `app.js:1183` `GET /api/buses`
- `app.js:1283` `POST /api/assign`
- `app.js:1346` `POST /api/register`

`API_BASE = window.API_BASE || ''` (`app.js:48`) is unchanged.
`live.html` is unchanged (device page, uses `/api/report`).

---

## 7. Dev harness — `tools/dev-server.js`

The harness builds the function `event` **without `headers`**, so bearer tokens
never reach the handlers. Add `headers: req.headers` when constructing the event.
(Handlers are registered at startup, so **restart the server** after edits.)

---

## 8. Env & dependencies

`.env.local` (gitignored):

```
NEON_AUTH_URL=<base_url from CLI>
NEON_AUTH_JWKS_URL=<jwks_url from CLI>
NEON_AUTH_ISSUER=<base_url from CLI>
DATABASE_URL=...            # already present
```

Netlify: set the three `NEON_AUTH_*` vars in the site environment.

`package.json`: add `jose` (`jose@6`, ESM-only → dynamic `import()` in the CJS
function) for server-side JWT verification. The client uses the REST endpoints
directly — no SDK, no bundler. «§»

---

## 9. Testing

- **Playwright E2E**: unauthenticated `index.html` → redirects to `auth.html`;
  sign up → onboarding → dashboard renders only school data; a second account sees
  a different (empty) school; `/api/report` still works with a device token.
- `node --check` on every changed JS file.
- Regression: `index.html` (Leaflet) and `index_g.html` (Google Maps) both still
  render; 0 console errors.
- No lint/typecheck script exists; only `npm run dev`.

---

## 10. Deferred for v1 (with upgrade path)

| Deferred | v1 behavior | Upgrade path |
| --- | --- | --- |
| **Email verification** | Anyone can sign up (Neon Auth default) | Enable verification via `neon neon-auth config email-password`; block unverified users in `requireUser` |
| **Password reset** | Not offered; contact admin | Configure `neon neon-auth config email-provider` (SMTP) and expose a reset link |
| **Device QR token expiry/rotation** | Static `code`+`token` | Add `token_expires_at` / rotate endpoint in `register.js`; enforce in `report.js` |

Mitigation for open signups during v1: manually review/clean the `schools` table.

---

## 11. Risks

- **No bundler** — SDK loaded via ESM CDN; REST fallback if the import fails.
- **Cross-site session cookie** (`SameSite=None; Secure`) — if the browser blocks
  it, JWT refresh after ~15 min fails and the user re-signs in. Acceptable for v1.
- **Neon MCP 401** — all provisioning/migrations go through the CLI / direct `pg`.
- **CORS** must add `Authorization` to allowed headers or bearer calls fail
  preflight.

---

## 12. Execution order

1. ~~Commit the Google Maps variant~~ — done (`4647319 Needs API`).
2. ~~Phase A — provision via Neon CLI; capture URLs~~ — done.
3. ~~Phase B — `migrations/003_schools.sql` + seed Stonehill~~ — done.
4. ~~Phase C — `_shared.js` `requireUser`; scope `buses`/`assign`/`register`; add `me.js`~~ — done.
5. ~~Phase D — `auth.html` + `auth-client.js`; gate + account menu; `apiFetch` in `app.js`~~ — done.
6. ~~Phase E — forward `req.headers` in `tools/dev-server.js`~~ — done.
7. ~~Phase F — env + `jose`~~ — env vars + `jose@6` installed; this doc is the
   plan-deferral record; **todo at deploy:** set `NEON_AUTH_URL`,
   `NEON_AUTH_JWKS_URL`, `NEON_AUTH_ISSUER` in Netlify site env.
8. ~~Verify — Playwright E2E + `node --check` + regression~~ — done (below).

---

## 13. Verification status

| Check | Result |
| --- | --- |
| Curl: sign-up → sign-in → `/token` JWT → `/api/me` (before/after onboarding) | ✅ |
| `requireUser` 401 with no/invalid token | ✅ |
| Onboarding copies the 6 Stonehill routes + 48 stops to the new school | ✅ |
| School scoping: `test.owner+1` (Testville) vs `test.owner+2` (Riverside) | ✅ each sees only its own fleet |
| Playwright: unauth `/` → `auth.html?next=%2F` | ✅ |
| Playwright: sign up E2E College → onboarding → dashboard, 0 console errors | ✅ |
| Playwright: bearer JWT attached to `/api/me` + `/api/buses` | ✅ |
| Playwright: live device (Add Bus → pairing `B6GFFP`) → `/api/report` → appears on map as **E2E Shuttle** | ✅ Total Buses 6→7 |
| Isolation: Riverside (via curl) does **not** see E2E Shuttle | ✅ `buses: []` |
| Playwright: Google variant `index_g.html` gate + account menu; only `InvalidKeyMapError` (keyless) | ✅ |
| Playwright: Sign out → `auth.html`; re-gate on return | ✅ (after `{}` body fix) |
| `node --check` on all changed JS | ✅ |
| Neon Auth session-cookie flow (token refresh post-expiry) | not yet tested long-run; v1 risk |

Test accounts: `test.owner+1@example.com`, `test.owner+2@example.com`,
`e2e.owner2@example.com` (password `Passw0rd!234`).

Still to do: final commit; add Netlify env vars; decide on `docs/plan.md`
(currently deleted in the working tree, uncommitted).
