/* Cassini - Gateway status read from the W2K-2 REST API.
 * Part of the browser application: the files in js/ are plain scripts that share one scope and are loaded in the
 * order listed in index.html (see the README, "How the code is organised"). */
'use strict';

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
