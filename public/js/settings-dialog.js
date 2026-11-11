/* Cassini - The Settings dialog: connection, display, export/import, clear data.
 * Part of the browser application: the files in js/ are plain scripts that share one scope and are loaded in the
 * order listed in index.html (see the README, "How the code is organised"). */
'use strict';

// settings dialog
const dlg = $('#settings'), form = $('#settingsForm');
function syncMode() {
  const mode = form.mode.value;
  $('#netRow').style.display = mode === 'sim' ? 'none' : '';
  form.port.parentElement.style.display = mode === 'ws' ? 'none' : '';
  $('#findServers').parentElement.style.display = mode === 'sim' ? 'none' : '';
  $('#findServers').style.display = mode === 'ws' ? 'none' : '';
  $('#modeHint').textContent = mode === 'ws' ? 'This browser connects straight to the W2K-2\'s built-in WebSocket. No data server needs setting up on the gateway and no bridge program is involved. Each device viewing the dashboard makes its own connection.'
    : mode === 'tcp' ? 'The bridge connects to a TCP data server on the W2K-2. Set that server\'s output format to "N2K ASCII" in the gateway\'s web interface.'
    : mode === 'udp' ? 'The bridge listens on this UDP port for data the W2K-2 broadcasts. Set that server\'s output format to "N2K ASCII". The address is only used to read gateway status.'
    : 'A built-in simulator generates realistic N2K ASCII data for a twin-engine vessel - useful for demos with no gateway attached.';
}
async function openSettings() {
  try { const j = await (await fetch('/api/config')).json(); form.mode.value = j.config.mode; form.host.value = j.config.host || ''; form.port.value = j.config.port || ''; } catch { /* no bridge */ }
  if (direct || standalone) { form.mode.value = 'ws'; if (settings.ws && settings.ws.host) form.host.value = settings.ws.host; }
  for (const r of form.mode) if (r.value !== 'ws') r.disabled = standalone;   // TCP, UDP and demo data need the bridge program
  for (const k of ['speed', 'depth', 'temp', 'pressure', 'volume', 'depthRef', 'theme', 'brightness']) form[k].value = settings[k];
  $('#brightVal').textContent = `${settings.brightness}%`;
  form.tileUrl.value = (settings.tiles && settings.tiles.url) || ''; form.tileAttr.value = (settings.tiles && settings.tiles.attribution) || '';
  $('#settingsError').hidden = true; $('#serverList').replaceChildren(); $('#testResult').hidden = true; syncMode();
  opened = { mode: form.mode.value, host: form.host.value, port: form.port.value, theme: settings.theme, brightness: settings.brightness };
  if (!dlg.open) dlg.showModal();
}
let opened = {};
form.brightness.addEventListener('input', () => { settings.brightness = +form.brightness.value; $('#brightVal').textContent = `${settings.brightness}%`; applyTheme(); });   // live preview
form.theme.addEventListener('change', () => { settings.theme = form.theme.value; applyTheme(); });
dlg.addEventListener('close', () => { if (dlg.returnValue !== 'saved') { settings.theme = opened.theme; settings.brightness = opened.brightness; applyTheme(); } dlg.returnValue = ''; });
/** try the gateway's WebSocket for up to 4 s */
const testWebSocket = (host) => new Promise((resolve) => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.\-]*$/.test(host)) return resolve({ ok: false, message: 'Enter the gateway\'s address first, for example 192.168.4.1.' });
  let sock, wasOpen = false, done = false;
  const fin = (ok, message) => { if (done) return; done = true; clearTimeout(tm); try { sock.close(); } catch { /* closed */ } resolve({ ok, message }); };
  const tm = setTimeout(() => fin(false, wasOpen ? `Connected to ${host}, but no NMEA 2000 data arrived within 4 seconds. Check the NMEA 2000 network is powered.` : `No answer from ${host} within 4 seconds. Check the address, and that this device is on the same network as the gateway.`), 4000);
  try { sock = new WebSocket(`ws://${host}/api/websocket`); } catch { return fin(false, 'That address is not valid.'); }
  sock.onopen = () => { wasOpen = true; sock.send(JSON.stringify({ t: 'ws_init', c: { subscriptions: [{ name: 'data', enabled: 'true' }] } })); };
  sock.onmessage = (e) => { try { const m = JSON.parse(e.data); if (m.t === 'data' && N2K.parseLine(m.c.m[0])) fin(true, `Success - receiving NMEA 2000 data from ${host} over WebSocket.`); } catch { /* ignore */ } };
  sock.onerror = () => { if (!wasOpen) fin(false, `Could not open a WebSocket to ${host}. Check the address, and that this device is on the same network as the gateway.`); };
});
$('#testConn').onclick = async () => {
  const out = $('#testResult'), btn = $('#testConn');
  out.className = 'test-result'; out.textContent = 'Testing… (up to 4 seconds)'; out.hidden = false; btn.disabled = true;
  try {
    const j = form.mode.value === 'ws' ? await testWebSocket(form.host.value.trim())
      : await (await fetch('/api/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: form.mode.value, host: form.host.value.trim(), port: form.port.value }) })).json();
    out.className = 'test-result ' + (j.ok ? 'good' : 'bad'); out.textContent = j.message;
  } catch { out.className = 'test-result bad'; out.textContent = 'The dashboard bridge did not answer - is server.js still running?'; }
  btn.disabled = false;
};
// "Clear all data": asks for a second click, then wipes this browser's data and the bridge's stored history
{ const btn = $('#clearDataBtn'), label = btn.textContent; let armed = 0;
  const disarm = () => { clearTimeout(armed); armed = 0; btn.textContent = label; btn.classList.remove('danger'); };
  btn.onclick = async () => {
    if (!armed) { btn.textContent = 'Click again to clear'; btn.classList.add('danger'); armed = setTimeout(disarm, 5000); return; }
    disarm(); wipeData();
    let stored = standalone;
    if (!standalone) try { stored = (await fetch('/api/clear', { method: 'POST' })).ok; } catch { stored = false; }
    toast(stored ? 'All received data cleared.' : 'Live data cleared here, but the dashboard bridge did not answer, so its stored history was not cleared.', stored ? 'good' : 'warn');
  }; }
$('#exportBtn').onclick = () => {
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify({ app: 'cassini', version: 1, settings: sharedSettings() }, null, 2)], { type: 'application/json' })), download: 'cassini-settings.json' });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('#importBtn').onclick = () => $('#importFile').click();
$('#importFile').onchange = async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    const j = JSON.parse(await file.text());
    if (!['cassini', 'w2k-dashboard'].includes(j.app) || !j.settings || typeof j.settings !== 'object') throw new Error('not a dashboard settings file');
    applyShared(j.settings); saveSettings(); dlg.returnValue = 'saved'; dlg.close();
    toast('Settings imported: units, alarms, source priority and dashboard layout replaced.', 'good');
  } catch (ex) { const err = $('#settingsError'); err.textContent = `Could not import that file (${ex.message}).`; err.hidden = false; }
};
form.addEventListener('change', (e) => { if (e.target.name === 'mode') syncMode(); });
$('#settingsCancel').onclick = () => dlg.close();
$('#settingsBtn').onclick = openSettings; $('#connPill').onclick = openSettings;
$('#alertBtn').onclick = () => { show('alarms'); };
$('#findServers').onclick = async () => {
  const list = $('#serverList'), host = form.host.value.trim();
  list.replaceChildren(h('p', { class: 'hint', text: 'Asking the gateway…' }));
  try {
    const r = await fetch(devUrl('data_server_config', host)), j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    // The output format is not in data_server_config on current firmware - it is reported per server by the routing endpoint.
    const fmt = {};
    try {
      const tx = await (await fetch(devUrl('data_routing', host, 'data_tx'))).json();
      for (const d of tx.dataTx || []) fmt[d.iname] = { id: d.outputFormat, name: ((d.outputFormats || []).find((o) => o.name === d.outputFormat) || {}).dispName || d.outputFormat };
    } catch { /* older firmware: fall back to whatever data_server_config says */ }
    const servers = (j.data_servers || []).filter((sv) => sv.visibility !== false);
    list.replaceChildren(...(servers.length ? servers.map((sv) => {
      const protoTxt = String(sv.network_protocol || sv.protocol || '?').toUpperCase(), proto = protoTxt.includes('UDP') ? 'udp' : 'tcp';
      const enabled = (sv.enable ?? sv.enabled) !== false, f0 = fmt[sv.name] || (sv.outputFormat || sv.encoding ? { id: sv.outputFormat || sv.encoding, name: sv.outputFormat || sv.encoding } : null);
      const ascii = f0 && /^N2K\s?ASCII$/i.test(f0.id);
      return h('div', 'srv', h('div', 'grow', h('strong', { text: `${sv.name ?? 'Server ' + sv.id} · ${protoTxt} ${sv.port ?? ''}` }), ' ',
        h('small', { text: [f0 ? f0.name : 'format not reported', enabled ? null : 'disabled on the gateway'].filter(Boolean).join(' · ') }),
        f0 && !ascii ? h('div', { class: 'desc', text: 'Change this server\'s output format to "N2K ASCII" on the gateway before using it here.' }) : null),
      ascii && enabled ? h('span', { class: 'chip good', text: 'Ready' }) : null,
      h('button', { class: 'btn sm', type: 'button', text: 'Use', onclick: () => { form.mode.value = proto; if (sv.port) form.port.value = sv.port; syncMode(); } }));
    }) : [h('p', { class: 'hint', text: 'The gateway reported no data servers.' })]));
  } catch (e) { list.replaceChildren(h('p', { class: 'error', text: `Could not read data servers from ${host || 'the gateway'}: ${e.message}` })); }
};
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#settingsError');
  const wasDirect = direct, wsHost = form.host.value.trim();
  if (form.mode.value === 'ws') {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.\-]*$/.test(wsHost)) { err.textContent = 'Enter the gateway\'s address, for example 192.168.4.1.'; err.hidden = false; return; }
    settings.ws = { on: true, host: wsHost };
    if (!wasDirect || conn.host !== wsHost) startDirect(wsHost);
  } else {
    try {
      const r = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: form.mode.value, host: wsHost, port: form.port.value }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not apply connection settings');
    } catch (ex) { err.textContent = ex.message === 'Failed to fetch' ? 'The dashboard bridge did not answer.' : ex.message; err.hidden = false; return; }
    if (settings.ws) settings.ws.on = false;
    if (wasDirect) stopDirect();
  }
  for (const k of ['speed', 'depth', 'temp', 'pressure', 'volume', 'depthRef', 'theme']) settings[k] = form[k].value;
  settings.brightness = +form.brightness.value;
  const tileUrl = form.tileUrl.value.trim();
  if (tileUrl && !/^https:\/\/.+\{z\}.+\{x\}.+\{y\}/.test(tileUrl)) { err.textContent = 'The map tile address must start with https:// and contain {z}, {x} and {y}.'; err.hidden = false; return; }
  settings.tiles = tileUrl ? { url: tileUrl, attribution: form.tileAttr.value.trim() } : {};
  const connChanged = wasDirect !== direct || opened.mode !== form.mode.value || opened.host !== form.host.value || String(opened.port) !== String(form.port.value);
  saveSettings(); applyTheme(); dlg.returnValue = 'saved'; dlg.close(); buildPages();   // rebuild so unit labels and alarm thresholds follow the new units
  if (connChanged) watchConnection(); else toast('Settings saved.', 'good', 3000);
});
$('#alarmAck').onclick = () => { alerts().forEach((x) => acked.add(alKey(x))); alertAt = 0; render(); };
$('#alarmView').onclick = () => show('alarms');
// shared settings: take the bridge's copy if it has one, otherwise seed it from this browser
fetch('/api/prefs').then((r) => r.json()).then((j) => { if (j.prefs) applyShared(j.prefs); else if (hadLocal) pushShared(); }).catch(() => {});
