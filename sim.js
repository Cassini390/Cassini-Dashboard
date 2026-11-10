/*
 * Built-in demo simulator.
 * Generates a coherent NMEA 2000 data set for a twin-engine vessel and emits it as
 * Actisense "N2K ASCII" lines - exactly what a W2K-2 data server sends - so the
 * dashboard's real decode path is exercised even with no gateway connected.
 *
 *   A173321.107 23FF7 1F513 012F3070002F30709F
 *   | time       | | |  PGN   data bytes (fast-packets already reassembled)
 *   |            | | priority
 *   |            | destination
 *   type         source
 */
'use strict';

const RAD = Math.PI / 180;
const KN = 0.514444;

class W { // little-endian payload writer; null => "not available" (all bits set)
  constructor() { this.b = []; }
  u8(v) { this.b.push(v == null ? 0xFF : v & 0xFF); return this; }
  u16(v) { v = v == null ? 0xFFFF : Math.round(v) & 0xFFFF; this.b.push(v & 0xFF, v >> 8); return this; }
  s16(v) { return this.u16(v == null ? 0x7FFF : Math.round(v)); }
  u24(v) { v = v == null ? 0xFFFFFF : Math.round(v); this.b.push(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF); return this; }
  u32(v) { v = v == null ? 0xFFFFFFFF : Math.round(v) >>> 0; this.b.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, v >>> 24); return this; }
  s32(v) { return this.u32(v == null ? 0x7FFFFFFF : Math.round(v)); }
  s64(v) { let n = BigInt.asUintN(64, BigInt(Math.round(v))); for (let i = 0; i < 8; i++) { this.b.push(Number(n & 0xFFn)); n >>= 8n; } return this; }
  str(s, len) { for (let i = 0; i < len; i++) this.b.push(i < s.length ? s.charCodeAt(i) : 0xFF); return this; }
  hex() { return this.b.map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase(); }
}
const w = () => new W();
const hex = (v, n) => v.toString(16).toUpperCase().padStart(n, '0');
const wrap = (a) => ((a % 360) + 360) % 360;
const noise = (amp) => (Math.random() - 0.5) * 2 * amp;

const SRC = { gps: 0x03, dst: 0x10, wind: 0x15, gw: 0x17, engP: 0x30, engS: 0x31, batt: 0x40, tank: 0x45, sw: 0x48 };
const DEVICES = [
  { src: SRC.gps, mfr: 273, fn: 145, cls: 60, model: 'GPS / Compass sensor', sw: '1.204', code: 1001 },
  { src: 0x04, mfr: 135, fn: 145, cls: 60, model: 'Backup GPS antenna', sw: '1.1', code: 1009 },
  { src: SRC.dst, mfr: 135, fn: 130, cls: 60, model: 'Depth / Speed / Temp triducer', sw: '2.010', code: 1002 },
  { src: SRC.wind, mfr: 135, fn: 130, cls: 85, model: 'Wind & weather station', sw: '1.070', code: 1003 },
  { src: SRC.gw, mfr: 273, fn: 136, cls: 25, model: 'W2K-2', sw: '3.087', code: 1004 },
  { src: SRC.engP, mfr: 273, fn: 140, cls: 50, model: 'EMU-1 (Port engine)', sw: '1.065', code: 1005 },
  { src: SRC.engS, mfr: 273, fn: 140, cls: 50, model: 'EMU-1 (Stbd engine)', sw: '1.065', code: 1005 },
  { src: SRC.batt, mfr: 358, fn: 170, cls: 35, model: 'Battery monitor', sw: '4.12', code: 1006 },
  { src: SRC.tank, mfr: 137, fn: 150, cls: 75, model: 'Tank level adapter', sw: '1.3', code: 1007 },
  { src: SRC.sw, mfr: 137, fn: 135, cls: 30, model: 'Switch bank', sw: '2.0', code: 1008 },
];
const WAYPOINTS = [{ lat: 50.6425, lon: -1.9120 }, { lat: 50.6860, lon: -1.9350 }, { lat: 50.6700, lon: -1.8700 }];

