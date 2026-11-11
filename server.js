#!/usr/bin/env node
/*
 * Cassini bridge (NMEA 2000 dashboard for the Actisense W2K-2)
 * ----------------------
 * Browsers cannot open raw TCP or UDP sockets, so this small zero-dependency
 * Node server does it for them:
 *
 *   W2K-2 data server (TCP or UDP, "N2K ASCII" format)
 *        -> this bridge -> Server-Sent Events (/events) -> dashboard in the browser
 *
 * It also serves the dashboard files and proxies a few read-only W2K-2 REST
 * endpoints (GET only) so the page can show gateway status without CORS issues.
 *
 * Usage:  node server.js [--port 8642] [--lan]
 *   --lan   listen on all interfaces so tablets/phones on the boat network can view it
 */
'use strict';
const http = require('http');
const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const { Simulator } = require('./sim');
const N2K = require('./public/n2k.js');
const { History } = require('./history');

const args = process.argv.slice(2);
const argVal = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const HTTP_PORT = parseInt(argVal('--port', process.env.PORT || '8642'), 10);
const BIND = args.includes('--lan') ? '0.0.0.0' : '127.0.0.1';
// When built as a single executable (node build.js --exe) the dashboard files are embedded in the program
// and settings are kept next to the .exe.
let sea = null;
try { const s = require('node:sea'); if (s.isSea()) sea = s; } catch { /* plain Node.js */ }
const BASE = sea ? path.dirname(process.execPath) : __dirname;
const PUBLIC = path.join(__dirname, 'public');
const CONFIG_FILE = path.join(BASE, 'config.json');
const HOST_RE = /^[a-zA-Z0-9]([a-zA-Z0-9.\-]{0,253})$/;

// ---------------------------------------------------------------- config
let config = { mode: 'sim', host: '192.168.4.1', port: 60002 };
const DEMO = args.includes('--demo');   // always start on the simulator and never touch config.json
if (!DEMO) { try { Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))); } catch { /* first run */ } }

function validateConfig(c) {
  const mode = ['sim', 'tcp', 'udp'].includes(c.mode) ? c.mode : null;
  const port = parseInt(c.port, 10);
  const host = String(c.host || '').trim();
  if (!mode) return 'mode must be sim, tcp or udp';
  if (mode !== 'sim' && !(port > 0 && port < 65536)) return 'port must be 1-65535';
  if (mode === 'tcp' && !HOST_RE.test(host)) return 'a valid host name or IP address is required for TCP';
  if (host && !HOST_RE.test(host)) return 'invalid host';
  return { mode, host, port: port || config.port };
}

// ---------------------------------------------------------------- SSE clients
const clients = new Set();
let pending = [];
const status = { mode: config.mode, state: 'idle', detail: '', lines: 0, rate: 0, lastData: 0 };
let rateCount = 0;

function sendEvent(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function broadcast(event, data) { for (const c of clients) sendEvent(c, event, data); }
function setStatus(state, detail = '') {
  status.mode = config.mode; status.state = state; status.detail = detail;
  broadcast('status', publicStatus());
  console.log(`[${config.mode}] ${state}${detail ? ' - ' + detail : ''}`);
}
function publicStatus() { return { ...status, host: config.host, port: config.port }; }

function onLine(line) {
  line = line.trim();
  if (!line) return;
  history.ingest(line);
  status.lines++; rateCount++; status.lastData = Date.now();
  if (pending.length < 5000) pending.push(line);
}
setInterval(() => { // flush ~10x/s
  if (!pending.length) return;
  const batch = pending; pending = [];
  if (clients.size) broadcast('n2k', batch);
}, 100);
setInterval(() => { status.rate = rateCount; rateCount = 0; broadcast('status', publicStatus()); }, 1000);

// ---------------------------------------------------------------- data sources
let stopSource = () => {};

function startSource() {
  stopSource();
  history.setSource(config.mode === 'sim' ? 'sim' : `${config.mode}|${config.host}|${config.port}`);   // new source = new history
  pending = [];
  if (config.mode === 'tcp') stopSource = startTcp();
  else if (config.mode === 'udp') stopSource = startUdp();
  else stopSource = startSim();
}

function startSim() {
  const sim = new Simulator(onLine);
  sim.start();
  setStatus('simulating', 'Demo data (built-in simulator)');
  return () => sim.stop();
}

function startTcp() {
  let sock = null, timer = null, stopped = false, buf = '';
  const connect = () => {
    if (stopped) return;
    buf = '';
    setStatus('connecting', `${config.host}:${config.port}`);
    sock = net.connect({ host: config.host, port: config.port });
    sock.setEncoding('latin1');
    sock.setKeepAlive(true, 5000);
    sock.setTimeout(15000);
    sock.on('connect', () => setStatus('connected', `TCP ${config.host}:${config.port}`));
    sock.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
      if (buf.length > 8192) buf = '';
    });
    sock.on('timeout', () => { setStatus('error', 'No data for 15 s - reconnecting'); sock.destroy(); });
    sock.on('error', (e) => setStatus('error', e.code || e.message));
    sock.on('close', () => { if (!stopped) timer = setTimeout(connect, 3000); });
  };
  connect();
  return () => { stopped = true; clearTimeout(timer); if (sock) sock.destroy(); };
}

