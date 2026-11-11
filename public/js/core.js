/* Cassini - DOM helpers, settings (shared and per-device) and unit conversion.
 * Part of the browser application: the files in js/ are plain scripts that share one scope and are loaded in the
 * order listed in index.html (see the README, "How the code is organised"). */
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
