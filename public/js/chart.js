/* Cassini - Navigation chart (Leaflet map with offline plot fallback), AIS targets and the track card.
 * Part of the browser application: the files in js/ are plain scripts that share one scope and are loaded in the
 * order listed in index.html (see the README, "How the code is organised"). */
'use strict';

function trackPlot() {
  const cv = h('canvas', { class: 'track', role: 'img', 'aria-label': 'Offline plot of own ship, recent track and waypoint, north up' });
  let last = 0;
  reg(() => {
    if (Date.now() - last < 900) return; last = Date.now();
    const css = getComputedStyle(document.documentElement), col = (n) => css.getPropertyValue(n).trim();
    const w = cv.clientWidth, ht = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!w) return;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(ht * dpr); }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, ht);
    const la = lat(), lo = lon();
    c.font = '12px Roboto, sans-serif'; c.fillStyle = col('--text-3');
    if (la == null || lo == null) { c.textAlign = 'center'; c.fillText('Waiting for position…', w / 2, ht / 2); return; }
    const k = Math.cos(la * RAD), toNm = (p) => [(p[1] - lo) * 60 * k, (p[0] - la) * 60];
    const wp = get('nav.wpLat') != null && get('nav.wpLon') != null ? [get('nav.wpLat'), get('nav.wpLon')] : null;
    let ext = 0.15;
    for (const p of track) { const [x, y] = toNm(p); ext = Math.max(ext, Math.abs(x), Math.abs(y)); }
    if (wp) { const [x, y] = toNm(wp); const d = Math.max(Math.abs(x), Math.abs(y)); if (d < 20) ext = Math.max(ext, d); }
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50], ring = steps.find((x) => x * 2.2 >= ext) || 50;
    const sc = (Math.min(w, ht) / 2 - 18) / (ring * 2.2), cx = w / 2, cy = ht / 2, X = (x) => cx + x * sc, Y = (y) => cy - y * sc;
    c.strokeStyle = col('--line'); c.lineWidth = 1; c.textAlign = 'left';
    for (const r of [ring, ring * 2]) { c.beginPath(); c.arc(cx, cy, r * sc, 0, 7); c.stroke(); c.fillText(`${r} nm`, cx + 4, cy - r * sc - 4); }
    c.beginPath(); c.moveTo(cx, 8); c.lineTo(cx, ht - 8); c.moveTo(8, cy); c.lineTo(w - 8, cy); c.stroke();
    c.fillStyle = col('--text-2'); c.textAlign = 'center'; c.font = '700 12px Roboto, sans-serif'; c.fillText('N', cx, 20);
    if (wp) {
      const [x, y] = toNm(wp), far = Math.hypot(x, y) > ring * 2.6, ax = far ? (x / Math.hypot(x, y)) * ring * 2.4 : x, ay = far ? (y / Math.hypot(x, y)) * ring * 2.4 : y;
      c.strokeStyle = col('--data'); c.setLineDash([5, 5]); c.beginPath(); c.moveTo(cx, cy); c.lineTo(X(ax), Y(ay)); c.stroke(); c.setLineDash([]);
      if (!far) { c.fillStyle = col('--data'); c.beginPath(); c.arc(X(x), Y(y), 5, 0, 7); c.fill(); c.font = '12px Roboto, sans-serif'; c.fillText('WPT', X(x), Y(y) - 9); }
    }
    if (track.length > 1) {
      c.strokeStyle = col('--accent'); c.lineWidth = 2; c.lineJoin = 'round'; c.beginPath();
      track.forEach((p, i) => { const [x, y] = toNm(p); i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y)); });
      c.lineTo(cx, cy); c.stroke();
    }
    const hd = heading().v ?? get('cog') ?? 0;
    c.save(); c.translate(cx, cy); c.rotate(hd * RAD); c.fillStyle = col('--text'); c.strokeStyle = col('--card'); c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, -12); c.lineTo(7, 9); c.lineTo(0, 5); c.lineTo(-7, 9); c.closePath(); c.fill(); c.stroke(); c.restore();
  });
  return cv;
}

/** Navigation chart: live map (Leaflet + OpenStreetMap + OpenSeaMap seamarks, needs internet for tiles)
 *  with the offline own-ship plot as the alternative / automatic fallback. */
