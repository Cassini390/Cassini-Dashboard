/* Cassini - Live value store: staleness, source arbitration, derived values and instance names.
 * Part of the browser application: the files in js/ are plain scripts that share one scope and are loaded in the
 * order listed in index.html (see the README, "How the code is organised"). */
'use strict';

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
