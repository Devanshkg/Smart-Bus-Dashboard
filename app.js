/* Stonehill Smart Bus Dashboard — app logic
   Map, simulation, rendering, selection state */

const state = {
  selectedBusId: null,
  selectedRouteId: null,
  usingAlt: new Set(), // routeIds using alternative route
  dismissedSugg: new Set(), // routeIds whose suggestion was dismissed
  tick: 0,
  startedAt: Date.now(),
  alerts: SEED_ALERTS.map(a => ({ ...a, ts: Date.now() }))
};

const mapEl = document.getElementById('map');
const busListEl = document.getElementById('busList');
const alertListEl = document.getElementById('alertList');
const clockTimeEl = document.getElementById('clockTime');
const clockDateEl = document.getElementById('clockDate');

const statTotal = document.getElementById('statTotal');
const statOnTime = document.getElementById('statOnTime');
const statDelayed = document.getElementById('statDelayed');
const statPresent = document.getElementById('statPresent');
const statTraffic = document.getElementById('statTraffic');
const alertCount = document.getElementById('alertCount');
const busCountHint = document.getElementById('busCountHint');

const routeChipsEl = document.getElementById('routeChips');
const busDetailsEl = document.getElementById('busDetails');
const routeOptEl = document.getElementById('suggestionBox') || document.getElementById('routePanel');
const routeTravelHintEl = document.getElementById('routeTravelHint');
const routeNameEl = document.getElementById('routeName');
const routeStopsEl = document.getElementById('routeStops');
const suggestionBoxEl = document.getElementById('suggestionBox');
const detailsStatusBadgeEl = document.getElementById('detailsStatusBadge');
const capacityTextEl = document.getElementById('capacityText');
const capacityBarEl = document.getElementById('capacityBar');
const rosterBodyEl = document.getElementById('rosterBody');
const studentSearchEl = document.getElementById('studentSearch');
const statusFilterEl = document.getElementById('statusFilter');
const legendEl = document.getElementById('legend');
const legendToggleEl = document.getElementById('legendToggle');
const attBusSelectEl = document.getElementById('attBusSelect');
const attPresentEl = document.getElementById('attPresent');
const attAbsentEl = document.getElementById('attAbsent');
const attExpectedEl = document.getElementById('attExpected');

const API_BASE = window.API_BASE || '';
const LIVE_POLL_MS = 2000;
const SWATCH_COLORS = ['#2563EB', '#0F766E', '#7C3AED', '#BE185D', '#B45309', '#047857', '#DB2777', '#334155'];

const addBusBtnEl = document.getElementById('addBusBtn');
const modalEl = document.getElementById('addBusModal');
const modalCloseEl = document.getElementById('modalClose');
const modalStepForm = document.getElementById('modalStepForm');
const modalStepDone = document.getElementById('modalStepDone');
const busLabelEl = document.getElementById('busLabel');
const swatchesEl = document.getElementById('swatches');
const registerBusBtn = document.getElementById('registerBusBtn');
const pairCodeEl = document.getElementById('pairCode');
const pairQREl = document.getElementById('pairQR');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const modalDoneBtn = document.getElementById('doneBtn');
const modalErrEl = document.getElementById('modalErr');

let leafletMap = null;
let routeLines = {};
let altRouteLines = {};
let busMarkers = {};
let stopMarkers = {};
let dirMarkers = {};
let schoolMarker = null;
let chart = null;
let liveBuses = new Map(); // device code -> live bus snapshot
let liveMarkers = {};      // device code -> L.Marker
let livePollTimer = null;
let swatchSel = 0;
let pairing = null;        // last registered device { code, token, label, color, qrPath }

function initClock() {
  updateClock();
  setInterval(updateClock, 1000);
}

function updateClock() {
  const now = new Date();
  clockTimeEl.textContent = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(now);
  clockDateEl.textContent = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(now);
}
function llToLatLng(ll) {
  return L.latLng(ll[0], ll[1]);
}

function getRoute(routeId) {
  return ROUTES.find(r => r.id === routeId);
}

function getBus(busId) {
  return BUSES.find(b => b.id === busId);
}

