/* Cassini - Logo and start-up. Loaded last.
 * Part of the browser application: the files in js/ are plain scripts that share one scope and are loaded in the
 * order listed in index.html (see the README, "How the code is organised"). */
'use strict';

// Logo: exported SVGs often sit on a large empty artboard, so the viewBox is cropped to the artwork's real bounding box.
// The logo is dark purple, which disappears on the dark theme, so there it is recoloured: purple -> pale lavender,
// and its white highlights -> the background colour, so they still read as cut-outs.
const LOGO_DARK = [[/#3b0a91/gi, '#d9ccff'], [/#fff(?:fff)?\b/gi, '#181530']];
let logoSvg = null;
function paintLogo() {
  const img = $('.logo'); if (!img || !logoSvg) return;
  let src = logoSvg;
  if (document.documentElement.dataset.theme === 'dark') for (const [from, to] of LOGO_DARK) src = src.replace(from, to);
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
}
(async () => {
  const img = $('.logo'); if (!img) return;
  try {
    const r = await fetch(img.getAttribute('src')); if (!r.ok) return;
    const svg = new DOMParser().parseFromString(await r.text(), 'image/svg+xml').documentElement;
    if (svg.nodeName !== 'svg') return;
    const probe = document.importNode(svg, true);
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden';
    document.body.append(probe);
    const bb = probe.getBBox(); probe.remove();
    if (bb.width > 0 && bb.height > 0) {
      const pad = bb.height * 0.04;
      svg.setAttribute('viewBox', `${bb.x - pad} ${bb.y - pad} ${bb.width + 2 * pad} ${bb.height + 2 * pad}`);
      svg.removeAttribute('width'); svg.removeAttribute('height');
    }
    logoSvg = new XMLSerializer().serializeToString(svg);
    paintLogo();
  } catch { /* keep the file as supplied */ }
})();
window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (PAGES[id] && id !== active) show(id); });
applyTheme();
buildPages();
connect();
if (settings.ws && settings.ws.on && settings.ws.host) startDirect(settings.ws.host);
else if (standalone) openSettings();
