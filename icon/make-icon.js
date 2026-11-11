#!/usr/bin/env node
/*
 * Builds icon/cassini.ico (Windows icon, sizes 16-256) and icon/cassini-256.png from the Cassini icon design.
 * No dependencies: the three shapes of icon/cassini-icon.svg are drawn directly and encoded as PNG.
 *
 *   node icon/make-icon.js
 *
 * The design (512 x 512 units) - keep in step with icon/cassini-icon.svg:
 *   background  rounded square, corner radius 112, purple #3b0a91
 *   planet      white circle, radius 112, centred
 *   ring        white ellipse outline rx 224 / ry 72, 32 wide, tilted 20 degrees
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PURPLE = [0x3b, 0x0a, 0x91], WHITE = [255, 255, 255];
const C = 256, COS = Math.cos(20 * Math.PI / 180), SIN = Math.sin(20 * Math.PI / 180);

/** colour at a point in the 512-unit design, or null outside the rounded square */
function sample(x, y) {
  const qx = Math.max(Math.abs(x - C) - (256 - 112), 0), qy = Math.max(Math.abs(y - C) - (256 - 112), 0);
  if (Math.abs(x - C) > 256 || Math.abs(y - C) > 256 || qx * qx + qy * qy > 112 * 112) return null;
  const dx = x - C, dy = y - C;
  if (dx * dx + dy * dy <= 112 * 112) return WHITE;                                   // planet
  const px = dx * COS - dy * SIN, py = dx * SIN + dy * COS;                             // undo the ring's tilt
  const outer = (px / 240) ** 2 + (py / 88) ** 2, inner = (px / 208) ** 2 + (py / 56) ** 2;
  return outer <= 1 && inner >= 1 ? WHITE : PURPLE;                                    // ring (32 wide)
}

/** RGBA pixels for an n x n icon, anti-aliased by 6 x 6 supersampling */
function render(n) {
  const SS = 6, out = Buffer.alloc(n * n * 4), k = 512 / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sj = 0; sj < SS; sj++) for (let si = 0; si < SS; si++) {
      const c = sample((i + (si + 0.5) / SS) * k, (j + (sj + 0.5) / SS) * k);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    const o = (j * n + i) * 4;
    if (a) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); out[o + 3] = Math.round((a / (SS * SS)) * 255); }
  }
  return out;
}

function png(n, rgba) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0); return Buffer.concat([len, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;   // 8-bit RGBA
  const raw = Buffer.alloc(n * (n * 4 + 1));
  for (let y = 0; y < n; y++) rgba.copy(raw, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4);                    // filter byte 0 per row
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((n) => png(n, render(n)));
const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((n, i) => {
  const e = Buffer.alloc(16);
  e[0] = n === 256 ? 0 : n; e[1] = n === 256 ? 0 : n; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(images[i].length, 8); e.writeUInt32LE(offset, 12);
  offset += images[i].length;
  return e;
});
fs.writeFileSync(path.join(__dirname, 'cassini.ico'), Buffer.concat([header, ...entries, ...images]));
fs.writeFileSync(path.join(__dirname, 'cassini-256.png'), images[sizes.indexOf(256)]);
console.log(`Wrote icon/cassini.ico (${sizes.join(', ')} px) and icon/cassini-256.png`);
