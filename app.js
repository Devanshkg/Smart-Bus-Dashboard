/* Stonehill Smart Bus Dashboard — app logic
   Map, simulation, rendering, selection state */

const state = {
  selectedBusId: null,
  selectedRouteId: null,
  usingAlt: new Set(), // routeIds using alternative route
  tick: 0,
  startedAt: Date.now(),
  alerts: SEED_ALERTS.slice()
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

let leafletMap = null;
const routeLines = {};
const altRouteLines = {};
const busMarkers = {};
const stopMarkers = {};
const chart = null;

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
  // clamp
  let tt = Math.max(0, Math.min(1, t));
  if (tt <= 0) return { point: lls[0], segIndex: 0, segT: 0 };
  if (tt >= 1) return { point: lls[lls.length - 1], segIndex: Math.max(0, lls.length - 2), segT: 1 };
  const totalSegs = lls.length - 1;
  const idx = Math.floor(tt * totalSegs);
  const segT2 = (tt * totalSegs) - idx;
  const p0 = lls[idx], p1 = lls[idx + 1];
  const point = [
    p0[0] + (p1[0] - p0[0]) * segT2,
    p0[1] + (p1[1] - p0[1]) * segT2
  ];
  return { point, segIndex: idx, segT: segT2 };
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
  if (d >= 8) return 'delayed';
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
    card.className = 'bus-card' + (active ? ' active' : '');
    const etaMins = estimateEtaMins(bus, route);
    card.innerHTML = `
      <div class="bus-meta">
        <div class="bus-name">${bus.name}</div>
        <div class="bus-driver">${bus.driver}</div>
      </div>
      <div class="bus-status">
        <span class="dot" style="background:${meta.color}"></span>
        <span>${meta.label}</span>
      </div>
      <span class="eta-badge">${formatEta(etaMins)}</span>
    `;
    card.addEventListener('click', () => selectBus(bus.id));
    busListEl.appendChild(card);
  });
  busCountHint.textContent = BUSES.length + ' active';
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
    chip.textContent = r.code + ' · ' + r.name;
    chip.addEventListener('click', () => {
      state.selectedRouteId = r.id;
      const b = getBus(state.selectedBusId);
      if (b && b.routeId !== r.id) selectBus(b.id); // keep context
      renderRouteChips();
      drawMap();
      renderRouteOpt();
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
  }

  // clear existing
  Object.values(routeLines).forEach(l => l.remove());
  Object.values(altRouteLines).forEach(l => l.remove());
  Object.values(stopMarkers).forEach(m => m.remove());
  Object.values(busMarkers).forEach(m => m.remove());

  routeLines = {};
  altRouteLines = {};
  stopMarkers = {};
  busMarkers = {};

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
      ar.stops.forEach((s, idx) => {
        const m = L.circleMarker(llToLatLng(s.ll), {
          radius: 5,
          color: '#111827',
          weight: 1,
          fillColor: '#f8fafc',
          fillOpacity: 1
        }).addTo(leafletMap);
        m.bindPopup('<b>' + s.n + '</b><br/>Stop ' + (idx + 1) + '/' + ar.stops.length);
        stopMarkers[idx] = m;
      });
    }

    // alt if exists and maybe suggest? draw thin dashed if suggested
    if (r.alt) {
      const alls = r.alt.stops.map(s => llToLatLng(s.ll));
      for (let i = 0; i < alls.length - 1; i++) {
        const seg = [alls[i], alls[i + 1]];
        const color = '#94a3b8';
        const weight = 4;
        const op = 0.6;
        const line = L.polyline(seg, { color, weight, opacity: op, dashArray: '6 6' });
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
    const marker = L.marker(p, {
      icon: L.divIcon({
        className: 'bus-marker',
        html: `<div class="bm" style="--c:${meta.color};${selected ? 'box-shadow:0 0 0 6px rgba(11,95,217,.25)' : ''}">${bus.name.replace('Bus ', '')}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      })
    }).addTo(leafletMap);
    const eta = formatEta(estimateEtaMins(bus, route));
    marker.bindTooltip(bus.name + ' · ' + eta + ' · ' + meta.label);
    marker.on('click', () => selectBus(bus.id));
    busMarkers[bus.id] = marker;
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
  const bus = getBus(busId);
  if (!bus) return;
  state.selectedBusId = busId;
  state.selectedRouteId = bus.routeId;
  renderBusList();
  renderRouteChips();
  renderBusDetails();
  renderRouteOpt();
  renderRoster();
  drawMap();
  // fly to
  const m = busMarkers[busId];
  if (m && leafletMap) {
    leafletMap.flyTo(m.getLatLng(), 14, { duration: 0.8 });
  }
}

function renderBusDetails() {
  const bus = getBus(state.selectedBusId);
  if (!bus) {
    busDetailsEl.innerHTML = '<p class="muted">Select a bus to see details.</p>';
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

  busDetailsEl.innerHTML = `
    <div class="detail-grid">
      <div>
        <div class="label">Bus</div>
        <div class="value">${bus.name}</div>
      </div>
      <div>
        <div class="label">Status</div>
        <div class="value"><span class="dot" style="background:${meta.color}"></span>${meta.label}</div>
      </div>
      <div>
        <div class="label">Driver</div>
        <div class="value">${bus.driver}</div>
      </div>
      <div>
        <div class="label">Phone</div>
        <div class="value">${bus.phone}</div>
      </div>
      <div>
        <div class="label">Route</div>
        <div class="value">${ar.name}</div>
      </div>
      <div>
        <div class="label">Traffic Level</div>
        <div class="value">${trafficLevelOfBus(bus, route)}</div>
      </div>
      <div>
        <div class="label">Next Stop</div>
        <div class="value">${nextStop.n}</div>
      </div>
      <div>
        <div class="label">ETA</div>
        <div class="value">${formatEta(eta)}</div>
      </div>
      <div>
        <div class="label">Students</div>
        <div class="value">${present} / ${totalStudents} present</div>
      </div>
      <div>
        <div class="label">Capacity</div>
        <div class="value">${capPct}% of ${bus.capacity}</div>
      </div>
    </div>
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

function updateSummary() {
  statTotal.textContent = BUSES.length;
  let ontime = 0, delayed = 0, present = 0, heavy = 0;
  BUSES.forEach(b => {
    const r = getRoute(b.routeId);
    const st = statusFromBus(b, r);
    if (st === 'ontime' || st === 'arriving' || st === 'arrived') {
      // better split: arriving counts differently? plan says on time/ delayed/ arriving; summary has On Time, Delayed
    }
    if (st === 'ontime' || st === 'arriving') ontime++; // arriving treated as not delayed for summary? "Buses On Time" vs "Delayed" - arriving blue
    if (st === 'delayed') delayed++;
    if (st === 'arrived') ontime++;
    present += countPresentOnBus(b);
    if (trafficLevelOfBus(b, r) === 'Heavy') heavy++;
  });
  statOnTime.textContent = ontime;
  statDelayed.textContent = delayed;
  statPresent.textContent = present;
  statTraffic.textContent = heavy;
}

function renderAlerts() {
  alertListEl.innerHTML = '';
  state.alerts.forEach((a, idx) => {
    const el = document.createElement('div');
    el.className = 'alert-item ' + (a.type || 'info');
    el.innerHTML = `<div>${a.text}</div><button class="alert-close" aria-label="Dismiss">×</button>`;
    el.querySelector('.alert-close').addEventListener('click', () => {
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
  if (routeNameEl) routeNameEl.textContent = (usingAlt && route.alt ? route.alt.name : ar.name);
  if (routeTravelHintEl) routeTravelHintEl.textContent = ar.stops.length + ' stops · ' + Math.round(routeTime(route, usingAlt)) + ' min est.';
  if (routeStopsEl) {
    routeStopsEl.innerHTML = ar.stops.map((s, i) => `<div class="stop-pill">${i+1}. ${s.n}</div>`).join('');
  }
  if (suggestionBoxEl) {
    const heavy = hasHeavyTraffic(route);
    if (route.alt && heavy && !usingAlt) {
      suggestionBoxEl.innerHTML = `
        <div class="sug-head"><span class="dot red"></span> Faster route suggested</div>
        <div class="sug-body">${route.alt.name} — saves ~${estimateSavings(route)} min</div>
        <div class="sug-actions">
          <button class="btn primary" id="acceptAlt">Accept</button>
          <button class="btn ghost" id="dismissAlt">Dismiss</button>
        </div>
      `;
      suggestionBoxEl.hidden = false;
      document.getElementById('acceptAlt')?.addEventListener('click', () => {
        state.usingAlt.add(route.id);
        renderRouteOpt();
        drawMap();
      });
      document.getElementById('dismissAlt')?.addEventListener('click', () => {
        state.usingAlt.delete(route.id);
        renderRouteOpt();
        drawMap();
      });
    } else if (usingAlt) {
      suggestionBoxEl.innerHTML = `<div class="sug-head">Using suggested route</div><button class="btn ghost" id="revertAlt">Revert to original</button>`;
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
  let len = 0;
  for (let i = 1; i < lls.length; i++) len += distanceMeters(lls[i - 1], lls[i]);
  let t = len / TRAFFIC_SPEED.green / 60; // optimistic base
  if (ar.traffic) {
    for (let i = 0; i < ar.traffic.length; i++) {
      const seg = [lls[i], lls[i + 1]];
      const sl = distanceMeters(seg[0], seg[1]);
      const tc = ar.traffic[i];
      let v = TRAFFIC_SPEED.green;
      if (tc === 'yellow') v = TRAFFIC_SPEED.yellow;
      if (tc === 'red') v = TRAFFIC_SPEED.red;
      t = len / TRAFFIC_SPEED.green / 60; // reset simplistic; better
    }
  }
  // simpler
  t = 0;
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
    let st = absent ? 'absent' : (reached ? 'onbus' : 'expected');
    if (st === 'absent') {
      // stay absent
    }
    if (absent) st = 'absent';
    else st = (reached ? 'onbus' : 'expected');
    if (q && !name.toLowerCase().includes(q)) return;
    if (f !== 'all' && st !== f) return;
    rows.push({ name, cls, stopName, st });
  });
  rosterBodyEl.innerHTML = rows.map(x => `
    <tr>
      <td>${x.name}</td>
      <td>${x.cls}</td>
      <td>${x.stopName}</td>
      <td><span class="pill ${x.st}">${x.st === 'onbus' ? 'On Bus' : (x.st === 'absent' ? 'Absent' : 'Expected')}</span></td>
    </tr>
  `).join('');
}

function updateCharts() {
  // donut - total present vs expected
  const bus = getBus(state.selectedBusId);
  let present = 0, expected = 0;
  if (bus) {
    const total = (bus.students || []).length;
    present = countPresentOnBus(bus);
    expected = total;
  } else {
    BUSES.forEach(b => { present += countPresentOnBus(b); expected += (b.students || []).length; });
  }
  const absent = Math.max(0, expected - present);
  const ctx = document.getElementById('attChart');
  if (!ctx) return;
  if (chart) { chart.destroy(); chart = null; }
  try {
    chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Present', 'Absent/Not yet on bus'],
        datasets: [{
          data: [present, absent],
          backgroundColor: ['#16A34A', '#E5E7EB'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom' }
        }
      }
    });
  } catch (e) {}
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
      state.alerts.unshift({ type: 'warn', text: b.name + ' delayed by ~' + amt + ' min due to traffic on ' + r.name + '.' });
    } else {
      // heavy traffic alert
      const routesWithHeavy = ROUTES.filter(hasHeavyTraffic);
      if (routesWithHeavy.length > 0) {
        const r = routesWithHeavy[Math.floor(Math.random() * routesWithHeavy.length)];
        state.alerts.unshift({ type: 'danger', text: 'Heavy traffic reported on ' + r.code + ' (' + r.name + ').' });
      }
    }
    if (state.alerts.length > 8) state.alerts = state.alerts.slice(0, 8);
    renderAlerts();
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
  if (studentSearchEl) studentSearchEl.addEventListener('input', () => { renderRoster(); updateCharts(); });
  if (statusFilterEl) statusFilterEl.addEventListener('change', () => { renderRoster(); updateCharts(); });
}

function init() {
  initClock();
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
