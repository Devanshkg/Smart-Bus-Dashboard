# Stonehill Smart Bus Dashboard — Implementation Plan

A modern, simple school transportation dashboard for Stonehill International School, built for the transport team and teachers to monitor buses, routes, traffic, student attendance, and estimated arrival times.

---

## 1. Constraints & Decisions

| Decision | Choice |
|---|---|
| Tech stack | Plain HTML, CSS, JavaScript (no framework, no build step) |
| Deployment | Static site on Netlify (drop folder or connect repo) |
| Map | Leaflet + free OSM/CartoDB Positron tiles — no API key, no cost |
| Data | Realistic simulated sample data for Bus 1–6, students, routes, traffic |
| Behaviour | Live ticking simulation (buses move, ETAs count down, traffic shifts) |
| Key libraries (CDN) | Leaflet (map), Chart.js (attendance donut) |

### Files

```
index.html      — layout, panels, legend, modals
styles.css      — blue/white/grey theme, projector-scale typography
data.js         — 6 buses, 6 routes, ~90 students, drivers, stops, traffic
app.js          — map init, simulation engine, selection state, rendering
docs/plan.md    — this plan
```

---

## 2. Main Layout (CSS Grid)

```
┌──────────── Header: title + live date/time ────────────┐
│ Summary: Total Buses | On Time | Delayed | Students    │
│ Present | Heavy Traffic Alerts                        │
├──────────┬─────────────────────────────────────────────┤
│ Bus list │              Leaflet MAP                   │
│ (Bus 1–6,│   bus markers, route polylines, stops,     │
│ status   │   traffic-coloured segments, ETA labels    │
│ dots)    ├──────────────┬──────────────┬───────────────┤
│          │ Bus Details  │ Route /      │ Student       │
│ Alerts   │ Panel        │ Optimization │ Attendance    │
│ feed     │              │ Panel        │ Panel         │
└──────────┴──────────────┴──────────────┴───────────────┘
Legend (map overlay, collapsible)
```

- Responsive: panels stack vertically below ~1100px.
- Projector-first: 16–18px base font, large bold labels, high contrast.

---

## 3. Components

### 3.1 Header
- Title: **“Stonehill Smart Bus Dashboard”**.
- Live date/time (updates every second via `Intl.DateTimeFormat`).

### 3.2 Summary section (top)
Computed from live data:
- **Total Buses** (6)
- **Buses On Time**
- **Delayed Buses**
- **Students Present**
- **Heavy Traffic Alerts** (red badge when > 0)

### 3.3 Bus list (left sidebar)
- Bus 1 – Bus 6, driver name, coloured status indicator:
  - 🟢 Green = **On Time**
  - 🟡 Amber = **Delayed**
  - 🔵 Blue = **Arriving**
- ETA badge per bus.
- **Selecting a bus** flies the map to it and updates every panel (details, attendance, route).

### 3.4 Interactive map (centre/right, ~55% of screen)
- Bus markers as numbered, colour-coded `divIcon`s with pulsing halo on selection + tooltip (name, ETA, next stop, traffic).
- Route polylines split into **traffic-coloured segments**:
  - 🟩 Green = clear
  - 🟨 Yellow = moderate
  - 🟥 Red = heavy
- Bus stop markers (circles) with popup: stop name, students boarding, ETA.
- Direction indicator toward school.
- Selected route drawn thicker/brighter; others faded.
- **Route selector** (chips/dropdown): shows ordered stops, per-stop ETA, and total travel time.

### 3.5 Route optimization panel
- Shows **current route** with stops + travel time.
- When traffic on that route is high, shows a **suggested shorter/faster route** as a dashed alternate polyline on the map, with “Save N min” badge and **Accept / Dismiss** buttons (Accept swaps the active route).

### 3.6 Student attendance panel
- Per-bus totals: **Present / Absent / Expected** + donut chart.
- Bus selector filters a roster table: student name, class, stop, status pill (**On Bus / Absent / Expected**).
- Search box + status filter.
- Statuses update live: students flip to *On Bus* as their bus passes their stop; a few seeded as *Absent*.

### 3.7 Bus details panel
- Bus number, driver (name + phone), current location (nearest landmark), next stop, ETA, traffic level, route, students present/total, capacity bar.

### 3.8 Alerts / notifications feed
- Auto-generated messages, e.g. **“Bus 3 delayed by 12 minutes due to heavy traffic.”**
- Newest first, coloured left border (red/amber/blue), dismissible, capped at ~8.

### 3.9 Legend (map overlay)
- Status colours, traffic colours (green/yellow/red), bus icon, stop icon, current route vs suggested route.

---

## 4. Live Simulation Engine

- Each bus has: `routeId`, `progress` (0→1), `speed`, `status`, `delayMin`.
- **Tick every ~2s**: advance progress along the polyline (interpolation), recompute nearest/next stop, ETA = remaining distance ÷ effective speed + delay.
- **Traffic**: segment levels per route; escalate/de-escalate roughly every 30s → triggers alerts when a route turns Heavy or a bus crosses a delay threshold; drives the route-optimization suggestion.
- **Students**: start as *Expected*, flip to *On Bus* when their stop is reached; some fixed *Absent*.
- Random delay events feed the alert feed.

### Seeded state at first paint
3 buses On Time, 2 Delayed (Bus 3 = heavy traffic, 12 min delay), 1 Arriving — so summary and alerts look alive immediately.

---

## 5. Sample Data (realistic, Bengaluru context)

- **6 routes:** Whitefield, Sarjapur Road, Marathahalli, Indiranagar, KR Puram, Electronic City — each 6–8 stops ending at Stonehill International School.
- **Drivers** with names and phone numbers; bus capacity 40.
- **~90 students** with names, classes (Grade 1–10), assigned stop, status.

---

## 6. Design

- Palette: primary blue `#0B5FD9`, white panels, light-grey background `#F1F4F9`.
- Status: green `#16A34A`, amber `#F59E0B`, red `#DC2626`.
- Pill badges, subtle shadows, rounded cards, dark header bar for anchoring.
- Minimal clutter, large readable text, strong colour contrast, clear icons.

---

## 7. Key Goal

Staff can instantly answer:
1. **Where is each bus?** → map + bus list
2. **When will it arrive?** → ETA in bus list, details panel, stop popups
3. **How much traffic?** → coloured route segments + traffic level
4. **Which students are on the bus?** → attendance panel / roster
5. **Is there a faster route?** → route optimization panel

---

## 8. Verification

- All 6 buses selectable → map fly-to + panels update.
- Route switching highlights stops and travel time.
- Optimization suggestion appears when traffic escalates.
- Attendance roster filters and status updates.
- Alerts generate; clock and ETAs tick.
- Responsive check + clean browser console.
- Netlify deploy preview works from static files.
