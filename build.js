#!/usr/bin/env node
/*
 * Builds a no-install download:  dist/Cassini-<platform>/  (+ a .zip on Windows)
 *
 * The folder contains a private copy of the Node.js runtime, the dashboard files and a launcher,
 * so the person using it does not need Node.js (or anything else) installed - they unzip it and
 * double-click the launcher.
 *
 *   node build.js
 *
 * The runtime copied is the one running this script, so build on the platform you are targeting
 * (run it on Windows for a Windows download, on a Mac for a Mac download).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = __dirname;
const win = process.platform === 'win32';
const name = `Cassini-${win ? 'windows' : process.platform === 'darwin' ? 'mac' : process.platform}-${process.arch}`;
const out = path.join(root, 'dist', name);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'app'), { recursive: true });

// application files (never the developer's own config.json / prefs.json)
for (const f of ['server.js', 'sim.js', 'history.js', 'README.md']) fs.copyFileSync(path.join(root, f), path.join(out, 'app', f));
fs.cpSync(path.join(root, 'public'), path.join(out, 'app', 'public'), { recursive: true });

// private Node.js runtime + its licence
const nodeName = win ? 'node.exe' : 'node';
fs.copyFileSync(process.execPath, path.join(out, nodeName));
if (!win) fs.chmodSync(path.join(out, nodeName), 0o755);
const nodeLicence = [path.join(path.dirname(process.execPath), 'LICENSE'), path.join(path.dirname(process.execPath), '..', 'LICENSE')].find((p) => fs.existsSync(p));
if (nodeLicence) fs.copyFileSync(nodeLicence, path.join(out, 'NODEJS-LICENSE.txt'));

// launcher
if (win) {
  fs.writeFileSync(path.join(out, 'Start Cassini.cmd'),
    ['@echo off', 'title Cassini', 'cd /d "%~dp0"', '"%~dp0node.exe" "%~dp0app\\server.js" --open %*', 'if errorlevel 1 pause', ''].join('\r\n'));
  fs.writeFileSync(path.join(out, 'Start Cassini (share on network).cmd'),
    ['@echo off', 'title Cassini (shared on network)', 'cd /d "%~dp0"', '"%~dp0node.exe" "%~dp0app\\server.js" --open --lan %*', 'if errorlevel 1 pause', ''].join('\r\n'));
} else {
  const sh = path.join(out, 'start-cassini.command');
  fs.writeFileSync(sh, '#!/bin/sh\ncd "$(dirname "$0")"\n./node app/server.js --open "$@"\n');
  fs.chmodSync(sh, 0o755);
}

fs.writeFileSync(path.join(out, 'READ ME FIRST.txt'), [
  'Cassini - NMEA 2000 dashboard for the Actisense W2K-2',
  '=====================================================',
  '',
  win ? '1. Double-click "Start Cassini".' : '1. Double-click "start-cassini.command".',
  '2. A small black window opens (leave it open) and the dashboard appears in your web browser.',
  '3. Click the connection button at the top of the dashboard to connect to your W2K-2.',
  '',
  'To view the dashboard from a tablet or phone on the same network, use the',
  '"share on network" launcher instead, then browse to http://<this-computer-address>:8642',
  '',
  'Nothing is installed. To remove the dashboard, delete this folder.',
  'Your settings are stored in the "app" folder (config.json and prefs.json).',
  '',
  'This software includes the Node.js runtime (MIT licence, nodejs.org) and Leaflet (BSD-2-Clause),',
  'and uses map data (c) OpenStreetMap contributors and OpenSeaMap.',
  '',
].join(win ? '\r\n' : '\n'));

// zip (Windows: built-in PowerShell; elsewhere: zip if available)
let zip = null;
try {
  zip = `${out}.zip`;
  fs.rmSync(zip, { force: true });
  if (win) execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${out}' -DestinationPath '${zip}'`], { stdio: 'inherit' });
  else execFileSync('zip', ['-qr', zip, name], { cwd: path.dirname(out), stdio: 'inherit' });
} catch (e) { zip = null; console.warn('Could not create the zip (the folder is still complete):', e.message); }

const size = (p) => `${(fs.statSync(p).size / 1048576).toFixed(0)} MB`;
console.log(`Built ${out}`);
if (zip) console.log(`Zip   ${zip} (${size(zip)})`);

// ---------------------------------------------------------------- optional: one single executable  (node build.js --exe)
// Uses Node's "single executable application" feature: the bridge, simulator and all dashboard files are embedded
// in a copy of the Node.js runtime. Needs the "postject" tool, fetched from npm by npx the first time.
if (process.argv.includes('--exe')) {
  const work = path.join(root, 'dist', 'sea');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  // 1. one script: inline sim.js into server.js (an executable can only load built-in modules)
  let main = fs.readFileSync(path.join(root, 'server.js'), 'utf8').replace(/^#!.*\n/, '');
  for (const [req, file] of [["require('./sim')", 'sim.js'], ["require('./public/n2k.js')", 'public/n2k.js'], ["require('./history')", 'history.js']]) {
    if (!main.includes(req)) throw new Error('server.js no longer contains: ' + req);
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    main = main.replace(req, () => `(() => { const module = { exports: {} };\n${src}\nreturn module.exports; })()`);
  }
  fs.writeFileSync(path.join(work, 'main.js'), main);
  // 2. embed everything under public/ as assets
  const assets = {};
  (function walk(d, rel) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r); else assets[r] = path.join(d, e.name);
    }
  })(path.join(root, 'public'), '');
  const blob = path.join(work, 'sea-prep.blob');
  fs.writeFileSync(path.join(work, 'sea-config.json'), JSON.stringify({ main: path.join(work, 'main.js'), output: blob, disableExperimentalSEAWarning: true, assets }, null, 2));
  execFileSync(process.execPath, ['--experimental-sea-config', path.join(work, 'sea-config.json')], { stdio: 'inherit' });
  // 3. copy the runtime and inject the blob
  const named = process.argv.indexOf('--exe-name');   // optional: --exe-name <file>, e.g. to build while Cassini.exe is running
  const exe = path.join(root, 'dist', named > 0 && process.argv[named + 1] ? path.basename(process.argv[named + 1]) : win ? 'Cassini.exe' : 'cassini');
  fs.copyFileSync(process.execPath, exe);
  // Windows: give the exe the Cassini icon and name (must happen before the blob is injected).
  // Needs rcedit (https://github.com/electron/rcedit/releases) saved as tools/rcedit/rcedit-x64.exe; skipped with a note if absent.
  const rcedit = path.join(root, 'tools', 'rcedit', 'rcedit-x64.exe'), ico = path.join(root, 'icon', 'cassini.ico');
  if (win && fs.existsSync(rcedit) && fs.existsSync(ico)) {
    execFileSync(rcedit, [exe, '--set-icon', ico, '--set-version-string', 'FileDescription', 'Cassini - NMEA 2000 dashboard',
      '--set-version-string', 'ProductName', 'Cassini', '--set-version-string', 'OriginalFilename', 'Cassini.exe', '--set-version-string', 'InternalName', 'cassini'], { stdio: 'inherit' });
    console.log('Icon  set from icon/cassini.ico');
  } else if (win) console.log('Icon  skipped: tools/rcedit/rcedit-x64.exe or icon/cassini.ico not found (the exe keeps the Node.js icon)');
  const pj =['--yes', 'postject', exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
  if (process.platform === 'darwin') pj.push('--macho-segment-name', 'NODE_SEA');
  execFileSync(win ? 'npx.cmd' : 'npx', pj, { stdio: 'inherit', shell: win });
  console.log(`Exe   ${exe} (${size(exe)})`);
}