function distanceMeters(a, b) {
  // quick haversine
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function interpolateAlongPolyline(lls, t) {
  const tt = Math.max(0, Math.min(1, t));
  if (lls.length < 2) return { point: lls[0], segIndex: 0, segT: 0 };
  const segLens = [];
  const dists = [0];
  let total = 0;
  for (let i = 1; i < lls.length; i++) {
    const d = distanceMeters(lls[i - 1], lls[i]);
    segLens.push(d);
    total += d;
    dists.push(total);
  }
  if (total <= 0) return { point: lls[0], segIndex: 0, segT: 0 };
  if (tt <= 0) return { point: lls[0], segIndex: 0, segT: 0 };
  if (tt >= 1) return { point: lls[lls.length - 1], segIndex: segLens.length - 1, segT: 1 };
  const target = tt * total;
  let idx = 0;
  for (let i = 1; i < dists.length; i++) {
    if (target <= dists[i]) { idx = i - 1; break; }
  }
  const segLen = segLens[idx];
  const segT = segLen === 0 ? 0 : (target - dists[idx]) / segLen;
  const p0 = lls[idx], p1 = lls[idx + 1];
  return {
    point: [p0[0] + (p1[0] - p0[0]) * segT, p0[1] + (p1[1] - p0[1]) * segT],
    segIndex: idx,
    segT
  };
}

function getTrafficColor(route, segIndex) {
  if (!route) return TRAFFIC_META.green.color;
  const t = route.traffic[segIndex];
  if (t === 'red') return TRAFFIC_META.red.color;
  if (t === 'yellow') return TRAFFIC_META.yellow.color;
  return TRAFFIC_META.green.color;
}

function polylineLength(lls) {
  let len = 0;
  for (let i = 1; i < lls.length; i++) len += distanceMeters(lls[i - 1], lls[i]);
  return len;
}

function formatEta(mins) {
  if (mins < 0) mins = 0;
  if (mins < 1) return '<1 min';
  const m = Math.round(mins);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return h + 'h ' + rem + 'm';
}

function minsFromNow(mins) {
  const now = new Date();
  const arr = new Date(now.getTime() + mins * 60000);
  return arr;
}

function statusFromBus(bus, route) {
  const d = bus.delay || 0;
  const prog = bus.progress || 0;
  if (prog >= 0.98) return 'arrived';
  if (d >= 6) return 'delayed';
  if (d >= 3 || prog >= 0.8) return 'arriving';
  return 'ontime';
}

function renderBusList() {
  busListEl.innerHTML = '';
  BUSES.forEach(bus => {
    const route = getRoute(bus.routeId);
    const status = statusFromBus(bus, route);
    const meta = STATUS_META[status] || STATUS_META.ontime;
    const active = state.selectedBusId === bus.id;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'bus-item' + (active ? ' selected' : '');
    const etaMins = estimateEtaMins(bus, route);
    const ar = getActiveRoute(route);
    const nextStop = ar.stops[nextStopIndex(bus, route)] || ar.stops[ar.stops.length - 1];
    card.innerHTML = `
      <span class="dot" style="background:${meta.color}"></span>
      <div class="bi-main">
        <div class="bi-top"><strong>${bus.name}</strong><span class="bi-eta">${formatEta(etaMins)}</span></div>
        <div class="bi-sub">${bus.driver} · <b style="color:${meta.color}">${meta.label}</b></div>
        <div class="bi-stop"><span>Next:</span> ${nextStop.n}</div>
      </div>
    `;
    card.addEventListener('click', () => selectBus(bus.id));
    busListEl.appendChild(card);
  });
  if (liveBuses.size) {
    const group = document.createElement('div');
    group.className = 'bus-group';
    group.innerHTML = '<span class="bus-group-label">Live devices</span>';
    busListEl.appendChild(group);
    [...liveBuses.values()].forEach(bus => {
      const active = state.selectedBusId === bus.code;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'bus-item' + (active ? ' selected' : '');
      const st = liveStatus(bus);
      card.innerHTML = `
        <span class="dot live-dot${bus.waiting ? ' wait' : ''}" style="background:${bus.color || '#2563EB'}"></span>
        <div class="bi-main">
          <div class="bi-top"><strong>${escapeHtml(bus.label || bus.code)}</strong><span class="bi-eta">${bus.pos && !bus.offline && bus.etaMins != null ? formatEta(bus.etaMins) : (bus.waiting ? 'pairing…' : '—')}</span></div>
          <div class="bi-sub">${escapeHtml(bus.code)} · <b style="color:${st.color}">${st.label}</b></div>
          <div class="bi-stop"><span>Last seen:</span> ${bus.last_seen ? timeAgo(bus.last_seen) : '—'}</div>
        </div>
      `;
      card.addEventListener('click', () => selectBus(bus.code));
      busListEl.appendChild(card);
    });
  }
  busCountHint.textContent = (BUSES.length + liveBuses.size) + ' active';
}

function estimateEtaMins(bus, route) {
  const r = route || getRoute(bus.routeId);
  if (!r) return 0;
  const lls = getActivePolylineLLs(r);
  const total = polylineLength(lls);
  const rem = total * (1 - (bus.progress || 0));
  let v = FREE_SPEED;
  // get current traffic at segment
  const interp = interpolateAlongPolyline(lls, bus.progress || 0);
  const seg = interp.segIndex;
  const tcol = getActiveRoute(r).traffic ? getActiveRoute(r).traffic[seg] : r.traffic[seg];
  if (tcol === 'yellow') v = TRAFFIC_SPEED.yellow;
  else if (tcol === 'red') v = TRAFFIC_SPEED.red;
  else v = TRAFFIC_SPEED.green;
  let mins = rem / v / 60;
  mins += (bus.delay || 0);
  if (bus.progress >= 1) mins = 0;
  return Math.max(0, mins);
}

function getActiveRoute(route) {
  if (state.usingAlt.has(route.id) && route.alt) return route.alt;
  return route;
}

function getActivePolylineLLs(route) {
  const ar = getActiveRoute(route);
  return ar.stops.map(s => s.ll);
}

function renderRouteChips() {
  routeChipsEl.innerHTML = '';
  ROUTES.forEach(r => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (state.selectedRouteId === r.id ? ' active' : '');
    chip.innerHTML = `<span class="dot" style="background:${r.color}"></span>${r.code} · ${r.name}`;
    chip.addEventListener('click', () => {
      const b = BUSES.find(x => x.routeId === r.id);
      if (b) selectBus(b.id);
      else {
        state.selectedRouteId = r.id;
        renderRouteChips();
        drawMap();
        renderRouteOpt();
      }
    });
    routeChipsEl.appendChild(chip);
  });
}

