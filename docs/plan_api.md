# Plan — Compulsory per-school Google Maps API key

Status: **planned** (not yet implemented)
Depends on: `docs/plan_auth.md` (school accounts & per-school isolation)

## Goal

Capture a **Google Maps API key** as part of the authentication flow and store it
per school, then make **Google Maps the only map** on the dashboard. The key is a
**required** input — a school without a key is an invalid state and must be sent
back to a "set your key" step before the dashboard loads.

## Decisions (confirmed)

- Key input lives on the **onboarding** step (create school) **and** on a dedicated
  **School settings** page (update later). Both inputs are **compulsory**.
- The dashboard **always** uses Google Maps (Leaflet is removed).
- The key is **stored as-is**; no server-side validation call to Google. Format is
  checked; an invalid key is surfaced by the existing `gm_authFailure` handler.
- `index_g.html` is **deleted** (its Google Maps setup moves into `index.html`).
- Existing schools without a key are **forced** to set one on next login.
- Settings live on a **dedicated `settings.html`** page reached from the account menu.

## Current state (relevant facts)

- `auth.html` has three forms: Log in, Sign up, and Onboard (create school).
  `BusAuth.onboard(name)` posts to `/api/me` (`netlify/functions/me.js`), which
  inserts into `schools` + `school_members` and copies the Stonehill route template.
- `schools` has **no** key column yet.
- Google Maps is currently isolated to `index_g.html`: it loads
  `google-maps-adapter.js` (defines `window.L` over `google.maps`) and a **static**
  loader `<script async src="...maps/api/js?key=GOOGLE_MAPS_API_KEY...">` with a
  hardcoded placeholder. `app.js` waits on `BusAuth.ready`, then runs `drawMap()` on
  a timer, so a late-arriving map script still renders.
- `index.html` currently uses free Leaflet tiles (`L.tileLayer(...cartocdn...)`).
- The auth gate (`startGate` in `auth-client.js`) redirects to `auth.html` when there
  is no session or no school.

## Plan

### 1. Migration — `migrations/004_school_key.sql` (new)

```sql
-- Phase 7 · per-school Google Maps API key.
-- Applies AFTER 003_schools.sql. Idempotent.
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS google_maps_api_key text;
```

The column stays **nullable at the DB level** (legacy rows exist); presence is
enforced by the application. No default and no seed value.

### 2. Backend — `netlify/functions/me.js`

- Add `normalizeKey(v)`:
  - `String(v).trim()`
  - empty/undefined -> invalid
  - length <= 128
  - charset `^[A-Za-z0-9_\-]+$`
- `POST` (onboarding): **require** `googleMapsApiKey` (400 if missing/invalid)
  alongside `name`; insert both into `schools`.
- `PUT` (new — settings): require a membership; update the caller's school
  `name` + `google_maps_api_key`. Both required.
- `GET`: return `school: { id, name, role, googleMapsApiKey }`.
  - The key is served only to members of that school, which is acceptable for the
    Maps JavaScript API (its real protection is referrer/API restriction).
  - **Never log the key.**

### 3. `auth-client.js`

- `onboard(name, googleMapsApiKey)` — include the key in the POST body.
- New `updateSchool({ name, googleMapsApiKey })` -> `PUT /api/me`.
- New `loadGoogleMaps(key)` — idempotent loader-script injector, exposed as
  `BusAuth.loadGoogleMaps`. Injects
  `https://maps.googleapis.com/maps/api/js?key=<key>&v=weekly&loading=async` once.
- Gate change: if `info.school` exists but has **no** `googleMapsApiKey`,
  redirect to `auth.html?next=<current>&setup=key`.
- `renderAccountMenu`: add a **School settings** link -> `settings.html`.

### 4. `auth.html`

- Onboarding form: add a required **Google Maps API key** input plus a hint
  ("Enable the Maps JavaScript API and restrict the key to this domain").
- Handle the `setup=key` param:
  - if a session + school already exist -> `updateSchool(...)`
  - else -> `onboard(...)`
- Carry the key through the sign-up -> onboard path.

### 5. `settings.html` (new, gated)

- `data-require-auth` page (reuses the `auth-client.js` gate).
- Fields: School name + Google Maps API key (**both required**).
- Submits via `BusAuth.updateSchool`; shows success; back link to the dashboard.

### 6. `index.html` — becomes the Google Maps dashboard

- Remove the Leaflet CSS/JS includes; load `google-maps-adapter.js` instead.
- Move the `window.gm_authFailure` handler (invalid-key UI) here from `index_g.html`.
- Inline: on `BusAuth.ready`, call
  `BusAuth.loadGoogleMaps(info.school.googleMapsApiKey)`.
  `app.js` already re-runs `drawMap()` on a timer, so the map appears once the API
  finishes loading.
- Retire the hardcoded `GOOGLE_MAPS_API_KEY` placeholder entirely.

### 7. `index_g.html`

- **Delete.** It is redundant once Google Maps is the default dashboard.

### 8. `netlify.toml`

- Add `/settings` -> `/settings.html` redirect (pretty URL).
- (No change needed for `PUT /api/me`; it is the same path as `GET`/`POST`.)

## Verification

- Apply the migration on a temporary branch and confirm the column exists.
- `node --check` on every changed JS file.
- Dev E2E (local dev server, e.g. `PORT=4174`):
  - Onboarding **rejects** a missing/invalid key; **accepts** a valid key.
  - `/api/me` GET returns the stored key for a member.
  - A keyless legacy school is forced to `auth.html?...&setup=key` on login.
  - `settings.html` update persists (name + key).
  - `index.html` renders the Google base map using the school's key.
  - Isolation: another school's member cannot read the key.
  - Confirm the key is never written to logs.
- Rebuild/redeploy via the Netlify CLI (draft -> verify -> promote), as in the prior
  auth deployment.

## Out of scope / known risks

- No live validation of the key against Google (by decision).
- The ~15-minute JWT refresh and the site's half-linked Netlify Git state are
  unchanged by this work; deploys stay CLI-based until the Netlify GitHub App is
  installed.
- Google Maps JS API keys are inherently client-visible; the intended safeguard is
  HTTP-referrer + API restriction configured by the school in Google Cloud.