class Simulator {
  constructor(emit) {
    this.emit = emit;
    this.timers = [];
    this.t = 0; this.sid = 0;
    this.lat = 50.6860; this.lon = -1.9350; this.hdg = 160; this.sog = 6.8 * KN;
    this.wp = 0; this.log = 1834200; this.trip = 0;
    this.fuel = [71, 68]; this.hours = [1210.4 * 3600, 1198.9 * 3600];
    this.rot = 0; this.rudder = 0; this.set = 12; // current set (deg offset between hdg & cog)
  }

  line(src, pgn, prio, payload, dst = 0xFF) {
    const d = new Date();
    const ts = `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}.${String(d.getUTCMilliseconds()).padStart(3, '0')}`;
    this.emit(`A${ts} ${hex(src, 2)}${hex(dst, 2)}${prio} ${hex(pgn, 5)} ${payload.hex()}`);
  }

  start() {
    this.identify();
    this.timers = [
      setInterval(() => this.fast(0.2), 200),
      setInterval(() => this.slow(), 1000),
      setInterval(() => this.verySlow(), 2500),
      setInterval(() => this.identify(), 10000),
    ];
  }
  stop() { this.timers.forEach(clearInterval); this.timers = []; }

  identify() {
    DEVICES.forEach((d, i) => {
      this.line(d.src, 60928, 6, w().u32(((1000 + i) | (d.mfr << 21)) >>> 0).u8(0).u8(d.fn).u8(d.cls << 1).u8(0xC0));
      this.line(d.src, 126996, 6, w().u16(2100).u16(d.code).str(d.model, 32).str(d.sw, 32).str('A', 32).str(String(240000 + i), 32).u8(1).u8(1));
    });
  }

  wind() { // true wind -> apparent
    const twd = 225 + 12 * Math.sin(this.t / 90), tws = (14 + 3 * Math.sin(this.t / 37) + noise(0.6)) * KN;
    const twa = wrap(twd - this.hdg) * RAD;
    const ax = tws * Math.cos(twa) + this.sog, ay = tws * Math.sin(twa);
    return { aws: Math.hypot(ax, ay), awa: wrap(Math.atan2(ay, ax) / RAD) };
  }

  fast(dt) {
    this.t += dt;
    const s = (this.sid = (this.sid + 1) % 253);
    const wp = WAYPOINTS[this.wp];
    const dN = (wp.lat - this.lat) * 111320, dE = (wp.lon - this.lon) * 111320 * Math.cos(this.lat * RAD);
    this.dtw = Math.hypot(dN, dE); this.btw = wrap(Math.atan2(dE, dN) / RAD);
    if (this.dtw < 120) this.wp = (this.wp + 1) % WAYPOINTS.length;
    // steer towards the waypoint with a gentle weave
    const want = this.btw + 6 * Math.sin(this.t / 23);
    const err = ((want - this.hdg + 540) % 360) - 180;
    this.rudder = Math.max(-25, Math.min(25, err * 1.2)) + noise(0.4);
    this.rot = this.rudder * 0.12; // deg/s
    this.hdg = wrap(this.hdg + this.rot * dt);
    this.sog = (6.8 + 0.6 * Math.sin(this.t / 50)) * KN;
    this.cog = wrap(this.hdg + 4 * Math.sin(this.t / 140));
    this.lat += (this.sog * Math.cos(this.cog * RAD) * dt) / 111320;
    this.lon += (this.sog * Math.sin(this.cog * RAD) * dt) / (111320 * Math.cos(this.lat * RAD));
    this.log += this.sog * dt; this.trip += this.sog * dt;
    this.roll = 4 * Math.sin(this.t / 2.1) + this.rudder * 0.15; this.pitch = 1.5 * Math.sin(this.t / 1.7);
    this.rpm = [1850 + 40 * Math.sin(this.t / 50) + noise(6), 1835 + 40 * Math.sin(this.t / 50 + 0.4) + noise(6)];

    this.line(SRC.gps, 127250, 2, w().u8(s).u16((this.hdg * RAD) / 1e-4).s16(null).s16((0.6 * RAD) / 1e-4).u8(0xFC));
    this.line(SRC.gps, 129025, 2, w().s32(this.lat * 1e7).s32(this.lon * 1e7));
    this.line(SRC.gps, 129026, 2, w().u8(s).u8(0xFC).u16((this.cog * RAD) / 1e-4).u16(this.sog / 0.01).u16(null));
    this.line(SRC.gps, 127257, 3, w().u8(s).s16(null).s16((this.pitch * RAD) / 1e-4).s16((this.roll * RAD) / 1e-4).u8(null));
    this.line(SRC.gps, 127245, 2, w().u8(0).u8(0xFF).s16(null).s16((this.rudder * RAD) / 1e-4).u16(null));
    this.line(SRC.engP, 127488, 2, w().u8(0).u16(this.rpm[0] / 0.25).u16(1420).u8(0).u16(null));
    this.line(SRC.engS, 127488, 2, w().u8(1).u16(this.rpm[1] / 0.25).u16(1410).u8(0).u16(null));
    const a = this.wind();
    this.line(SRC.wind, 130306, 2, w().u8(s).u16(a.aws / 0.01).u16((a.awa * RAD) / 1e-4).u8(0xFA).u16(null));
  }

