# Stonehill Smart Bus Dashboard — Plan

Live school-transportation dashboard for Stonehill International School (Bengaluru).
Static frontend (HTML/CSS/JS + Leaflet + Chart.js) with simulated fleet, extended with
real-time Google Maps tracking and a "Add Bus" device-pairing flow.

---

## Part 1 — Current system (built & verified, Steps 1–8)

### Stack
- **Static site**: `index.html`, `styles.css`, `data.js`, `app.js` — no build step, no server.
- **Map**: Leaflet 1.9.4 + CARTO/OSM tiles (light basemap), ~Bengaluru area.
- **Charts**: Chart.js 4.4 doughnut for attendance.
- **Deploy**: static drop on Netlify (`netlify.toml`, `publish = "."`).

### Data model (client-side, `data.js`)
- `SCHOOL` — school lat/lng + short name.
- `ROUTES` — 6 Bengaluru routes (`ROUTES[].stops[]` with real lat/lng, per-segment `traffic[]`
  in `green|yellow|red`, optional `alt` route) matching the plan's route names:
  Whitefield, Sarjapur Road, Marathahalli, Indiranagar, KR Puram, Electronic City.
- `BUSES` — 6 simulated buses (`routeId`, `driver`, `phone`, `capacity`, `students[]`),
  each student string `name|class|stopIndex[|absent]`.
- `SEED_ALERTS` — initial alert list.

### Simulation (in `app.js`)
- `TIME_SCALE = 6` real-time acceleration; tick every `TICK_MS = 2000`.
- Buses advance along their active route at traffic-dependent speeds; delay decays 0.5
  every 5 ticks; traffic fluctuates every 8 ticks; buses recycle after arrival (~15 ticks).
- Random alert generation; alerts capped at 8 (newest-first, dismissible).

### Features (Steps 6–7 verified, 0 console errors)
1. **Where is each bus?** — 6 numbered map pins coloured by status, 6 bus-list cards,
   fly-to on select, "Current location: Near <nearest stop>, X% of the way".
2. **When will it arrive?** — ETA in list badge, details panel, per-stop chips and popups,
   tooltips, live countdown.
3. **Traffic** — traffic-coloured route segments, per-bus traffic pill, heavy-traffic stat card
   (`statTraffic` = count of heavy routes), traffic popups.
4. **Students on board** — attendance cards + donut per bus, 16-row roster with search and
   status filter, live flip when the bus passes a boarding stop, `statPresent`.
5. **Faster route** — "Save N min" suggestion with dashed alternate polyline; Accept/Revert.
6. **Responsive** — no horizontal scroll 1600→400px; legend hides < 860px; map min-height 340px.

### Key implementation fixes worth preserving
- `interpolateAlongPolyline()` is **distance-weighted** (cumulative haversine), so bus position,
  `nextStopIndex`, traffic segment, and stop chips (`stopProgressForStop`) all agree.
- `statTraffic` counts routes with a heavy segment, not buses in red.
- Browser tests must disable the cache (CDP `Network.setCacheDisabled`), else stale CSS fakes bugs.

---

## Part 2 — Live-device tracking: backend + "Add Bus" flow

> Status: **Phase 1 (backend) and Phases 3–5 (Add Bus, live.html, dashboard live rendering) are built and verified.**
> **Route assignment for live buses** (assign a paired device to one of the six school routes → stop-based
> ETA, stop progress, snapped marker, on-board attendance) is also built and verified.
> The Google Maps migration is **deferred** pending a Google API key; live tracking runs on the existing
> Leaflet renderer.

### Decisions (confirmed)
- **Backend**: Netlify Functions + Neon Postgres (Neon wired via MCP; project `broad-haze-02751607`,
  branch `production`).
- **Devices ("apple Find My")**: Apple exposes **no public API** for Find My / AirTags, so a third-party
  app cannot read a phone's Find My position. The buildable equivalent users asked for is the **phone's
  own browser GPS** (`live.html`) — which is also more accurate than the Find My network. The device must
  keep the tab open and the screen on while running.
- **Map**: Google Maps swap deferred until a `GMAPS_JS_KEY` exists. Live buses use the existing Leaflet
  map; the renderer swap is a self-contained later change (Part 4).
