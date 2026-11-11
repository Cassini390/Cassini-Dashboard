/* Cassini - Ready-made instruments built from the widgets: tank rows, engine and battery gauges, history chart boxes, custom names.
 * Part of the browser application: the files in js/ are plain scripts that share one scope and are loaded in the
 * order listed in index.html (see the README, "How the code is organised"). */
'use strict';

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
