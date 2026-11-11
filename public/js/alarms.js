/* Cassini - Alarms: definitions, evaluation, acknowledgement and the audible alert.
 * Part of the browser application: the files in js/ are plain scripts that share one scope and are loaded in the
 * order listed in index.html (see the README, "How the code is organised"). */
'use strict';

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