- **Live-bus scope**: marker + card + ETA to school (Google Directions when a key exists; otherwise
  straight-line distance × ~9 m/s fallback). Unassigned live buses stay simple (no attendance/traffic/
  suggestion machinery). **Once assigned to a route** (Phase 5b) the live bus inherits stop-based ETA,
  stop progress, snapped marker and on-board attendance from the simulated-fleet helpers.
- **Offline threshold**: 45 s by default; overridable via `OFFLINE_AFTER_S` for local tests (min 3).
- **QR**: rendered **server-side** by `register.js` (npm `qrcode` → base64 PNG data URL) — no client CDN
  dependency, works on phones. (The `qrcode@*` npm browser bundle does not ship on CDNs — a client-side
  attempt was removed.)
- **Device test**: real phone scanning a QR (HTTPS required for geolocation; `netlify dev --live` tunnel).

### Architecture

```
 Device phone (live.html)          Netlify                 Neon Postgres          Dashboard
 ┌─────────────────────┐   POST /api/report ┌──────────────┐   live_devices     ┌──────────────────┐
 │ navigator.geolocation│ ────────────────▶ │ Netlify Function│ ─upsert/insert─▶ │                 │
 │ watchPosition ~3s    │  code+token+latlng│ Roads snap +   │                  │ polls /api/buses │
 │                      │ ◀────────────────┤ Directions ETA │   live_positions  │ every ~2s        │
 │ (HTTPS: netlify dev  │        ok/err     │  validation    │                  │ Leaflet markers  │
 │   --live / preview)  │                   └───────────────┘                  │ move (no redraw) │
 └──────────────────────┘                                                      └──────────────────┘
```

### Phase 0 — Prerequisites (user-side; unblocks Google Maps + Roads/Directions ETA)
- Google Cloud Console: API key with **Maps JavaScript**, **Directions**, **Roads** enabled.
  - JS key (`GMAPS_JS_KEY`): restrict by HTTP referrer (Netlify domain).
  - Server key (`GMAPS_KEY`): restrict by IP; used only inside Netlify Functions.
- Env vars on Netlify: `GMAPS_KEY`, `GMAPS_JS_KEY`, `DATABASE_URL` (Neon pooled).
- Without these the dashboard ships on Leaflet with the distance-based ETA fallback (current state).

### Phase 1 — Backend (Netlify Functions + Neon) — ✅ built & verified
- Neon migration applied (`migrations/001_live_tracking.sql`):

  ```sql
  CREATE TABLE live_devices (
    code       TEXT PRIMARY KEY,          -- 6-char pairing code
    token      TEXT NOT NULL,             -- device secret
    label      TEXT NOT NULL,             -- e.g. "Bus 7"
    color      TEXT,                      -- marker colour hex
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen  TIMESTAMPTZ               -- NULL until first fix
  );

  CREATE TABLE live_positions (
    device_code TEXT REFERENCES live_devices(code) ON DELETE CASCADE,
    lat  DOUBLE PRECISION NOT NULL,
    lng  DOUBLE PRECISION NOT NULL,
    heading REAL, speed REAL, accuracy REAL,
    ts   TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX live_positions_dev_ts ON live_positions (device_code, ts DESC);
  ```
  A rolling short trail per device is pruned on each report (~10 min, literal interval).

- `netlify/functions/register.js` — `POST /api/register`; creates a device row, returns
  `{ code, token, qrPath, qrDataURL }` (QR = server-rendered PNG data URL).
- `netlify/functions/report.js` — `POST /api/report`; body `{code,token,lat,lng,heading,speed,accuracy}`;
  validates `code+token`; snaps via **Roads API** when `GMAPS_KEY` set (fallback: raw fix), inserts
  `live_positions` + bumps `last_seen`, prunes stale rows.
- `netlify/functions/buses.js` — `GET /api/buses`; latest fix per device + `offline`/`waiting` flags +
  `etaMins`/`etaSource` (Directions when `GMAPS_KEY`, haversine fallback, 30 s cache); live buses also
  appear as waiting (`last_seen` NULL) and offline (`last_seen` stale).
- `netlify.toml`: `functions = "netlify/functions"`, `publish = "."`, `/api/*` redirects.
- Smoke-tested live against Neon: 200/400/401/404/405 paths, offline/waiting flags, ETA fallback.

