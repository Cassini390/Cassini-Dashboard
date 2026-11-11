/* Cassini - Data connection: bridge event stream, direct WebSocket source, header status and periodic work.
 * Part of the browser application: the files in js/ are plain scripts that share one scope and are loaded in the
 * order listed in index.html (see the README, "How the code is organised"). */
'use strict';

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