let leafMaps = [];
function chartView() {
  const mapEl = h('div', 'map'), plot = trackPlot(), note = h('div', { class: 'map-note', hidden: '' });
  const bMap = h('button', { type: 'button', text: 'Map', onclick: () => setView('map') }), bPlot = h('button', { type: 'button', text: 'Offline plot', onclick: () => setView('plot') });
  const centre = h('button', { type: 'button', class: 'btn sm', text: 'Centre on vessel', hidden: '', onclick: () => { follow = true; centre.hidden = true; last = 0; } });
  let map = null, aisLayer, aisMarks = new Map(), ship, line, wpt, wptLine, follow = true, fixed = false, lastW = 0, last = 0, loaded = 0, errors = 0;
  function setView(v) {
    settings.navView = v; saveSettings();
    mapEl.hidden = v !== 'map'; plot.hidden = v !== 'plot'; if (v !== 'map') centre.hidden = true; else note.hidden = true;
    bMap.setAttribute('aria-pressed', v === 'map'); bPlot.setAttribute('aria-pressed', v === 'plot');
    lastW = 0; last = 0;
  }
  setView(window.L && settings.navView !== 'plot' ? 'map' : 'plot');
  reg(() => {
    if (settings.navView !== 'map' || !window.L) return;
    const w = mapEl.clientWidth + mapEl.clientHeight * 10000; if (!mapEl.clientWidth) return;
    if (!map) {
      map = L.map(mapEl, { worldCopyJump: true }).setView([30, 0], 2); leafMaps.push(map);
      const custom = settings.tiles && /^https:\/\//.test(settings.tiles.url || '') ? settings.tiles : null;
      const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const base = L.tileLayer(standalone ? (custom ? custom.url : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png') : '/tiles/base/{z}/{x}/{y}', { maxZoom: 19, className: custom ? '' : 'base-tiles',
        attribution: custom ? esc(custom.attribution || 'Map tiles: custom provider') : '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }).addTo(map);
      L.tileLayer(standalone ? 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png' : '/tiles/sea/{z}/{x}/{y}', { maxZoom: 18,
        attribution: 'Seamarks &copy; <a href="https://www.openseamap.org" target="_blank" rel="noopener">OpenSeaMap</a>' }).addTo(map);
      base.on('tileload', () => { loaded++; });
      base.on('tileerror', () => {
        if (loaded || ++errors < 4 || settings.navView !== 'map') return;
        setView('plot'); note.textContent = 'Map tiles could not be loaded - they need an internet connection. Showing the offline plot instead.'; note.hidden = false;
      });
      map.on('dragstart', () => { follow = false; centre.hidden = false; });
      L.control.scale({ imperial: false }).addTo(map);
      line = L.polyline([], { color: '#7c3aed', weight: 3, opacity: 0.95 }).addTo(map);
      wptLine = L.polyline([], { color: '#1f7fe0', weight: 2, dashArray: '6 6' }).addTo(map);
      aisLayer = L.layerGroup().addTo(map);
      wpt = L.circleMarker([0, 0], { radius: 6, color: '#fff', weight: 2, fillColor: '#1f7fe0', fillOpacity: 1 });
      ship = L.marker([0, 0], { interactive: false, icon: L.divIcon({ className: 'ship', iconSize: [30, 30], iconAnchor: [15, 15],
        html: '<svg viewBox="-12 -12 24 24"><path d="M0 -11 L7 9 L0 5 L-7 9Z"/></svg>' }) });
    }
    if (w !== lastW) { lastW = w; map.invalidateSize(); }
    if (Date.now() - last < 900) return; last = Date.now();
    const la = lat(), lo = lon();
    if (la == null || lo == null) return;
    const pos = [la, lo], hd = heading().v ?? get('cog') ?? 0;
    if (!map.hasLayer(ship)) ship.addTo(map);
    ship.setLatLng(pos);
    const icon = ship.getElement(); if (icon) icon.firstChild.style.transform = `rotate(${hd.toFixed(0)}deg)`;
    line.setLatLngs([...histTrack, ...track, pos]);
    const wl = get('nav.wpLat'), wo = get('nav.wpLon');
    if (wl != null && wo != null) { wpt.setLatLng([wl, wo]); if (!map.hasLayer(wpt)) wpt.addTo(map); wptLine.setLatLngs([pos, [wl, wo]]); }
    else { wpt.remove(); wptLine.setLatLngs([]); }
    // AIS targets: one rotated marker per vessel, with its name on hover/tap
    const seen = new Set();
    for (const o of aisList()) {
      seen.add(o.mmsi);
      let mk = aisMarks.get(o.mmsi);
      if (!mk) {
        mk = L.marker([o.lat, o.lon], { icon: L.divIcon({ className: 'ais-mark', iconSize: [22, 22], iconAnchor: [11, 11], html: '<svg viewBox="-11 -11 22 22"><path d="M0 -10 L6 8 L-6 8Z"/></svg>' }) }).addTo(aisLayer);
        mk.bindTooltip('', { direction: 'top', offset: [0, -10] });
        aisMarks.set(o.mmsi, mk);
      }
      mk.setLatLng([o.lat, o.lon]);
      const g = mk.getElement(); if (g) g.firstChild.style.transform = `rotate(${(o.hdg ?? o.cog ?? 0).toFixed(0)}deg)`;
      mk.setTooltipContent(`${aisName(o)} · ${fu(conv('speed', o.sog), 1, unit('speed'))}${o.range != null ? ` · ${o.range.toFixed(2)} nm` : ''}`);
    }
    for (const [mmsi, mk] of aisMarks) if (!seen.has(mmsi)) { mk.remove(); aisMarks.delete(mmsi); }
    if (!fixed) { fixed = true; map.setView(pos, 13, { animate: false }); }
    else if (follow) map.panTo(pos, { animate: true, duration: 0.5 });
  });
  const fit = h('button', { type: 'button', class: 'btn sm', text: 'Fit track', onclick: () => { const pts = [...histTrack, ...track]; if (map && pts.length > 1) { follow = false; centre.hidden = false; map.fitBounds(L.latLngBounds(pts).pad(0.15)); } } });
  return { el: h('div', 'chart', mapEl, plot, note), controls: h('span', 'h-tools', fit, centre, h('span', 'mini-seg', bMap, bPlot)) };
}

/** AIS targets with range, bearing and closest point of approach (CPA) relative to own ship, nearest first */
function aisList() {
  const la = lat(), lo = lon(), os = get('sog'), oc = get('cog'), out = [];
  for (const tg of aisTargets.values()) {
    if (tg.lat == null || tg.lon == null) continue;
    const o = Object.assign({}, tg);
    if (la != null && lo != null) {
      const dN = (tg.lat - la) * 60, dE = (tg.lon - lo) * 60 * Math.cos(la * RAD);            // nautical miles
      o.range = Math.hypot(dN, dE); o.brg = wrap(Math.atan2(dE, dN) / RAD);
      if (os != null && oc != null && tg.sog != null && tg.cog != null) {
        const kn = 1 / 0.514444, rE = (tg.sog * Math.sin(tg.cog * RAD) - os * Math.sin(oc * RAD)) * kn, rN = (tg.sog * Math.cos(tg.cog * RAD) - os * Math.cos(oc * RAD)) * kn, v2 = rE * rE + rN * rN;
        if (v2 > 0.01) { const tc = -(dE * rE + dN * rN) / v2; o.tcpa = tc * 60; o.cpa = tc > 0 ? Math.hypot(dE + rE * tc, dN + rN * tc) : o.range; }
      }
    }
    out.push(o);
  }
  return out.sort((a, b) => (a.range ?? 1e9) - (b.range ?? 1e9));
}
const aisName = (o) => o.name || `MMSI ${o.mmsi}`;
function aisTable() {
  const body = h('tbody'); let last = 0;
  reg(() => {
    if (Date.now() - last < 950) return; last = Date.now();
    const list = aisList().slice(0, 60);
    body.replaceChildren(...(list.length ? list.map((o) => h('tr', null,
      h('td', 'wrap', h('strong', { text: aisName(o) }), h('div', { class: 'desc', text: [`Class ${o.cls || '?'}`, N2K.aisTypeName(o.type), o.length ? `${o.length.toFixed(0)} m` : '', o.status || '', o.dest ? `to ${o.dest}` : ''].filter(Boolean).join(' · ') })),
      h('td', { class: 'num', text: o.range == null ? '—' : `${o.range.toFixed(2)} nm` }), h('td', { class: 'num', text: fdeg(o.brg) }),
      h('td', { class: 'num', text: fu(conv('speed', o.sog), 1, unit('speed')) }), h('td', { class: 'num', text: fdeg(o.cog) }),
      h('td', { class: 'num' + (o.cpa != null && o.tcpa > 0 && o.cpa < 0.25 ? ' close' : ''), text: o.cpa == null ? '—' : `${o.cpa.toFixed(2)} nm` }),
      h('td', { class: 'num', text: o.tcpa == null ? '—' : o.tcpa <= 0 ? 'passed' : o.tcpa > 180 ? '> 3 h' : `${o.tcpa.toFixed(0)} min` })))
      : [h('tr', null, h('td', { colspan: 7, class: 'dim', text: 'No AIS targets received. AIS needs an AIS receiver or transponder on the NMEA 2000 network.' }))]));
  });
  return h('div', 'tbl-wrap', h('table', null, h('thead', null, h('tr', null, ['Vessel', 'Range', 'Bearing', 'SOG', 'COG', 'CPA', 'Time to CPA'].map((x, i) => h('th', { class: i ? 'num' : null, text: x })))), body));
}

/** track summary + export, like a location-history panel. Live = since this page opened; other ranges come from the bridge. */
function trackCard() {
  let range = 'live', hist = null, fetchedAt = 0;
  const dist = (pts) => { let d = 0; for (let i = 1; i < pts.length; i++) d += Math.hypot((pts[i][1] - pts[i - 1][1]) * 111320, (pts[i][2] - pts[i - 1][2]) * 111320 * Math.cos(pts[i][1] * RAD)); return d; };
  const cur = () => (range === 'live' ? { pts: track.map((p, i) => [trackT[i], p[0], p[1]]), dist: trackDist } : hist || { pts: [], dist: 0 });
  const chips = rangeChips((r) => { range = r; hist = null; fetchedAt = 0; if (r === 'live') histTrack = []; });
  reg(() => {
    if (range === 'live' || (Date.now() - fetchedAt < 60000 && fetchedAt >= wipedAt)) return;
    fetchedAt = Date.now(); const r = range;
    fetch(`/api/track?range=${r}`).then((x) => x.json()).then((j) => { if (range !== r) return; const pts = j.points || []; hist = { pts, dist: dist(pts) }; histTrack = pts.map((p) => [p[1], p[2]]); }).catch(() => { if (range === r) hist = { pts: [], dist: 0 }; });
  });
  const exportCsv = () => {
    const rows = ['time_utc,latitude,longitude', ...cur().pts.map((p) => `${new Date(p[0]).toISOString()},${p[1].toFixed(6)},${p[2].toFixed(6)}`)];
    const a = h('a', { href: URL.createObjectURL(new Blob([rows.join('\r\n')], { type: 'text/csv' })), download: `track-${range}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const stat = (label, fn) => h('div', 'stat', t('stat-num', fn, 'div'), h('div', { class: 'stat-label', text: label }));
  return card('Track history', 'c4', chips,
    h('div', 'stats', stat('Points', () => String(cur().pts.length)),
      stat('Timeframe', () => { const p = cur().pts; if (p.length < 2) return '—'; const m = (p[p.length - 1][0] - p[0][0]) / 60000; return m < 90 ? `${m.toFixed(0)} min` : m < 2880 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} days`; }),
      stat('Distance', () => (cur().pts.length < 2 ? '—' : `${(cur().dist / 1852).toFixed(2)} nm`))),
    h('div', 'row wrap', h('button', { class: 'btn', type: 'button', text: 'Export CSV', onclick: exportCsv }),
      h('button', { class: 'btn', type: 'button', text: 'Clear live track', onclick: () => { track = []; trackT = []; trackDist = 0; } })),
    t('hint', () => (range === 'live' ? 'Live: since this page was opened. Choose a longer range to load the stored track and draw it on the chart.' : 'Stored by the dashboard bridge (every 30 s for 24 h, 10-minute averages for 30 days).'), 'p'));
}