### Phase 2 — Google Maps migration — ⏸ deferred (no key)
- `index.html`: replace Leaflet CSS/JS with the Maps JS loader; keep Chart.js, `data.js`, `app.js`.
- Rewrite the map section of `app.js` to one Google-native renderer:
  - Traffic-coloured `google.maps.Polyline` per route segment (same colours/legend).
  - Stops → `google.maps.Circle` + `InfoWindow` (same boarding/ETA content as today).
  - Buses → numbered custom markers (`AdvancedMarkerElement` if supported, else `Marker`;
    custom pin), tooltip; selected = larger + name label.
  - Alternate routes → dashed `Polyline` via `icons` (`repeat: '20px'`).
  - 🏫 school marker; direction-arrow overlays; `fitBounds`/`panTo` replace `flyTo`.
  - Graceful banner if `GMAPS_JS_KEY` missing/invalid; page still renders.
- Simulated buses keep today's behaviour (traffic, delays, recycling) — renderer only.
- **Live bus markers** (Leaflet today) must move to the Google renderer too (live card/details stay).

### Phase 3 — "Add Bus" + pairing (dashboard) — ✅ built & verified
- "Add Bus" button in the Buses panel head → modal: bus label (e.g. "Bus 7 · driver phone"), colour swatch.
- Submit → `POST /api/register` → show **6-char code + QR** (server-rendered data URL in an `<img>`).
- Bus appears in the Buses list immediately as "Waiting for device"; live marker renders once the first
  fix arrives; bus count = simulated + live (online live buses count toward "On time").
- Live buses show a distinct live badge/icon; excluded from present/delayed/attendance counts.

### Phase 4 — Device live page (`live.html`) — ✅ built & verified
- Reads `?c=CODE&t=TOKEN`; requests permission →
  `navigator.geolocation.watchPosition({ enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 })`.
- POSTs `/api/report` every ~3 s; status UI ("Connected · accuracy · speed · last sent"); Start/Stop;
  graceful permission-denied message with iOS/Android Settings guidance.

### Phase 5 — Dashboard live rendering — ✅ built & verified
- Poll `GET /api/buses` every 2 s; `setLatLng()` moves existing Leaflet markers (no full redraw);
  update card and details (Last seen, Speed, Heading, Coords, ETA to school).
- Offline alert (throttled once per device) when stale > threshold; marker greys out (`offline` class).

### Phase 5b — Route assignment for live buses — ✅ built & verified
- A paired live device can be **assigned to a school route** (R1–R6) or left unassigned ("No route").
  Assignment is **persisted server-side** (`live_devices.route_id`, `migrations/002_route_assignment.sql`)
  so it survives reloads and applies on every dashboard.
- `netlify/functions/assign.js` — `POST /api/assign` body `{ code, routeId }` (`routeId` ∈ `'1'..'6'` or
  `null`/`""` to unassign); 404 on unknown pairing code. `buses.js` now returns `route_id` per device.
- When assigned, the live bus reuses the simulated-fleet helpers (per-segment traffic-weighted ETA):
  - **Next stop / progress / ETA to next stop / ETA to school** rows in the details panel and route code
    on the bus-list card.
  - **Marker snapped** to the nearest point on the assigned route polyline (`liveMarkerPos` →
    `projectOntoPolyline`), so it sits on the road rather than the raw fix.
  - **On-board attendance** mirrors sim semantics (`liveAttendanceCounts`: present = reached & not absent,
    absent counted regardless, expected = not-yet-reached & not absent; total = present+absent+expected).
  - Route chips/stops highlighted on the map when a live bus with a route is selected
    (`assignLiveRoute` sets `state.selectedRouteId`).
- Unassigned/offline behaviour preserved: falls back to straight-line ETA and the
  "not on a fixed school route" note; offline assigned devices show "—" (never a stale route ETA).
- Verified end-to-end (Playwright, 0 console errors): assign R1 at Whitefield → next stop
  "Hope Farm Junction", marker snapped, 1 on board · 13 expected · 2 absent; move GPS to Budigere Cross →
  next stop "Hunasamaranahalli", 32% · 5 of 8 stops, on-board 1→9; unassign → straight-line ETA restored;
  assign R2 while offline → STATUS Offline, NEXT STOP "—", NOTE "snapped onto the assigned route".

