/* Cassini - Gateway status read from the W2K-2 REST API.
 * Part of the browser application: the files in js/ are plain scripts that share one scope and are loaded in the
 * order listed in index.html (see the README, "How the code is organised"). */
'use strict';

// ---- gateway status (W2K-2 REST API via the bridge proxy, read-only)
let device = { about: null, info: null, wifi: null, error: null }, boatAsked = false;
/** gateway REST URL: through the bridge's proxy, or straight to the gateway (it allows cross-origin requests) when there is no bridge */
const devUrl = (ep, host, q) => {   // q: an object name (string) or query parameters, e.g. { method: 'fileList', folder: 'EBL000003' }
  const qs = new URLSearchParams(typeof q === 'string' ? { object: q } : q || {});
  if (standalone) return `http://${host}/api/${ep}${[...qs].length ? `?${qs}` : ''}`;
  qs.set('host', host);
  return `/api/device/${ep}?${qs}`;
};
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

// ---- gateway log files: the EBL logs the W2K-2 writes to its SD card. Listed and downloaded read-only; nothing on the gateway is changed.
const fBytes = (n) => (n == null ? '—' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} kB` : `${(n / 1048576).toFixed(1)} MB`);
function logsCard() {
  const status = h('small'), folders = h('div', { class: 'ranges', role: 'group', 'aria-label': 'Log folder' }), body = h('tbody'), note = h('p', 'hint');
  const table = h('div', 'tbl-wrap', h('table', null, h('thead', null, h('tr', null, ['File', 'Written', 'Size', ''].map((x, i) => h('th', { class: i === 2 ? 'num' : null, text: x })))), body));
  let key = null, folder = null, seq = 0;
  const getJ = async (ep, q) => { const r = await fetch(devUrl(ep, conn.host, q)); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; };
  const clear = (msg) => { status.textContent = ''; folders.replaceChildren(); body.replaceChildren(); table.hidden = true; note.textContent = msg; };
  async function load(pick) {
    const my = ++seq;
    if (pick) folder = pick;
    if (conn.mode === 'sim' || !conn.host) return clear('Connect to a W2K-2 in Settings to list and download the log files on its SD card.');
    if (!direct && !bridgeUp) return clear('The dashboard bridge is not reachable.');
    note.textContent = 'Reading the gateway\u2019s log list\u2026';
    try {
      const [list, st, pa] = await Promise.all([getJ('data_logs'), getJ('data_logs', { method: 'stats' }).catch(() => null), standalone ? getJ('paths').catch(() => null) : null]);
      if (my !== seq) return;
      const names = (list.dataFolders || []).map((f) => f.name).filter((x) => /^EBL\d+$/.test(x));
      const stats = (st && st.dataFolders) || null, base = ((pa && pa.paths) || []).find((x) => x.name === 'ebl_logs');
      const current = stats ? names.find((x) => +x.slice(3) === stats.currentFolderIndex) : null;
      if (!names.includes(folder)) folder = current || names[names.length - 1] || null;
      status.textContent = stats ? `Logging ${stats.logging ? 'on' : stats.enabled ? 'enabled, not writing' : 'off'} · ${(stats.messagesLogged || 0).toLocaleString()} messages since the gateway started` : '';
      folders.replaceChildren(...names.map((x) => h('button', { type: 'button', text: x === current ? `${x} (current)` : x, 'aria-pressed': String(x === folder), onclick: () => load(x) })));
      if (!folder) return clear('There are no log folders on the gateway\u2019s SD card yet.');
      const files = ((await getJ('data_logs', { method: 'fileList', folder })).dataFiles || []).filter((f) => /^[\w-]+\.ebl$/.test(f.file_name));
      if (my !== seq) return;
      const url = (f) => (standalone ? (base ? `http://${conn.host}/api/download?file_name=${base.path}/${folder}/${f}` : null) : `/api/device-file?host=${encodeURIComponent(conn.host)}&folder=${folder}&file=${f}`);
      const writing = (f) => { const m = /_(\d+)\.ebl$/.exec(f); return !!(stats && stats.logging && folder === current && m && +m[1] === stats.currentFileIndex); };
      body.replaceChildren(...files.slice().reverse().map((f) => { const w = writing(f.file_name), u = url(f.file_name); return h('tr', null,
        h('td', 'mono', f.file_name, w ? h('span', { class: 'chip good', style: 'margin-left:10px', text: 'being written' }) : null),
        h('td', { text: f.file_time ? new Date(f.file_time * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—' }),
        h('td', { class: 'num', text: fBytes(f.file_size) }),
        h('td', 'num', u ? h('a', { class: 'btn sm', href: u, download: f.file_name, text: w ? 'Download so far' : 'Download', 'aria-label': `Download ${f.file_name}` }) : null)); }));
      table.hidden = !files.length;
      note.textContent = files.length ? `${files.length} files, ${fBytes(files.reduce((a, f) => a + (f.file_size || 0), 0))} in ${folder}, newest first${files.length >= 101 ? ' (the gateway lists at most 101 files per folder)' : ''}. The files are in Actisense EBL format: open them with Actisense EBL Reader or Toolkit.` : `${folder} is empty.`;
    } catch (e) {
      if (my !== seq) return;
      clear(/501/.test(e.message) ? 'This gateway does not have data logging (no SD card, or not supported on this model).' : `Could not read the gateway\u2019s log list (${e.message || e}). Live data is unaffected.`);
    }
  }
  reg(() => { const k = `${conn.mode}|${conn.host}|${direct || bridgeUp}`; if (k !== key) { key = k; load(); } });
  return card(['Gateway logs', h('span', 'h-tools', status, h('button', { class: 'btn sm', type: 'button', text: 'Refresh', onclick: () => load() }))], 'c12', folders, table, note);
}
