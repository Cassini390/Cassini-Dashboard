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
function customPage() {
  if (!Array.isArray(settings.panels)) { settings.panels = DEFAULT_PANELS.map(([ty, a]) => newPanel(ty, a)); settings.panelGrid = 2; }
  if (settings.panelGrid !== 2) {   // layouts saved before the finer grid: same sizes in half-steps
    for (const p of settings.panels) { p.w = clamp((p.w || 4) * 2, MIN_W, COLS); p.h = clamp((p.h || 3) * 2, MIN_H, MAX_H); }
    settings.panelGrid = 2; saveSettings();
  }
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
          h('button', { class: 'p-btn', type: 'button', title: panelSubject(p) ? 'Rename' : 'Rename panel', 'aria-label': panelSubject(p) ? 'Rename' : 'Rename panel', text: '✎', onclick: () => openRename(p, def) }),
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
      // listen on the window, not the handle: moving the panel in the page ends the browser's pointer capture on the handle,
      // so the handle would never hear the release and the new order would not be saved
      const onUp = () => { removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onUp); el.classList.remove('dragging'); saveOrder(); };
      addEventListener('pointermove', onMove); addEventListener('pointerup', onUp); addEventListener('pointercancel', onUp);
    });
    // resize: drag the corner grip; snaps to the grid
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault(); grip.setPointerCapture(e.pointerId); el.classList.add('resizing');
      const x0 = e.clientX, y0 = e.clientY, w0 = p.w, h0 = p.h, colW = (grid.clientWidth - (COLS - 1) * GAP) / COLS;
      const onMove = (ev) => {
        p.w = clamp(Math.round(w0 + (ev.clientX - x0) / (colW + GAP)), MIN_W, COLS); p.h = clamp(Math.round(h0 + (ev.clientY - y0) / (ROW + GAP)), MIN_H, MAX_H);
        el.style.gridColumn = `span ${p.w}`; el.style.gridRow = `span ${p.h}`;
      };
      const onUp = () => { removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onUp); el.classList.remove('resizing'); saveSettings(); };
      addEventListener('pointermove', onMove); addEventListener('pointerup', onUp); addEventListener('pointercancel', onUp);
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
      p.w = clamp(p.w + d[0], MIN_W, COLS); p.h = clamp(p.h + d[1], MIN_H, MAX_H);
      el.style.gridColumn = `span ${p.w}`; el.style.gridRow = `span ${p.h}`; saveSettings();
    });
    grid.append(el);
  }
  if (!grid.children.length) grid.append(h('div', { class: 'empty dash-empty', text: 'This dashboard is empty. Choose "Edit layout", then "Add panel".' }));
  const bar = h('div', 'dash-bar',
    h('span', { class: 'hint', text: editMode ? 'Drag ⠿ to move a panel, drag its bottom-right corner to resize, ✕ to remove. The layout is shared with every device.' : '' }),
    editMode ? h('button', { class: 'btn sm', type: 'button', text: 'Reset layout', onclick: () => { delete settings.panels; saveSettings(); buildPages(); } }) : null,
    editMode ? h('button', { class: 'btn sm', type: 'button', text: '+ Add panel', onclick: openAddPanel }) : null,
    h('button', { class: 'btn sm' + (editMode ? ' primary' : ''), type: 'button', text: editMode ? 'Done' : 'Edit layout', onclick: () => { if (editMode && grid.querySelector('.panel')) saveOrder(); editMode = !editMode; buildPages(); } }));   // Done keeps the order as shown
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
