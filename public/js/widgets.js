/* Cassini - Instrument widgets: arc gauge, compass, wind dial and history charts.
 * Part of the browser application: the files in js/ are plain scripts that share one scope and are loaded in the
 * order listed in index.html (see the README, "How the code is organised"). */
'use strict';

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
