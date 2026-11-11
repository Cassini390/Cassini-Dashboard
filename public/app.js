/* Cassini - NMEA 2000 dashboard for the Actisense W2K-2 - browser application.
 * Receives N2K ASCII lines from the local bridge (server.js) over Server-Sent Events,
 * decodes them (n2k.js) into a live value store and renders the instrument pages. */
(() => {
  'use strict';
  const RAD = Math.PI / 180;
  const $ = (s, r = document) => r.querySelector(s);
  const wrap = (a) => ((a % 360) + 360) % 360;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ================================================================ DOM helpers
  function attrs(e, a) {
    if (typeof a === 'string') e.setAttribute('class', a);
    else if (a) for (const k in a) {
      if (k === 'text') e.textContent = a[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), a[k]);
      else if (a[k] != null) e.setAttribute(k, a[k]);
    }
    return e;
  }
  const h = (tag, a, ...kids) => { const e = attrs(document.createElement(tag), a); e.append(...kids.flat().filter((k) => k != null)); return e; };
  const s = (tag, a, ...kids) => { const e = attrs(document.createElementNS('http://www.w3.org/2000/svg', tag), a); e.append(...kids.flat().filter((k) => k != null)); return e; };

  // Widgets register an update function into the page currently being built.
  let sink = null;
  const reg = (fn) => sink.push(fn);
  const withSink = (arr, fn) => { const prev = sink; sink = arr; try { return fn(); } finally { sink = prev; } };
  /** element whose text follows fn() */
  function t(cls, fn, tag = 'span') {
    const e = h(tag, cls); let last;
    let lastAge = false;
    reg(() => {
      ageing = false;
      const v = fn(); if (v !== last) { e.textContent = v; last = v; }
      if (ageing !== lastAge) { lastAge = ageing; e.classList.toggle('ageing', ageing); }   // dim values whose data has stopped updating
    });
    return e;
  }
  let ageing = false;   // set by get() when it returns a value that is overdue for an update
  /** container whose children are rebuilt whenever the id list changes (engines, batteries, tanks...) */
  function dyn(el, idsFn, build, emptyText) {
    let sig = null, ups = [];
    reg(() => {
      const ids = idsFn(), sg = ids.join('|');
      if (sg !== sig) {
        sig = sg; ups = []; el.replaceChildren();
        withSink(ups, () => { if (!ids.length) el.append(h('div', { class: 'empty', text: emptyText })); else ids.forEach((id, i) => el.append(build(id, i, ids))); });
      }
      ups.forEach((u) => u());
    });
    return el;
  }
  const card = (title, cls, ...kids) => h('section', 'card ' + (cls || ''), h('h3', null, ...[].concat(title)), ...kids);
  const kv = (rows, cls = '') => h('dl', 'kv ' + cls, rows.map(([k, fn]) => h('div', null, h('dt', { text: k }), t(null, fn, 'dd'))));
  const big = (numFn, unitFn, cls = '') => h('div', 'big ' + cls, t('num', numFn), t('unit', typeof unitFn === 'function' ? unitFn : () => unitFn));

  // ================================================================ settings & units
  const DEFAULTS = () => ({ speed: 'kn', depth: 'm', temp: 'c', pressure: 'bar', volume: 'l', theme: 'auto', brightness: 100, sound: false, alarms: {}, sources: {}, names: {}, tiles: {}, depthRef: 'offset' });
  const settings = Object.assign(DEFAULTS(),
    (() => { try { return JSON.parse(localStorage.getItem('w2k.settings')) || {}; } catch { return {}; } })());
  // Per-device settings stay in this browser; everything else (units, alarms, source priority, dashboard layout)
  // is also stored by the bridge so every device viewing the dashboard shares it.
  const DEVICE_KEYS = ['theme', 'brightness', 'sound', 'navView', 'ws'];
  const clientId = Math.random().toString(36).slice(2);
  const sharedSettings = () => Object.fromEntries(Object.entries(settings).filter(([k]) => !DEVICE_KEYS.includes(k)));
  const hadLocal = (() => { try { return !!localStorage.getItem('w2k.settings'); } catch { return false; } })();
  let pushTimer = 0;
  const saveLocal = () => { try { localStorage.setItem('w2k.settings', JSON.stringify(settings)); } catch { /* private mode */ } };
  const pushShared = () => fetch('/api/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Client': clientId }, body: JSON.stringify(sharedSettings()) }).catch(() => {});
  if (settings.shallow != null) { if (!settings.alarms.shallow) settings.alarms.shallow = { value: settings.shallow }; delete settings.shallow; }   // migrate old setting
  const saveSettings = () => { saveLocal(); clearTimeout(pushTimer); pushTimer = setTimeout(pushShared, 400); };
  /** replace the shared part of the settings (from the bridge, another device, or an imported file) */
  function applyShared(p) {
    if (!p || typeof p !== 'object') return;
    for (const k of Object.keys(settings)) if (!DEVICE_KEYS.includes(k)) delete settings[k];
    const d = DEFAULTS();
    for (const k of Object.keys(d)) if (!DEVICE_KEYS.includes(k)) settings[k] = d[k];
    for (const k of Object.keys(p)) if (!DEVICE_KEYS.includes(k)) settings[k] = p[k];
    if (typeof settings.alarms !== 'object' || !settings.alarms) settings.alarms = {};
    if (typeof settings.sources !== 'object' || !settings.sources) settings.sources = {};
    if (typeof settings.names !== 'object' || !settings.names) settings.names = {};
    if (typeof settings.tiles !== 'object' || !settings.tiles) settings.tiles = {};
    saveLocal(); alertAt = 0; buildPages();
  }
  const UNITS = {
    speed: { kn: [1 / 0.514444, 'kn'], kmh: [3.6, 'km/h'], mph: [2.236936, 'mph'], ms: [1, 'm/s'] },
    depth: { m: [1, 'm'], ft: [3.28084, 'ft'] },
    pressure: { bar: [0.01, 'bar'], kpa: [1, 'kPa'], psi: [0.1450377, 'psi'] },
    volume: { l: [1, 'L'], gal: [0.264172, 'gal'], igal: [0.219969, 'gal'] },
  };
  const conv = (kind, v) => (v == null ? null : v * UNITS[kind][settings[kind]][0]);
  const unit = (kind) => (kind === 'temp' ? (settings.temp === 'f' ? '°F' : '°C') : UNITS[kind][settings[kind]][1]);
  const cTemp = (v) => (v == null ? null : settings.temp === 'f' ? v * 9 / 5 + 32 : v);
  const f = (v, d = 0) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));
  const fu = (v, d, u) => (v == null || !isFinite(v) ? '—' : `${v.toFixed(d)} ${u}`);
  const fdeg = (v) => (v == null ? '—' : String(Math.round(wrap(v)) % 360).padStart(3, '0') + '°');
  const fSpd = (v, d = 1) => f(conv('speed', v), d);
  const fTemp = (v, d = 1) => fu(cTemp(v), d, unit('temp'));
  const fPres = (v) => fu(conv('pressure', v), settings.pressure === 'bar' ? 2 : settings.pressure === 'psi' ? 1 : 0, unit('pressure'));
  const fNm = (m) => (m == null ? '—' : m < 185.2 ? `${Math.round(m)} m` : `${(m / 1852).toFixed(m < 18520 ? 2 : 1)} nm`);
  function fLatLon(v, pos, neg) {
    if (v == null) return '—';
    const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60;
    return `${d}° ${m.toFixed(3).padStart(6, '0')}′ ${v >= 0 ? pos : neg}`;
  }
  const fTime = (ms) => (ms == null ? '—' : new Date(ms).toISOString().substr(11, 8));
  function fDur(min) { if (min == null) return '—'; const hh = Math.floor(min / 60); return hh >= 48 ? `${Math.round(hh / 24)} d` : `${hh} h ${String(Math.round(min % 60)).padStart(2, '0')} m`; }

  // ================================================================ live value store
  let aisTargets = new Map();   // mmsi -> { mmsi, cls, name, lat, lon, cog, sog, hdg, t (last position time), ... }
  const onAis = (mmsi, f) => {
    if (mmsi == null) return;
    const o = aisTargets.get(mmsi) || { mmsi };
    for (const k in f) if (f[k] != null && f[k] !== '') o[k] = f[k];
    if (f.lat != null) o.t = Date.now();
    aisTargets.set(mmsi, o);
  };
  let boatName = '', trackT = [], trackDist = 0, histTrack = [];   // histTrack: stored track for the range chosen on the Track history card
  let D = {}, H = {}, track = [], pgnStats = new Map(), srcStats = new Map(), rawLog = [], lastRx = 0, badLines = 0, maxSog = 0;
  const SLOW = /^(tank|bat|temp|tempSet|humidity|pressure|switch|eng|log|variation|gnss)\b/;
  // ---- source arbitration: when several devices send the same data, only one source is used at a time.
  // "Auto" sticks with the first source seen and fails over when it goes quiet; a prioritised source
  // (Sources page) always wins while it is alive.
  let curSrc = null, groupSrcs = new Map(), groupActive = new Map();
  const groupOf = N2K.groupOf;   // shared with the bridge (public/n2k.js)
  const put = (k, v) => {
    if (v == null || (typeof v === 'number' && !isFinite(v))) return;
    const now = Date.now();
    if (curSrc != null && !k.startsWith('dev.')) {
      const g = groupOf(k), tmo = SLOW.test(k) ? 25000 : 8000;
      let m = groupSrcs.get(g); if (!m) groupSrcs.set(g, (m = new Map()));
      m.set(curSrc, now);
      const live = (sa) => sa != null && m.has(sa) && now - m.get(sa) < tmo;
      const pref = settings.sources[g];
      let act = groupActive.get(g);
      if (pref != null && live(pref)) act = pref; else if (!live(act)) act = curSrc;
      groupActive.set(g, act);
      if (act !== curSrc) return;
    }
    D[k] = { v, t: now };
  };
  function get(k) {
    const e = D[k];
    if (!e) return null;
    if (k.startsWith('dev.')) return e.v;
    const age = Date.now() - e.t, slow = SLOW.test(k);
    if (age >= (slow ? 20000 : 6000)) return null;          // too old: treat as no data
    if (age > (slow ? 8000 : 2500)) ageing = true;          // overdue: still shown, but dimmed
    return e.v;
  }
  /** ids of live instances under a prefix, e.g. ids('eng') -> ['0','1'] */
  function ids(prefix) {
    const out = new Set(), p = prefix + '.';
    for (const k in D) if (k.startsWith(p) && get(k) != null) out.add(k.slice(p.length).split('.')[0]);
    return [...out].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
  let wipedAt = 0;   // when the data was last cleared by hand: stored-history charts fetched before this reload
  /** forget everything received so far (values, instances, sources, AIS targets, track, traffic counters); settings are untouched */
  function wipeData() { resetData(); histTrack = []; wipedAt = Date.now(); }
  function resetData() { aisTargets = new Map(); D = {}; H = {}; track = []; trackT = []; trackDist = 0; pgnStats = new Map(); srcStats = new Map(); rawLog = []; badLines = 0; maxSog = 0; groupSrcs = new Map(); groupActive = new Map(); }

  function ingest(line) {
    const m = N2K.parseLine(line);
    if (!m) { badLines++; return; }
    lastRx = Date.now();
    let ps = pgnStats.get(m.pgn);
    if (!ps) pgnStats.set(m.pgn, (ps = { n: 0, n1: 0, rate: 0, srcs: new Set(), t: 0 }));
    ps.n++; ps.n1++; ps.t = lastRx; ps.srcs.add(m.src);
    let ss = srcStats.get(m.src);
    if (!ss) srcStats.set(m.src, (ss = { n: 0, t: 0 }));
    ss.n++; ss.t = lastRx;
    curSrc = m.src; N2K.decode(m, put, onAis); curSrc = null;
    rawLog.push(line); if (rawLog.length > 300) rawLog.splice(0, 100);
  }

  // ---- derived values
  function heading() { // -> {v, ref} preferring true
    const tr = get('hdg.true'), mg = get('hdg.mag'), va = get('variation');
    if (tr != null) return { v: tr, ref: 'T' };
    if (mg != null && va != null) return { v: wrap(mg + va), ref: 'T' };
    if (mg != null) return { v: mg, ref: 'M' };
    return { v: null, ref: 'T' };
  }
  const lat = () => get('lat') ?? get('gnss.lat');
  const lon = () => get('lon') ?? get('gnss.lon');
  function trueWind() { // network true wind if present, else computed from apparent wind and boat speed
    let tws = get('wind.tws'), twa = get('wind.twa'), calc = false;
    const hd = heading().v;
    if (tws != null && twa == null && get('wind.twd') != null && hd != null) twa = wrap(get('wind.twd') - hd);
    if (tws == null || twa == null) {
      const aws = get('wind.aws'), awa = get('wind.awa'), bs = get('stw') ?? get('sog');
      if (aws != null && awa != null && bs != null) {
        const x = aws * Math.cos(awa * RAD) - bs, y = aws * Math.sin(awa * RAD);
        tws = Math.hypot(x, y); twa = wrap(Math.atan2(y, x) / RAD); calc = true;
      } else { tws = twa = null; }
    }
    const twd = get('wind.twd') ?? (twa != null && hd != null ? wrap(hd + twa) : null);
    return { tws, twa, twd, calc };
  }
  const signed = (a) => (a == null ? null : a > 180 ? a - 360 : a);
  const fSide = (a) => { const v = signed(a); return v == null ? '—' : `${Math.abs(Math.round(v))}° ${v < -0.5 ? 'port' : v > 0.5 ? 'stbd' : ''}`.trim(); };
  const beaufort = (ms) => (ms == null ? '—' : 'F' + [0.3, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7].filter((x) => ms >= x).length);

  // ---- names
  // names: a custom name (Sources page) wins over the automatic one
  const customName = (k) => (settings.names && settings.names[k]) || null;
  const defEngName = (id, all) => (all.length === 1 ? 'Engine' : all.length === 2 && all.join() === '0,1' ? (id === '0' ? 'Port engine' : 'Starboard engine') : `Engine ${+id + 1}`);
  const engName = (id, all) => customName(`eng.${id}`) || defEngName(id, all);
  function defTankName(id, all) {
    const [type, inst] = id.split('-').map(Number), same = all.filter((x) => x.startsWith(type + '-'));
    const base = N2K.TANK_TYPES[type] || `Tank type ${type}`;
    return same.length > 1 ? `${base} ${same.length === 2 && same.join() === `${type}-0,${type}-1` ? (inst === 0 ? '(Port)' : '(Stbd)') : inst + 1}` : base;
  }
  const tankName = (id, all) => customName(`tank.${id}`) || defTankName(id, all);
  const defBatName = (id) => 'Battery ' + (+id + 1);
  const batName = (id) => customName(`bat.${id}`) || defBatName(id);
  const tankClass = (type) => (type === 0 || type === 6 ? 'fuel' : type === 1 || type === 3 ? 'water' : type === 4 ? 'oil' : 'waste');
  function tempName(id) { const [src, inst] = id.split('-').map(Number); return (N2K.TEMP_SOURCES[src] || `Source ${src}`) + (inst ? ` ${inst + 1}` : ''); }
  const batNominal = (v) => (v == null ? 1 : v > 36 ? 4 : v > 18 ? 2 : 1);

  // ---- alarms (configurable on the Alarms page; thresholds are stored in base units)
  const ALARMS = [
    { id: 'noData', name: 'No data from gateway', desc: 'Bridge or gateway link lost, or no NMEA 2000 data for 5 seconds', level: 'crit' },
    { id: 'shallow', name: 'Shallow water', desc: 'Depth (including the transducer offset) is below the threshold', kind: 'depth', value: 3, level: 'crit' },
    { id: 'gnss', name: 'GNSS fix lost', desc: 'The GNSS receiver reports no position fix', level: 'warn' },
    { id: 'batLow', name: 'Battery voltage low', desc: 'Per battery. Set for a 12 V system; scaled automatically for 24 V and 48 V banks', unit: 'V', step: 0.1, value: 11.8, level: 'crit' },
    { id: 'batHigh', name: 'Battery voltage high', desc: 'Per battery. Set for a 12 V system; scaled automatically for 24 V and 48 V banks', unit: 'V', step: 0.1, value: 15.2, level: 'warn' },
    { id: 'socLow', name: 'Battery state of charge low', desc: 'Per battery, where the battery monitor reports state of charge', unit: '%', value: 20, level: 'warn' },
    { id: 'engFlags', name: 'Engine warning flags', desc: 'Warnings raised by the engine itself (check engine, over temperature, low oil pressure…)', level: 'crit' },
    { id: 'coolant', name: 'Engine coolant temperature high', desc: 'Per engine', kind: 'temp', value: 105, level: 'crit' },
    { id: 'oilLow', name: 'Engine oil pressure low', desc: 'Per engine, only while it is running (above 300 rpm)', kind: 'pressure', value: 100, level: 'crit' },
    { id: 'overRev', name: 'Engine over-speed', desc: 'Per engine', unit: 'rpm', step: 50, value: 3800, level: 'warn', on: false },
    { id: 'fuelLow', name: 'Fuel tank low', desc: 'Per fuel tank', unit: '%', value: 15, level: 'warn' },
    { id: 'waterLow', name: 'Fresh water tank low', desc: 'Per fresh water tank', unit: '%', value: 15, level: 'warn' },
    { id: 'wasteHigh', name: 'Waste tank nearly full', desc: 'Per grey or black water tank', unit: '%', value: 85, level: 'warn' },
    { id: 'windHigh', name: 'High wind', desc: 'True wind speed is above the threshold', kind: 'speed', value: 30 * 0.514444, level: 'warn' },
    { id: 'xte', name: 'Cross-track error', desc: 'Distance off the track to the active waypoint', unit: 'm', step: 10, value: 100, level: 'warn', on: false },
  ];
  const ALARM_BY = Object.fromEntries(ALARMS.map((d) => [d.id, d]));
  const al = (id) => { const d = ALARM_BY[id], c = settings.alarms[id] || {}; return { on: c.on ?? d.on ?? true, value: c.value ?? d.value, level: c.level || d.level }; };
  const alDisp = (d, v) => (d.kind === 'temp' ? cTemp(v) : d.kind ? conv(d.kind, v) : v);
  const alBase = (d, v) => (d.kind === 'temp' ? (settings.temp === 'f' ? (v - 32) * 5 / 9 : v) : d.kind ? v / UNITS[d.kind][settings[d.kind]][0] : v);
  const alUnit = (d) => (d.kind ? unit(d.kind) : d.unit || '');
  let alertCache = [], alertAt = 0;
  /** active alarms as [level, text, alarmId] */
  function alerts() {
    if (Date.now() - alertAt < 400) return alertCache;
    const keepAge = ageing;
    try { return computeAlerts(); } finally { ageing = keepAge; }
  }
  function computeAlerts() {
    const a = [], add = (id, txt) => a.push([al(id).level, txt, id]), on = (id) => al(id).on, thr = (id) => al(id).value;
    if (on('noData')) {
      if (!direct && !bridgeUp) add('noData', standalone ? 'Not connected - choose a gateway in Settings' : 'Dashboard bridge is not reachable - is it still running?');
      else if (conn.state === 'error') add('noData', `Gateway connection problem: ${conn.detail}`);
      else if (conn.state !== 'simulating' && Date.now() - lastRx > 5000) add('noData', 'No NMEA 2000 data is being received');
    }
    const dp = get('depth');
    if (on('shallow') && dp != null && dp + (get('depth.offset') || 0) < thr('shallow')) add('shallow', `Shallow water: ${fu(conv('depth', dp + (get('depth.offset') || 0)), 1, unit('depth'))}`);
    if (on('gnss') && get('gnss.method') === 'No fix') add('gnss', 'GNSS has no position fix');
    for (const id of ids('bat')) {
      const v = get(`bat.${id}.v`), soc = get(`bat.${id}.soc`), n = batNominal(v);
      if (v != null && on('batLow') && v < thr('batLow') * n) add('batLow', `${batName(id)} voltage low: ${v.toFixed(1)} V`);
      if (v != null && on('batHigh') && v > thr('batHigh') * n) add('batHigh', `${batName(id)} voltage high: ${v.toFixed(1)} V`);
      if (soc != null && on('socLow') && soc < thr('socLow')) add('socLow', `${batName(id)} charge low: ${soc}%`);
    }
    const engs = ids('eng');
    for (const id of engs) {
      const s1 = get(`eng.${id}.status1`) || 0, s2 = get(`eng.${id}.status2`) || 0, name = engName(id, engs);
      if (on('engFlags')) [...N2K.ENGINE_STATUS1.filter((x, i) => s1 & (1 << i)), ...N2K.ENGINE_STATUS2.filter((x, i) => s2 & (1 << i))].forEach((txt) => add('engFlags', `${name}: ${txt}`));
      const ct = get(`eng.${id}.coolT`), op = get(`eng.${id}.oilP`), rpm = get(`eng.${id}.rpm`);
      if (on('coolant') && ct != null && ct > thr('coolant')) add('coolant', `${name}: coolant ${fTemp(ct, 0)}`);
      if (on('oilLow') && op != null && rpm != null && rpm > 300 && op < thr('oilLow')) add('oilLow', `${name}: oil pressure ${fPres(op)}`);
      if (on('overRev') && rpm != null && rpm > thr('overRev')) add('overRev', `${name}: ${rpm.toFixed(0)} rpm`);
    }
    const tanks = ids('tank');
    for (const id of tanks) {
      const type = +id.split('-')[0], lvl = get(`tank.${id}.level`); if (lvl == null) continue;
      const name = tankName(id, tanks);
      if ([0, 6].includes(type) && on('fuelLow') && lvl < thr('fuelLow')) add('fuelLow', `${name} low: ${lvl.toFixed(0)}%`);
      if (type === 1 && on('waterLow') && lvl < thr('waterLow')) add('waterLow', `${name} low: ${lvl.toFixed(0)}%`);
      if ([2, 5].includes(type) && on('wasteHigh') && lvl > thr('wasteHigh')) add('wasteHigh', `${name} nearly full: ${lvl.toFixed(0)}%`);
    }
    const tws = trueWind().tws, xte = get('nav.xte');
    if (on('windHigh') && tws != null && tws > thr('windHigh')) add('windHigh', `High wind: ${fu(conv('speed', tws), 0, unit('speed'))}`);
    if (on('xte') && xte != null && Math.abs(xte) > thr('xte')) add('xte', `Cross-track error: ${Math.abs(xte).toFixed(0)} m to ${xte < 0 ? 'port' : 'starboard'}`);
    a.sort((x, y) => (y[0] === 'crit') - (x[0] === 'crit'));
    alertCache = a; alertAt = Date.now();
    return a;
  }
  // optional audible alert when a new critical alarm appears
  // acknowledgement: an alarm stays acknowledged until it clears; if it comes back it alerts again
  let acked = new Set(), announced = new Set(), lastBeep = 0;
  const alKey = (x) => x[2] + '|' + x[1].split(':')[0];
  const LEVEL = { crit: 'Critical', warn: 'Warning' };
  let audio = null;
  function beep() {
    if (!audio) return;
    [0, 0.25].forEach((dt) => { const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 880; g.gain.value = 0.15; o.connect(g).connect(audio.destination); o.start(audio.currentTime + dt); o.stop(audio.currentTime + dt + 0.15); });
  }
  if (settings.sound) document.addEventListener('pointerdown', () => { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no audio */ } }, { once: true });
  const srcLabel = (sa) => { const name = get(`dev.${sa}.model`) || N2K.MANUFACTURERS[get(`dev.${sa}.mfr`)]; return `${sa.toString(16).toUpperCase().padStart(2, '0')} (${sa})${name ? ' · ' + name : ''}`; };

  // ================================================================ widgets
  function arc(cx, cy, r, a0, a1) { // degrees clockwise from 12 o'clock
    const p = (a) => [cx + r * Math.sin(a * RAD), cy - r * Math.cos(a * RAD)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  const polar = (cx, cy, r, a) => [cx + r * Math.sin(a * RAD), cy - r * Math.cos(a * RAD)];

  /** 270-degree arc gauge. Values/zones are in base units; `show` converts for display. */
  function gauge(o) {
    const A0 = -135, SW = 270, val = s('path', 'g-val'), num = s('text', { class: 'g-num', x: 60, y: 66 }), un = s('text', { class: 'g-unit', x: 60, y: 80 });
    const lo = s('text', { class: 'g-lim', x: 22, y: 110 }), hi = s('text', { class: 'g-lim', x: 98, y: 110 }), zones = s('g');
    const el = s('svg', { class: 'gauge', viewBox: '0 0 120 116', role: 'img', 'aria-label': o.label },
      s('path', { class: 'g-track', d: arc(60, 60, 46, A0, A0 + SW) }), zones, val, num, un, lo, hi,
      s('text', { class: 'g-label', x: 60, y: 110, text: o.label.toUpperCase() }));
    const show = o.show || ((v) => v);
    let zsig = '';
    reg(() => {
      const min = typeof o.min === 'function' ? o.min() : o.min, max = typeof o.max === 'function' ? o.max() : o.max;
      ageing = false;
      const v = o.get(); el.classList.toggle('ageing', ageing);
      const zs = (typeof o.zones === 'function' ? o.zones() : o.zones) || [];
      const frac = (x) => clamp((x - min) / (max - min), 0, 1);
      const uTxt = typeof o.unit === 'function' ? o.unit() : o.unit, sig = `${min},${max},${zs},${uTxt}`;
      if (sig !== zsig) {
        zsig = sig;
        zones.replaceChildren(...zs.map(([a, b, lvl]) => s('path', { class: `g-zone s-${lvl}`, d: arc(60, 60, 54, A0 + SW * frac(a), A0 + SW * Math.max(frac(b), frac(a) + 0.002)) })));
        lo.textContent = f(show(min), 0); hi.textContent = f(show(max), 0);
      }
      const zone = v == null ? null : zs.find(([a, b]) => v >= a && v <= b);
      val.setAttribute('class', 'g-val' + (zone ? ` s-${zone[2]}` : ''));
      val.setAttribute('d', v == null ? '' : arc(60, 60, 46, A0, A0 + Math.max(SW * frac(v), 0.5)));
      num.textContent = f(show(v), typeof o.digits === 'function' ? o.digits() : o.digits || 0);
      un.textContent = uTxt;
      const say = `${o.label}: ${num.textContent} ${uTxt}`; if (el.getAttribute('aria-label') !== say) el.setAttribute('aria-label', say);
    });
    return el;
  }

  function compass() {
    const rose = s('g', 'rot'), cog = s('g', 'rot'), wpt = s('g', 'rot'), labels = [];
    for (let a = 0; a < 360; a += 5) {
      const major = a % 30 === 0, [x1, y1] = polar(100, 100, 88, a), [x2, y2] = polar(100, 100, major ? 78 : a % 10 === 0 ? 81 : 84, a);
      rose.append(s('line', { class: 'tick' + (major ? ' major' : ''), x1, y1, x2, y2 }));
      if (major) {
        const card = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[a];
        const txt = s('text', { class: 'lbl up' + (a === 0 ? ' card-n' : card ? ' cardinal' : ''), x: 100, y: 34, text: card || a / 10 });
        labels.push([a, txt]);
        rose.append(s('g', { transform: `rotate(${a} 100 100)` }, txt));
      }
    }
    cog.append(s('path', { class: 'cog', d: 'M100 3 L107 15 L93 15 Z' }));
    wpt.append(s('circle', { class: 'wpt', cx: 100, cy: 9, r: 4.5 }));
    const num = s('text', { class: 'd-num', x: 100, y: 108 }), sub = s('text', { class: 'd-sub', x: 100, y: 124 });
    const el = s('svg', { class: 'dial', viewBox: '0 0 200 200', role: 'img', 'aria-label': 'Compass' },
      s('circle', { class: 'ring', cx: 100, cy: 100, r: 90 }), rose, wpt, cog,
      s('circle', { class: 'hub', cx: 100, cy: 100, r: 44 }), s('path', { class: 'lubber', d: 'M100 22 L105 10 L95 10 Z' }), num, sub);
    const spin = (g) => { let acc = 0; return (a, vis) => { g.style.display = vis ? '' : 'none'; if (vis) { acc += ((a - acc) % 360 + 540) % 360 - 180; g.style.transform = `rotate(${acc.toFixed(1)}deg)`; } return acc; }; };
    const sRose = spin(rose), sCog = spin(cog), sWpt = spin(wpt);
    reg(() => {
      ageing = false;
      const hd = heading(), c = get('cog'), b = get('nav.btw'), ref = hd.v ?? c;   // fall back to COG-up if no heading sensor
      el.classList.toggle('ageing', ageing);
      const acc = sRose(-(ref ?? 0), true); sCog((c ?? 0) - (ref ?? 0), c != null && ref != null); sWpt((b ?? 0) - (ref ?? 0), b != null && ref != null);
      for (const [a, txt] of labels) txt.style.transform = `rotate(${(-(acc + a)).toFixed(1)}deg)`;   // counter-rotate so the numerals stay upright
      num.textContent = fdeg(ref); sub.textContent = hd.v != null ? `HDG °${hd.ref}` : c != null ? 'COG °T' : 'HEADING';
      const say = ref == null ? 'Compass: no heading' : `${hd.v != null ? 'Heading' : 'Course over ground'} ${Math.round(wrap(ref))} degrees ${hd.v != null && hd.ref === 'M' ? 'magnetic' : 'true'}`;
      if (el.getAttribute('aria-label') !== say) el.setAttribute('aria-label', say);
    });
    return el;
  }

  function windDial() {
    const aw = s('g', 'rot'), tw = s('g', 'rot'), g = s('g');
    for (let a = 0; a < 360; a += 10) {
      const major = a % 30 === 0, [x1, y1] = polar(100, 100, 88, a), [x2, y2] = polar(100, 100, major ? 79 : 83, a);
      g.append(s('line', { class: 'tick' + (major ? ' major' : ''), x1, y1, x2, y2 }));
      if (major && a !== 0) { const [x, y] = polar(100, 100, 70, a); g.append(s('text', { class: 'lbl', x, y: y + 3.5, text: a > 180 ? 360 - a : a })); }
    }
    aw.append(s('path', { class: 'aw', d: 'M100 9 L110 -8 L90 -8 Z' }));
    tw.append(s('path', { class: 'tw', d: 'M100 9 L107 -5 L93 -5 Z' }));
    const num = s('text', { class: 'd-num', x: 100, y: 108 }), sub = s('text', { class: 'd-sub', x: 100, y: 124 });
    const [px, py] = polar(100, 100, 55, -40), [sx, sy] = polar(100, 100, 55, 40);
    const el = s('svg', { class: 'dial', viewBox: '-10 -10 220 220', role: 'img', 'aria-label': 'Wind' },
      s('circle', { class: 'ring', cx: 100, cy: 100, r: 90 }),
      s('path', { class: 'sector-p', d: arc(100, 100, 91, -60, -20) }), s('path', { class: 'sector-s', d: arc(100, 100, 91, 20, 60) }), g,
      s('text', { class: 'side side-p', x: px, y: py + 4, text: 'P' }), s('text', { class: 'side side-s', x: sx, y: sy + 4, text: 'S' }),
      s('path', { class: 'hull', d: 'M100 36 C124 68 126 122 116 164 L84 164 C74 122 76 68 100 36Z' }),
      s('circle', { class: 'hub', cx: 100, cy: 104, r: 38 }), tw, aw, num, sub);
    const spin = (grp) => { let acc = 0; return (a) => { grp.style.display = a == null ? 'none' : ''; if (a != null) { acc += ((a - acc) % 360 + 540) % 360 - 180; grp.style.transform = `rotate(${acc.toFixed(1)}deg)`; } }; };
    const sA = spin(aw), sT = spin(tw);
    reg(() => {
      ageing = false; const awa = get('wind.awa'), aws = get('wind.aws'); el.classList.toggle('ageing', ageing);
      sA(awa); sT(trueWind().twa); num.textContent = fSpd(aws); sub.textContent = `AWS ${unit('speed').toUpperCase()}`;
      const say = awa == null ? 'Wind: no data' : `Apparent wind ${fSpd(aws)} ${unit('speed')}, ${fSide(awa)}`;
      if (el.getAttribute('aria-label') !== say) el.setAttribute('aria-label', say);
    });
    return h('div', null, el, h('div', 'legend', h('span', null, h('i', 'a'), 'Apparent'), h('span', null, h('i', 't'), 'True')));
  }

  /** history chart for a store key. "Live" = the last 30 min held in this page; 24 h / 7 d / 30 d come from the bridge's stored history.
   *  o.thr() may return alarm thresholds [{ v, lvl, label }] to draw as dashed lines (o.fit forces them into view). */
  const RANGES = [['live', 'Live'], ['24h', '24 h'], ['7d', '7 d'], ['30d', '30 d']];
  const fmtAxisTime = (t, spanMs) => (spanMs > 36 * 3600000 ? new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' }) : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
  function rangeChips(onPick) {
    const el = h('div', 'ranges');
    const pick = (r) => { for (const b of el.children) b.setAttribute('aria-pressed', b.dataset.r === r); onPick(r); };
    RANGES.forEach(([r, label]) => el.append(h('button', { type: 'button', 'data-r': r, text: label, onclick: () => pick(r) })));
    el.firstChild.setAttribute('aria-pressed', 'true');
    if (standalone) el.hidden = true;     // stored history needs the bridge
    return el;
  }
  function spark(key, show = (v) => v, digits = 1, o = {}) {
    const line = s('path', 'line'), area = s('path', 'area'), thrG = s('g'), hi = h('span', 'hi'), lo = h('span', 'lo'), msg = h('span', 'span'), thrL = h('div', 'thr-labels');
    const t0l = h('span', 'axis-t'), t1l = h('span', 'axis-t');
    let range = 'live', hist = null, fetchedAt = 0, sig = '';
    const chips = rangeChips((r) => { range = r; hist = null; fetchedAt = 0; sig = ''; });
    const el = h('div', 'spark', h('div', 'spark-plot', s('svg', { viewBox: '0 0 300 80', preserveAspectRatio: 'none' }, area, thrG, line), thrL, hi, lo, msg), h('div', 'spark-axis', t0l, chips, t1l));
    reg(() => {
      if (range !== 'live' && (Date.now() - fetchedAt > 60000 || fetchedAt < wipedAt)) {
        fetchedAt = Date.now(); const r = range;
        fetch(`/api/history?key=${encodeURIComponent(key)}&range=${r}`).then((x) => x.json()).then((j) => { if (range === r) { hist = (j.points || []).map(([t, v]) => ({ t, v })); sig = ''; } }).catch(() => { if (range === r) { hist = []; sig = ''; } });
      }
      const a = range === 'live' ? (H[key] || []) : hist, ths = (o.thr ? o.thr() : []).filter((x) => x && x.v != null);
      const sg = `${range}|${a ? a.length : -1}|${a && a.length ? a[a.length - 1].t : 0}|${ths.map((x) => x.v).join()}`;
      if (sg === sig) return; sig = sg;
      const blank = (text) => { line.setAttribute('d', ''); area.setAttribute('d', ''); thrG.replaceChildren(); thrL.replaceChildren(); hi.textContent = lo.textContent = t0l.textContent = t1l.textContent = ''; msg.textContent = text; };
      if (!a) return blank('Loading…');
      if (a.length < 2) return blank(range === 'live' ? 'Collecting history…' : 'No stored history for this period yet');
      msg.textContent = '';
      let mn = Infinity, mx = -Infinity;
      for (const p of a) { if (p.v < mn) mn = p.v; if (p.v > mx) mx = p.v; }
      const dMin = mn, dMax = mx, reach = Math.max(mx - mn, (o.minSpan || 0.05) * 4);
      for (const x of ths) if (o.fit || (x.v > mn - reach && x.v < mx + reach)) { mn = Math.min(mn, x.v); mx = Math.max(mx, x.v); }
      const pad = Math.max((mx - mn) * 0.12, o.minSpan || 0.05); mn -= pad; mx += pad;
      if (o.zero) mn = Math.min(0, mn + pad);
      const t0 = a[0].t, t1 = a[a.length - 1].t, dt = Math.max(t1 - t0, 1);
      const y = (v) => (o.invert ? (v - mn) / (mx - mn) : 1 - (v - mn) / (mx - mn)) * 80;
      const pts = a.map((p) => `${(((p.t - t0) / dt) * 300).toFixed(1)} ${y(p.v).toFixed(1)}`);
      line.setAttribute('d', 'M' + pts.join('L'));
      area.setAttribute('d', `M0 ${o.invert ? 0 : 80}L${pts.join('L')}L300 ${o.invert ? 0 : 80}Z`);
      const shown = ths.filter((x) => x.v >= mn && x.v <= mx);
      thrG.replaceChildren(...shown.map((x) => s('path', { class: `thr-line s-${x.lvl}`, d: `M0 ${y(x.v).toFixed(1)}H300` })));
      thrL.replaceChildren(...shown.map((x) => h('span', { class: `thr-label ${x.lvl}`, style: `top:${(y(x.v) / 80 * 100).toFixed(1)}%`, text: `${x.label} ${f(show(x.v), digits)}` })));
      hi.textContent = f(show(o.invert ? dMin : dMax), digits); lo.textContent = f(show(o.invert ? dMax : o.zero ? Math.min(0, dMin) : dMin), digits);
      t0l.textContent = fmtAxisTime(t0, dt); t1l.textContent = range === 'live' ? 'now' : fmtAxisTime(t1, dt);
    });
    return el;
  }
  // alarm thresholds as chart lines
  const thrDepth = () => (al('shallow').on ? [{ v: al('shallow').value, lvl: 'crit', label: 'Shallow' }] : []);
  const thrWind = () => (al('windHigh').on ? [{ v: al('windHigh').value, lvl: 'warn', label: 'High wind' }] : []);
  const thrBat = (id) => () => { const n = batNominal(get(`bat.${id}.v`)); return [al('batLow').on ? { v: al('batLow').value * n, lvl: 'crit', label: 'Low' } : null, al('batHigh').on ? { v: al('batHigh').value * n, lvl: 'warn', label: 'High' } : null]; };

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

  function rudderBar() {
    const mark = h('i'), el = h('div', null, h('div', 'bar-ind', mark), h('div', 'bar-scale', h('span', { text: '35° P' }), h('span', { text: '0' }), h('span', { text: '35° S' })));
    reg(() => { const r = get(`rudder.${ids('rudder')[0] ?? 0}`); mark.style.display = r == null ? 'none' : ''; if (r != null) mark.style.left = `${50 + clamp(r, -35, 35) / 35 * 50}%`; });
    return el;
  }
  function rollInd() {
    const boat = s('g', 'boat', s('path', { d: 'M62 70 L138 70 C134 92 118 100 100 100 C82 100 66 92 62 70Z' }), s('line', { class: 'mast', x1: 100, y1: 70, x2: 100, y2: 22 }));
    const sc = s('g');
    for (let a = -30; a <= 30; a += 10) { const [x1, y1] = polar(100, 70, 58, a), [x2, y2] = polar(100, 70, a === 0 ? 50 : 53, a); sc.append(s('line', { class: 'scale', x1, y1, x2, y2 })); }
    reg(() => { const r = get('roll'); boat.style.transform = `rotate(${clamp(r ?? 0, -45, 45).toFixed(1)}deg)`; });
    return s('svg', { class: 'roll', viewBox: '20 6 160 104', role: 'img', 'aria-label': 'Roll' }, sc, s('line', { class: 'hz', x1: 30, y1: 84, x2: 170, y2: 84 }), boat);
  }

  function tankRow(id, i, all) {
    const type = +id.split('-')[0], bar = h('i', tankClass(type));
    reg(() => {
      const l = get(`tank.${id}.level`); bar.style.width = `${clamp(l ?? 0, 0, 100)}%`;
      const low = [0, 1, 6].includes(type) ? l != null && l < 15 : [2, 5].includes(type) ? l != null && l > 85 : false;
      bar.className = low ? 'crit' : tankClass(type);
    });
    return h('div', 'tank', h('span', { class: 'name', text: tankName(id, all) }), h('div', 'meter', bar), t('pct', () => fu(get(`tank.${id}.level`), 0, '%').replace(' ', '')),
      t('vol', () => { const l = get(`tank.${id}.level`), c = get(`tank.${id}.capacity`); return l == null || c == null ? '' : `${f(conv('volume', c * l / 100), 0)} of ${f(conv('volume', c), 0)} ${unit('volume')}`; }));
  }
  const tankList = () => dyn(h('div', 'stack'), () => ids('tank'), tankRow, 'No tank level data (PGN 127505) received.');

  /** a gauge warning zone taken from an alarm on the Alarms page: from its threshold to the end of the scale, in the alarm's
   *  severity colour. Returns null when the alarm is switched off, so the gauge then shows no zone. */
  const alarmZone = (alarm, end, side, mul = 1) => { const a = al(alarm); if (!a.on) return null; const v = a.value * mul; return side === 'below' ? [Math.min(end, v), v, a.level] : [v, Math.max(end, v), a.level]; };
  const batGauge = (id) => gauge({ label: 'Voltage', unit: 'V', digits: 2, get: () => get(`bat.${id}.v`),
    min: () => 10 * batNominal(get(`bat.${id}.v`)), max: () => 16 * batNominal(get(`bat.${id}.v`)),
    zones: () => { const n = batNominal(get(`bat.${id}.v`)); return [alarmZone('batLow', 10 * n, 'below', n), alarmZone('batHigh', 16 * n, 'above', n)].filter(Boolean); } });
  const rpmGauge = (id) => gauge({ label: 'RPM', unit: 'rpm', min: 0, max: () => ((get(`eng.${id}.rpm`) || 0) > 3900 ? 8000 : 4000), get: () => get(`eng.${id}.rpm`),
    zones: () => [alarmZone('overRev', (get(`eng.${id}.rpm`) || 0) > 3900 ? 8000 : 4000, 'above')].filter(Boolean) });

  function alertList() {
    const el = h('div', 'alerts'); let sig = null;
    reg(() => {
      const a = alerts(), sg = JSON.stringify(a) + [...acked].join();
      if (sg === sig) return; sig = sg;
      el.replaceChildren(...(a.length ? a.map((x) => h('div', `alert ${x[0]}`, h('span', null, h('strong', { text: LEVEL[x[0]] + ' · ' }), x[1], acked.has(alKey(x)) ? h('span', { class: 'ack', text: ' (acknowledged)' }) : null)))
        : [h('div', { class: 'alert', text: 'All monitored systems normal' })]));
    });
    return el;
  }

  const coolGauge = (id) => gauge({ label: 'Coolant', unit: () => unit('temp'), get: () => get(`eng.${id}.coolT`), show: cTemp, min: 40, max: 120, zones: () => [alarmZone('coolant', 120, 'above')].filter(Boolean) });
  const oilGauge = (id) => gauge({ label: 'Oil press', unit: () => unit('pressure'), digits: () => (settings.pressure === 'kpa' ? 0 : 1), get: () => get(`eng.${id}.oilP`), show: (v) => conv('pressure', v), min: 0, max: 700, zones: () => [alarmZone('oilLow', 0, 'below')].filter(Boolean) });
  const sogGauge = () => gauge({ label: 'SOG', unit: () => unit('speed'), digits: 1, get: () => get('sog'), show: (v) => conv('speed', v), min: 0,
    max: () => { const d = conv('speed', maxSog) * 1.15; return [10, 20, 40, 80, 160].find((x) => x >= d) / UNITS.speed[settings.speed][0]; } });
  const depthShown = () => { const d = get('depth'); return d == null ? null : settings.depthRef === 'transducer' ? d : d + (get('depth.offset') || 0); };   // below keel / waterline (using the sender's offset) or below the transducer
  const rudder = () => get(`rudder.${ids('rudder')[0] ?? 0}`);

  /** how to chart a stored key: label, display conversion, unit, chart options (incl. the matching alarm threshold) */
  function histSpec(key) {
    const [p, id, fld] = key.split('.');
    const thr = (alarm, lvl, label, mul = 1) => () => (al(alarm).on ? [{ v: al(alarm).value * mul, lvl: al(alarm).level, label }] : []);
    if (p === 'eng' && fld === 'rpm') return { label: 'RPM', show: (v) => v, digits: 0, unit: () => 'rpm', o: { zero: true, minSpan: 50, thr: thr('overRev', 'warn', 'Over-speed') } };
    if (p === 'eng' && fld === 'coolT') return { label: 'Coolant', show: cTemp, digits: 0, unit: () => unit('temp'), o: { minSpan: 1, thr: thr('coolant', 'crit', 'High') } };
    if (p === 'tank') { const ty = +id.split('-')[0], low = [0, 1, 6].includes(ty); return { label: 'Level', show: (v) => v, digits: 0, unit: () => '%', o: { zero: true, minSpan: 1, thr: low ? thr(ty === 1 ? 'waterLow' : 'fuelLow', 'warn', 'Low') : [2, 5].includes(ty) ? thr('wasteHigh', 'warn', 'Full') : null } }; }
    if (p === 'bat') return { label: 'Voltage', show: (v) => v, digits: 2, unit: () => 'V', o: { minSpan: 0.05, fit: true, thr: thrBat(id) } };
    return { label: key, show: (v) => v, digits: 1, unit: () => '', o: {} };
  }
  const histTitle = (key) => { const [p, id] = key.split('.'), sp = histSpec(key); return `${p === 'eng' ? engName(id, ids('eng')) : p === 'tank' ? tankName(id, ids('tank')) : p === 'bat' ? batName(id) : ''} · ${sp.label.toLowerCase()} history`; };
  /** a labelled history chart for a stored key */
  function chartBox(key, labelled = true) {
    const sp = histSpec(key);
    return h('div', 'chart-box', labelled ? h('div', 'label', sp.label, ' ', t(null, () => fu(sp.show(get(key)), sp.digits, sp.unit()))) : null, spark(key, sp.show, sp.digits, sp.o));
  }
  /** custom names for engines, batteries and tanks (shared setting) */
  function namesCard() {
    const body = h('div', 'names'); let sig = null;
    reg(() => {
      const engs = ids('eng'), tanks = ids('tank');
      const items = [...engs.map((id) => [`eng.${id}`, defEngName(id, engs), `Engine, instance ${id}`]), ...ids('bat').map((id) => [`bat.${id}`, defBatName(id), `Battery, instance ${id}`]),
        ...tanks.map((id) => [`tank.${id}`, defTankName(id, tanks), `${N2K.TANK_TYPES[+id.split('-')[0]] || 'Tank'} tank, instance ${id.split('-')[1]}`])];
      const sg = items.map((x) => x[0] + x[1]).join('|');
      if (sg === sig || body.contains(document.activeElement)) return; sig = sg;
      body.replaceChildren(...(items.length ? items.map(([key, def, what]) => {
        const inp = h('input', { type: 'text', maxlength: 24, placeholder: def, value: settings.names[key] || '', 'aria-label': `Name for ${what}` });
        inp.addEventListener('change', () => { const v = inp.value.trim(); if (v) settings.names[key] = v; else delete settings.names[key]; saveSettings(); inp.blur(); buildPages(); });
        return h('label', 'name-row', h('span', null, h('strong', { text: def }), h('div', { class: 'desc', text: what })), inp);
      }) : [h('div', { class: 'empty', text: 'Engines, batteries and tanks are listed here once their data is being received.' })]));
    });
    return card('Names', 'c12', h('p', { class: 'hint', text: 'Give engines, batteries and tanks your own names, for example "House bank" or "Main fuel". Leave a box empty to use the automatic name. Names are shared with every device.' }), body);
  }
  let showAllSources = false, bannerDismissed = false;

  // ================================================================ customisable dashboard ("My Dashboard")
  // Single-value panels: id -> [title, value text, unit text]
  const METRICS = {
    sog: ['Speed over ground', () => fSpd(get('sog')), () => unit('speed')],
    stw: ['Speed through water', () => fSpd(get('stw')), () => unit('speed')],
    vmg: ['VMG to waypoint', () => fSpd(get('nav.vmg')), () => unit('speed')],
    hdg: ['Heading', () => fdeg(heading().v), () => heading().ref],
    cog: ['Course over ground', () => fdeg(get('cog')), () => 'T'],
    rot: ['Rate of turn', () => f(get('rot'), 0), () => '°/min'],
    depth: ['Depth', () => f(conv('depth', depthShown()), 1), () => unit('depth')],
    aws: ['Apparent wind speed', () => fSpd(get('wind.aws')), () => unit('speed')],
    awa: ['Apparent wind angle', () => fSide(get('wind.awa')), () => ''],
    tws: ['True wind speed', () => fSpd(trueWind().tws), () => unit('speed')],
    twa: ['True wind angle', () => fSide(trueWind().twa), () => ''],
    twd: ['True wind direction', () => fdeg(trueWind().twd), () => 'T'],
    dtw: ['Distance to waypoint', () => { const d = get('nav.dtw'); return d == null ? '—' : (d / 1852).toFixed(2); }, () => 'nm'],
    btw: ['Bearing to waypoint', () => fdeg(get('nav.btw')), () => (get('nav.btw.mag') ? 'M' : 'T')],
    xte: ['Cross-track error', () => { const x = get('nav.xte'); return x == null ? '—' : Math.abs(x).toFixed(0); }, () => { const x = get('nav.xte'); return x == null ? 'm' : x < 0 ? 'm port' : 'm stbd'; }],
    eta: ['ETA at waypoint', () => fTime(get('nav.eta')), () => 'UTC'],
    utc: ['Time', () => fTime(get('time.utc')), () => 'UTC'],
    log: ['Log', () => { const d = get('log.total'); return d == null ? '—' : (d / 1852).toFixed(1); }, () => 'nm'],
    trip: ['Trip', () => { const d = get('log.trip'); return d == null ? '—' : (d / 1852).toFixed(2); }, () => 'nm'],
    rudder: ['Rudder angle', () => fSide(rudder()), () => ''],
    roll: ['Roll', () => fSide(get('roll')), () => ''],
    pitch: ['Pitch', () => f(get('pitch'), 1), () => '°'],
    airT: ['Air temperature', () => f(cTemp(get('temp.1-0')), 1), () => unit('temp')],
    seaT: ['Sea temperature', () => f(cTemp(get('temp.0-0')), 1), () => unit('temp')],
    baro: ['Barometer', () => f(get('pressure'), 1), () => 'hPa'],
    hum: ['Humidity', () => f(get('humidity.1') ?? get('humidity.0'), 0), () => '%'],
  };
  const HISTORY = { depth: ['Depth history', 'depth', (v) => conv('depth', v), () => unit('depth'), { invert: true, minSpan: 0.5, thr: thrDepth }, () => get('depth')],
    sog: ['Speed history', 'sog', (v) => conv('speed', v), () => unit('speed'), { zero: true, minSpan: 0.2 }, () => get('sog')],
    tws: ['True wind history', 'tws', (v) => conv('speed', v), () => unit('speed'), { zero: true, minSpan: 0.5, thr: thrWind }, () => trueWind().tws],
    baro: ['Barometer history', 'pressure', (v) => v, () => 'hPa', { minSpan: 0.3 }, () => get('pressure')] };
  const fill = (el) => { el.classList.add('fill'); return el; };
  // Panel types: name(arg), default size in grid cells (12 columns wide, ~84 px rows), build(arg). list:true = scrolling list content.
  const PANELS = {
    compass: { name: () => 'Compass', w: 3, h: 4, build: () => compass() },
    wind: { name: () => 'Wind', w: 3, h: 4, build: () => fill(windDial()) },
    sog: { name: () => 'Speed gauge', w: 3, h: 3, build: () => sogGauge() },
    map: { name: () => 'Chart', w: 6, h: 4, build: () => chartView() },
    position: { name: () => 'Position', w: 4, h: 2, build: () => h('div', 'ppos', t(null, () => fLatLon(lat(), 'N', 'S'), 'div'), t(null, () => fLatLon(lon(), 'E', 'W'), 'div')) },
    waypoint: { name: () => 'Waypoint', w: 4, h: 3, list: true, build: () => kv([['Distance', () => fNm(get('nav.dtw'))], ['Bearing', () => fdeg(get('nav.btw'))], ['VMG', () => fu(conv('speed', get('nav.vmg')), 1, unit('speed'))],
      ['Cross-track', () => { const x = get('nav.xte'); return x == null ? '—' : `${Math.abs(x).toFixed(0)} m ${x < 0 ? 'port' : 'stbd'}`; }], ['ETA (UTC)', () => fTime(get('nav.eta'))]], 'wide') },
    gnss: { name: () => 'GNSS status', w: 4, h: 3, list: true, build: () => kv([['Fix', () => get('gnss.method') || '—'], ['Satellites', () => f(get('gnss.sats'))], ['HDOP', () => f(get('gnss.hdop'), 2)], ['PDOP', () => f(get('gnss.pdop'), 2)],
      ['Altitude', () => fu(get('gnss.alt'), 1, 'm')], ['UTC time', () => fTime(get('time.utc'))]], 'wide') },
    attitude: { name: () => 'Attitude & rudder', w: 3, h: 4, list: true, build: () => [rollInd(), kv([['Roll', () => fSide(get('roll'))], ['Pitch', () => fu(get('pitch'), 1, '°')], ['Rudder', () => fSide(rudder())]]), rudderBar()] },
    alarms: { name: () => 'Alarms', w: 4, h: 3, list: true, build: () => alertList() },
    ais: { name: () => 'AIS targets', w: 8, h: 4, list: true, build: () => aisTable() },
    engines: { name: () => 'Engines', w: 5, h: 4, list: true, build: () => dyn(h('div', 'stack'), () => ids('eng'), (id, i, all) => h('div', 'eng-mini', rpmGauge(id),
      h('div', 'stack', h('strong', { text: engName(id, all) }), kv([['Coolant', () => fTemp(get(`eng.${id}.coolT`), 0)], ['Oil pressure', () => fPres(get(`eng.${id}.oilP`))],
        ['Fuel rate', () => fu(conv('volume', get(`eng.${id}.fuelRate`)), 1, `${unit('volume')}/h`)], ['Hours', () => fu(get(`eng.${id}.hours`), 1, 'h')]]))), 'No engine data received.') },
    batteries: { name: () => 'Batteries', w: 4, h: 3, list: true, build: () => dyn(h('div'), () => ids('bat'), (id) => h('div', 'rowline', h('span', { class: 'name', text: batName(id) }),
      h('span', 'val', t(null, () => fu(get(`bat.${id}.v`), 2, 'V')), t(null, () => { const a = get(`bat.${id}.a`), soc = get(`bat.${id}.soc`); return [a == null ? null : `${a > 0 ? '+' : ''}${a.toFixed(1)} A`, soc == null ? null : `${soc}%`].filter(Boolean).join(' · '); }, 'small'))), 'No battery data received.') },
    tanks: { name: () => 'Tanks', w: 4, h: 4, list: true, build: () => tankList() },
    temps: { name: () => 'Temperatures', w: 4, h: 3, list: true, build: () => dyn(h('div'), () => ids('temp'), (id) => h('div', 'rowline', h('span', { class: 'name', text: tempName(id) }), h('span', 'val', t(null, () => fTemp(get(`temp.${id}`))))), 'No temperature data received.') },
    value: { name: (a) => (METRICS[a] || ['Value'])[0], w: 3, h: 2, build: (a) => {
      const m = METRICS[a]; if (!m) return h('div', { class: 'empty', text: 'Unknown value' });
      const el = h('div', 'pv', t('pv-num', m[1]), t('pv-unit', m[2])); let len = 0;
      reg(() => { const l = Math.max(4, m[1]().length + m[2]().length * 0.4); if (l !== len) { len = l; el.style.setProperty('--len', l.toFixed(1)); } });   // long values shrink to fit the panel
      return el;
    } },
    history: { name: (a) => (HISTORY[a] || ['History'])[0], w: 4, h: 3, build: (a) => { const d = HISTORY[a]; return d ? [big(() => f(d[2](d[5]()), 1), d[3], 'md'), spark(d[1], d[2], 1, d[4])] : h('div', { class: 'empty', text: 'Unknown history' }); } },
    khist: { name: (a) => histTitle(a), w: 4, h: 3, build: (a) => { const sp = histSpec(a); return [big(() => f(sp.show(get(a)), sp.digits), sp.unit, 'md'), spark(a, sp.show, sp.digits, sp.o)]; } },
    engRpm: { name: (a) => `RPM · ${engName(a, ids('eng'))}`, w: 3, h: 3, build: (a) => rpmGauge(a) },
    engCool: { name: (a) => `Coolant · ${engName(a, ids('eng'))}`, w: 3, h: 3, build: (a) => coolGauge(a) },
    engOil: { name: (a) => `Oil pressure · ${engName(a, ids('eng'))}`, w: 3, h: 3, build: (a) => oilGauge(a) },
    batV: { name: (a) => `${batName(a)} voltage`, w: 3, h: 3, build: (a) => batGauge(a) },
    tank: { name: (a) => tankName(a, ids('tank')), w: 3, h: 2, build: (a) => {
      const bar = h('i', tankClass(+a.split('-')[0]));
      reg(() => { bar.style.width = `${clamp(get(`tank.${a}.level`) ?? 0, 0, 100)}%`; });
      return [h('div', 'pv', t('pv-num', () => f(get(`tank.${a}.level`), 0)), h('span', { class: 'pv-unit', text: '%' })), h('div', 'meter', bar)];
    } },
  };
  const DEFAULT_PANELS = [['compass'], ['map'], ['wind'], ['value', 'sog'], ['value', 'depth'], ['value', 'tws'], ['value', 'cog'], ['engines'], ['tanks'], ['alarms']];
  const newPanel = (type, arg) => ({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type, arg, w: PANELS[type].w, h: PANELS[type].h });
  /** everything that can be added, grouped for the "Add panel" dialog */
  function panelCatalogue() {
    const g = { Navigation: [['compass'], ['map'], ['position'], ['sog'], ['waypoint'], ['gnss'], ['attitude'], ['ais']], Wind: [['wind']], Engines: [['engines']], Electrical: [['batteries']], Tanks: [['tanks']],
      Environment: [['temps']], System: [['alarms']], 'Single values': Object.keys(METRICS).map((k) => ['value', k]), 'History graphs': Object.keys(HISTORY).map((k) => ['history', k]) };
    g.Wind.push(...['aws', 'awa', 'tws', 'twa', 'twd'].map((k) => ['value', k]));
    for (const id of ids('eng')) g.Engines.push(['engRpm', id], ['engCool', id], ['engOil', id], ['khist', `eng.${id}.rpm`], ['khist', `eng.${id}.coolT`]);
    for (const id of ids('bat')) g.Electrical.push(['batV', id], ['khist', `bat.${id}.v`]);
    for (const id of ids('tank')) g.Tanks.push(['tank', id], ['khist', `tank.${id}.level`]);
    g.Environment.push(...['airT', 'seaT', 'baro', 'hum'].map((k) => ['value', k]));
    return g;
  }
  let editMode = false;
  const ROW = 84, GAP = 16;
  function customPage() {
    if (!Array.isArray(settings.panels)) settings.panels = DEFAULT_PANELS.map(([ty, a]) => newPanel(ty, a));
    const grid = h('div', 'dash' + (editMode ? ' editing' : ''));
    const saveOrder = () => { const by = Object.fromEntries(settings.panels.map((p) => [p.id, p])); settings.panels = [...grid.children].map((c) => by[c.dataset.id]).filter(Boolean); saveSettings(); };
    for (const p of settings.panels) {
      const def = PANELS[p.type]; if (!def) continue;
      const built = def.build(p.arg), body = h('div', 'panel-body' + (def.list ? ' list' : ''));
      body.append(...(built && built.controls ? [built.el] : [].concat(built)));
      const move = h('button', { class: 'p-btn p-move', type: 'button', title: 'Drag to move (or focus and use the arrow keys)', 'aria-label': 'Move panel: drag, or use the arrow keys', text: '⠿' });
      const grip = h('div', { class: 'p-resize', title: 'Drag to resize (or focus and use the arrow keys)', tabindex: 0, role: 'button', 'aria-label': 'Resize panel: drag, or use the arrow keys' });
      const el = h('section', { class: 'card panel', 'data-id': p.id, style: `grid-column: span ${p.w}; grid-row: span ${p.h}` },
        h('h3', null, t('p-title', () => p.title || def.name(p.arg)), built && built.controls ? built.controls : null,
          h('span', 'p-edit', move,
            h('button', { class: 'p-btn', type: 'button', title: 'Rename panel', 'aria-label': 'Rename panel', text: '✎', onclick: () => { const v = window.prompt('Panel title (leave empty for the automatic title)', p.title || def.name(p.arg)); if (v == null) return; if (v.trim()) p.title = v.trim().slice(0, 40); else delete p.title; saveSettings(); buildPages(); } }),
            h('button', { class: 'p-btn', type: 'button', title: 'Remove panel', 'aria-label': 'Remove panel', text: '✕', onclick: () => {
              const at = settings.panels.indexOf(p); settings.panels = settings.panels.filter((x) => x.id !== p.id); saveSettings(); buildPages();
              toast(`"${p.title || def.name(p.arg)}" removed.`, 'info', 9000, h('button', { class: 'btn sm', type: 'button', text: 'Undo', onclick: () => { settings.panels.splice(Math.min(at, settings.panels.length), 0, p); saveSettings(); buildPages(); $('#toast').hidden = true; } }));
            } }))), body, grip);
      // move: drag the handle over another panel to take its place
      move.addEventListener('pointerdown', (e) => {
        e.preventDefault(); move.setPointerCapture(e.pointerId); el.classList.add('dragging');
        let lastUnder = null;
        const onMove = (ev) => {
          const hit = document.elementFromPoint(ev.clientX, ev.clientY), under = hit && hit.closest('.panel');
          if (!under || under === el || under.parentNode !== grid) { lastUnder = null; return; }
          if (under === lastUnder) return;
          lastUnder = under;
          const kids = [...grid.children];
          if (kids.indexOf(el) < kids.indexOf(under)) under.after(el); else under.before(el);
        };
        const onUp = () => { move.removeEventListener('pointermove', onMove); move.removeEventListener('pointerup', onUp); move.removeEventListener('pointercancel', onUp); el.classList.remove('dragging'); saveOrder(); };
        move.addEventListener('pointermove', onMove); move.addEventListener('pointerup', onUp); move.addEventListener('pointercancel', onUp);
      });
      // resize: drag the corner grip; snaps to the grid
      grip.addEventListener('pointerdown', (e) => {
        e.preventDefault(); grip.setPointerCapture(e.pointerId); el.classList.add('resizing');
        const x0 = e.clientX, y0 = e.clientY, w0 = p.w, h0 = p.h, colW = (grid.clientWidth - 11 * GAP) / 12;
        const onMove = (ev) => {
          p.w = clamp(Math.round(w0 + (ev.clientX - x0) / (colW + GAP)), 2, 12); p.h = clamp(Math.round(h0 + (ev.clientY - y0) / (ROW + GAP)), 1, 10);
          el.style.gridColumn = `span ${p.w}`; el.style.gridRow = `span ${p.h}`;
        };
        const onUp = () => { grip.removeEventListener('pointermove', onMove); grip.removeEventListener('pointerup', onUp); grip.removeEventListener('pointercancel', onUp); el.classList.remove('resizing'); saveSettings(); };
        grip.addEventListener('pointermove', onMove); grip.addEventListener('pointerup', onUp); grip.addEventListener('pointercancel', onUp);
      });
      move.addEventListener('keydown', (e) => {
        const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp', fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
        if (!back && !fwd) return;
        e.preventDefault();
        const sib = back ? el.previousElementSibling : el.nextElementSibling;
        if (sib) { if (back) sib.before(el); else sib.after(el); saveOrder(); move.focus(); }
      });
      grip.addEventListener('keydown', (e) => {
        const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (!d) return;
        e.preventDefault();
        p.w = clamp(p.w + d[0], 2, 12); p.h = clamp(p.h + d[1], 1, 10);
        el.style.gridColumn = `span ${p.w}`; el.style.gridRow = `span ${p.h}`; saveSettings();
      });
      grid.append(el);
    }
    if (!grid.children.length) grid.append(h('div', { class: 'empty dash-empty', text: 'This dashboard is empty. Choose "Edit layout", then "Add panel".' }));
    const bar = h('div', 'dash-bar',
      h('span', { class: 'hint', text: editMode ? 'Drag ⠿ to move a panel, drag its bottom-right corner to resize, ✕ to remove. The layout is shared with every device.' : '' }),
      editMode ? h('button', { class: 'btn sm', type: 'button', text: 'Reset layout', onclick: () => { delete settings.panels; saveSettings(); buildPages(); } }) : null,
      editMode ? h('button', { class: 'btn sm', type: 'button', text: '+ Add panel', onclick: openAddPanel }) : null,
      h('button', { class: 'btn sm' + (editMode ? ' primary' : ''), type: 'button', text: editMode ? 'Done' : 'Edit layout', onclick: () => { editMode = !editMode; buildPages(); } }));
    return [bar, grid];
  }
  function openAddPanel() {
    let dlg = $('#addPanel');
    if (!dlg) { dlg = h('dialog', { id: 'addPanel' }); document.body.append(dlg); applyTheme(); }
    const add = (ty, a) => { settings.panels.push(newPanel(ty, a)); saveSettings(); dlg.close(); buildPages(); const last = $('#page-custom .dash').lastElementChild; if (last) last.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    dlg.replaceChildren(h('div', 'add-wrap', h('h2', { text: 'Add panel' }),
      Object.entries(panelCatalogue()).map(([group, items]) => h('fieldset', null, h('legend', { text: group }),
        h('div', 'add-list', items.map(([ty, a]) => h('button', { class: 'btn sm', type: 'button', text: PANELS[ty].name(a), onclick: () => add(ty, a) }))))),
      h('p', { class: 'hint', text: 'Individual engine, battery and tank panels are listed once that data is being received.' }),
      h('div', 'actions', h('button', { class: 'btn', type: 'button', text: 'Close', onclick: () => dlg.close() }))));
    dlg.showModal();
  }

  // ================================================================ pages
  const PAGES = {
    overview: ['Overview', () => [
      card(['Heading', t(null, () => `COG ${fdeg(get('cog'))}`, 'small')], 'c4', h('div', 'center', compass())),
      card('Speed', 'c4', h('div', 'center',
        gauge({ label: 'SOG', unit: () => unit('speed'), digits: 1, get: () => get('sog'), show: (v) => conv('speed', v), min: 0,
          max: () => { const d = conv('speed', maxSog) * 1.15; return [10, 20, 40, 80, 160].find((x) => x >= d) / UNITS.speed[settings.speed][0]; } })),
        kv([['Speed through water', () => fu(conv('speed', get('stw')), 1, unit('speed'))], ['VMG to waypoint', () => fu(conv('speed', get('nav.vmg')), 1, unit('speed'))],
          ['Log', () => fNm(get('log.total'))], ['Trip', () => fNm(get('log.trip'))]], 'wide')),
      card(['Depth', t(null, () => { const o = settings.depthRef === 'transducer' ? 0 : get('depth.offset'); return o == null ? '' : o < 0 ? `below keel (offset ${f(conv('depth', o), 1)} ${unit('depth')})` : o > 0 ? 'below waterline' : 'below transducer'; }, 'small')], 'c4',
        big(() => f(conv('depth', depthShown()), 1), () => unit('depth')),
        spark('depth', (v) => conv('depth', v), 1, { invert: true, minSpan: 0.5, thr: thrDepth })),
      card('Wind', 'c4', h('div', 'center', windDial()),
        kv([['Apparent angle', () => fSide(get('wind.awa'))], ['True speed', () => fu(conv('speed', trueWind().tws), 1, unit('speed'))], ['True direction', () => fdeg(trueWind().twd)]])),
      card(['Position', t(null, () => get('gnss.method') || '', 'small')], 'c4',
        h('div', 'stack', big(() => fLatLon(lat(), 'N', 'S'), '', 'md'), big(() => fLatLon(lon(), 'E', 'W'), '', 'md')),
        kv([['Satellites', () => f(get('gnss.sats'))], ['HDOP', () => f(get('gnss.hdop'), 1)], ['Waypoint', () => fNm(get('nav.dtw'))], ['Bearing', () => fdeg(get('nav.btw'))],
          ['Cross-track', () => { const x = get('nav.xte'); return x == null ? '—' : `${Math.abs(x).toFixed(0)} m ${x < 0 ? 'port' : 'stbd'}`; }], ['ETA (UTC)', () => fTime(get('nav.eta'))]])),
      card(['Alarms', h('button', { class: 'btn sm', type: 'button', text: 'Configure', onclick: () => show('alarms') })], 'c4', alertList()),
      card('Engines', 'c6', dyn(h('div', 'stack'), () => ids('eng'), (id, i, all) => h('div', 'eng-mini', rpmGauge(id),
        h('div', 'stack', h('strong', { text: engName(id, all) }), kv([['Coolant', () => fTemp(get(`eng.${id}.coolT`), 0)], ['Oil pressure', () => fPres(get(`eng.${id}.oilP`))],
          ['Fuel rate', () => fu(conv('volume', get(`eng.${id}.fuelRate`)), 1, `${unit('volume')}/h`)], ['Hours', () => fu(get(`eng.${id}.hours`), 1, 'h')]]))), 'No engine data received.')),
      card('Batteries', 'c3', dyn(h('div'), () => ids('bat'), (id) => h('div', 'rowline', h('span', { class: 'name', text: batName(id) }),
        h('span', 'val', t(null, () => fu(get(`bat.${id}.v`), 2, 'V')), t(null, () => { const a = get(`bat.${id}.a`), soc = get(`bat.${id}.soc`); return [a == null ? null : `${a > 0 ? '+' : ''}${a.toFixed(1)} A`, soc == null ? null : `${soc}%`].filter(Boolean).join(' · '); }, 'small'))), 'No battery data received.')),
      card('Tanks', 'c3', tankList()),
      card('Environment', 'c12', h('div', 'tiles',
        h('div', 'tile', h('div', { class: 'label', text: 'Air temperature' }), big(() => f(cTemp(get('temp.1-0')), 1), () => unit('temp'), 'md')),
        h('div', 'tile', h('div', { class: 'label', text: 'Sea temperature' }), big(() => f(cTemp(get('temp.0-0')), 1), () => unit('temp'), 'md')),
        h('div', 'tile', h('div', { class: 'label', text: 'Barometer' }), big(() => f(get('pressure'), 1), 'hPa', 'md')),
        h('div', 'tile', h('div', { class: 'label', text: 'Humidity' }), big(() => f(get('humidity.1') ?? get('humidity.0'), 0), '%', 'md')),
        h('div', 'tile', h('div', { class: 'label', text: 'True wind' }), big(() => fSpd(trueWind().tws), () => `${unit('speed')} ${beaufort(trueWind().tws)}`, 'md')),
        h('div', 'tile', h('div', { class: 'label', text: 'Rudder' }), big(() => fSide(get(`rudder.${ids('rudder')[0] ?? 0}`)), '', 'md')))),
    ]],

    custom: ['My Dashboard', () => customPage()],

    navigation: ['Navigation', () => [
      card(['Heading', t(null, () => { const v = get('variation'); return v == null ? '' : `Variation ${Math.abs(v).toFixed(1)}° ${v < 0 ? 'W' : 'E'}`; }, 'small')], 'c4', h('div', 'center', compass()),
        kv([['COG', () => fdeg(get('cog'))], ['SOG', () => fu(conv('speed', get('sog')), 1, unit('speed'))], ['Rate of turn', () => fu(get('rot'), 0, '°/min')]])),
      (() => { const cv = chartView(); return card(['Chart', cv.controls], 'c8', cv.el); })(),
      card('Position & GNSS', 'c4', h('div', 'stack', big(() => fLatLon(lat(), 'N', 'S'), '', 'md'), big(() => fLatLon(lon(), 'E', 'W'), '', 'md')),
        kv([['Fix', () => get('gnss.method') || '—'], ['Satellites used', () => f(get('gnss.sats'))], ['HDOP', () => f(get('gnss.hdop'), 2)], ['PDOP', () => f(get('gnss.pdop'), 2)],
          ['Altitude', () => fu(get('gnss.alt'), 1, 'm')], ['UTC time', () => fTime(get('time.utc'))]], 'wide')),
      card('Waypoint', 'c4', big(() => { const d = get('nav.dtw'); return d == null ? '—' : (d / 1852).toFixed(2); }, 'nm to go'),
        kv([['Bearing', () => fdeg(get('nav.btw')) + (get('nav.btw') == null ? '' : get('nav.btw.mag') ? ' M' : ' T')], ['VMG', () => fu(conv('speed', get('nav.vmg')), 1, unit('speed'))],
          ['Cross-track error', () => { const x = get('nav.xte'); return x == null ? '—' : `${Math.abs(x).toFixed(0)} m ${x < 0 ? 'port' : 'stbd'}`; }], ['ETA (UTC)', () => fTime(get('nav.eta'))],
          ['Waypoint lat', () => fLatLon(get('nav.wpLat'), 'N', 'S')], ['Waypoint lon', () => fLatLon(get('nav.wpLon'), 'E', 'W')]], 'wide')),
      card('Attitude & rudder', 'c4', rollInd(),
        kv([['Roll', () => fSide(get('roll'))], ['Pitch', () => { const p = get('pitch'); return p == null ? '—' : `${Math.abs(p).toFixed(1)}° ${p >= 0 ? 'bow up' : 'bow down'}`; }], ['Rudder', () => fSide(get(`rudder.${ids('rudder')[0] ?? 0}`))]]), rudderBar()),
      card(['AIS targets', t(null, () => { const c = aisList().length; return c ? `${c} in range` : ''; }, 'small')], 'c12', aisTable()),
      trackCard(),
      card('Depth history', 'c4', big(() => f(conv('depth', get('depth')), 1), () => unit('depth'), 'md'), spark('depth', (v) => conv('depth', v), 1, { invert: true, minSpan: 0.5, thr: thrDepth })),
      card('Speed history', 'c4', big(() => fSpd(get('sog')), () => `${unit('speed')} SOG`, 'md'), spark('sog', (v) => conv('speed', v), 1, { zero: true, minSpan: 0.2 })),
    ]],

    engines: ['Engines', () => [
      dyn(h('div', 'cards'), () => ids('eng'), (id, i, all) => {
        const chips = h('div', 'chips'); let sig = null;
        reg(() => {
          const s1 = get(`eng.${id}.status1`), s2 = get(`eng.${id}.status2`), sg = `${s1},${s2}`;
          if (sg === sig) return; sig = sg;
          const on = [...N2K.ENGINE_STATUS1.filter((x, b) => s1 & (1 << b)), ...N2K.ENGINE_STATUS2.filter((x, b) => s2 & (1 << b))];
          chips.replaceChildren(...(s1 == null ? [h('span', { class: 'chip', text: 'No status reported' })] : on.length ? on.map((x) => h('span', { class: 'chip crit', text: x })) : [h('span', { class: 'chip good', text: 'No warnings' })]));
        });
        return card([engName(id, all), t(null, () => get(`eng.${id}.gear`) || '', 'small')], '', h('div', 'gauges', rpmGauge(id),
          coolGauge(id),
          oilGauge(id)),
        kv([['Engine load', () => fu(get(`eng.${id}.load`), 0, '%')], ['Fuel rate', () => fu(conv('volume', get(`eng.${id}.fuelRate`)), 1, `${unit('volume')}/h`)],
          ['Alternator', () => fu(get(`eng.${id}.altV`), 1, 'V')], ['Oil temperature', () => fTemp(get(`eng.${id}.oilT`), 0)], ['Boost pressure', () => fPres(get(`eng.${id}.boost`))],
          ['Fuel pressure', () => fPres(get(`eng.${id}.fuelP`))], ['Coolant pressure', () => fPres(get(`eng.${id}.coolP`))], ['Trim', () => fu(get(`eng.${id}.trim`), 0, '%')],
          ['Gearbox oil', () => fPres(get(`eng.${id}.transP`))], ['Gearbox temp', () => fTemp(get(`eng.${id}.transT`), 0)], ['Engine hours', () => fu(get(`eng.${id}.hours`), 1, 'h')],
          ['Torque', () => fu(get(`eng.${id}.torque`), 0, '%')]]),
          h('div', 'charts2', chartBox(`eng.${id}.rpm`), chartBox(`eng.${id}.coolT`)), chips);
      }, 'No engine data (PGN 127488 / 127489) received yet.'),
    ]],

    power: ['Power & Tanks', () => [
      dyn(h('div', 'cards'), () => ids('bat'), (id) => {
        const soc = h('i', 'good');
        reg(() => { const v = get(`bat.${id}.soc`); soc.style.width = `${v ?? 0}%`; soc.className = v == null ? '' : v < 20 ? 'crit' : v < 40 ? 'warn' : 'good'; });
        return card([batName(id), h('small', { text: `instance ${id}` })], '', h('div', 'split', batGauge(id), h('div', 'stack',
          big(() => { const a = get(`bat.${id}.a`); return a == null ? '—' : Math.abs(a).toFixed(1); }, () => { const a = get(`bat.${id}.a`); return a == null ? 'A' : a > 0.05 ? 'A charging' : a < -0.05 ? 'A discharging' : 'A'; }, 'md'),
          h('div', null, h('div', 'meter', soc), t('hint', () => { const v = get(`bat.${id}.soc`); return v == null ? 'State of charge not reported' : `${v}% state of charge`; }, 'p')))),
        kv([['Power', () => { const v = get(`bat.${id}.v`), a = get(`bat.${id}.a`); return v == null || a == null ? '—' : `${(v * a).toFixed(0)} W`; }], ['Temperature', () => fTemp(get(`bat.${id}.temp`))],
          ['Time remaining', () => fDur(get(`bat.${id}.remaining`))], ['Health', () => fu(get(`bat.${id}.soh`), 0, '%')]]),
        spark(`bat.${id}.v`, (v) => v, 2, { minSpan: 0.05, fit: true, thr: thrBat(id) }));
      }, 'No battery data (PGN 127508) received yet.'),
      card('Tanks', 'c6', tankList()),
      card('Switches', 'c6', dyn(h('div', 'stack'), () => ids('switch'), (bank) => {
        const grid = h('div', 'switches'); let sig = null;
        reg(() => {
          const st = get(`switch.${bank}.states`) || [], sg = st.join('');
          if (sg === sig) return; sig = sg;
          grid.replaceChildren(...st.map((v, i) => (v > 1 ? null : h('span', { class: 'chip' + (v === 1 ? ' on' : ''), text: `Ch ${i + 1} · ${v === 1 ? 'On' : 'Off'}` }))).filter(Boolean));
        });
        return h('div', 'stack', h('strong', { text: `Switch bank ${bank}` }), grid);
      }, 'No switch bank status (PGN 127501) received.')),
      card('Tank level history', 'c12', dyn(h('div', 'charts-grid'), () => ids('tank'), (id, i, all) => h('div', null, h('strong', { text: tankName(id, all) }), chartBox(`tank.${id}.level`, false)), 'No tank level data received.')),
    ]],

    environment: ['Environment', () => [
      card('Wind', 'c4', h('div', 'center', windDial())),
      card('Wind detail', 'c4', h('div', 'split', h('div', null, h('div', { class: 'tile' }, h('div', { class: 'label', text: 'Apparent' }), big(() => fSpd(get('wind.aws')), () => unit('speed'), 'md'), t('hint', () => fSide(get('wind.awa')), 'p'))),
        h('div', null, h('div', { class: 'tile' }, h('div', { class: 'label' }, t(null, () => (trueWind().calc ? 'True (calculated)' : 'True'))), big(() => fSpd(trueWind().tws), () => unit('speed'), 'md'), t('hint', () => fSide(trueWind().twa), 'p')))),
        kv([['True direction', () => fdeg(trueWind().twd)], ['Beaufort', () => beaufort(trueWind().tws)]]), spark('tws', (v) => conv('speed', v), 1, { zero: true, minSpan: 0.5, thr: thrWind })),
      card('Barometer', 'c4', big(() => f(get('pressure'), 1), 'hPa'),
        t('hint', () => { const a = H.pressure || []; if (a.length < 30) return 'Trend available after a few minutes of data'; const d = a[a.length - 1].v - a[0].v; return `${d > 0.1 ? 'Rising' : d < -0.1 ? 'Falling' : 'Steady'} (${d >= 0 ? '+' : ''}${d.toFixed(1)} hPa over ${Math.round((a[a.length - 1].t - a[0].t) / 60000)} min)`; }, 'p'),
        spark('pressure', (v) => v, 1, { minSpan: 0.3 })),
      card('Temperatures', 'c6', dyn(h('div'), () => ids('temp'), (id) => h('div', 'rowline', h('span', { class: 'name', text: tempName(id) }),
        h('span', 'val', t(null, () => fTemp(get(`temp.${id}`))), t(null, () => { const sp = get(`tempSet.${id}`); return sp == null ? '' : `set ${fTemp(sp, 0)}`; }, 'small'))), 'No temperature data received.')),
      card('Humidity & sea', 'c6', h('div', 'tiles',
        h('div', 'tile', h('div', { class: 'label', text: 'Outside humidity' }), big(() => f(get('humidity.1'), 0), '%', 'md')),
        h('div', 'tile', h('div', { class: 'label', text: 'Inside humidity' }), big(() => f(get('humidity.0'), 0), '%', 'md')),
        h('div', 'tile', h('div', { class: 'label', text: 'Sea temperature' }), big(() => f(cTemp(get('temp.0-0')), 1), () => unit('temp'), 'md')),
        h('div', 'tile', h('div', { class: 'label', text: 'Depth' }), big(() => f(conv('depth', get('depth')), 1), () => unit('depth'), 'md')))),
    ]],

    alarms: ['Alarms', () => {
      const rows = ALARMS.map((d) => {
        const c = al(d.id);
        const onBox = h('input', { type: 'checkbox', class: 'sw', 'aria-label': `Enable ${d.name}` }); onBox.checked = c.on;
        const val = d.value == null ? null : h('input', { type: 'number', step: d.step || (d.kind ? 0.1 : 1), value: +alDisp(d, c.value).toFixed(2), 'aria-label': `${d.name} threshold` });
        const lvl = h('select', { 'aria-label': `${d.name} severity` }, h('option', { value: 'warn', text: 'Warning' }), h('option', { value: 'crit', text: 'Critical' })); lvl.value = c.level;
        const save = () => {
          const v = val ? parseFloat(val.value) : NaN;
          settings.alarms[d.id] = Object.assign({ on: onBox.checked, level: lvl.value }, isFinite(v) ? { value: alBase(d, v) } : {});
          saveSettings(); alertAt = 0;
        };
        [onBox, val, lvl].forEach((e) => e && e.addEventListener('change', save));
        const state = h('span', 'chip');
        reg(() => {
          const on = al(d.id).on, act = on && alerts().some((x) => x[2] === d.id), txt = !on ? 'Off' : act ? 'Active' : 'OK';
          if (state.textContent !== txt) { state.textContent = txt; state.className = 'chip' + (act ? ' crit' : on ? ' good' : ''); }
          if (val) val.disabled = !on; lvl.disabled = !on;
        });
        return h('tr', null, h('td', null, onBox), h('td', 'wrap', h('strong', { text: d.name }), h('div', { class: 'desc', text: d.desc })),
          h('td', null, val ? h('span', 'thr', val, h('span', { text: alUnit(d) })) : h('span', { class: 'dim', text: '—' })), h('td', null, lvl), h('td', null, state));
      });
      const sound = h('input', { type: 'checkbox', class: 'sw', id: 'soundSw' }); sound.checked = settings.sound;
      sound.onchange = () => {
        settings.sound = sound.checked; saveSettings();
        if (sound.checked) { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); beep(); } catch { /* no audio */ } }
      };
      const reset = h('button', { class: 'btn sm', type: 'button', text: 'Reset to defaults', onclick: () => { settings.alarms = {}; saveSettings(); alertAt = 0; buildPages(); } });
      return [
        card(['Active alarms', t(null, () => { const n = alerts().length; return n ? `${n} active` : 'none active'; }, 'small')], 'c4', alertList(),
          h('label', { class: 'swrow', for: 'soundSw' }, sound, h('span', null, 'Sound when a new critical alarm starts', h('div', { class: 'desc', text: 'Plays in this browser tab only' })))),
        card(['Alarm configuration', reset], 'c8', h('div', 'tbl-wrap tall', h('table', 'cfg', h('thead', null, h('tr', null, ['On', 'Alarm', 'Trigger threshold', 'Severity', 'State'].map((x) => h('th', { text: x })))), h('tbody', null, rows))),
          h('p', { class: 'hint', text: 'Changes apply immediately and are saved in this browser. Thresholds use the units chosen in Settings.' })),
      ];
    }],

    sources: ['Sources', () => {
      const body = h('tbody'); let sig = '', inUse = [];
      reg(() => {
        const groups = [...groupSrcs.entries()].filter(([g, m]) => showAllSources || m.size > 1 || settings.sources[g] != null).map(([g, m]) => { const list = new Set(m.keys()); if (settings.sources[g] != null) list.add(settings.sources[g]); return [g, [...list].sort((a, b) => a - b)]; })
          .sort((a, b) => (b[1].length > 1) - (a[1].length > 1) || a[0].localeCompare(b[0], undefined, { numeric: true }));
        const sg = showAllSources + JSON.stringify(groups) + groups.map(([, l]) => l.map(srcLabel).join()).join();
        if (sg !== sig && !body.contains(document.activeElement)) {
          sig = sg; inUse = [];
          body.replaceChildren(...(groups.length ? groups.map(([g, list]) => {
            const sel = h('select', { 'aria-label': `Priority source for ${g}` }, h('option', { value: 'auto', text: 'Automatic' }), list.map((sa) => h('option', { value: sa, text: srcLabel(sa) })));
            sel.value = settings.sources[g] != null ? settings.sources[g] : 'auto';
            sel.onchange = () => { if (sel.value === 'auto') delete settings.sources[g]; else settings.sources[g] = +sel.value; saveSettings(); groupActive.delete(g); };
            const use = h('td', 'wrap'); inUse.push([g, use]);
            return h('tr', null, h('td', 'wrap', h('strong', { text: g })), h('td', null, h('span', { class: 'chip' + (list.length > 1 ? ' on' : ''), text: list.length > 1 ? `${list.length} sources` : '1 source' })), h('td', null, sel), use);
          }) : [h('tr', null, h('td', { colspan: 4, class: 'dim', text: groupSrcs.size ? 'No data is currently being sent by more than one device, so there is nothing to prioritise. Tick "Show all" to see every data type.' : 'Waiting for data…' }))]));
        }
        for (const [g, cell] of inUse) {
          const act = groupActive.get(g), pref = settings.sources[g], m = groupSrcs.get(g);
          const stale = act == null || !m || Date.now() - (m.get(act) || 0) > 25000;
          const txt = stale ? 'No data' : srcLabel(act) + (pref != null && pref !== act ? ' — priority source not sending, using fallback' : '');
          if (cell.textContent !== txt) cell.textContent = txt;
        }
      });
      return [
        card(['Source priority', (() => { const cb = h('input', { type: 'checkbox', id: 'allSrc' }); cb.checked = showAllSources; cb.onchange = () => { showAllSources = cb.checked; sig = ''; }; return h('label', { class: 'h-check', for: 'allSrc' }, cb, 'Show all'); })()], 'c12',
          h('p', { class: 'hint', text: 'When more than one device on the NMEA 2000 network sends the same data, the dashboard uses one source at a time so values do not jump between devices. '
            + 'Automatic keeps the first source seen and switches only if it stops sending. Choose a source address to prioritise it: it is used whenever it is sending, and the dashboard falls back to another source if it stops.' }),
          h('div', 'tbl-wrap tall', h('table', 'cfg', h('thead', null, h('tr', null, ['Data', 'Available', 'Priority source', 'Currently using'].map((x) => h('th', { text: x })))), body))),
        namesCard(),
      ];
    }],

    network: ['Network', () => {
      const gw = h('div', 'stack'), devBody = h('tbody'), pgnBody = h('tbody'), log = h('pre', 'log'), pause = h('button', { class: 'btn sm', type: 'button', text: 'Pause' });
      let paused = false, last = 0;
      const logFilter = h('input', { type: 'text', placeholder: 'Filter, e.g. a PGN in hex (1F805) or text', 'aria-label': 'Filter the raw log', spellcheck: 'false' });
      pause.onclick = () => { paused = !paused; pause.textContent = paused ? 'Resume' : 'Pause'; };
      reg(() => {
        if (Date.now() - last < 950) return; last = Date.now();
        renderGateway(gw);
        const now = Date.now(), age = (tm) => { const a = (now - tm) / 1000; return a < 2 ? 'now' : a < 90 ? `${a.toFixed(0)} s ago` : `${(a / 60).toFixed(0)} min ago`; };
        devBody.replaceChildren(...[...srcStats.entries()].sort((a, b) => a[0] - b[0]).map(([src, st]) => h('tr', null,
          h('td', { class: 'mono', text: `${src.toString(16).toUpperCase().padStart(2, '0')} (${src})` }),
          h('td', { text: N2K.MANUFACTURERS[get(`dev.${src}.mfr`)] || (get(`dev.${src}.mfr`) != null ? `Code ${get(`dev.${src}.mfr`)}` : '—') }),
          h('td', { text: get(`dev.${src}.model`) || '—' }), h('td', { text: get(`dev.${src}.sw`) || '—' }), h('td', { class: 'num', text: st.n.toLocaleString() }), h('td', { class: 'dim', text: age(st.t) }))));
        pgnBody.replaceChildren(...[...pgnStats.entries()].sort((a, b) => a[0] - b[0]).map(([pgn, st]) => h('tr', null,
          h('td', { class: 'mono', text: pgn }), h('td', { text: N2K.PGN_NAMES[pgn] || 'Unknown / proprietary' }),
          h('td', { class: 'mono dim', text: [...st.srcs].map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ') }),
          h('td', { class: 'num', text: st.n.toLocaleString() }), h('td', { class: 'num', text: st.rate ? `${st.rate}/s` : '—' }), h('td', { class: 'dim', text: N2K.supported.includes(pgn) ? 'Displayed' : '' }))));
        if (!paused) { const q = logFilter.value.trim().toUpperCase(); log.textContent = (q ? rawLog.filter((l) => l.toUpperCase().includes(q)) : rawLog).slice(-120).join('\n'); log.scrollTop = log.scrollHeight; }
      });
      return [
        card('Gateway', 'c4', gw),
        card(['NMEA 2000 devices', h('small', { text: 'sources seen in the data stream' })], 'c8', h('div', 'tbl-wrap', h('table', null, h('thead', null, h('tr', null, ['Source', 'Manufacturer', 'Model', 'Firmware', 'Messages', 'Last seen'].map((x, i) => h('th', { class: i === 4 ? 'num' : null, text: x })))), devBody))),
        card(['PGN traffic', t(null, () => `${pgnStats.size} PGNs · ${conn.rate || 0} msg/s${badLines ? ` · ${badLines} unparsed lines` : ''}`, 'small')], 'c7', h('div', 'tbl-wrap', h('table', null, h('thead', null, h('tr', null, ['PGN', 'Description', 'Sources', 'Count', 'Rate', ''].map((x, i) => h('th', { class: i === 3 || i === 4 ? 'num' : null, text: x })))), pgnBody))),
        card(['Raw N2K ASCII', pause], 'c5', logFilter, log),
      ];
    }],
  };

  // ---- gateway status (W2K-2 REST API via the bridge proxy, read-only)
  let device = { about: null, info: null, wifi: null, error: null }, boatAsked = false;
  /** gateway REST URL: through the bridge's proxy, or straight to the gateway (it allows cross-origin requests) when there is no bridge */
  const devUrl = (ep, host, obj) => (standalone ? `http://${host}/api/${ep}${obj ? `?object=${obj}` : ''}` : `/api/device/${ep}?host=${encodeURIComponent(host)}${obj ? `&object=${obj}` : ''}`);
  const whereTxt = () => (conn.mode === 'ws' ? `WebSocket ${conn.host}` : conn.mode === 'tcp' ? `TCP ${conn.host}:${conn.port}` : `UDP port ${conn.port}`);
  async function pollDevice() {
    if ((!direct && !bridgeUp) || conn.mode === 'sim' || !conn.host) { device = { about: null, info: null, wifi: null, error: null }; return; }
    const getJ = async (ep) => { const r = await fetch(devUrl(ep, conn.host)); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; };
    try {
      const [about, info, wifi] = await Promise.all([getJ('about'), getJ('info').catch(() => null), getJ('wifi').catch(() => null)]);
      device = { about: about.about || null, info, wifi, error: null };
      if (!boatAsked) { boatAsked = true; getJ('installation').then((j) => { const n = j.installation && j.installation.boatName; boatName = n || ''; }).catch(() => {}); }
    } catch (e) { device = { about: null, info: null, wifi: null, error: String(e.message || e) }; }
  }
  function renderGateway(el) {
    const rows = [];
    const add = (k, v) => { if (v != null && v !== '') rows.push(h('div', 'rowline', h('span', { class: 'name', text: k }), h('span', { class: 'val', text: String(v), style: 'font-size:14px' }))); };
    add('Source', conn.mode === 'sim' ? 'Built-in demo simulator' : whereTxt() + (direct ? ' (direct from this browser)' : ''));
    add('Link', conn.detail || conn.state);
    add('Lines received', (conn.lines || 0).toLocaleString());
    if (conn.mode === 'sim') rows.push(h('p', { class: 'hint', text: 'Connect to a W2K-2 in Settings to see gateway status (model, firmware, bus voltage, CAN load, Wi-Fi) read from its REST API.' }));
    else if (device.error) rows.push(h('p', { class: 'hint', text: `Gateway REST API not reachable at ${conn.host || '(no address set)'} (${device.error}). Live data is unaffected.` }));
    else if (device.about) {
      const a = device.about;
      add('Model', a.modelName); add('Serial number', a.serialNumber); add('Firmware', a.firmwareVersion); add('Operating mode', a.operatingMode);
      for (const col of (device.info && device.info.columns) || []) if (col.name === 'Status') for (const d of col.details || []) if (!/^(Operating Mode)$/i.test(d.key)) add(d.key, d.value);
      const sta = device.wifi && device.wifi.sta;
      if (sta && sta.ssid) add('Wi-Fi', `${sta.ssid}${sta.rssi != null ? ` (${sta.rssi} dBm)` : ''}`);
    }
    el.replaceChildren(...rows);
  }

  // ================================================================ shell: tabs, theme, connection, settings
  const pages = {};
  let active = null;
  // sidebar navigation: page -> [group, icon path]
  const NAV = {
    overview: ['Overview', 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'], custom: ['Overview', 'M4 4h16v6H4zM4 14h7v6H4zM15 14h5v6h-5z'],
    navigation: ['Overview', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z'],
    engines: ['Systems', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2'],
    power: ['Systems', 'M13 2 5 14h6l-1 8 8-12h-6z'], environment: ['Systems', 'M3 9h11a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3M3 19h7'],
    alarms: ['Alerts', 'M12 3a6 6 0 0 0-6 6v4l-2 3v1h16v-1l-2-3V9a6 6 0 0 0-6-6zm-2 16a2 2 0 0 0 4 0'],
    sources: ['Configuration', 'M4 7h12M4 17h12M16 4l4 3-4 3M16 14l4 3-4 3'], network: ['Configuration', 'M12 4v6M5 20v-4h14v4M12 10v6M3 20h4M10 20h4M17 20h4'],
  };
  const navIcon = (d) => s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, s('path', { d }));
  function buildPages() {
    const main = $('#main'), tabs = $('#tabs');
    // remember what had keyboard focus so a rebuild does not throw it away
    const fa = document.activeElement, focusKey = fa && main.contains(fa) ? [fa.tagName, (fa.getAttribute('aria-label') || fa.textContent || '').slice(0, 60)] : null;
    leafMaps.forEach((m) => m.remove()); leafMaps = [];
    main.replaceChildren(); tabs.replaceChildren();
    let lastGroup = '';
    for (const [id, [title, build]] of Object.entries(PAGES)) {
      const ups = [], el = h('div', { class: 'page', id: `page-${id}`, hidden: '' });
      withSink(ups, () => el.append(...build()));
      pages[id] = { el, ups };
      main.append(el);
      if (NAV[id][0] !== lastGroup) { lastGroup = NAV[id][0]; tabs.append(h('div', { class: 'nav-group', text: lastGroup })); }
      tabs.append(h('button', { type: 'button', 'data-page': id, onclick: () => show(id) }, navIcon(NAV[id][1]), h('span', { text: title })));
    }
    tabs.append(h('button', { type: 'button', onclick: () => openSettings() }, navIcon('M4 7h10M18 7h2M4 17h2M10 17h10M16 4.5v5M8 14.5v5'), h('span', { text: 'Settings' })));
    show(PAGES[location.hash.slice(1)] ? location.hash.slice(1) : 'overview');
    if (focusKey) {
      const again = [...pages[active].el.querySelectorAll(focusKey[0])].find((e) => (e.getAttribute('aria-label') || e.textContent || '').slice(0, 60) === focusKey[1]);
      (again || main).focus({ preventScroll: true });
    }
  }
  function show(id) {
    active = id;
    for (const k in pages) pages[k].el.hidden = k !== id;
    for (const b of $('#tabs').querySelectorAll('[data-page]')) { if (b.dataset.page === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
    $('#pageTitle').textContent = PAGES[id][0];
    history.replaceState(null, '', '#' + id);
    render();
  }
  const headerUps = [];
  function render() { if (active) for (const u of pages[active].ups) u(); for (const u of headerUps) u(); }

  // theme
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const THEME_ICON = { light: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
    dark: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z', night: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z' };
  const themeMode = () => (settings.theme === 'auto' ? (mq.matches ? 'dark' : 'light') : settings.theme);
  /** light / dark / night. Night = the dark theme shown in red only (preserves night vision); brightness dims everything. */
  function applyTheme() {
    const mode = themeMode(), root = document.documentElement, b = clamp(+settings.brightness || 100, 30, 100);
    root.dataset.theme = mode === 'light' ? 'light' : 'dark';
    root.toggleAttribute('data-night', mode === 'night');
    const flt = `${mode === 'night' ? 'url(#redOnly) ' : ''}${b < 100 ? `brightness(${b}%)` : ''}`.trim();
    document.body.style.filter = flt;                                   // dialogs sit in the top layer, outside body, so they get it too
    document.querySelectorAll('dialog').forEach((d) => { d.style.filter = flt; });
    $('#themeIcon').setAttribute('d', THEME_ICON[mode]);
    paintLogo();
    $('#themeBtn').title = `Theme: ${mode} (click to change)`; $('#themeBtn').setAttribute('aria-label', `Theme: ${mode}. Click to change`);
  }
  mq.addEventListener('change', applyTheme);
  $('#themeBtn').onclick = () => { settings.theme = { light: 'dark', dark: 'night', night: 'light' }[themeMode()]; saveLocal(); applyTheme(); render(); };

  // brief status message under the tabs (connection results, import/export)
  let toastTimer = 0;
  function toast(msg, kind = 'info', ms = 6000, action) {
    const el = $('#toast');
    el.className = 'toast ' + kind; el.replaceChildren(...[h('span', { text: msg }), action, h('button', { class: 'btn sm', type: 'button', text: 'Dismiss', onclick: () => { el.hidden = true; } })].filter(Boolean));
    el.hidden = false; clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }
  /** after the connection settings change, report clearly whether it worked */
  function watchConnection() {
    const t0 = Date.now(), where = whereTxt;
    const fix = () => h('button', { class: 'btn sm', type: 'button', text: 'Open settings', onclick: openSettings });
    lastRx = 0;
    toast('Applying connection settings…', 'info', 0);
    const iv = setInterval(() => {
      if (conn.mode === 'sim') { clearInterval(iv); return toast('Now showing built-in demo data.', 'info'); }
      if (conn.state === 'connected' && Date.now() - lastRx < 2000) { clearInterval(iv); return toast(`Connected - receiving live data from ${where()}.`, 'good'); }
      if (Date.now() - t0 < 1500) return;                     // give the bridge a moment to switch over
      if (conn.state === 'error') { clearInterval(iv); return toast(`Could not connect to ${where()}: ${conn.detail}. Use "Test connection" in Settings for details.`, 'bad', 0, fix()); }
      if (Date.now() - t0 > 9000) { clearInterval(iv); toast(conn.state === 'connecting' ? `Still trying to reach ${where()} - check the address and network.` : `Connected to ${where()}, but no data is arriving yet.`, 'warn', 0, fix()); }
    }, 400);
  }

  // connection to the bridge
  let conn = { mode: 'sim', state: 'idle', detail: '', rate: 0, lines: 0 }, bridgeUp = false, connKey = '';
  // ---- direct WebSocket source: the browser connects straight to the W2K-2 (ws://<gateway>/api/websocket),
  // which streams N2K ASCII lines as {"t":"data","c":{"m":[...]}}. No bridge program is involved, so the page
  // also works when opened straight from disk (file://).
  const standalone = location.protocol === 'file:';
  let direct = false, ws = null, wsRetry = 0, wsRate = 0, bridgeConn = null;
  function startDirect(host) {
    stopDirect(false); direct = true; resetData();
    conn = { mode: 'ws', state: 'connecting', detail: '', host, port: 80, rate: 0, lines: 0 };
    connKey = `ws|${host}`;
    const open = () => {
      if (!direct) return;
      conn.state = 'connecting';
      let sock;
      try { sock = ws = new WebSocket(`ws://${host}/api/websocket`); } catch (e) { conn.state = 'error'; conn.detail = 'invalid gateway address'; return; }
      sock.onopen = () => { conn.state = 'connected'; conn.detail = `WebSocket ${host}`; sock.send(JSON.stringify({ t: 'ws_init', c: { subscriptions: [{ name: 'data', enabled: 'true' }] } })); };
      sock.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.t !== 'data' || !m.c || !Array.isArray(m.c.m)) return;
        for (const line of m.c.m) { ingest(line); conn.lines++; wsRate++; }
      };
      sock.onclose = () => { if (ws !== sock || !direct) return; conn.state = 'error'; conn.detail = 'gateway WebSocket not reachable'; wsRetry = setTimeout(open, 3000); };
    };
    open(); pollDevice();
  }
  function stopDirect(restore = true) {
    direct = false; clearTimeout(wsRetry);
    if (ws) { const s = ws; ws = null; try { s.close(); } catch { /* closed */ } }
    if (restore && bridgeConn) { resetData(); conn = bridgeConn; connKey = `${conn.mode}|${conn.host}|${conn.port}`; }
  }
  setInterval(() => { if (direct) conn.rate = wsRate; wsRate = 0; }, 1000);

  function connect() {
    if (standalone) return;   // opened from disk: there is no bridge to talk to
    const es = new EventSource('/events');
    es.onopen = () => { bridgeUp = true; };
    es.onerror = () => { bridgeUp = false; };
    es.addEventListener('status', (e) => {
      bridgeConn = JSON.parse(e.data); bridgeUp = true;
      if (direct) return;
      conn = bridgeConn;
      const key = `${conn.mode}|${conn.host}|${conn.port}`;
      if (key !== connKey) { if (connKey) resetData(); connKey = key; pollDevice(); }
    });
    es.addEventListener('n2k', (e) => { if (!direct) for (const line of JSON.parse(e.data)) ingest(line); });
    es.addEventListener('clear', () => wipeData());   // someone pressed "Clear all data"
    es.addEventListener('prefs', (e) => {   // another device changed the shared settings
      const m = JSON.parse(e.data);
      if (m.from === clientId || editMode || (document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName))) return;
      applyShared(m.prefs);
    });
  }
  headerUps.push(() => {
    const pill = $('#connPill'), live = Date.now() - lastRx < 5000;
    let cls = 'wait', txt;
    if (!direct && !bridgeUp) { cls = 'bad'; txt = standalone ? 'Not connected' : 'Bridge offline'; }
    else if (conn.state === 'simulating') { cls = 'demo'; txt = `Demo data · ${conn.rate} msg/s`; }
    else if (conn.state === 'error') { cls = 'bad'; txt = `${conn.mode === 'ws' ? 'WebSocket' : conn.mode.toUpperCase()} error · ${conn.detail}`; }
    else if (conn.state === 'connected' && live) { cls = 'live'; txt = `Live · ${whereTxt()} · ${conn.rate} msg/s`; }
    else if (conn.state === 'connected') txt = 'Connected · no data';
    else if (conn.state === 'listening') txt = `Listening on UDP ${conn.port}…`;
    else txt = `Connecting to ${conn.mode === 'ws' ? conn.host : conn.host + ':' + conn.port}…`;
    pill.className = 'pill ' + cls; $('#connText').textContent = txt;
    const utc = get('time.utc'); $('#clock').textContent = utc == null ? '--:--:-- UTC' : `${fTime(utc)} UTC`;
    const a = alerts(), badge = $('#alertBadge');
    badge.hidden = !a.length; badge.textContent = a.length; badge.className = 'badge' + (a.some((x) => x[0] === 'crit') ? ' crit' : '');
    // alarm bar: shown on every page until the active alarms are acknowledged
    const keys = new Set(a.map(alKey));
    for (const k of acked) if (!keys.has(k)) acked.delete(k);
    for (const k of announced) if (!keys.has(k)) announced.delete(k);
    const open = a.filter((x) => !acked.has(alKey(x))), bar = $('#alarmBar');
    bar.hidden = !open.length;
    if (open.length) {
      const crit = open[0][0] === 'crit', txt = `${LEVEL[open[0][0]]} alarm · ${open[0][1]}${open.length > 1 ? `  (+${open.length - 1} more)` : ''}`;
      bar.className = 'alarm-bar ' + (crit ? 'crit' : 'warn');
      if ($('#alarmText').textContent !== txt) $('#alarmText').textContent = txt;
      const fresh = open.filter((x) => !announced.has(alKey(x)));
      if (fresh.length) { fresh.forEach((x) => announced.add(alKey(x))); $('#alarmSay').textContent = fresh.map((x) => `${LEVEL[x[0]]} alarm: ${x[1]}`).join('. '); }
      if (crit && settings.sound && Date.now() - lastBeep > 5000) { lastBeep = Date.now(); beep(); }   // repeats until acknowledged
    }
    // sidebar device card
    const ab = device.about, sim = conn.mode === 'sim', since = lastRx ? (Date.now() - lastRx) / 1000 : null;
    const setTxt = (id, v) => { const e = $(id); if (e.textContent !== v) e.textContent = v; };
    setTxt('#devName', boatName || (sim && !standalone ? 'Demo vessel' : ab ? ab.modelName || 'W2K-2' : 'W2K-2 gateway'));
    setTxt('#devModel', sim && !standalone ? 'Built-in simulator' : ab ? `${ab.modelName || ''} · S/N ${ab.serialNumber ?? '—'}` : 'Gateway details not available');
    setTxt('#devSource', sim ? (standalone ? 'Not connected' : 'No gateway connected') : whereTxt());
    setTxt('#devLast', since == null ? 'No data yet' : since < 3 ? 'Receiving data' : `Last data ${since < 90 ? since.toFixed(0) + ' s' : (since / 60).toFixed(0) + ' min'} ago`);
    $('#devStatus').className = 'dev-status ' + (since != null && since < 5 ? (sim ? 'demo' : 'live') : 'bad');
    const banner = $('#banner'), demo = bridgeUp && conn.mode === 'sim' && !bannerDismissed;
    if (banner.hidden === demo) {
      banner.hidden = !demo;
      if (demo && !banner.firstChild) banner.append('Showing built-in demo data. Connect to your W2K-2 over TCP or UDP to see live NMEA 2000 data.', h('button', { class: 'btn sm primary', type: 'button', text: 'Connect…', onclick: openSettings }), h('button', { class: 'btn sm', type: 'button', text: 'Hide', 'aria-label': 'Hide this message', onclick: () => { bannerDismissed = true; banner.hidden = true; } }));
    }
  });

  // periodic work: history sampling, track, rates
  setInterval(() => {
    const now = Date.now(), tw = trueWind();
    const sample = (k, v) => { if (v == null) return; const a = (H[k] = H[k] || []); a.push({ t: now, v }); if (a.length > 900) a.shift(); };
    for (const [mmsi, tg] of aisTargets) if (!tg.t || now - tg.t > 600000) aisTargets.delete(mmsi);   // drop AIS targets not heard for 10 min
    sample('depth', get('depth')); sample('sog', get('sog')); sample('pressure', get('pressure')); sample('tws', tw.tws);
    for (const id of ids('bat')) sample(`bat.${id}.v`, get(`bat.${id}.v`));
    for (const id of ids('eng')) { sample(`eng.${id}.rpm`, get(`eng.${id}.rpm`)); sample(`eng.${id}.coolT`, get(`eng.${id}.coolT`)); }
    for (const id of ids('tank')) sample(`tank.${id}.level`, get(`tank.${id}.level`));
    const sog = get('sog'); if (sog != null) maxSog = Math.max(maxSog * 0.9995, sog);
    const la = lat(), lo = lon();
    if (la != null && lo != null) {
      const p = track[track.length - 1];
      if (!p || Math.hypot((la - p[0]) * 111320, (lo - p[1]) * 111320 * Math.cos(la * RAD)) > 8) { if (p) trackDist += Math.hypot((la - p[0]) * 111320, (lo - p[1]) * 111320 * Math.cos(la * RAD)); track.push([la, lo]); trackT.push(now); if (track.length > 3000) { track.splice(0, 500); trackT.splice(0, 500); } }
    }
  }, 2000);
  setInterval(() => { for (const st of pgnStats.values()) { st.rate = st.n1; st.n1 = 0; } }, 1000);
  setInterval(pollDevice, 5000);
  setInterval(render, 200);

  // settings dialog
  const dlg = $('#settings'), form = $('#settingsForm');
  function syncMode() {
    const mode = form.mode.value;
    $('#netRow').style.display = mode === 'sim' ? 'none' : '';
    form.port.parentElement.style.display = mode === 'ws' ? 'none' : '';
    $('#findServers').parentElement.style.display = mode === 'sim' ? 'none' : '';
    $('#findServers').style.display = mode === 'ws' ? 'none' : '';
    $('#modeHint').textContent = mode === 'ws' ? 'This browser connects straight to the W2K-2\'s built-in WebSocket. No data server needs setting up on the gateway and no bridge program is involved. Each device viewing the dashboard makes its own connection.'
      : mode === 'tcp' ? 'The bridge connects to a TCP data server on the W2K-2. Set that server\'s output format to "N2K ASCII" in the gateway\'s web interface.'
      : mode === 'udp' ? 'The bridge listens on this UDP port for data the W2K-2 broadcasts. Set that server\'s output format to "N2K ASCII". The address is only used to read gateway status.'
      : 'A built-in simulator generates realistic N2K ASCII data for a twin-engine vessel - useful for demos with no gateway attached.';
  }
  async function openSettings() {
    try { const j = await (await fetch('/api/config')).json(); form.mode.value = j.config.mode; form.host.value = j.config.host || ''; form.port.value = j.config.port || ''; } catch { /* no bridge */ }
    if (direct || standalone) { form.mode.value = 'ws'; if (settings.ws && settings.ws.host) form.host.value = settings.ws.host; }
    for (const r of form.mode) if (r.value !== 'ws') r.disabled = standalone;   // TCP, UDP and demo data need the bridge program
    for (const k of ['speed', 'depth', 'temp', 'pressure', 'volume', 'depthRef', 'theme', 'brightness']) form[k].value = settings[k];
    $('#brightVal').textContent = `${settings.brightness}%`;
    form.tileUrl.value = (settings.tiles && settings.tiles.url) || ''; form.tileAttr.value = (settings.tiles && settings.tiles.attribution) || '';
    $('#settingsError').hidden = true; $('#serverList').replaceChildren(); $('#testResult').hidden = true; syncMode();
    opened = { mode: form.mode.value, host: form.host.value, port: form.port.value, theme: settings.theme, brightness: settings.brightness };
    if (!dlg.open) dlg.showModal();
  }
  let opened = {};
  form.brightness.addEventListener('input', () => { settings.brightness = +form.brightness.value; $('#brightVal').textContent = `${settings.brightness}%`; applyTheme(); });   // live preview
  form.theme.addEventListener('change', () => { settings.theme = form.theme.value; applyTheme(); });
  dlg.addEventListener('close', () => { if (dlg.returnValue !== 'saved') { settings.theme = opened.theme; settings.brightness = opened.brightness; applyTheme(); } dlg.returnValue = ''; });
  /** try the gateway's WebSocket for up to 4 s */
  const testWebSocket = (host) => new Promise((resolve) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.\-]*$/.test(host)) return resolve({ ok: false, message: 'Enter the gateway\'s address first, for example 192.168.4.1.' });
    let sock, wasOpen = false, done = false;
    const fin = (ok, message) => { if (done) return; done = true; clearTimeout(tm); try { sock.close(); } catch { /* closed */ } resolve({ ok, message }); };
    const tm = setTimeout(() => fin(false, wasOpen ? `Connected to ${host}, but no NMEA 2000 data arrived within 4 seconds. Check the NMEA 2000 network is powered.` : `No answer from ${host} within 4 seconds. Check the address, and that this device is on the same network as the gateway.`), 4000);
    try { sock = new WebSocket(`ws://${host}/api/websocket`); } catch { return fin(false, 'That address is not valid.'); }
    sock.onopen = () => { wasOpen = true; sock.send(JSON.stringify({ t: 'ws_init', c: { subscriptions: [{ name: 'data', enabled: 'true' }] } })); };
    sock.onmessage = (e) => { try { const m = JSON.parse(e.data); if (m.t === 'data' && N2K.parseLine(m.c.m[0])) fin(true, `Success - receiving NMEA 2000 data from ${host} over WebSocket.`); } catch { /* ignore */ } };
    sock.onerror = () => { if (!wasOpen) fin(false, `Could not open a WebSocket to ${host}. Check the address, and that this device is on the same network as the gateway.`); };
  });
  $('#testConn').onclick = async () => {
    const out = $('#testResult'), btn = $('#testConn');
    out.className = 'test-result'; out.textContent = 'Testing… (up to 4 seconds)'; out.hidden = false; btn.disabled = true;
    try {
      const j = form.mode.value === 'ws' ? await testWebSocket(form.host.value.trim())
        : await (await fetch('/api/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: form.mode.value, host: form.host.value.trim(), port: form.port.value }) })).json();
      out.className = 'test-result ' + (j.ok ? 'good' : 'bad'); out.textContent = j.message;
    } catch { out.className = 'test-result bad'; out.textContent = 'The dashboard bridge did not answer - is server.js still running?'; }
    btn.disabled = false;
  };
  // "Clear all data": asks for a second click, then wipes this browser's data and the bridge's stored history
  { const btn = $('#clearDataBtn'), label = btn.textContent; let armed = 0;
    const disarm = () => { clearTimeout(armed); armed = 0; btn.textContent = label; btn.classList.remove('danger'); };
    btn.onclick = async () => {
      if (!armed) { btn.textContent = 'Click again to clear'; btn.classList.add('danger'); armed = setTimeout(disarm, 5000); return; }
      disarm(); wipeData();
      let stored = standalone;
      if (!standalone) try { stored = (await fetch('/api/clear', { method: 'POST' })).ok; } catch { stored = false; }
      toast(stored ? 'All received data cleared.' : 'Live data cleared here, but the dashboard bridge did not answer, so its stored history was not cleared.', stored ? 'good' : 'warn');
    }; }
  $('#exportBtn').onclick = () => {
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify({ app: 'cassini', version: 1, settings: sharedSettings() }, null, 2)], { type: 'application/json' })), download: 'cassini-settings.json' });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#importBtn').onclick = () => $('#importFile').click();
  $('#importFile').onchange = async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      if (!['cassini', 'w2k-dashboard'].includes(j.app) || !j.settings || typeof j.settings !== 'object') throw new Error('not a dashboard settings file');
      applyShared(j.settings); saveSettings(); dlg.returnValue = 'saved'; dlg.close();
      toast('Settings imported: units, alarms, source priority and dashboard layout replaced.', 'good');
    } catch (ex) { const err = $('#settingsError'); err.textContent = `Could not import that file (${ex.message}).`; err.hidden = false; }
  };
  form.addEventListener('change', (e) => { if (e.target.name === 'mode') syncMode(); });
  $('#settingsCancel').onclick = () => dlg.close();
  $('#settingsBtn').onclick = openSettings; $('#connPill').onclick = openSettings;
  $('#alertBtn').onclick = () => { show('alarms'); };
  $('#findServers').onclick = async () => {
    const list = $('#serverList'), host = form.host.value.trim();
    list.replaceChildren(h('p', { class: 'hint', text: 'Asking the gateway…' }));
    try {
      const r = await fetch(devUrl('data_server_config', host)), j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      // The output format is not in data_server_config on current firmware - it is reported per server by the routing endpoint.
      const fmt = {};
      try {
        const tx = await (await fetch(devUrl('data_routing', host, 'data_tx'))).json();
        for (const d of tx.dataTx || []) fmt[d.iname] = { id: d.outputFormat, name: ((d.outputFormats || []).find((o) => o.name === d.outputFormat) || {}).dispName || d.outputFormat };
      } catch { /* older firmware: fall back to whatever data_server_config says */ }
      const servers = (j.data_servers || []).filter((sv) => sv.visibility !== false);
      list.replaceChildren(...(servers.length ? servers.map((sv) => {
        const protoTxt = String(sv.network_protocol || sv.protocol || '?').toUpperCase(), proto = protoTxt.includes('UDP') ? 'udp' : 'tcp';
        const enabled = (sv.enable ?? sv.enabled) !== false, f0 = fmt[sv.name] || (sv.outputFormat || sv.encoding ? { id: sv.outputFormat || sv.encoding, name: sv.outputFormat || sv.encoding } : null);
        const ascii = f0 && /^N2K\s?ASCII$/i.test(f0.id);
        return h('div', 'srv', h('div', 'grow', h('strong', { text: `${sv.name ?? 'Server ' + sv.id} · ${protoTxt} ${sv.port ?? ''}` }), ' ',
          h('small', { text: [f0 ? f0.name : 'format not reported', enabled ? null : 'disabled on the gateway'].filter(Boolean).join(' · ') }),
          f0 && !ascii ? h('div', { class: 'desc', text: 'Change this server\'s output format to "N2K ASCII" on the gateway before using it here.' }) : null),
        ascii && enabled ? h('span', { class: 'chip good', text: 'Ready' }) : null,
        h('button', { class: 'btn sm', type: 'button', text: 'Use', onclick: () => { form.mode.value = proto; if (sv.port) form.port.value = sv.port; syncMode(); } }));
      }) : [h('p', { class: 'hint', text: 'The gateway reported no data servers.' })]));
    } catch (e) { list.replaceChildren(h('p', { class: 'error', text: `Could not read data servers from ${host || 'the gateway'}: ${e.message}` })); }
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#settingsError');
    const wasDirect = direct, wsHost = form.host.value.trim();
    if (form.mode.value === 'ws') {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9.\-]*$/.test(wsHost)) { err.textContent = 'Enter the gateway\'s address, for example 192.168.4.1.'; err.hidden = false; return; }
      settings.ws = { on: true, host: wsHost };
      if (!wasDirect || conn.host !== wsHost) startDirect(wsHost);
    } else {
      try {
        const r = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: form.mode.value, host: wsHost, port: form.port.value }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Could not apply connection settings');
      } catch (ex) { err.textContent = ex.message === 'Failed to fetch' ? 'The dashboard bridge did not answer.' : ex.message; err.hidden = false; return; }
      if (settings.ws) settings.ws.on = false;
      if (wasDirect) stopDirect();
    }
    for (const k of ['speed', 'depth', 'temp', 'pressure', 'volume', 'depthRef', 'theme']) settings[k] = form[k].value;
    settings.brightness = +form.brightness.value;
    const tileUrl = form.tileUrl.value.trim();
    if (tileUrl && !/^https:\/\/.+\{z\}.+\{x\}.+\{y\}/.test(tileUrl)) { err.textContent = 'The map tile address must start with https:// and contain {z}, {x} and {y}.'; err.hidden = false; return; }
    settings.tiles = tileUrl ? { url: tileUrl, attribution: form.tileAttr.value.trim() } : {};
    const connChanged = wasDirect !== direct || opened.mode !== form.mode.value || opened.host !== form.host.value || String(opened.port) !== String(form.port.value);
    saveSettings(); applyTheme(); dlg.returnValue = 'saved'; dlg.close(); buildPages();   // rebuild so unit labels and alarm thresholds follow the new units
    if (connChanged) watchConnection(); else toast('Settings saved.', 'good', 3000);
  });
  $('#alarmAck').onclick = () => { alerts().forEach((x) => acked.add(alKey(x))); alertAt = 0; render(); };
  $('#alarmView').onclick = () => show('alarms');
  // shared settings: take the bridge's copy if it has one, otherwise seed it from this browser
  fetch('/api/prefs').then((r) => r.json()).then((j) => { if (j.prefs) applyShared(j.prefs); else if (hadLocal) pushShared(); }).catch(() => {});

  // Logo: exported SVGs often sit on a large empty artboard, so the viewBox is cropped to the artwork's real bounding box.
  // The logo is dark purple, which disappears on the dark theme, so there it is recoloured: purple -> pale lavender,
  // and its white highlights -> the background colour, so they still read as cut-outs.
  const LOGO_DARK = [[/#3b0a91/gi, '#d9ccff'], [/#fff(?:fff)?\b/gi, '#181530']];
  let logoSvg = null;
  function paintLogo() {
    const img = $('.logo'); if (!img || !logoSvg) return;
    let src = logoSvg;
    if (document.documentElement.dataset.theme === 'dark') for (const [from, to] of LOGO_DARK) src = src.replace(from, to);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
  }
  (async () => {
    const img = $('.logo'); if (!img) return;
    try {
      const r = await fetch(img.getAttribute('src')); if (!r.ok) return;
      const svg = new DOMParser().parseFromString(await r.text(), 'image/svg+xml').documentElement;
      if (svg.nodeName !== 'svg') return;
      const probe = document.importNode(svg, true);
      probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden';
      document.body.append(probe);
      const bb = probe.getBBox(); probe.remove();
      if (bb.width > 0 && bb.height > 0) {
        const pad = bb.height * 0.04;
        svg.setAttribute('viewBox', `${bb.x - pad} ${bb.y - pad} ${bb.width + 2 * pad} ${bb.height + 2 * pad}`);
        svg.removeAttribute('width'); svg.removeAttribute('height');
      }
      logoSvg = new XMLSerializer().serializeToString(svg);
      paintLogo();
    } catch { /* keep the file as supplied */ }
  })();
  window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (PAGES[id] && id !== active) show(id); });
  applyTheme();
  buildPages();
  connect();
  if (settings.ws && settings.ws.on && settings.ws.host) startDirect(settings.ws.host);
  else if (standalone) openSettings();
})();