function startUdp() {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let announced = false;
  sock.on('error', (e) => setStatus('error', e.code || e.message));
  sock.on('message', (msg, rinfo) => {
    if (!announced) { announced = true; setStatus('connected', `UDP port ${config.port}, receiving from ${rinfo.address}`); }
    for (const l of msg.toString('latin1').split('\n')) onLine(l);
  });
  sock.bind(config.port, () => {
    try { sock.setBroadcast(true); } catch { /* ignore */ }
    setStatus('listening', `UDP port ${config.port} - waiting for data`);
  });
  return () => { try { sock.close(); } catch { /* already closed */ } };
}

// ---------------------------------------------------------------- connection test (Settings > Test connection)
const N2K_LINE = /^A\d{6}\.\d{3} [0-9A-F]{5} [0-9A-F]{5} (?:[0-9A-F]{2})*$/i;
function testConnection(c) {
  return new Promise((resolve) => {
    let done = false, connected = false, sock = null, buf = '';
    const where = c.mode === 'tcp' ? `${c.host}:${c.port}` : `UDP port ${c.port}`;
    const fin = (ok, message) => { if (done) return; done = true; clearTimeout(timer); try { c.mode === 'tcp' ? sock.destroy() : sock.close(); } catch { /* closed */ } resolve({ ok, message }); };
    const judge = (line) => {
      line = line.trim();
      if (N2K_LINE.test(line)) return fin(true, `Success - receiving N2K ASCII data from ${where}.`);
      const shown = /^[\x20-\x7e]+$/.test(line) ? `"${line.slice(0, 40)}"` : 'binary data';
      fin(false, `Connected to ${where}, but the data is not N2K ASCII (received ${shown}). Set this data server's format to N2K ASCII in the gateway's web interface.`);
    };
    const timer = setTimeout(() => fin(false, c.mode === 'udp' ? `No data arrived on UDP port ${c.port} within 4 seconds. Check the port number and that the gateway's UDP data server is enabled.`
      : connected ? `Connected to ${where}, but no data arrived within 4 seconds. Check the NMEA 2000 network is powered and the data server is enabled.`
        : `No answer from ${where} within 4 seconds. Check the address, and that this computer is on the same network as the gateway.`), 4000);
    const fail = (e) => fin(false, e.code === 'ECONNREFUSED' ? `${where} refused the connection - the address is reachable but nothing is listening on that port. Check the port number.`
      : e.code === 'ENOTFOUND' ? `The name "${c.host}" could not be found. Check the address.`
        : e.code === 'EADDRINUSE' ? `UDP port ${c.port} is already in use by another program on this computer.`
          : ['EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT'].includes(e.code) ? `${where} cannot be reached. Check this computer is on the same network as the gateway.` : `Could not connect to ${where} (${e.code || e.message}).`);
    if (c.mode === 'tcp') {
      sock = net.connect({ host: c.host, port: c.port });
      sock.setEncoding('latin1');
      sock.on('connect', () => { connected = true; });
      sock.on('data', (d) => { buf += d; const lines = buf.split('\n'); if (lines.length >= 3) judge(lines[1]); else if (buf.length > 4096) judge(buf); }); // 2nd line: the 1st may be partial
      sock.on('error', fail);
      sock.on('close', () => { if (connected) fin(false, `${where} accepted the connection and then closed it.`); });
    } else {
      sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('error', fail);
      sock.on('message', (m) => judge(m.toString('latin1').split('\n')[0]));
      sock.bind(c.port);
    }
  });
}

