/* Cassini - My Dashboard: the customisable panel grid.
 * Part of the browser application: the files in js/ are plain scripts that share one scope and are loaded in the
 * order listed in index.html (see the README, "How the code is organised"). */
'use strict';

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
// Panel types: name(arg), default size in "coarse" cells (12 columns wide, ~84 px rows; doubled when a panel is created, because the
// grid itself is 24 columns of ~42 px rows so panels can be sized in half steps), build(arg). list:true = scrolling list content.
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
  history: { name: (a) => (HISTORY[a] || ['History'])[0], w: 4, h: 3, build: (a) => { const d = HISTORY[a]; return d ? [big(() => f(d[2](d[5]()), 1), d[3], 'md'), spark(d[1], d[2], 1, { ...d[4], unit: d[3] })] : h('div', { class: 'empty', text: 'Unknown history' }); } },
  khist: { name: (a) => histTitle(a), w: 4, h: 3, build: (a) => { const sp = histSpec(a); return [big(() => f(sp.show(get(a)), sp.digits), sp.unit, 'md'), spark(a, sp.show, sp.digits, { ...sp.o, unit: sp.unit })]; } },
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
const newPanel = (type, arg) => ({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type, arg, w: PANELS[type].w * 2, h: PANELS[type].h * 2 });
const COLS = 24, MIN_W = 4, MIN_H = 2, MAX_H = 20;
/** the engine, battery or tank a panel shows, if any: { key: 'bat.0', what: 'battery', def: 'Battery 1' } */
function panelSubject(p) {
  const k = p.type === 'khist' ? String(p.arg).split('.').slice(0, 2).join('.') : { engRpm: 'eng', engCool: 'eng', engOil: 'eng', batV: 'bat', tank: 'tank' }[p.type] ? `${{ engRpm: 'eng', engCool: 'eng', engOil: 'eng', batV: 'bat', tank: 'tank' }[p.type]}.${p.arg}` : null;
  if (!k) return null;
  const [kind, id] = k.split('.');
  if (kind === 'eng') return { key: k, what: 'engine', def: defEngName(id, ids('eng')) };
  if (kind === 'bat') return { key: k, what: 'battery', def: defBatName(id) };
  if (kind === 'tank') return { key: k, what: 'tank', def: defTankName(id, ids('tank')) };
  return null;
}
/** ✎ on a panel: its title, and for an engine, battery or tank panel also that item's name (used on every page) */
function openRename(p, def) {
  const subj = panelSubject(p);
  let dlg = $('#renamePanel');
  if (!dlg) { dlg = h('dialog', { id: 'renamePanel' }); document.body.append(dlg); applyTheme(); }
  const nameIn = subj ? h('input', { type: 'text', maxlength: 24, value: (settings.names && settings.names[subj.key]) || '', placeholder: subj.def, 'aria-label': `Name of this ${subj.what}` }) : null;
  const titleIn = h('input', { type: 'text', maxlength: 40, value: p.title || '', placeholder: 'Automatic', 'aria-label': 'Panel title' });
  const form = h('form', { method: 'dialog' }, h('h2', { text: subj ? `Rename ${subj.what}` : 'Rename panel' }),
    subj ? h('label', 'stack-label', `Name of this ${subj.what}`, nameIn, h('span', { class: 'hint', text: `Shown on every page and every device. Leave empty for "${subj.def}". The same names are on the Sources page.` })) : null,
    h('label', 'stack-label', subj ? 'Panel title (optional)' : 'Panel title', titleIn, h('span', { class: 'hint', text: subj ? 'Only for this panel. Leave empty to use the name above.' : `Leave empty for "${def.name(p.arg)}".` })),
    h('div', 'actions', h('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: () => dlg.close() }), h('button', { class: 'btn primary', type: 'submit', text: 'Save' })));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (subj) { const v = nameIn.value.trim(); if (v) settings.names[subj.key] = v.slice(0, 24); else delete settings.names[subj.key]; }
    const tt = titleIn.value.trim(); if (tt) p.title = tt.slice(0, 40); else delete p.title;
    saveSettings(); dlg.close(); buildPages();
  });
  dlg.replaceChildren(form); dlg.showModal(); (nameIn || titleIn).focus();
}
/** everything that can be added, grouped for the "Add panel" dialog */
function panelCatalogue() {
  const g = { Navigation: [['compass'], ['map'], ['position'], ['sog'], ['waypoint'], ['gnss'], ['attitude'], ['ais']], Wind: [['wind']], Engines: [['engines']], Electrical: [['batteries']], Tanks: [['tanks']],
    Environment: [['temps']], System: [['alarms']], 'Single values': Object.keys(METRICS).map((k) => ['value', k]), 'History graphs': Object.keys(HISTORY).map((k) => ['history', k]) };
  g.Wind.push(...['aws', 'awa', 'tws', 'twa', 'twd'].map((k) => ['value', k]));
  for (const id of ids('eng')) g.Engines.push(['engRpm', id], ['engCool', id], ['engOil', id], ['khist', `eng.${id}.rpm`], ['khist', `eng.${id}.coolT`]);
  for (const id of ids('bat')) g.Electrical.push(['batV', id], ['khist', `bat.${id}.v`], ['khist', `bat.${id}.a`], ['khist', `bat.${id}.soc`]);
  for (const id of ids('tank')) g.Tanks.push(['tank', id], ['khist', `tank.${id}.level`]);
  g.Environment.push(...['airT', 'seaT', 'baro', 'hum'].map((k) => ['value', k]));
  return g;
}
let editMode = false;
const ROW = 42, GAP = 16;

// ---- layout: every panel has a position (x, y) and size (w, h) in grid cells, 24 columns wide.
// Panels never overlap. Moving or resizing one pushes the panels in its way down, and everything floats up to close gaps
// (like Grafana or Home Assistant dashboards), so the rest of the layout stays as arranged.
const overlaps = (a, b) => a !== b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** place items in reading order, each at the first free spot from the top (used to convert old layouts that had no positions) */
function packLayout(items) {
  const placed = [];
  for (const it of items) {
    it.w = clamp(it.w || 8, MIN_W, COLS); it.h = clamp(it.h || 6, MIN_H, MAX_H);
    find: for (let y = 0; ; y++) for (let x = 0; x + it.w <= COLS; x++) { it.x = x; it.y = y; if (!placed.some((p) => overlaps(it, p))) break find; }
    placed.push(it);
  }
}
/** settle a layout: `fixed` (the panel being moved or resized) keeps its place; the others float up as far as they can and
 *  move down below anything they would overlap. The fixed panel then floats up too if there is room above it. */
function compactLayout(items, fixed) {
  const placed = fixed ? [fixed] : [];
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (it === fixed) continue;
    it.x = clamp(it.x, 0, COLS - it.w);
    while (it.y > 0 && !placed.some((p) => overlaps({ ...it, y: it.y - 1 }, p))) it.y--;
    while (placed.some((p) => overlaps(it, p))) it.y++;
    placed.push(it);
  }
  if (fixed) {
    while (fixed.y > 0 && !items.some((p) => p !== fixed && overlaps({ ...fixed, y: fixed.y - 1 }, p))) fixed.y--;
    compactLayout(items);   // and close any gap that left behind (this only ever moves panels up, so nothing new overlaps)
  }
}
const byPosition = (a, b) => a.y - b.y || a.x - b.x;

