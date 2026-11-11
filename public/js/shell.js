/* Cassini - Page shell: sidebar navigation, rendering loop, theme and status messages.
 * Part of the browser application: the files in js/ are plain scripts that share one scope and are loaded in the
 * order listed in index.html (see the README, "How the code is organised"). */
'use strict';

// ================================================================ shell: tabs, theme, connection, settings
const pages = {};
let active = null;
// sidebar navigation: page -> [group, icon path]
const NAV = {
  overview: ['Overview', 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'], custom: ['Overview', 'M4 4h16v6H4zM4 14h7v6H4zM15 14h5v6h-5z'],
  navigation: ['Overview', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z'],
  engines: ['Systems', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2'],
  power: ['Systems', 'M13 2 5 14h6l-1 8 8-12h-6z'], environment: ['Systems', 'M3 9h11a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3M3 19h7'],
  alarms: ['Alerts', 'M12 3a6 6 0 0 0-6 6v4l-2 3v1h16v-1l-2-3V9a6 6 0 0 0-6-6zm-2 16a2 2 0 0 0 4 0'],
  sources: ['Configuration', 'M4 7h12M4 17h12M16 4l4 3-4 3M16 14l4 3-4 3'], network: ['Configuration', 'M12 4v6M5 20v-4h14v4M12 10v6M3 20h4M10 20h4M17 20h4'],
};
const navIcon = (d) => s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, s('path', { d }));
function buildPages() {
  const main = $('#main'), tabs = $('#tabs');
  // remember what had keyboard focus so a rebuild does not throw it away
  const fa = document.activeElement, focusKey = fa && main.contains(fa) ? [fa.tagName, (fa.getAttribute('aria-label') || fa.textContent || '').slice(0, 60)] : null;
  leafMaps.forEach((m) => m.remove()); leafMaps = [];
  main.replaceChildren(); tabs.replaceChildren();
  let lastGroup = '';
  for (const [id, [title, build]] of Object.entries(PAGES)) {
    const ups = [], el = h('div', { class: 'page', id: `page-${id}`, hidden: '' });
    withSink(ups, () => el.append(...build()));
    pages[id] = { el, ups };
    main.append(el);
    if (NAV[id][0] !== lastGroup) { lastGroup = NAV[id][0]; tabs.append(h('div', { class: 'nav-group', text: lastGroup })); }
    tabs.append(h('button', { type: 'button', 'data-page': id, onclick: () => show(id) }, navIcon(NAV[id][1]), h('span', { text: title })));
  }
  tabs.append(h('button', { type: 'button', onclick: () => openSettings() }, navIcon('M4 7h10M18 7h2M4 17h2M10 17h10M16 4.5v5M8 14.5v5'), h('span', { text: 'Settings' })));
  show(PAGES[location.hash.slice(1)] ? location.hash.slice(1) : 'overview');
  if (focusKey) {
    const again = [...pages[active].el.querySelectorAll(focusKey[0])].find((e) => (e.getAttribute('aria-label') || e.textContent || '').slice(0, 60) === focusKey[1]);
    (again || main).focus({ preventScroll: true });
  }
}
function show(id) {
  active = id;
  for (const k in pages) pages[k].el.hidden = k !== id;
  for (const b of $('#tabs').querySelectorAll('[data-page]')) { if (b.dataset.page === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  $('#pageTitle').textContent = PAGES[id][0];
  history.replaceState(null, '', '#' + id);
  render();
}
const headerUps = [];
function render() { if (active) for (const u of pages[active].ups) u(); for (const u of headerUps) u(); }

// theme
const mq = window.matchMedia('(prefers-color-scheme: dark)');
const THEME_ICON = { light: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  dark: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z', night: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z' };
const themeMode = () => (settings.theme === 'auto' ? (mq.matches ? 'dark' : 'light') : settings.theme);
/** light / dark / night. Night = the dark theme shown in red only (preserves night vision); brightness dims everything. */
function applyTheme() {
  const mode = themeMode(), root = document.documentElement, b = clamp(+settings.brightness || 100, 30, 100);
  root.dataset.theme = mode === 'light' ? 'light' : 'dark';
  root.toggleAttribute('data-night', mode === 'night');
  const flt = `${mode === 'night' ? 'url(#redOnly) ' : ''}${b < 100 ? `brightness(${b}%)` : ''}`.trim();
  document.body.style.filter = flt;                                   // dialogs sit in the top layer, outside body, so they get it too
  document.querySelectorAll('dialog').forEach((d) => { d.style.filter = flt; });
  $('#themeIcon').setAttribute('d', THEME_ICON[mode]);
  paintLogo();
  $('#themeBtn').title = `Theme: ${mode} (click to change)`; $('#themeBtn').setAttribute('aria-label', `Theme: ${mode}. Click to change`);
}
mq.addEventListener('change', applyTheme);
$('#themeBtn').onclick = () => { settings.theme = { light: 'dark', dark: 'night', night: 'light' }[themeMode()]; saveLocal(); applyTheme(); render(); };

// brief status message under the tabs (connection results, import/export)
let toastTimer = 0;
function toast(msg, kind = 'info', ms = 6000, action) {
  const el = $('#toast');
  el.className = 'toast ' + kind; el.replaceChildren(...[h('span', { text: msg }), action, h('button', { class: 'btn sm', type: 'button', text: 'Dismiss', onclick: () => { el.hidden = true; } })].filter(Boolean));
  el.hidden = false; clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
/** after the connection settings change, report clearly whether it worked */
function watchConnection() {
  const t0 = Date.now(), where = whereTxt;
  const fix = () => h('button', { class: 'btn sm', type: 'button', text: 'Open settings', onclick: openSettings });
  lastRx = 0;
  toast('Applying connection settings…', 'info', 0);
  const iv = setInterval(() => {
    if (conn.mode === 'sim') { clearInterval(iv); return toast('Now showing built-in demo data.', 'info'); }
    if (conn.state === 'connected' && Date.now() - lastRx < 2000) { clearInterval(iv); return toast(`Connected - receiving live data from ${where()}.`, 'good'); }
    if (Date.now() - t0 < 1500) return;                     // give the bridge a moment to switch over
    if (conn.state === 'error') { clearInterval(iv); return toast(`Could not connect to ${where()}: ${conn.detail}. Use "Test connection" in Settings for details.`, 'bad', 0, fix()); }
    if (Date.now() - t0 > 9000) { clearInterval(iv); toast(conn.state === 'connecting' ? `Still trying to reach ${where()} - check the address and network.` : `Connected to ${where()}, but no data is arriving yet.`, 'warn', 0, fix()); }
  }, 400);
}