// ---------------------------------------------------------------- shared preferences (alarms, units, layout, source priority)
// Stored by the bridge so every device viewing the dashboard gets the same setup.
const PREFS_FILE = path.join(BASE, 'prefs.json');
let prefs = null;
if (!DEMO) { try { prefs = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); } catch { /* none saved yet */ } }

// history of the main values (charts: 24 h / 7 d / 30 d, and the vessel track)
const history = new History(N2K, { file: path.join(BASE, 'history.json'), persist: !DEMO, sources: () => (prefs && prefs.sources) || {} });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { history.stop(); process.exit(0); });

function readBody(req, limit, cb) {
  let body = '', over = false;
  req.on('data', (d) => { body += d; if (body.length > limit) { over = true; req.destroy(); } });
  req.on('end', () => { if (over) return; let v; try { v = JSON.parse(body); } catch { v = undefined; } cb(v); });
}

// ---------------------------------------------------------------- device REST proxy (GET, read-only)
const DEVICE_ENDPOINTS = new Set(['about', 'info', 'wifi', 'installation', 'sensei_stats', 'data_server_config',
  'data_server_status', 'data_routing', 'nmea2000_info', 'can', 'date_time']);

function proxyDevice(endpoint, host, res, object) {
  if (!DEVICE_ENDPOINTS.has(endpoint)) return json(res, 404, { error: 'endpoint not allowed' });
  if (!HOST_RE.test(host || '')) return json(res, 400, { error: 'no gateway host configured' });
  const query = object && /^\w{1,32}$/.test(object) ? `?object=${object}` : '';   // e.g. data_routing?object=data_tx
  const req = http.get({ host, port: 80, path: `/api/${endpoint}${query}`, timeout: 4000 }, (r) => {
    let body = '';
    r.setEncoding('utf8');
    r.on('data', (d) => { body += d; if (body.length > 1e6) req.destroy(); });
    r.on('end', () => {
      try { json(res, r.statusCode === 200 ? 200 : 502, r.statusCode === 200 ? JSON.parse(body) : { error: `device returned ${r.statusCode}` }); }
      catch { json(res, 502, { error: 'device returned invalid JSON' }); }
    });
  });
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', (e) => { if (!res.headersSent) json(res, 502, { error: e.code || e.message }); });
}

