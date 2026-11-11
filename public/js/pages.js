/* Cassini - The fixed pages (Overview, Navigation, Engines, Power & Tanks, Alarms, Data ...).
 * Part of the browser application: the files in js/ are plain scripts that share one scope and are loaded in the
 * order listed in index.html (see the README, "How the code is organised"). */
'use strict';

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
