/* google-maps-adapter.js — Google Maps renderer for the dashboard.
 *
 * app.js is written against a small subset of the Leaflet API (L.map, L.marker,
 * L.divIcon, L.polyline, L.circleMarker, L.featureGroup, L.latLng, plus the
 * usual addTo/remove/setLatLng/bindTooltip/bindPopup methods). This file
 * provides that same subset on top of the Google Maps JavaScript API, so the
 * whole dashboard (routes, stops, buses, live devices, popups, tooltips)
 * renders on Google Maps with no change to the application logic.
 *
 * index_g.html loads this file plus the Google Maps JS API; that page holds the
 * GOOGLE_MAPS_API_KEY placeholder. If the API is missing or the key is rejected
 * the adapter degrades to a no-op (every layer call is dropped), so the rest of
 * the dashboard still works and index_g.html shows a notice over the map area.
 * Remove that notice on click once the key is set.
 *
 * This file intentionally does NOT contain the API key — only index_g.html does.
 */
(function () {
  'use strict';

  const LIGHT_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#eef2f7' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#5d6b82' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
    { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#dfe6f0' }] },
    { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#dfeee0' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
    { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8a94a6' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f3d9a4' }] },
    { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#a1731f' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#cfe0f3' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#7fa8d4' }] }
  ];

  const gmaps = () => (window.google && window.google.maps) || null;

  function toLL(p) {
    if (p == null) return null;
    if (Array.isArray(p)) return { lat: +p[0], lng: +p[1] };
    if (typeof p.lat === 'function') return { lat: +p.lat(), lng: +p.lng() }; // google.maps.LatLng
    if (typeof p.lat === 'number') return { lat: +p.lat, lng: +p.lng };
    return null;
  }

  function Bounds(min, max) { this.min = min; this.max = max; }
  Bounds.prototype.pad = function (f) {
    if (!this.min || !this.max) return this;
    const dLat = (this.max.lat - this.min.lat) * f;
    const dLng = (this.max.lng - this.min.lng) * f;
    return new Bounds(
      { lat: this.min.lat - dLat, lng: this.min.lng - dLng },
      { lat: this.max.lat + dLat, lng: this.max.lng + dLng }
    );
  };

  /* ------------------------------- Map ------------------------------- */
  function MapHandle(id) {
    this.id = id;
    this.container = document.getElementById(id);
    this.map = null;
    this._center = null;
    this._zoom = 12;
  }
  MapHandle.prototype._ensure = function () {
    if (this.map) return this.map;
    const gm = gmaps();
    if (!gm || window.__gmapsFailed || !this.container) return null;
    this.map = new gm.Map(this.container, {
      center: this._center || { lat: 12.9716, lng: 77.5946 },
      zoom: this._zoom,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
      gestureHandling: 'greedy',
      styles: LIGHT_STYLE
    });
    this.map.addListener('click', () => {
      document.querySelectorAll('.gm-pop').forEach(el => { el.hidden = true; });
    });
    return this.map;
  };
  // Run fn against the google map when available; drop the op otherwise
  // (drawMap() re-adds every layer on each tick, so dropped ops self-heal).
  MapHandle.prototype._run = function (fn) {
    const m = this._ensure();
    if (!m) return false;
    try { fn(m); } catch (e) { /* keep the dashboard alive on renderer errors */ }
    return true;
  };
  MapHandle.prototype.setView = function (ll, zoom) {
    const p = toLL(ll);
    if (p) this._center = p;
    if (zoom != null) this._zoom = zoom;
    this._run(m => { if (this._center) m.setCenter(this._center); if (zoom != null) m.setZoom(zoom); });
    return this;
  };
  MapHandle.prototype.fitBounds = function (bounds) {
    const b = bounds && bounds.min ? bounds : null;
    this._run(m => {
      const gm = gmaps();
      if (b && b.min && b.max && gm) {
        const gb = new gm.LatLngBounds();
        gb.extend({ lat: b.min.lat, lng: b.min.lng });
        gb.extend({ lat: b.max.lat, lng: b.max.lng });
        if (!gb.isEmpty()) { m.fitBounds(gb, 40); return; }
      }
      if (this._center) { m.setCenter(this._center); m.setZoom(this._zoom); }
    });
    return this;
  };
  MapHandle.prototype.flyTo = function (ll, zoom) {
    const p = toLL(ll);
    this._run(m => { if (zoom != null) m.setZoom(zoom); if (p) m.panTo(p); });
    return this;
  };
  MapHandle.prototype.getContainer = function () { return this.container; };

  /* ---------------------------- Base tiles --------------------------- */
  function TileLayer() {}
  TileLayer.prototype.addTo = function () { return this; }; // Google draws its own basemap
  TileLayer.prototype.remove = function () { return this; };

  /* ----------------------------- Polylines --------------------------- */
  function Polyline(points, opts) {
    this._lls = (points || []).map(toLL).filter(Boolean);
    this.opts = opts || {};
    this._obj = null;
  }
  Polyline.prototype.addTo = function (map) {
    const self = this;
    map._run(m => {
      const gm = gmaps();
      const op = self.opts.opacity == null ? 0.85 : self.opts.opacity;
      const o = {
        path: self._lls,
        strokeColor: self.opts.color || '#3388ff',
        strokeOpacity: op,
        strokeWeight: self.opts.weight || 3,
        clickable: false
      };
      if (self.opts.dashArray) {
        o.strokeOpacity = 0;
        o.icons = [{
          icon: {
            path: 'M 0,-1 0,1',
            strokeOpacity: op,
            strokeColor: o.strokeColor,
            scale: o.strokeWeight
          },
          offset: '0',
          repeat: '14px'
        }];
      }
      self._obj = new gm.Polyline(o);
      self._obj.setMap(m);
    });
    return this;
  };
  Polyline.prototype.remove = function () {
    if (this._obj) this._obj.setMap(null);
    this._obj = null;
    return this;
  };

  /* ------------------------------ Markers ---------------------------- */
  // DOM markers (rich HTML icons) drawn via google.maps.OverlayView, which
  // needs no Map ID. Supports tooltips (hover or permanent) and click popups.
  function DomMarker(ll, opts) {
    this._latlng = toLL(ll) || { lat: 0, lng: 0 };
    this.opts = opts || {};
    this._icon = this.opts.icon || {};
    this._events = {};
    this._overlay = null;
    this._div = null;
    this._tip = null;
    this._pop = null;
    this._tooltip = null;
    this._popupHtml = null;
    this._z = this.opts.zIndexOffset || 0;
  }
  DomMarker.prototype.on = function (ev, fn) {
    (this._events[ev] = this._events[ev] || []).push(fn);
    return this;
  };
  DomMarker.prototype.getLatLng = function () { return this._latlng; };
  DomMarker.prototype.setLatLng = function (ll) {
    const p = toLL(ll);
    if (!p) return this;
    this._latlng = p;
    if (this._overlay) this._overlay.draw();
    return this;
  };
  DomMarker.prototype.setIcon = function (icon) {
    this._icon = icon || {};
    this._build();
    return this;
  };
  DomMarker.prototype.bindTooltip = function (content, opts) {
    this._tooltip = { content: content, opts: opts || {} };
    this._build();
    return this;
  };
  DomMarker.prototype.setTooltipContent = function (content) {
    if (!this._tooltip) this._tooltip = { content: content, opts: {} };
    else this._tooltip.content = content;
    if (this._tip) this._tip.textContent = content;
    else this._build();
    return this;
  };
  DomMarker.prototype.unbindTooltip = function () {
    this._tooltip = null;
    this._build();
    return this;
  };
  DomMarker.prototype.bindPopup = function (html) {
    this._popupHtml = html;
    this._build();
    return this;
  };
  DomMarker.prototype.closePopup = function () {
    if (this._pop) this._pop.hidden = true;
    return this;
  };
  DomMarker.prototype._togglePopup = function () {
    if (!this._pop) return;
    const willShow = this._pop.hidden;
    document.querySelectorAll('.gm-pop').forEach(el => { el.hidden = true; });
    this._pop.hidden = !willShow;
  };
  DomMarker.prototype._build = function () {
    if (!this._div) return;
    this._div.innerHTML = this._icon.html || '';
    this._tip = null;
    this._pop = null;
    if (this._tooltip) {
      const t = document.createElement('div');
      const perma = this._tooltip.opts && this._tooltip.opts.permanent;
      t.className = 'gm-tip ' + ((this._tooltip.opts && this._tooltip.opts.className) || '') +
        (perma ? ' gm-tip-permanent show' : '');
      t.textContent = this._tooltip.content;
      this._tip = t;
      this._div.appendChild(t);
    }
    if (this._popupHtml != null) {
      const p = document.createElement('div');
      p.className = 'gm-pop';
      p.innerHTML = this._popupHtml;
      p.hidden = true;
      this._pop = p;
      this._div.appendChild(p);
    }
  };
  DomMarker.prototype.addTo = function (map) {
    const self = this;
    map._run(m => {
      const gm = gmaps();
      function Overlay() {}
      Overlay.prototype = new gm.OverlayView();
      Overlay.prototype.onAdd = function () {
        const div = document.createElement('div');
        div.className = 'gm-marker' + (self._icon.className ? ' ' + self._icon.className : '');
        div.style.position = 'absolute';
        const anchor = self._icon.iconAnchor ||
          [(self._icon.iconSize && self._icon.iconSize[0] / 2) || 0,
           (self._icon.iconSize && self._icon.iconSize[1] / 2) || 0];
        div.style.marginLeft = (-anchor[0]) + 'px';
        div.style.marginTop = (-anchor[1]) + 'px';
        div.style.zIndex = String(1000 + self._z);
        const interactive = self.opts.interactive !== false;
        div.style.pointerEvents = interactive ? 'auto' : 'none';
        if (interactive) {
          div.style.cursor = 'pointer';
          div.addEventListener('click', ev => {
            ev.stopPropagation();
            if (self._popupHtml != null) self._togglePopup();
            (self._events.click || []).forEach(fn => fn());
          });
          div.addEventListener('mouseenter', () => {
            if (self._tip && !self._tip.classList.contains('gm-tip-permanent')) self._tip.classList.add('show');
          });
          div.addEventListener('mouseleave', () => {
            if (self._tip && !self._tip.classList.contains('gm-tip-permanent')) self._tip.classList.remove('show');
          });
        }
        self._div = div;
        self._build();
        const pane = interactive ? this.getPanes().overlayMouseTarget : this.getPanes().overlayLayer;
        pane.appendChild(div);
      };
      Overlay.prototype.draw = function () {
        if (!self._div) return;
        const proj = this.getProjection();
        if (!proj) return;
        const p = proj.fromLatLngToDivPixel(new gm.LatLng(self._latlng.lat, self._latlng.lng));
        if (p) { self._div.style.left = p.x + 'px'; self._div.style.top = p.y + 'px'; }
      };
      Overlay.prototype.onRemove = function () {
        if (self._div && self._div.parentNode) self._div.parentNode.removeChild(self._div);
        self._div = null; self._tip = null; self._pop = null;
      };
      self._overlay = new Overlay();
      self._overlay.setMap(m);
    });
    return this;
  };
  DomMarker.prototype.remove = function () {
    if (this._overlay) this._overlay.setMap(null);
    this._overlay = null;
    return this;
  };

  function circleMarker(ll, opts) {
    const o = opts || {};
    const html = '<span class="stop-dot" style="border-color:' + (o.color || '#111827') +
      ';background:' + (o.fillColor || '#f8fafc') + '"></span>';
    return new DomMarker(ll, {
      icon: { html: html, iconSize: [12, 12], iconAnchor: [6, 6] },
      interactive: true,
      zIndexOffset: 200
    });
  }

  function featureGroup(layers) {
    return {
      getBounds: function () {
        let min = null, max = null;
        (layers || []).forEach(l => {
          const ll = l && l._latlng;
          if (!ll) return;
          min = min ? { lat: Math.min(min.lat, ll.lat), lng: Math.min(min.lng, ll.lng) }
                    : { lat: ll.lat, lng: ll.lng };
          max = max ? { lat: Math.max(max.lat, ll.lat), lng: Math.max(max.lng, ll.lng) }
                    : { lat: ll.lat, lng: ll.lng };
        });
        return new Bounds(min, max);
      }
    };
  }

  window.L = {
    map: id => new MapHandle(id),
    tileLayer: () => new TileLayer(),
    marker: (ll, opts) => new DomMarker(ll, opts),
    circleMarker: (ll, opts) => circleMarker(ll, opts),
    polyline: (pts, opts) => new Polyline(pts, opts),
    featureGroup: layers => featureGroup(layers),
    latLng: (a, b) => ({ lat: +a, lng: +b }),
    divIcon: opts => Object.assign({ _divIcon: true }, opts || {})
  };
  window.__gmapsReady = () => !!gmaps();
})();