function customPage() {
  if (!Array.isArray(settings.panels)) { settings.panels = DEFAULT_PANELS.map(([ty, a]) => newPanel(ty, a)); settings.panelGrid = 2; }
  if (settings.panelGrid !== 2) {   // layouts saved before the finer grid: same sizes in half-steps
    for (const p of settings.panels) { p.w = clamp((p.w || 4) * 2, MIN_W, COLS); p.h = clamp((p.h || 3) * 2, MIN_H, MAX_H); }
    settings.panelGrid = 2; saveSettings();
  }
  settings.panels = settings.panels.filter((p) => PANELS[p.type]);
  if (settings.panels.some((p) => !Number.isInteger(p.x) || !Number.isInteger(p.y))) packLayout(settings.panels);   // older layouts: order only
  const was = JSON.stringify(settings.panels.map((p) => [p.x, p.y]));
  compactLayout(settings.panels);   // no gaps (e.g. after a panel was removed on another device)
  if (JSON.stringify(settings.panels.map((p) => [p.x, p.y])) !== was) saveSettings();
  settings.panels.sort(byPosition);   // page order = reading order (also the order panels stack in on a phone)
  const grid = h('div', 'dash' + (editMode ? ' editing' : ''));
  const els = new Map();   // panel -> its element
  const ghost = h('div', { class: 'p-ghost', 'aria-hidden': 'true' });
  const metrics = () => { const r = grid.getBoundingClientRect(); return { left: r.left, top: r.top, colW: (grid.clientWidth - (COLS - 1) * GAP) / COLS }; };
  const cellPos = (m, x, y) => ({ left: m.left + x * (m.colW + GAP), top: m.top + y * (ROW + GAP) });
  const areaKey = (p) => `${p.x},${p.y},${p.w},${p.h}`;
  const setArea = (el, p) => { el.style.gridColumn = `${p.x + 1} / span ${p.w}`; el.style.gridRow = `${p.y + 1} / span ${p.h}`; el.style.setProperty("--rows", p.h); el._area = areaKey(p); };
  /** show a layout: panels whose place changed slide there from where they are drawn now (except `skip`, the one being dragged) */
  function show(items, skip) {
    const recs = [];
    for (const it of items) { const el = els.get(it.src); if (!el || it.src === skip || el._area === areaKey(it)) continue; recs.push([el, it, el.getBoundingClientRect()]); }
    if (!recs.length) return;
    for (const [el, it] of recs) { el.style.transition = 'none'; el.style.transform = ''; setArea(el, it); }
    const now = recs.map(([el]) => el.getBoundingClientRect());
    recs.forEach(([el, , was], i) => { const dx = was.left - now[i].left, dy = was.top - now[i].top; el.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : ''; });
    void grid.offsetWidth;   // apply the starting offsets before animating them away
    for (const [el] of recs) { el.style.transition = 'transform .18s ease'; el.style.transform = ''; }
  }
  // a working copy of the layout while a panel is being dragged or resized; written back to the settings on release
  const snapshot = () => settings.panels.map((p) => ({ src: p, x: p.x, y: p.y, w: p.w, h: p.h }));
  const commit = (items) => { for (const it of items) Object.assign(it.src, { x: it.x, y: it.y, w: it.w, h: it.h }); settings.panels.sort(byPosition); saveSettings(); };
  const narrow = () => matchMedia('(max-width: 760px)').matches;   // phones: panels are stacked in one column, so there is nothing to drag into place

  for (const p of settings.panels) {
    const def = PANELS[p.type];
    const built = def.build(p.arg), body = h('div', 'panel-body' + (def.list ? ' list' : ''));
    body.append(...(built && built.controls ? [built.el] : [].concat(built)));
    const move = h('button', { class: 'p-btn p-move', type: 'button', title: 'Drag to move (or focus and use the arrow keys)', 'aria-label': 'Move panel: drag, or use the arrow keys', text: '⠿' });
    const grip = h('div', { class: 'p-resize', title: 'Drag to resize (or focus and use the arrow keys)', tabindex: 0, role: 'button', 'aria-label': 'Resize panel: drag, or use the arrow keys' });
    const head = h('h3', null, t('p-title', () => p.title || def.name(p.arg)), built && built.controls ? built.controls : null,
      h('span', 'p-edit', move,
        h('button', { class: 'p-btn', type: 'button', title: panelSubject(p) ? 'Rename' : 'Rename panel', 'aria-label': panelSubject(p) ? 'Rename' : 'Rename panel', text: '✎', onclick: () => openRename(p, def) }),
        h('button', { class: 'p-btn', type: 'button', title: 'Remove panel', 'aria-label': 'Remove panel', text: '✕', onclick: () => {
          const before = settings.panels.map((x) => ({ ...x }));
          settings.panels = settings.panels.filter((x) => x.id !== p.id); compactLayout(settings.panels); saveSettings(); buildPages();
          toast(`"${p.title || def.name(p.arg)}" removed.`, 'info', 9000, h('button', { class: 'btn sm', type: 'button', text: 'Undo', onclick: () => { settings.panels = before; saveSettings(); buildPages(); $('#toast').hidden = true; } }));
        } })));
    const el = h('section', { class: 'card panel', 'data-id': p.id }, head, body, grip);
    setArea(el, p); els.set(p, el);

    // move: drag the panel by its title bar (or ⠿). It follows the pointer; the outline shows where it will land.
    head.addEventListener('pointerdown', (e) => {
      if (!editMode || e.button !== 0 || narrow() || (e.target.closest('button, input, select, a') && !e.target.closest('.p-move'))) return;
      e.preventDefault();
      const items = snapshot(), me = items.find((it) => it.src === p), m0 = metrics(), cell = cellPos(m0, p.x, p.y);
      const grabX = e.clientX - cell.left, grabY = e.clientY - cell.top;
      let started = false, drop = { x: p.x, y: p.y };
      const onMove = (ev) => {
        if (!started) { if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return; started = true; el.classList.add('dragging'); grid.append(ghost); }
        const m = metrics();
        // where the pointer would put the panel, settled against the layout as it was before the drag
        const want = { x: clamp(Math.round((ev.clientX - grabX - m.left) / (m.colW + GAP)), 0, COLS - me.w), y: Math.max(0, Math.round((ev.clientY - grabY - m.top) / (ROW + GAP))) };
        const work = items.map((it) => ({ ...it, x: it.src.x, y: it.src.y }));
        const mine = work.find((it) => it.src === p); Object.assign(mine, want);
        compactLayout(work, mine);
        work.forEach((wk, i) => { items[i].x = wk.x; items[i].y = wk.y; });
        drop = { x: mine.x, y: mine.y };
        setArea(ghost, mine); show(items, p); setArea(el, mine);
        const c = cellPos(m, mine.x, mine.y);
        el.style.transition = 'none'; el.style.transform = `translate(${ev.clientX - grabX - c.left}px, ${ev.clientY - grabY - c.top}px)`;
      };
      const onUp = () => {
        removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onUp);
        if (!started) return;
        Object.assign(me, drop); ghost.remove(); el.classList.remove('dragging');
        el.style.transition = 'transform .18s ease'; el.style.transform = '';   // glide into place
        commit(items);
      };
      addEventListener('pointermove', onMove); addEventListener('pointerup', onUp); addEventListener('pointercancel', onUp);
    });
    // resize: drag the bottom-right corner. The panel follows the pointer; the outline shows the size it will snap to.
    grip.addEventListener('pointerdown', (e) => {
      if (!editMode || e.button !== 0 || narrow()) return;
      e.preventDefault(); e.stopPropagation();
      const items = snapshot(), me = items.find((it) => it.src === p), r0 = el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
      el.classList.add('resizing'); setArea(ghost, me); grid.append(ghost);
      const onMove = (ev) => {
        const m = metrics(), wpx = Math.max(60, r0.width + ev.clientX - x0), hpx = Math.max(60, r0.height + ev.clientY - y0);
        el.style.width = `${wpx}px`; el.style.height = `${hpx}px`;
        const w = clamp(Math.round((wpx + GAP) / (m.colW + GAP)), MIN_W, COLS - p.x), hh = clamp(Math.round((hpx + GAP) / (ROW + GAP)), MIN_H, MAX_H);
        const work = items.map((it) => ({ ...it, x: it.src.x, y: it.src.y, w: it.src === p ? w : it.src.w, h: it.src === p ? hh : it.src.h }));
        const mine = work.find((it) => it.src === p); compactLayout(work, mine);
        work.forEach((wk, i) => Object.assign(items[i], { x: wk.x, y: wk.y, w: wk.w, h: wk.h }));
        setArea(ghost, me); show(items, p); setArea(el, me);
      };
      const onUp = () => {
        removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onUp);
        el.classList.remove('resizing'); ghost.remove(); el.style.width = el.style.height = '';
        commit(items);
      };
      addEventListener('pointermove', onMove); addEventListener('pointerup', onUp); addEventListener('pointercancel', onUp);
    });
    // keyboard: arrow keys on ⠿ move the panel one cell, on the corner grip they change its size
    const nudge = (e, change) => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d) return;
      e.preventDefault();
      const items = snapshot(), me = items.find((it) => it.src === p);
      change(me, d); compactLayout(items, me); show(items); commit(items);
    };
    move.addEventListener('keydown', (e) => nudge(e, (me, [dx, dy]) => { me.x = clamp(me.x + dx, 0, COLS - me.w); me.y = Math.max(0, me.y + dy); }));
    grip.addEventListener('keydown', (e) => nudge(e, (me, [dx, dy]) => { me.w = clamp(me.w + dx, MIN_W, COLS - me.x); me.h = clamp(me.h + dy, MIN_H, MAX_H); }));
    grid.append(el);
  }
  if (!grid.children.length) grid.append(h('div', { class: 'empty dash-empty', text: 'This dashboard is empty. Choose "Edit layout", then "Add panel".' }));
  const bar = h('div', 'dash-bar',
    h('span', { class: 'hint', text: editMode ? (narrow() ? 'On a phone the panels are stacked: use ⠿ and the arrow keys, or a wider screen, to arrange them. ✕ removes a panel.'
      : 'Drag a panel by its title bar to move it, drag its bottom-right corner to resize, ✕ to remove. The layout is shared with every device.') : '' }),
    editMode ? h('button', { class: 'btn sm', type: 'button', text: 'Reset layout', onclick: () => { delete settings.panels; saveSettings(); buildPages(); } }) : null,
    editMode ? h('button', { class: 'btn sm', type: 'button', text: '+ Add panel', onclick: openAddPanel }) : null,
    h('button', { class: 'btn sm' + (editMode ? ' primary' : ''), type: 'button', text: editMode ? 'Done' : 'Edit layout', onclick: () => { editMode = !editMode; buildPages(); } }));
  return [bar, grid];
}
function openAddPanel() {
  let dlg = $('#addPanel');
  if (!dlg) { dlg = h('dialog', { id: 'addPanel' }); document.body.append(dlg); applyTheme(); }
  const add = (ty, a) => {
    const p = newPanel(ty, a); p.x = 0; p.y = settings.panels.reduce((m, q) => Math.max(m, q.y + q.h), 0);   // new panels go at the bottom
    settings.panels.push(p); saveSettings(); dlg.close(); buildPages();
    const el = $(`#page-custom .panel[data-id="${p.id}"]`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  dlg.replaceChildren(h('div', 'add-wrap', h('h2', { text: 'Add panel' }),
    Object.entries(panelCatalogue()).map(([group, items]) => h('fieldset', null, h('legend', { text: group }),
      h('div', 'add-list', items.map(([ty, a]) => h('button', { class: 'btn sm', type: 'button', text: PANELS[ty].name(a), onclick: () => add(ty, a) }))))),
    h('p', { class: 'hint', text: 'Individual engine, battery and tank panels are listed once that data is being received.' }),
    h('div', 'actions', h('button', { class: 'btn', type: 'button', text: 'Close', onclick: () => dlg.close() }))));
  dlg.showModal();
}