### Phase 6 — Test & verify (real phone via QR) — automated pass ✅ / phone run pending
- Local run: `netlify dev --live` (HTTPS tunnel — geolocation requires HTTPS; LAN IP won't work).
  Alternative: Netlify deploy preview. Dev harness: `npm run dev` (tools/dev-server.js,
  serves static + mounts the three handlers at `/api/*`; `OFFLINE_AFTER_S=4` for fast tests).
- Automated harness (done): Playwright with `context.setGeolocation` + `grantPermissions(['geolocation'])`.
  1. Add Bus → QR data URL → (simulated) device opens link → marker appears & moves → ETA updates.
  2. Stop the device → offline alert + grey marker within threshold.
  3. Re-open → marker resumes.
  4. Part 1 regression pass at desktop width — 0 console errors, sim features intact.
- Physical run (user): scan QR with a real phone, grant location, keep screen on.
- Update README/docs: key setup, device instructions, "Run live" quickstart.

### Assumptions / notes
- **Find My**: no public API — phone-browser GPS is the buildable equivalent (user-confirmed direction).
- **Roads API coverage**: Bengaluru metro roads are covered; unmatched points fall back to raw GPS
  (accuracy shown).
- **Directions quota**: ETA cached server-side ≥ 30 s per bus; fallback = straight-line distance ×
  ~9 m/s if Directions is skipped/absent.
- **Security**: device `token` authorizes only that device's `report`; API keys stay server-side (JS key
  referrer-restricted); `GET /api/buses` is public (dashboard view).
- **Deploy env**: Netlify must get `DATABASE_URL` (Neon pooled) + optional `GMAPS_KEY`/`GMAPS_JS_KEY`;
  package.json holds `pg` + `qrcode` (function deps). HTTPS required for phone geolocation.

---

## Part 3 — Files touched by the feature

| File | Change |
|------|--------|
| `netlify.toml` | `functions = "netlify/functions"`, `/api/*` redirects, `publish = "."` |
| `netlify/functions/register.js` | new — create device + pairing code + server-side QR data URL |
| `netlify/functions/report.js` | new — validate, snap, store position |
| `netlify/functions/buses.js` | new — live list + cached ETA/fallback + offline/waiting flags + `route_id` |
| `netlify/functions/assign.js` | new — `POST /api/assign` assign/unassign a live device to a route |
| `migrations/001_live_tracking.sql` | new — live_devices / live_positions schema |
| `migrations/002_route_assignment.sql` | new — `route_id TEXT` on live_devices (idempotent) |
| `index.html` | Add Bus button + pairing modal (img QR) |
| `live.html` | new — device geolocation sender |
| `tools/dev-server.js` | new — local harness (static + `/api/*` handlers), `npm run dev` |
| `app.js` | Add Bus modal, live cards/markers/details, 2 s poll, offline alerts, route assignment |
| `styles.css` | Add Bus modal, swatches, live badges, live-marker states |
| `package.json` | deps `pg`, `qrcode`; `dev` script |
| `.gitignore` | ignore `.neon`/`.env.local`/`node_modules`/`.playwright-mcp` |
| `docs/plan.md` | this document |

## Part 4 — Build order (as executed)
1. Phase 1 — Neon schema (applied) + three Netlify functions + `netlify.toml` — smoke-tested. ✅
2. Phase 3 — Add Bus modal + pairing + server-side QR. ✅
3. Phase 4 — `live.html` device page. ✅
4. Phase 5 — dashboard live poll + rendering + offline alerts. ✅
5. Phase 6 — Playwright end-to-end pass (register → QR → fake GPS → live marker/movement → ETA →
   offline) + regression pass + docs. ✅
6. Phase 5b — route assignment for live buses: migration `002`, `/api/assign`, dashboard route select,
   snapped marker, stop-based ETA/progress/attendance. ✅
7. Phase 2 — Google Maps migration — **deferred** until a `GMAPS_JS_KEY`/`GMAPS_KEY` is provided.
8. Real-phone run via `netlify dev --live` (HTTPS) — pending user.