function drawMap() {
  if (!leafletMap) {
    leafletMap = L.map('map').setView(llToLatLng(SCHOOL.ll), 11);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 18
    }).addTo(leafletMap);
    schoolMarker = L.marker(llToLatLng(SCHOOL.ll), {
      interactive: false,
      icon: L.divIcon({
        className: 'school-wrap',
        html: '<div class="school-icon">🏫</div>',
        iconSize: [38, 38],
        iconAnchor: [19, 19]
      })
    }).addTo(leafletMap);
    schoolMarker.bindTooltip(SCHOOL.short, {
      className: 'school-label', direction: 'top', offset: [0, -22], permanent: true
    });
  }

  // clear existing
  Object.values(routeLines).forEach(ls => ls.forEach(l => l.remove()));
  Object.values(altRouteLines).forEach(ls => ls.forEach(l => l.remove()));
  Object.values(stopMarkers).forEach(m => m.remove());
  Object.values(busMarkers).forEach(m => m.remove());
  Object.values(dirMarkers).forEach(m => m.remove());

  routeLines = {};
  altRouteLines = {};
  stopMarkers = {};
  busMarkers = {};
  dirMarkers = {};

  ROUTES.forEach(r => {
    const ar = getActiveRoute(r);
    const lls = ar.stops.map(s => llToLatLng(s.ll));
    // split by traffic
    for (let i = 0; i < lls.length - 1; i++) {
      const seg = [lls[i], lls[i + 1]];
      const tcol = ar.traffic && ar.traffic[i] ? ar.traffic[i] : (r.traffic && r.traffic[i]);
      const color = getTrafficColor({ traffic: ar.traffic || r.traffic }, i);
      const weight = (state.selectedRouteId === r.id) ? 6 : 4;
      const op = (state.selectedRouteId === r.id) ? 0.95 : 0.4;
      const line = L.polyline(seg, { color, weight, opacity: op, dashArray: undefined });
      line.addTo(leafletMap);
      // group by route
      if (!routeLines[r.id]) routeLines[r.id] = [];
      routeLines[r.id].push(line);
    }

    // draw stops for selected route
    if (state.selectedRouteId === r.id) {
      const routeBus = BUSES.find(b => b.routeId === r.id);
      ar.stops.forEach((s, idx) => {
        const m = L.circleMarker(llToLatLng(s.ll), {
          radius: 5,
          color: '#111827',
          weight: 1,
          fillColor: '#f8fafc',
          fillOpacity: 1
        }).addTo(leafletMap);
        const boarding = stopBoardingCount(r.id, idx);
        const eta = routeBus ? estimateStopEta(routeBus, r, idx) : null;
        const etaLine = eta === null ? '' :
          `<div class="pop-row"><span>Bus ETA</span><b>${(routeBus.progress || 0) >= stopProgressForStop(ar, idx) - 0.01 ? 'passed' : formatEta(eta)}</b></div>`;
        m.bindPopup(`
          <div class="pop-title">${s.n}</div>
          <div class="pop-row"><span>Stop</span><b>${idx + 1} / ${ar.stops.length}</b></div>
          <div class="pop-row"><span>Boarding</span><b>${boarding} student${boarding === 1 ? '' : 's'}</b></div>
          ${etaLine}
        `);
        stopMarkers[idx] = m;
      });
    }

    // dashed alternate only while a suggestion is active for this route
    if (r.alt && r.id === state.selectedRouteId && hasHeavyTraffic(r) &&
        !state.usingAlt.has(r.id) && !state.dismissedSugg.has(r.id)) {
      const alls = r.alt.stops.map(s => llToLatLng(s.ll));
      for (let i = 0; i < alls.length - 1; i++) {
        const seg = [alls[i], alls[i + 1]];
        const line = L.polyline(seg, { color: '#64748b', weight: 4, opacity: 0.75, dashArray: '6 6' });
        line.addTo(leafletMap);
        if (!altRouteLines[r.id]) altRouteLines[r.id] = [];
        altRouteLines[r.id].push(line);
      }
    }
  });

  // draw buses
  BUSES.forEach(bus => {
    const route = getRoute(bus.routeId);
    if (!route) return;
    const lls = getActivePolylineLLs(route);
    const interp = interpolateAlongPolyline(lls, bus.progress || 0);
    const p = llToLatLng(interp.point);
    const status = statusFromBus(bus, route);
    const meta = STATUS_META[status] || STATUS_META.ontime;
    const selected = state.selectedBusId === bus.id;
    const num = bus.name.replace('Bus ', '');
    const marker = L.marker(p, {
      icon: L.divIcon({
        className: 'bus-marker',
        html: `
          <div class="bus-icon${selected ? ' selected' : ''}">
            <div class="bus-pin ${status}">${num}</div>
            ${selected ? `<div class="bus-num">${bus.name}</div>` : ''}
          </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      })
    }).addTo(leafletMap);
    const eta = formatEta(estimateEtaMins(bus, route));
    const nextStop = getActiveRoute(route).stops[nextStopIndex(bus, route)];
    marker.bindTooltip(`${bus.name} · ${eta} · ${meta.label} · next: ${nextStop.n}`, {
      className: 'bus-tip' + (selected ? ' selected' : ''),
      direction: 'top',
      offset: [0, -22]
    });
    marker.on('click', () => selectBus(bus.id));
    busMarkers[bus.id] = marker;

    // direction indicator toward school
    const brg = bearingDeg(interp.point, SCHOOL.ll);
    dirMarkers[bus.id] = L.marker(p, {
      interactive: false,
      zIndexOffset: 500,
      icon: L.divIcon({
        className: 'dir-marker',
        html: `<div class="dir-arrow" style="transform:rotate(${brg.toFixed(1)}deg)">▲</div>`,
        iconSize: [18, 18],
        iconAnchor: [9, -16]
      })
    }).addTo(leafletMap);
  });

  // fit if nothing selected
  if (!state.selectedBusId) {
    const group = L.featureGroup(Object.values(busMarkers));
    if (Object.keys(busMarkers).length > 0) {
      leafletMap.fitBounds(group.getBounds().pad(0.15));
    } else {
      leafletMap.setView(llToLatLng(SCHOOL.ll), 12);
    }
  }
}

function selectBus(busId) {
  const isLive = typeof busId === 'string' && liveBuses.has(busId);
  const bus = getBus(busId);
  if (!bus && !isLive) return;
  state.selectedBusId = busId;
  if (bus) state.selectedRouteId = bus.routeId;
  renderBusList();
  renderRouteChips();
  renderBusDetails();
  renderRouteOpt();
  renderRoster();
  updateAttendance();
  updateCharts();
  updateSummary();
  drawMap();
  const m = isLive ? liveMarkers[busId] : busMarkers[busId];
  if (m && leafletMap) {
    leafletMap.flyTo(m.getLatLng(), 14, { duration: 0.8 });
  }
}

function renderBusDetails() {
  const live = (typeof state.selectedBusId === 'string') ? liveBuses.get(state.selectedBusId) : null;
  if (live) { renderLiveDetails(live); return; }
  const bus = getBus(state.selectedBusId);
  if (!bus) {
    busDetailsEl.innerHTML = '<p class="muted">Select a bus to see details.</p>';
    if (detailsStatusBadgeEl) { detailsStatusBadgeEl.textContent = '—'; detailsStatusBadgeEl.style.background = ''; detailsStatusBadgeEl.style.color = ''; }
    if (capacityTextEl) capacityTextEl.textContent = '0 / 0';
    if (capacityBarEl) capacityBarEl.style.width = '0%';
    return;
  }
  const route = getRoute(bus.routeId);
  const status = statusFromBus(bus, route);
  const meta = STATUS_META[status] || STATUS_META.ontime;
  const ar = getActiveRoute(route);
  const eta = estimateEtaMins(bus, route);
  const totalSt = ar.stops.length;
  const nextIdx = nextStopIndex(bus, route);
  const nextStop = ar.stops[nextIdx] || ar.stops[ar.stops.length - 1];
  const totalStudents = (bus.students || []).length;
  const present = countPresentOnBus(bus, route);
  const capPct = Math.min(100, Math.round((present / bus.capacity) * 100));
  const traffic = trafficLevelOfBus(bus, route);
  const trafficColor = traffic === 'Heavy' ? TRAFFIC_META.red.color
    : traffic === 'Moderate' ? TRAFFIC_META.yellow.color : TRAFFIC_META.green.color;
  const nearName = nearestStopName(ar, bus);

  busDetailsEl.innerHTML = `
    <div class="dg-item"><div class="dg-label">Bus</div><div class="dg-value">${bus.name}</div></div>
    <div class="dg-item"><div class="dg-label">Status</div><div class="dg-value"><span class="dot" style="background:${meta.color}"></span>${meta.label}</div></div>
    <div class="dg-item"><div class="dg-label">Driver</div><div class="dg-value">${bus.driver}</div></div>
    <div class="dg-item"><div class="dg-label">Phone</div><div class="dg-value num">${bus.phone}</div></div>
    <div class="dg-item"><div class="dg-label">Route</div><div class="dg-value">${ar.name}</div></div>
    <div class="dg-item"><div class="dg-label">Traffic Level</div><div class="dg-value"><span class="traffic-pill" style="color:${trafficColor}"><i style="background:${trafficColor}"></i>${traffic}</span></div></div>
    <div class="dg-item"><div class="dg-label">Next Stop</div><div class="dg-value">${nextStop.n}</div></div>
    <div class="dg-item"><div class="dg-label">ETA</div><div class="dg-value num">${formatEta(eta)}</div></div>
    <div class="dg-item"><div class="dg-label">Students</div><div class="dg-value num">${present} / ${totalStudents} present</div></div>
    <div class="dg-item"><div class="dg-label">Capacity</div><div class="dg-value num">${capPct}% of ${bus.capacity}</div></div>
    <div class="dg-item wide"><div class="dg-label">Current location</div><div class="dg-value">Near ${nearName}<span class="sub">${ar.name} route · ${Math.round(bus.progress * 100)}% of the way to school</span></div></div>
  `;
  if (detailsStatusBadgeEl) {
    detailsStatusBadgeEl.textContent = meta.label;
    detailsStatusBadgeEl.style.background = meta.color + '22';
    detailsStatusBadgeEl.style.color = meta.color;
  }
  if (capacityTextEl) capacityTextEl.textContent = present + ' / ' + bus.capacity;
  if (capacityBarEl) capacityBarEl.style.width = capPct + '%';
}

function nextStopIndex(bus, route) {
  const r = route || getRoute(bus.routeId);
  const ar = getActiveRoute(r);
  const lls = ar.stops.map(s => s.ll);
  const interp = interpolateAlongPolyline(lls, bus.progress || 0);
  // next is segIndex+1 or last
  let idx = interp.segIndex + 1;
  if (idx >= lls.length) idx = lls.length - 1;
  return idx;
}

function countPresentOnBus(bus) {
  let c = 0;
  (bus.students || []).forEach(s => {
    if (s.includes('|absent')) return;
    // if reached or passed stop?
    const parts = s.split('|');
    const stopIdx = parseInt(parts[2] || '0');
    const r = getRoute(bus.routeId);
    const ar = getActiveRoute(r);
    const reached = bus.progress >= stopProgressForStop(ar, stopIdx);
    if (reached) c++;
  });
  return c;
}

function stopProgressForStop(route, stopIdx) {
  const lls = route.stops.map(s => s.ll);
  let dist = 0;
  for (let i = 1; i <= stopIdx && i < lls.length; i++) {
    dist += distanceMeters(lls[i - 1], lls[i]);
  }
  const total = polylineLength(lls);
  if (total === 0) return 1;
  return Math.min(1, dist / total);
}

function trafficLevelOfBus(bus, route) {
  const r = route || getRoute(bus.routeId);
  const ar = getActiveRoute(r);
  const lls = ar.stops.map(s => s.ll);
  const interp = interpolateAlongPolyline(lls, bus.progress || 0);
  const seg = interp.segIndex;
  const t = ar.traffic && ar.traffic[seg];
  if (t === 'red') return 'Heavy';
  if (t === 'yellow') return 'Moderate';
  return 'Clear';
}

function nearestStopName(activeRoute, bus) {
  const lls = activeRoute.stops.map(s => s.ll);
  const interp = interpolateAlongPolyline(lls, bus.progress || 0);
  let best = 0, bestD = Infinity;
  activeRoute.stops.forEach((s, i) => {
    const d = distanceMeters(s.ll, interp.point);
    if (d < bestD) { bestD = d; best = i; }
  });
  return activeRoute.stops[best].n;
}

function bearingDeg(from, to) {
  const p1 = (from[0] * Math.PI) / 180;
  const p2 = (to[0] * Math.PI) / 180;
  const dl = ((to[1] - from[1]) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function estimateStopEta(bus, route, stopIdx) {
  if (!bus) return null;
  const ar = getActiveRoute(route);
  const lls = ar.stops.map(s => s.ll);
  const total = polylineLength(lls);
  if (total <= 0) return 0;
  const stopProg = stopProgressForStop(ar, stopIdx);
  if (stopProg <= (bus.progress || 0)) return 0;
  const interp = interpolateAlongPolyline(lls, bus.progress || 0);
  const tcol = (ar.traffic && ar.traffic[interp.segIndex]) || 'green';
  const v = tcol === 'red' ? TRAFFIC_SPEED.red
    : tcol === 'yellow' ? TRAFFIC_SPEED.yellow : TRAFFIC_SPEED.green;
  const rem = (stopProg - (bus.progress || 0)) * total;
  return rem / v / 60 + (bus.delay || 0);
}

function stopBoardingCount(routeId, stopIdx) {
  let c = 0;
  BUSES.filter(b => b.routeId === routeId).forEach(b => {
    (b.students || []).forEach(s => {
      if (s.includes('|absent')) return;
      if (parseInt(s.split('|')[2] || '0', 10) === stopIdx) c++;
    });
  });
  return c;
}

function attendanceCounts(bus) {
  let present = 0, absent = 0;
  const route = getRoute(bus.routeId);
  const ar = getActiveRoute(route);
  (bus.students || []).forEach(s => {
    if (s.includes('|absent')) { absent++; return; }
    const stopIdx = parseInt(s.split('|')[2] || '0', 10);
    if ((bus.progress || 0) >= stopProgressForStop(ar, stopIdx)) present++;
  });
  const total = (bus.students || []).length;
  return { present, absent, expected: Math.max(0, total - present - absent), total };
}

function updateSummary() {
  const liveOnline = [...liveBuses.values()].filter(b => b.pos && !b.offline).length;
  statTotal.textContent = BUSES.length + liveBuses.size;
  let ontime = 0, delayed = 0, present = 0;
  BUSES.forEach(b => {
    const r = getRoute(b.routeId);
    const st = statusFromBus(b, r);
    if (st === 'ontime' || st === 'arrived') ontime++;
    if (st === 'delayed') delayed++;
    present += countPresentOnBus(b);
  });
  const heavy = ROUTES.filter(hasHeavyTraffic).length;
  statOnTime.textContent = ontime + liveOnline;
  statDelayed.textContent = delayed;
  statPresent.textContent = present;
  statTraffic.textContent = heavy;
}

function fmtTs(ts) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(new Date(ts));
}

function pushAlert(type, text) {
  state.alerts.unshift({ type, text, ts: Date.now() });
  if (state.alerts.length > 8) state.alerts = state.alerts.slice(0, 8);
  renderAlerts();
}

function renderAlerts() {
  if (!state.alerts.length) {
    alertListEl.innerHTML = '<div class="alert-empty">No active alerts — all clear.</div>';
    alertCount.textContent = '0';
    return;
  }
  alertListEl.innerHTML = '';
  state.alerts.forEach((a, idx) => {
    const el = document.createElement('div');
    el.className = 'alert ' + (a.type || 'info');
    el.innerHTML = `
      <div>${a.text}</div>
      <time>${fmtTs(a.ts || state.startedAt)}</time>
      <button class="x" aria-label="Dismiss">×</button>
    `;
    el.querySelector('.x').addEventListener('click', () => {
      state.alerts.splice(idx, 1);
      renderAlerts();
    });
    alertListEl.appendChild(el);
  });
  alertCount.textContent = state.alerts.length;
}

function renderRouteOpt() {
  const bus = getBus(state.selectedBusId);
  if (!bus) {
    if (routeNameEl) routeNameEl.textContent = '—';
    if (routeTravelHintEl) routeTravelHintEl.textContent = '—';
    if (routeStopsEl) routeStopsEl.innerHTML = '';
    if (suggestionBoxEl) { suggestionBoxEl.innerHTML = ''; suggestionBoxEl.hidden = true; }
    return;
  }
  const route = getRoute(bus.routeId);
  const ar = getActiveRoute(route);
  const usingAlt = state.usingAlt.has(route.id);
  const rtTime = routeTime(route, usingAlt);
  const plTime = routeTime(route, false);
  if (routeNameEl) routeNameEl.textContent = (usingAlt && route.alt ? route.alt.name : ar.name);
  if (routeTravelHintEl) routeTravelHintEl.textContent = ar.stops.length + ' stops · ' + Math.round(rtTime) + ' min est.';
  const rtPlanned = document.getElementById('routePlanned');
  const rtTraffic = document.getElementById('routeTrafficTime');
  const rtNextEta = document.getElementById('routeNextEta');
  if (rtPlanned) rtPlanned.textContent = Math.round(plTime) + ' min';
  if (rtTraffic) rtTraffic.textContent = Math.round(rtTime) + ' min';
  const nextEta = estimateEtaMins(bus, route);
  if (rtNextEta) rtNextEta.textContent = formatEta(nextEta);
  if (routeStopsEl) {
    const nextIdx = nextStopIndex(bus, route);
    routeStopsEl.innerHTML = ar.stops.map((s, i) => {
      const stopProg = stopProgressForStop(ar, i);
      const done = (bus.progress || 0) >= stopProg - 0.01;
      const eta = estimateStopEta(bus, route, i);
      const cls = done ? 'stop-chip done' : (i === nextIdx ? 'stop-chip next' : 'stop-chip');
      const etaTxt = done ? 'passed' : formatEta(eta);
      return `<div class="${cls}">${i + 1}. ${s.n} <span class="eta">${etaTxt}</span></div>`;
    }).join('');
  }
  if (suggestionBoxEl) {
    const heavy = hasHeavyTraffic(route);
    const dismissed = state.dismissedSugg.has(route.id);
    if (route.alt && heavy && !usingAlt && !dismissed) {
      const saved = estimateSavings(route);
      suggestionBoxEl.innerHTML = `
        <h4>Faster route suggested <span class="save">Save ${saved} min</span></h4>
        <p><strong>${route.alt.name}</strong> avoids the heavy segments currently on ${ar.name}.</p>
        <div class="actions">
          <button class="btn btn-primary" id="acceptAlt">Accept</button>
          <button class="btn btn-ghost" id="dismissAlt">Dismiss</button>
        </div>
        <div class="suggestion-note">The suggested route is drawn on the map as a dashed line.</div>
      `;
      suggestionBoxEl.hidden = false;
      document.getElementById('acceptAlt')?.addEventListener('click', () => {
        state.usingAlt.add(route.id);
        renderRouteOpt();
        drawMap();
      });
      document.getElementById('dismissAlt')?.addEventListener('click', () => {
        state.dismissedSugg.add(route.id);
        renderRouteOpt();
      });
    } else if (usingAlt) {
      suggestionBoxEl.innerHTML = `
        <h4>Using suggested route</h4>
        <p>${route.alt.name} is active for this bus.</p>
        <div class="actions"><button class="btn btn-ghost" id="revertAlt">Revert to original</button></div>
      `;
      suggestionBoxEl.hidden = false;
      document.getElementById('revertAlt')?.addEventListener('click', () => {
        state.usingAlt.delete(route.id);
        renderRouteOpt();
        drawMap();
      });
    } else {
      suggestionBoxEl.innerHTML = '';
      suggestionBoxEl.hidden = true;
    }
  }
}

function hasHeavyTraffic(route) {
  const ar = getActiveRoute(route);
  if (!ar.traffic) return false;
  return ar.traffic.some(t => t === 'red');
}

function estimateSavings(route) {
  const cur = routeTime(route, false);
  const alt = route.alt ? routeTime(route, true) : cur;
  return Math.max(0, Math.round((cur - alt)));
}

function routeTime(route, useAlt) {
  const ar = useAlt && route.alt ? route.alt : getActiveRoute(route);
  const lls = ar.stops.map(s => s.ll);
  let t = 0;
  for (let i = 0; i < lls.length - 1; i++) {
    const sl = distanceMeters(lls[i], lls[i + 1]);
    let v = TRAFFIC_SPEED.green;
    const tc = (ar.traffic && ar.traffic[i]) || 'green';
    if (tc === 'yellow') v = TRAFFIC_SPEED.yellow;
    if (tc === 'red') v = TRAFFIC_SPEED.red;
    t += sl / v / 60;
  }
  return t;
}

function renderRoster() {
  const liveBus = (typeof state.selectedBusId === 'string') ? liveBuses.get(state.selectedBusId) : null;
  if (liveBus) {
    rosterBodyEl.innerHTML = '<tr><td colspan="4" class="muted">Live device — no student roster attached.</td></tr>';
    return;
  }
  const bus = getBus(state.selectedBusId);
  if (!bus) {
    rosterBodyEl.innerHTML = '<tr><td colspan="4" class="muted">Select a bus</td></tr>';
    return;
  }
  const r = getRoute(bus.routeId);
  const ar = getActiveRoute(r);
  const q = (studentSearchEl.value || '').toLowerCase();
  const f = statusFilterEl.value || 'all';
  const rows = [];
  (bus.students || []).forEach(s => {
    const parts = s.split('|');
    const name = parts[0];
    const cls = parts[1] || '';
    const stopIdx = parseInt(parts[2] || '0');
    const absent = s.includes('|absent');
    const stopName = ar.stops[stopIdx] ? ar.stops[stopIdx].n : '';
    const reached = bus.progress >= stopProgressForStop(ar, stopIdx) - 0.01;
    const st = absent ? 'absent' : (reached ? 'onbus' : 'expected');
    if (q && !name.toLowerCase().includes(q)) return;
    if (f !== 'all' && st !== f) return;
    rows.push({ name, cls, stopName, st });
  });
  if (!rows.length) {
    rosterBodyEl.innerHTML = '<tr class="roster-empty"><td colspan="4">No students match your filters.</td></tr>';
    return;
  }
  rosterBodyEl.innerHTML = rows.map(x => `
    <tr>
      <td class="stu">${x.name}</td>
      <td>${x.cls}</td>
      <td>${x.stopName}</td>
      <td><span class="pill ${x.st}">${x.st === 'onbus' ? 'On Bus' : (x.st === 'absent' ? 'Absent' : 'Expected')}</span></td>
    </tr>
  `).join('');
}

function updateCharts() {
  const bus = getBus(state.selectedBusId);
  let counts = { present: 0, absent: 0, expected: 0 };
  if (typeof state.selectedBusId === 'string' && liveBuses.has(state.selectedBusId)) {
    counts = { present: 0, absent: 0, expected: 0 };
  } else if (bus) {
    counts = attendanceCounts(bus);
  } else {
    BUSES.forEach(b => {
      const c = attendanceCounts(b);
      counts.present += c.present;
      counts.absent += c.absent;
      counts.expected += c.expected;
    });
  }
  const ctx = document.getElementById('attChart');
  if (!ctx) return;
  if (chart) { chart.destroy(); chart = null; }
  try {
    chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Present', 'Absent', 'Expected'],
        datasets: [{
          data: [counts.present, counts.absent, counts.expected],
          backgroundColor: ['#16A34A', '#DC2626', '#94A3B8'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }
        }
      }
    });
  } catch (e) {}
}

function populateAttSelect() {
  if (!attBusSelectEl) return;
  attBusSelectEl.innerHTML = BUSES.map(b =>
    `<option value="${b.id}">${b.name}</option>`
  ).join('');
  if (state.selectedBusId) attBusSelectEl.value = String(state.selectedBusId);
}

function updateAttendance() {
  const bus = getBus(state.selectedBusId);
  if (!bus) {
    if (typeof state.selectedBusId === 'string') {
      if (attPresentEl) attPresentEl.textContent = '0';
      if (attAbsentEl) attAbsentEl.textContent = '0';
      if (attExpectedEl) attExpectedEl.textContent = '0';
    }
    return;
  }
  const c = attendanceCounts(bus);
  if (attPresentEl) attPresentEl.textContent = c.present;
  if (attAbsentEl) attAbsentEl.textContent = c.absent;
  if (attExpectedEl) attExpectedEl.textContent = c.expected;
  if (attBusSelectEl) attBusSelectEl.value = String(bus.id);
}

function tickSimulation() {
  state.tick++;
  BUSES.forEach(bus => {
    const route = getRoute(bus.routeId);
    if (!route) return;
    const lls = getActivePolylineLLs(route);
    const total = polylineLength(lls);
    if (total <= 0) return;
    // speed varies by traffic
    let v = FREE_SPEED;
    const interp = interpolateAlongPolyline(lls, bus.progress || 0);
    const seg = Math.min(interp.segIndex, (lls.length - 2));
    const ar = getActiveRoute(route);
    const tcol = (ar.traffic && ar.traffic[seg]) || 'green';
    if (tcol === 'yellow') v = TRAFFIC_SPEED.yellow;
    else if (tcol === 'red') v = TRAFFIC_SPEED.red;
    else v = TRAFFIC_SPEED.green;
    // advance
    const deltaDist = v * (TICK_MS / 1000) * TIME_SCALE;
    const deltaProg = deltaDist / total;
    bus.progress = Math.min(1, (bus.progress || 0) + deltaProg);
    // recycle after arrival so the demo keeps ticking
    if (bus.progress >= 1) {
      if (!bus.arrivedFlag) {
        bus.arrivedFlag = true;
        bus.arrivedTick = state.tick;
        pushAlert('info', bus.name + ' arrived at ' + SCHOOL.short + '.');
      } else if (state.tick - bus.arrivedTick > 15) {
        bus.progress = 0.01;
        bus.delay = 0;
        bus.arrivedFlag = false;
        pushAlert('info', bus.name + ' started its return run.');
      }
    }
    // decay delay slowly
    if ((state.tick % 5) === 0 && (bus.delay || 0) > 0) {
      bus.delay = Math.max(0, (bus.delay || 0) - 0.5);
    }
  });
}

function maybeGenerateAlert() {
  if (Math.random() < 0.15) {
    const delayed = BUSES.filter(b => statusFromBus(b, getRoute(b.routeId)) === 'delayed');
    if (delayed.length > 0 && Math.random() < 0.5) {
      const b = delayed[Math.floor(Math.random() * delayed.length)];
      const r = getRoute(b.routeId);
      const amt = Math.round(3 + Math.random() * 12);
      b.delay = Math.max(b.delay || 0, amt - 2);
      pushAlert('warn', b.name + ' delayed by ~' + amt + ' min due to traffic on ' + r.name + '.');
    } else {
      const routesWithHeavy = ROUTES.filter(hasHeavyTraffic);
      if (routesWithHeavy.length > 0) {
        const r = routesWithHeavy[Math.floor(Math.random() * routesWithHeavy.length)];
        pushAlert('danger', 'Heavy traffic reported on ' + r.code + ' (' + r.name + ').');
      }
    }
  }
}

function trafficFluctuate() {
  ROUTES.forEach(r => {
    // shift every so often
    if ((state.tick % 8) === 0) {
      r.traffic = r.traffic.map(t => {
        const roll = Math.random();
        if (t === 'green') return roll < 0.2 ? 'yellow' : (roll < 0.22 ? 'red' : 'green');
        if (t === 'yellow') return roll < 0.3 ? 'green' : (roll < 0.5 ? 'red' : 'yellow');
        if (t === 'red') return roll < 0.4 ? 'yellow' : (roll < 0.5 ? 'green' : 'red');
        return t;
      });
      // traffic shifted → a dismissed suggestion may become relevant again
      state.dismissedSugg.delete(r.id);
    }
  });
}

function initLegend() {
  if (legendToggleEl) {
    legendToggleEl.addEventListener('click', () => {
      legendEl.classList.toggle('collapsed');
      legendToggleEl.textContent = legendEl.classList.contains('collapsed') ? 'Show' : 'Hide';
    });
  }
}

function bindRosterFilters() {
  if (studentSearchEl) studentSearchEl.addEventListener('input', () => { renderRoster(); });
  if (statusFilterEl) statusFilterEl.addEventListener('change', () => { renderRoster(); });
  if (attBusSelectEl) attBusSelectEl.addEventListener('change', () => {
    const id = parseInt(attBusSelectEl.value, 10);
    if (id && id !== state.selectedBusId) selectBus(id);
  });
}

/* ---------- Live device tracking (Add Bus / pairing) ---------- */

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function timeAgo(ts) {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  const m = Math.round(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  return h + 'h ago';
}

function liveStatus(lb) {
  if (lb.waiting) return { label: 'Waiting for device', color: '#F59E0B' };
  if (lb.offline) return { label: 'Offline', color: '#94A3B8' };
  return { label: 'Live', color: '#16A34A' };
}

function liveBusIcon(code, lb, status, selected) {
  const num = (lb.label || '').match(/Bus\s*(\d+)/i);
  const glyph = num ? num[1] : '⌖';
  const cls = lb.waiting ? 'waiting' : (lb.offline ? 'offline' : 'ontime');
  return L.divIcon({
    className: 'bus-marker',
    html: `
      <div class="bus-icon${selected ? ' selected' : ''}">
        <div class="bus-pin ${cls}">${glyph}</div>
        ${selected ? `<div class="bus-num">${escapeHtml(lb.label || code)}</div>` : ''}
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
}

function liveBusTip(lb, status) {
  const eta = lb.etaMins == null ? '—' : formatEta(lb.etaMins);
  const sub = lb.waiting ? 'waiting for first fix'
    : (lb.offline ? 'offline · last seen ' + timeAgo(lb.last_seen) : 'ETA ' + eta);
  return `${lb.label} (${lb.code}) · ${status.label} · ${sub}`;
}

function upsertLiveMarker(code, lb) {
  if (!leafletMap) return;
  const ll = lb.pos ? L.latLng(lb.pos.lat, lb.pos.lng) : null;
  const status = liveStatus(lb);
  const selected = state.selectedBusId === code;
  const markerKey = status.label + (selected ? '1' : '0');
  let mk = liveMarkers[code];
  if (!mk) {
    if (!ll) return; // no marker until first fix; list still shows "waiting"
    mk = L.marker(ll, { icon: liveBusIcon(code, lb, status, selected) }).addTo(leafletMap);
    mk.on('click', () => selectBus(code));
    mk.setTooltipContent(liveBusTip(lb, status));
    liveMarkers[code] = mk;
  } else {
    if (ll) mk.setLatLng(ll);
    if (mk._liveKey !== markerKey) {
      mk.setIcon(liveBusIcon(code, lb, status, selected));
      mk._liveKey = markerKey;
    }
    mk.setTooltipContent(liveBusTip(lb, status));
  }
}

async function pollLiveBuses() {
  let data;
  try {
    const res = await fetch(API_BASE + '/api/buses', { cache: 'no-store' });
    if (!res.ok) return;
    data = await res.json();
  } catch (e) { return; }
  const seen = new Set();
  (data.buses || []).forEach(b => {
    seen.add(b.code);
    const prev = liveBuses.get(b.code);
    if (!prev) {
      liveBuses.set(b.code, Object.assign({ launched: Date.now() }, b));
      pushAlert('info', 'Live tracker "' + escapeHtml(b.label || b.code) + '" joined the fleet.');
    } else {
      if (prev.pos && !prev.offline && b.offline) {
        pushAlert('warn', '"' + escapeHtml(b.label || b.code) + '" went offline — last fix ' + timeAgo(b.last_seen) + '.');
      }
      if (prev.offline && b.pos && !b.offline) {
        pushAlert('info', '"' + escapeHtml(b.label || b.code) + '" is back online.');
      }
      liveBuses.set(b.code, Object.assign({ launched: prev.launched }, b));
    }
    upsertLiveMarker(b.code, liveBuses.get(b.code));
  });
  [...liveBuses.keys()].forEach(code => {
    if (seen.has(code)) return;
    liveBuses.delete(code);
    if (liveMarkers[code]) { liveMarkers[code].remove(); delete liveMarkers[code]; }
  });
}

function renderLiveDetails(lb) {
  const status = liveStatus(lb);
  const eta = lb.etaMins == null ? '—' : formatEta(lb.etaMins);
  const kmh = lb.pos && lb.pos.speed != null ? Math.round(lb.pos.speed * 3.6) : '—';
  const hdg = lb.pos && lb.pos.heading != null ? Math.round(lb.pos.heading) + '°' : '—';
  const acc = lb.pos && lb.pos.accuracy != null ? '±' + Math.round(lb.pos.accuracy) + ' m' : '—';
  busDetailsEl.innerHTML = `
    <div class="dg-item"><div class="dg-label">Device</div><div class="dg-value">${escapeHtml(lb.label || lb.code)}</div></div>
    <div class="dg-item"><div class="dg-label">Status</div><div class="dg-value"><span class="dot" style="background:${status.color}"></span>${status.label}</div></div>
    <div class="dg-item"><div class="dg-label">Device code</div><div class="dg-value num">${escapeHtml(lb.code)}</div></div>
    <div class="dg-item"><div class="dg-label">Last seen</div><div class="dg-value">${lb.last_seen ? timeAgo(lb.last_seen) : '—'}</div></div>
    <div class="dg-item"><div class="dg-label">Coordinates</div><div class="dg-value num">${lb.pos ? lb.pos.lat.toFixed(5) + ', ' + lb.pos.lng.toFixed(5) : '—'}</div></div>
    <div class="dg-item"><div class="dg-label">Speed</div><div class="dg-value num">${kmh} km/h</div></div>
    <div class="dg-item"><div class="dg-label">Heading</div><div class="dg-value num">${hdg}</div></div>
    <div class="dg-item"><div class="dg-label">Accuracy</div><div class="dg-value num">${acc}</div></div>
    <div class="dg-item"><div class="dg-label">ETA to school</div><div class="dg-value num">${eta}</div></div>
    <div class="dg-item wide"><div class="dg-label">Note</div><div class="dg-value">Runs on the driver's phone GPS — not on a fixed school route.</div></div>
  `;
  if (detailsStatusBadgeEl) {
    detailsStatusBadgeEl.textContent = status.label;
    detailsStatusBadgeEl.style.background = status.color + '22';
    detailsStatusBadgeEl.style.color = status.color;
  }
  if (capacityTextEl) capacityTextEl.textContent = '—';
  if (capacityBarEl) capacityBarEl.style.width = '0%';
}

/* Add Bus modal */

function fillSwatches() {
  if (!swatchesEl) return;
  swatchesEl.innerHTML = SWATCH_COLORS.map((c, i) =>
    `<button type="button" class="swatch${i === swatchSel ? ' active' : ''}" data-i="${i}" style="background:${c}" aria-label="Colour ${i + 1}"></button>`
  ).join('');
  swatchesEl.querySelectorAll('.swatch').forEach(b => {
    b.addEventListener('click', () => { swatchSel = +b.dataset.i; fillSwatches(); });
  });
}

function openAddBusModal() {
  pairing = null;
  modalStepForm.hidden = false;
  modalStepDone.hidden = true;
  if (modalErrEl) modalErrEl.textContent = '';
  fillSwatches();
  modalEl.hidden = false;
  if (busLabelEl) busLabelEl.focus();
}

function closeAddBusModal() { if (modalEl) modalEl.hidden = true; }

async function handleRegister() {
  const label = (busLabelEl.value || '').trim();
  if (!label) { if (busLabelEl) busLabelEl.focus(); return; }
  if (modalErrEl) modalErrEl.textContent = '';
  registerBusBtn.disabled = true;
  try {
    const res = await fetch(API_BASE + '/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, color: SWATCH_COLORS[swatchSel] })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    pairing = data;
    if (pairCodeEl) pairCodeEl.textContent = data.code.slice(0, 3) + ' ' + data.code.slice(3);
    if (pairQREl) {
      if (data.qrDataURL) { pairQREl.src = data.qrDataURL; pairQREl.style.display = ''; }
      else pairQREl.style.display = 'none';
    }
    modalStepForm.hidden = true;
    modalStepDone.hidden = false;
    pollLiveBuses();
  } catch (e) {
    if (modalErrEl) modalErrEl.textContent = (e && e.message) || 'Failed to register device.';
  } finally {
    registerBusBtn.disabled = false;
  }
}

async function copyPairLink() {
  if (!pairing) return;
  const url = location.origin + (pairing.qrPath || ('/live.html?c=' + pairing.code + '&t=' + pairing.token));
  try {
    await navigator.clipboard.writeText(url);
    if (copyLinkBtn) {
      copyLinkBtn.textContent = 'Copied!';
      setTimeout(() => { copyLinkBtn.textContent = 'Copy link'; }, 1500);
    }
  } catch (e) {}
}

function initLiveUI() {
  if (addBusBtnEl) addBusBtnEl.addEventListener('click', openAddBusModal);
  if (modalCloseEl) modalCloseEl.addEventListener('click', closeAddBusModal);
  if (modalDoneBtn) modalDoneBtn.addEventListener('click', closeAddBusModal);
  if (copyLinkBtn) copyLinkBtn.addEventListener('click', copyPairLink);
  if (registerBusBtn) registerBusBtn.addEventListener('click', handleRegister);
  if (busLabelEl) busLabelEl.addEventListener('keydown', e => { if (e.key === 'Enter') handleRegister(); });
  if (modalEl) modalEl.addEventListener('click', e => { if (e.target === modalEl) closeAddBusModal(); });
  pollLiveBuses();
  livePollTimer = setInterval(pollLiveBuses, LIVE_POLL_MS);
}

function init() {
  initClock();
  populateAttSelect();
  renderBusList();
  renderRouteChips();
  renderAlerts();
  drawMap();
  renderBusDetails();
  renderRouteOpt();
  renderRoster();
  updateSummary();
  updateCharts();
  bindRosterFilters();
  initLegend();
  initLiveUI();

  // select first bus by default
  if (BUSES.length > 0 && !state.selectedBusId) {
    selectBus(BUSES[0].id);
  }

  setInterval(() => {
    tickSimulation();
    trafficFluctuate();
    maybeGenerateAlert();
    renderBusList();
    renderBusDetails();
    renderRouteOpt();
    renderRoster();
    updateAttendance();
    updateSummary();
    updateCharts();
    drawMap();
  }, TICK_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