  slow() {
    const s = this.sid, now = Date.now();
    const days = Math.floor(now / 86400000), tod = (now % 86400000) * 10;
    const depth = 14 + 7 * Math.sin(this.t / 70) + 2.5 * Math.sin(this.t / 11) + noise(0.1);
    const stw = this.sog - 0.4 * KN + noise(0.05);
    const K = 273.15;

    this.line(SRC.gps, 126992, 3, w().u8(s).u8(0xF0).u16(days).u32(tod));
    this.line(SRC.gps, 129029, 3, w().u8(s).u16(days).u32(tod).s64(this.lat * 1e16).s64(this.lon * 1e16).s64(2.4e6)
      .u8(0x10).u8(0xFC).u8(11).s16(90 + noise(8)).s16(160).s32(4700).u8(0));
    // a second (backup) GPS sending the same PGNs at 1 Hz with a small position offset - exercises source priority
    this.line(0x04, 129025, 2, w().s32((this.lat + 0.0004) * 1e7).s32((this.lon + 0.0006) * 1e7));
    this.line(0x04, 129026, 2, w().u8(s).u8(0xFC).u16((wrap(this.cog + 1.5) * RAD) / 1e-4).u16((this.sog + 0.1) / 0.01).u16(null));
    this.line(0x04, 129029, 3, w().u8(s).u16(days).u32(tod).s64((this.lat + 0.0004) * 1e16).s64((this.lon + 0.0006) * 1e16).s64(3.1e6)
      .u8(0x10).u8(0xFC).u8(7).s16(140).s16(230).s32(4700).u8(0));
    this.line(SRC.gps, 129539, 6, w().u8(s).u8(0xDB).s16(90).s16(130).s16(null));
    this.line(SRC.gps, 127258, 7, w().u8(s).u8(0xF4).u16(days).s16((0.6 * RAD) / 1e-4).u16(null));
    this.line(SRC.gps, 127251, 2, w().u8(s).s32((this.rot * RAD) / 3.125e-8).u8(null).u16(null));
    this.line(SRC.dst, 128267, 3, w().u8(s).u32(depth / 0.01).s16(-0.4 / 0.001).u8(null));
    this.line(SRC.dst, 128259, 2, w().u8(s).u16(stw / 0.01).u16(null).u8(0).u8(0xFF).u16(null));
    this.line(SRC.dst, 128275, 6, w().u16(days).u32(tod).u32(this.log).u32(this.trip));
    // navigation to waypoint
    const xte = 18 * Math.sin(this.t / 60);
    const vmg = this.sog * Math.cos((this.cog - this.btw) * RAD);
    const eta = now + (this.dtw / Math.max(vmg, 0.5)) * 1000;
    const wp = WAYPOINTS[this.wp];
    this.line(SRC.gps, 129283, 3, w().u8(s).u8(0x00).s32(xte / 0.01).u16(null));
    this.line(SRC.gps, 129284, 3, w().u8(s).u32(this.dtw / 0.01).u8(0x00).u32((eta % 86400000) * 10).u16(Math.floor(eta / 86400000))
      .u16(null).u16((this.btw * RAD) / 1e-4).u32(this.wp).u32(this.wp + 1).s32(wp.lat * 1e7).s32(wp.lon * 1e7).s16(vmg / 0.01));
    // engines
    [SRC.engP, SRC.engS].forEach((src, i) => {
      this.hours[i] += 1; this.fuel[i] = Math.max(5, this.fuel[i] - 0.0006);
      const load = 52 + 3 * Math.sin(this.t / 50 + i);
      this.line(src, 127489, 2, w().u8(i).u16((398 + 6 * i + noise(3)) * 10).u16((K + 96 + i) / 0.1).u16((K + 82.5 + 1.5 * i + noise(0.2)) / 0.01)
        .s16((14.1 - 0.1 * i) / 0.01).s16((21.5 + i * 0.6 + noise(0.3)) / 0.1).u32(this.hours[i]).u16(null).u16(310).u8(null)
        .u16(0).u16(0).u8(load).u8(load - 4));
      this.line(src, 127493, 2, w().u8(i).u8(0xFC).u16(1650).u16((K + 71 + i) / 0.1).u8(0).u8(null));
    });
    // electrical
    const batts = [[12.74 + noise(0.02), -8.4 + noise(0.5), 21.5], [13.92 + noise(0.02), 2.1 + noise(0.2), 24.0], [25.6 + noise(0.03), -0.3, 19.0]];
    batts.forEach(([v, a, t], i) => this.line(SRC.batt, 127508, 6, w().u8(i).s16(v / 0.01).s16(a / 0.1).u16((K + t) / 0.01).u8(s)));
    this.line(SRC.batt, 127506, 6, w().u8(s).u8(0).u8(0).u8(84).u8(97).u16(1430).u16(null).u16(null));
    // environment
    const pres = 1014.2 + 1.5 * Math.sin(this.t / 600);
    this.line(SRC.wind, 130310, 5, w().u8(s).u16(null).u16((K + 17.8) / 0.01).u16(pres).u8(null));
    this.line(SRC.dst, 130312, 5, w().u8(s).u8(0).u8(0).u16((K + 15.6 + 0.2 * Math.sin(this.t / 80)) / 0.01).u16(null).u8(null));
    this.line(SRC.wind, 130312, 5, w().u8(s).u8(0).u8(1).u16((K + 17.8 + 0.3 * Math.sin(this.t / 200)) / 0.01).u16(null).u8(null));
    this.line(SRC.tank, 130312, 5, w().u8(s).u8(0).u8(3).u16((K + 38.5) / 0.01).u16(null).u8(null));
    this.line(SRC.tank, 130312, 5, w().u8(s).u8(0).u8(4).u16((K + 21.4) / 0.01).u16(null).u8(null));
    this.line(SRC.tank, 130312, 5, w().u8(s).u8(0).u8(7).u16((K + 4.2) / 0.01).u16((K + 4) / 0.01).u8(null));
    this.line(SRC.wind, 130313, 5, w().u8(s).u8(0).u8(1).s16(68 / 0.004).s16(null).u8(null));
    this.line(SRC.wind, 130314, 5, w().u8(s).u8(0).u8(0).s32(pres * 1000).u8(null));
  }

  verySlow() {
    const tanks = [[0, 0, this.fuel[0], 400], [1, 0, this.fuel[1], 400], [0, 1, 62, 300], [0, 2, 34, 120], [0, 5, 47, 100]];
    tanks.forEach(([inst, type, lvl, cap]) => this.line(SRC.tank, 127505, 6, w().u8((type << 4) | inst).s16(lvl / 0.004).u32(cap * 10).u8(null)));
    // switch bank 0: channels 1,2,5 on, 3,4,6-8 off, rest not available
    const on = [1, 1, 0, 0, 1, 0, 0, 0];
    const p = w().u8(0);
    for (let byte = 0; byte < 7; byte++) {
      let v = 0;
      for (let k = 0; k < 4; k++) { const ch = byte * 4 + k; v |= (ch < 8 ? on[ch] : 3) << (k * 2); }
      p.u8(v === 0xFF ? null : v);
    }
    this.line(SRC.sw, 127501, 3, p);
  }
}

module.exports = { Simulator };