// ---------------------------------------------------------------- map tiles: caching proxy
// Tiles the dashboard asks for are fetched once and kept on disk (tile-cache/), so areas that have been viewed
// keep working with no internet connection. Only tiles actually viewed are stored - nothing is bulk-downloaded.
const TILE_DIR = path.join(BASE, 'tile-cache');
const TILE_FRESH_MS = 30 * 24 * 3600000;
const TILE_SOURCES = { osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', sea: 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png' };
function tileType(buf) { return buf[0] === 0xFF && buf[1] === 0xD8 ? 'image/jpeg' : buf.slice(0, 4).toString('latin1') === 'RIFF' ? 'image/webp' : 'image/png'; }
function serveTile(layer, z, x, y, res) {
  const zi = +z, xi = +x, yi = +y;
  if (!['base', 'sea'].includes(layer) || !Number.isInteger(zi) || !Number.isInteger(xi) || !Number.isInteger(yi) || zi < 0 || zi > 20 || xi < 0 || yi < 0 || xi >= 2 ** zi || yi >= 2 ** zi) { res.writeHead(400); return res.end(); }
  const custom = layer === 'base' && prefs && prefs.tiles && /^https:\/\/[^\s]+\{z\}[^\s]+\{x\}[^\s]+\{y\}/.test(prefs.tiles.url || '') ? prefs.tiles.url : null;
  const tpl = layer === 'sea' ? TILE_SOURCES.sea : custom || TILE_SOURCES.osm;
  const tag = layer === 'sea' ? 'sea' : custom ? 'custom-' + require('crypto').createHash('sha1').update(custom).digest('hex').slice(0, 10) : 'osm';
  const file = path.join(TILE_DIR, tag, String(zi), String(xi), `${yi}.tile`);
  const send = (buf) => { res.writeHead(200, { 'Content-Type': tileType(buf), 'Cache-Control': 'public, max-age=86400' }); res.end(buf); };
  fs.readFile(file, (err, cached) => {
    let age = Infinity;
    if (!err) { try { age = Date.now() - fs.statSync(file).mtimeMs; } catch { /* treat as stale */ } }
    if (!err && age < TILE_FRESH_MS) return send(cached);
    const url = tpl.replace('{s}', 'a').replace('{r}', '').replace('{z}', zi).replace('{x}', xi).replace('{y}', yi);
    fetch(url, { headers: { 'User-Agent': 'Cassini-Dashboard/1.0' }, signal: AbortSignal.timeout(8000) })
      .then(async (r) => {
        if (!r.ok || !/^image\//.test(r.headers.get('content-type') || '')) throw new Error(`tile server returned ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 2e6) throw new Error('tile too large');
        fs.mkdir(path.dirname(file), { recursive: true }, (e) => { if (!e) fs.writeFile(file, buf, () => {}); });
        send(buf);
      })
      .catch(() => { if (!err) return send(cached); res.writeHead(502); res.end(); });   // offline: fall back to an old copy if there is one
  });
}

// ---------------------------------------------------------------- HTTP server
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    sendEvent(res, 'status', publicStatus());
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (p === '/api/config' && req.method === 'GET') return json(res, 200, { config, status: publicStatus() });
  if (p === '/api/config' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let v;
      try { v = validateConfig(JSON.parse(body)); } catch { v = 'invalid JSON'; }
      if (typeof v === 'string') return json(res, 400, { error: v });
      config = v;
      if (!DEMO) try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); } catch (e) { console.warn('could not save config:', e.message); }
      startSource();
      json(res, 200, { config, status: publicStatus() });
    });
    return;
  }
  if (p === '/api/test' && req.method === 'POST') {
    return readBody(req, 4096, (b) => {
      const v = b && typeof b === 'object' ? validateConfig(b) : 'invalid request';
      if (typeof v === 'string') return json(res, 400, { ok: false, message: v });
      if (v.mode === 'sim') return json(res, 200, { ok: true, message: 'Demo data needs no connection.' });
      testConnection(v).then((r) => json(res, 200, r));
    });
  }
  if (p === '/api/history' && req.method === 'GET') return json(res, 200, { key: url.searchParams.get('key'), points: history.query(String(url.searchParams.get('key')), url.searchParams.get('range')) });
  if (p === '/api/track' && req.method === 'GET') return json(res, 200, { points: history.track(url.searchParams.get('range')) });
  if (p === '/api/clear' && req.method === 'POST') {   // forget all received data: stored history + every connected browser's live data
    history.clear(history.tag); history.save();
    broadcast('clear', {});
    return json(res, 200, { ok: true });
  }
  if (p === '/api/prefs' && req.method === 'GET') return json(res, 200, { prefs });
  if (p === '/api/prefs' && req.method === 'PUT') {
    return readBody(req, 262144, (b) => {
      if (!b || typeof b !== 'object' || Array.isArray(b)) return json(res, 400, { error: 'preferences must be a JSON object' });
      prefs = b;
      if (!DEMO) try { fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2)); } catch (e) { console.warn('could not save prefs:', e.message); }
      broadcast('prefs', { from: String(req.headers['x-client'] || ''), prefs });
      json(res, 200, { ok: true });
    });
  }
  if (p.startsWith('/api/device/') && req.method === 'GET') {
    return proxyDevice(p.slice('/api/device/'.length), url.searchParams.get('host') || config.host, res, url.searchParams.get('object'));
  }
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  const tile = /^\/tiles\/(\w+)\/(\d+)\/(\d+)\/(\d+)$/.exec(p);
  if (tile) return serveTile(tile[1], tile[2], tile[3], tile[4], res);

  if (sea) {   // single-executable build: files are embedded assets, keyed by their path under public/
    const key = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
    let data;
    try { data = Buffer.from(sea.getAsset(key)); } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(key)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    return res.end(data);
  }
  const file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : decodeURIComponent(p)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(HTTP_PORT, BIND, () => {
  console.log(`Cassini is running at http://${BIND === '0.0.0.0' ? 'localhost' : BIND}:${HTTP_PORT}`);
  if (BIND === '0.0.0.0') console.log('LAN access enabled - open http://<this-computer-ip>:' + HTTP_PORT + ' from other devices');
  console.log('Keep this window open while you use the dashboard. Close it (or press Ctrl+C) to stop.');
  startSource();
  if ((sea && !args.includes('--no-open')) || args.includes('--open')) {   // used by the packaged launcher: open the dashboard in the default browser
    const url = `http://localhost:${HTTP_PORT}`;
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    require('child_process').exec(cmd, () => {});
  }
});
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${HTTP_PORT} is already in use - the dashboard may already be running. Open http://localhost:${HTTP_PORT} or start with --port <number>.` : `Could not start: ${e.message}`);
  process.exitCode = 1;
});
