/*
 * Actisense "N2K ASCII" parser + NMEA 2000 PGN decoder.
 *
 *   A173321.107 23FF7 1F513 012F3070002F30709F
 *   A<hhmmss.ddd> <SS><DD><P> <PGN:5 hex> <data bytes, fast-packets pre-assembled>
 *
 * decode(msg, put) converts a message into engineering values (SI units:
 * metres, m/s, degrees, Kelvin->degC, Pa->hPa/kPa, volts, amps) and stores each
 * one by key with put(key, value).
 */
(function (global) {
  'use strict';
  const LINE = /^A(\d{6}\.\d{3}) ([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]) ([0-9A-F]{5}) ((?:[0-9A-F]{2})*)$/i;
  const DEG = 180 / Math.PI;

  function parseLine(line) {
    const m = LINE.exec(line.trim());
    if (!m) return null;
    const hex = m[6], data = new Uint8Array(hex.length / 2);
    for (let i = 0; i < data.length; i++) data[i] = parseInt(hex.substr(i * 2, 2), 16);
    return { time: m[1], src: parseInt(m[2], 16), dst: parseInt(m[3], 16), prio: parseInt(m[4], 16), pgn: parseInt(m[5], 16), data };
  }

  // Little-endian reader. Returns null for NMEA 2000 "not available" / "out of range" values.
  class R {
    constructor(b) { this.b = b; this.n = b.length; this.dv = new DataView(b.buffer, b.byteOffset, b.length); }
    raw(o) { return o < this.n ? this.b[o] : 0xFF; }
    u8(o) { const v = this.raw(o); return v >= 0xFE ? null : v; }
    s8(o) { if (o >= this.n) return null; const v = this.dv.getInt8(o); return v >= 0x7E ? null : v; }
    u16(o) { if (o + 2 > this.n) return null; const v = this.dv.getUint16(o, true); return v >= 0xFFFE ? null : v; }
    s16(o) { if (o + 2 > this.n) return null; const v = this.dv.getInt16(o, true); return v >= 0x7FFE ? null : v; }
    u24(o) { if (o + 3 > this.n) return null; const v = this.b[o] | (this.b[o + 1] << 8) | (this.b[o + 2] << 16); return v >= 0xFFFFFE ? null : v; }
    u32(o) { if (o + 4 > this.n) return null; const v = this.dv.getUint32(o, true); return v >= 0xFFFFFFFE ? null : v; }
    s32(o) { if (o + 4 > this.n) return null; const v = this.dv.getInt32(o, true); return v >= 0x7FFFFFFE ? null : v; }
    s64(o) { if (o + 8 > this.n) return null; const v = this.dv.getBigInt64(o, true); return v >= 0x7FFFFFFFFFFFFFFEn ? null : Number(v); }
    str(o, len) { let s = ''; for (let i = o; i < o + len && i < this.n; i++) { const c = this.b[i]; if (c === 0 || c === 0xFF) break; s += String.fromCharCode(c); } return s.replace(/@+$/, '').trim(); }
  }
  const sc = (v, k, off = 0) => (v == null ? null : v * k + off);
  const ang = (v) => sc(v, 1e-4 * DEG);            // 1e-4 rad -> degrees
  const tempC = (v, k) => sc(v, k, -273.15);       // Kelvin steps -> degC
  const dateTime = (days, t) => (days == null || t == null ? null : days * 86400000 + t / 10);

  const TEMP_SOURCES = ['Sea', 'Outside air', 'Inside air', 'Engine room', 'Main cabin', 'Live well', 'Bait well', 'Refrigeration',
    'Heating system', 'Dew point', 'Wind chill (apparent)', 'Wind chill (theoretical)', 'Heat index', 'Freezer', 'Exhaust gas'];
  const TANK_TYPES = ['Fuel', 'Fresh water', 'Grey water', 'Live well', 'Oil', 'Black water', 'Gasoline'];
  const GNSS_METHODS = ['No fix', 'GNSS fix', 'DGNSS fix', 'Precise GNSS', 'RTK fixed', 'RTK float', 'Estimated (DR)', 'Manual', 'Simulator'];
  const ENGINE_STATUS1 = ['Check engine', 'Over temperature', 'Low oil pressure', 'Low oil level', 'Low fuel pressure', 'Low system voltage',
    'Low coolant level', 'Water flow', 'Water in fuel', 'Charge indicator', 'Preheat indicator', 'High boost pressure', 'Rev limit exceeded',
    'EGR system', 'Throttle position sensor', 'Emergency stop'];
  const ENGINE_STATUS2 = ['Warning level 1', 'Warning level 2', 'Power reduction', 'Maintenance needed', 'Engine comm error',
    'Sub or secondary throttle', 'Neutral start protect', 'Engine shutting down'];
  const MANUFACTURERS = { 78: 'FW Murphy', 135: 'Airmar', 137: 'Maretron', 140: 'Lowrance', 144: 'Mercury', 172: 'Yanmar', 174: 'Volvo Penta',
    229: 'Garmin', 273: 'Actisense', 275: 'Navico', 304: 'EmpirBus', 315: 'ICOM', 358: 'Victron Energy', 381: 'B&G', 717: 'Yacht Devices',
    1851: 'Raymarine', 1855: 'Furuno', 1857: 'Simrad', 1862: 'Yamaha Marine' };
  const PGN_NAMES = { 59392: 'ISO Acknowledgement', 59904: 'ISO Request', 60928: 'ISO Address Claim', 126208: 'Group Function', 126464: 'PGN List',
    126992: 'System Time', 126993: 'Heartbeat', 126996: 'Product Information', 126998: 'Configuration Information', 127237: 'Heading/Track Control',
    127245: 'Rudder', 127250: 'Vessel Heading', 127251: 'Rate of Turn', 127252: 'Heave', 127257: 'Attitude', 127258: 'Magnetic Variation',
    127488: 'Engine Parameters, Rapid', 127489: 'Engine Parameters, Dynamic', 127493: 'Transmission Parameters', 127497: 'Trip Fuel Consumption',
    127501: 'Binary Switch Bank Status', 127505: 'Fluid Level', 127506: 'DC Detailed Status', 127507: 'Charger Status', 127508: 'Battery Status',
    128259: 'Speed, Water Referenced', 128267: 'Water Depth', 128275: 'Distance Log', 129025: 'Position, Rapid Update', 129026: 'COG & SOG, Rapid Update',
    129029: 'GNSS Position Data', 129033: 'Local Time Offset', 129038: 'AIS Class A Position', 129039: 'AIS Class B Position', 129283: 'Cross Track Error',
    129284: 'Navigation Data', 129285: 'Route/WP Information', 129539: 'GNSS DOPs', 129540: 'GNSS Sats in View', 129794: 'AIS Class A Static Data', 129809: 'AIS Class B Static Data, Part A', 129810: 'AIS Class B Static Data, Part B',
    130306: 'Wind Data', 130310: 'Environmental Parameters', 130311: 'Environmental Parameters', 130312: 'Temperature', 130313: 'Humidity',
    130314: 'Actual Pressure', 130316: 'Temperature, Extended Range', 130577: 'Direction Data' };

  const AIS_NAV_STATUS = ['Under way using engine', 'At anchor', 'Not under command', 'Restricted manoeuvrability', 'Constrained by draught', 'Moored', 'Aground', 'Fishing', 'Under way sailing'];
  function aisPosition(r, ais, cls) {
    const f = { cls, lon: sc(r.s32(5), 1e-7), lat: sc(r.s32(9), 1e-7), cog: ang(r.u16(14)), sog: sc(r.u16(16), 0.01), hdg: ang(r.u16(21)) };
    if (cls === 'A') f.status = AIS_NAV_STATUS[r.raw(25) & 15] || null;
    ais(r.u32(1), f);
  }
  /** broad AIS ship-type groups */
  const aisTypeName = (t) => (t == null ? '' : t === 30 ? 'Fishing' : t === 31 || t === 32 || t === 52 ? 'Tug' : t === 36 ? 'Sailing' : t === 37 ? 'Pleasure craft' : t === 50 ? 'Pilot' : t === 51 ? 'Search & rescue'
    : t >= 40 && t < 50 ? 'High-speed craft' : t >= 60 && t < 70 ? 'Passenger' : t >= 70 && t < 80 ? 'Cargo' : t >= 80 && t < 90 ? 'Tanker' : 'Other');

  const DECODERS = {
    60928(r, put, m) {
      const lo = r.dv.getUint32(0, true);
      put(`dev.${m.src}.mfr`, lo >>> 21); put(`dev.${m.src}.fn`, r.raw(5)); put(`dev.${m.src}.cls`, r.raw(6) >> 1);
    },
    126996(r, put, m) {
      put(`dev.${m.src}.model`, r.str(4, 32)); put(`dev.${m.src}.sw`, r.str(36, 32)); put(`dev.${m.src}.serial`, r.str(100, 32));
    },
    126992(r, put) { put('time.utc', dateTime(r.u16(2), r.u32(4))); },
    127245(r, put) { put(`rudder.${r.raw(0)}`, ang(r.s16(4))); },
    127250(r, put) {
      const h = ang(r.u16(1)), ref = r.raw(7) & 3;
      put(ref === 0 ? 'hdg.true' : 'hdg.mag', h);
      put('deviation', ang(r.s16(3))); put('variation', ang(r.s16(5)));
    },
    127251(r, put) { put('rot', sc(r.s32(1), 3.125e-8 * DEG * 60)); },            // deg/min
    127257(r, put) { put('yaw', ang(r.s16(1))); put('pitch', ang(r.s16(3))); put('roll', ang(r.s16(5))); },
    127258(r, put) { put('variation', ang(r.s16(4))); },
    127488(r, put) {
      const e = `eng.${r.raw(0)}`;
      put(`${e}.rpm`, sc(r.u16(1), 0.25)); put(`${e}.boost`, sc(r.u16(3), 0.1)); put(`${e}.trim`, r.s8(5));   // kPa, %
    },
    127489(r, put) {
      const e = `eng.${r.raw(0)}`;
      put(`${e}.oilP`, sc(r.u16(1), 0.1)); put(`${e}.oilT`, tempC(r.u16(3), 0.1)); put(`${e}.coolT`, tempC(r.u16(5), 0.01));
      put(`${e}.altV`, sc(r.s16(7), 0.01)); put(`${e}.fuelRate`, sc(r.s16(9), 0.1)); put(`${e}.hours`, sc(r.u32(11), 1 / 3600));
      put(`${e}.coolP`, sc(r.u16(15), 0.1)); put(`${e}.fuelP`, sc(r.u16(17), 1));
      if (r.n >= 24) { // all bits set = status not available (not "every warning active")
        const s1 = r.dv.getUint16(20, true), s2 = r.dv.getUint16(22, true);
        put(`${e}.status1`, s1 === 0xFFFF ? null : s1); put(`${e}.status2`, s2 === 0xFFFF ? null : s2);
      }
      put(`${e}.load`, r.s8(24)); put(`${e}.torque`, r.s8(25));
    },
    127493(r, put) {
      const e = `eng.${r.raw(0)}`, g = r.raw(1) & 3;
      put(`${e}.gear`, ['Forward', 'Neutral', 'Reverse'][g] || null);
      put(`${e}.transP`, sc(r.u16(2), 0.1)); put(`${e}.transT`, tempC(r.u16(4), 0.1));
    },
    127501(r, put) {
      const bank = r.raw(0), states = [];
      for (let i = 0; i < 28; i++) { const v = (r.raw(1 + (i >> 2)) >> ((i & 3) * 2)) & 3; states.push(v); }
      put(`switch.${bank}.states`, states);
    },
    127505(r, put) {
      const k = `tank.${r.raw(0) >> 4}-${r.raw(0) & 15}`;
      put(`${k}.level`, sc(r.s16(1), 0.004)); put(`${k}.capacity`, sc(r.u32(3), 0.1));
    },
    127506(r, put) {
      const k = `bat.${r.raw(1)}`;
      put(`${k}.soc`, r.u8(3)); put(`${k}.soh`, r.u8(4)); put(`${k}.remaining`, r.u16(5));   // %, %, minutes
    },
    127508(r, put) {
      const k = `bat.${r.raw(0)}`;
      put(`${k}.v`, sc(r.s16(1), 0.01)); put(`${k}.a`, sc(r.s16(3), 0.1)); put(`${k}.temp`, tempC(r.u16(5), 0.01));
    },
    128259(r, put) { put('stw', sc(r.u16(1), 0.01)); },
    128267(r, put) { put('depth', sc(r.u32(1), 0.01)); put('depth.offset', sc(r.s16(5), 0.001)); },
    128275(r, put) { put('log.total', r.u32(6)); put('log.trip', r.u32(10)); },
    129025(r, put) { put('lat', sc(r.s32(0), 1e-7)); put('lon', sc(r.s32(4), 1e-7)); },
    129026(r, put) { put((r.raw(1) & 3) === 1 ? 'cog.mag' : 'cog', ang(r.u16(2))); put('sog', sc(r.u16(4), 0.01)); },
    129029(r, put) {
      put('time.utc', dateTime(r.u16(1), r.u32(3)));
      put('gnss.lat', sc(r.s64(7), 1e-16)); put('gnss.lon', sc(r.s64(15), 1e-16)); put('gnss.alt', sc(r.s64(23), 1e-6));
      put('gnss.method', GNSS_METHODS[r.raw(31) >> 4] || null);
      put('gnss.sats', r.u8(33)); put('gnss.hdop', sc(r.s16(34), 0.01)); put('gnss.pdop', sc(r.s16(36), 0.01));
    },
    129283(r, put) { put('nav.xte', sc(r.s32(2), 0.01)); },
    129284(r, put) {
      put('nav.dtw', sc(r.u32(1), 0.01)); put('nav.eta', dateTime(r.u16(10), r.u32(6)));
      put('nav.btw', ang(r.u16(14))); put('nav.btw.mag', (r.raw(5) & 3) === 1);
      put('nav.wpLat', sc(r.s32(24), 1e-7)); put('nav.wpLon', sc(r.s32(28), 1e-7)); put('nav.vmg', sc(r.s16(32), 0.01));
    },
    129539(r, put) { put('gnss.hdop', sc(r.s16(2), 0.01)); put('gnss.vdop', sc(r.s16(4), 0.01)); },
    129540(r, put) { put('gnss.inView', r.u8(2)); },
    // ---- AIS (reported through the ais(mmsi, fields) callback, not the value store)
    129038(r, put, m, ais) { aisPosition(r, ais, 'A'); },
    129039(r, put, m, ais) { aisPosition(r, ais, 'B'); },
    129794(r, put, m, ais) {
      ais(r.u32(1), { cls: 'A', callsign: r.str(9, 7), name: r.str(16, 20), type: r.u8(36), length: sc(r.u16(37), 0.1), beam: sc(r.u16(39), 0.1), dest: r.str(53, 20) });
    },
    129809(r, put, m, ais) { ais(r.u32(1), { cls: 'B', name: r.str(5, 20) }); },
    129810(r, put, m, ais) { ais(r.u32(1), { cls: 'B', type: r.u8(5), callsign: r.str(13, 7), length: sc(r.u16(20), 0.1), beam: sc(r.u16(22), 0.1) }); },
    130306(r, put) {
      const spd = sc(r.u16(1), 0.01), a = ang(r.u16(3)), ref = r.raw(5) & 7;
      if (ref === 2) { put('wind.aws', spd); put('wind.awa', a); }
      else if (ref === 3 || ref === 4) { put('wind.tws', spd); put('wind.twa', a); }
      else if (ref === 0) { put('wind.tws', spd); put('wind.twd', a); }
    },
    130310(r, put) {
      put('temp.0-0', tempC(r.u16(1), 0.01)); put('temp.1-0', tempC(r.u16(3), 0.01)); put('pressure', sc(r.u16(5), 1));  // hPa
    },
    130311(r, put) {
      const src = r.raw(1) & 0x3F, hs = r.raw(1) >> 6;
      put(`temp.${src}-0`, tempC(r.u16(2), 0.01)); put(`humidity.${hs}`, sc(r.s16(4), 0.004)); put('pressure', sc(r.u16(6), 1));
    },
    130312(r, put) { put(`temp.${r.raw(2)}-${r.raw(1)}`, tempC(r.u16(3), 0.01)); put(`tempSet.${r.raw(2)}-${r.raw(1)}`, tempC(r.u16(5), 0.01)); },
    130313(r, put) { put(`humidity.${r.raw(2)}`, sc(r.s16(3), 0.004)); },
    130314(r, put) { if (r.raw(2) === 0) put('pressure', sc(r.s32(3), 0.001)); },   // 0.1 Pa -> hPa, atmospheric only
    130316(r, put) { put(`temp.${r.raw(2)}-${r.raw(1)}`, tempC(r.u24(3), 0.001)); },
  };

  const GROUPS = [[/^hdg\.|^deviation$/, 'Heading'], [/^variation$/, 'Magnetic variation'], [/^(lat|lon)$/, 'Position (rapid update)'], [/^(cog|sog)/, 'COG & SOG'],
    [/^gnss\./, 'GNSS position & quality'], [/^time\./, 'Date & time'], [/^stw$/, 'Speed through water'], [/^depth/, 'Depth'], [/^log\./, 'Distance log'],
    [/^rot$/, 'Rate of turn'], [/^(roll|pitch|yaw)$/, 'Attitude'], [/^nav\./, 'Waypoint navigation'], [/^wind\.aw/, 'Apparent wind'], [/^wind\.tw/, 'True wind'],
    [/^pressure$/, 'Barometric pressure']];
  function groupOf(k) {
    for (const [re, name] of GROUPS) if (re.test(k)) return name;
    const [p, id] = k.split('.');
    if (p === 'eng') return `Engine (instance ${id})`;
    if (p === 'bat') return `Battery (instance ${id})`;
    if (p === 'rudder') return `Rudder (instance ${id})`;
    if (p === 'switch') return `Switch bank ${id}`;
    if (p === 'humidity') return `Humidity (${id === '0' ? 'inside' : id === '1' ? 'outside' : 'source ' + id})`;
    if (p === 'tank') { const [ty, inst] = id.split('-'); return `Tank: ${TANK_TYPES[ty] || 'type ' + ty} (instance ${inst})`; }
    if (p === 'temp' || p === 'tempSet') { const [sr, inst] = id.split('-'); return `Temperature: ${TEMP_SOURCES[sr] || 'source ' + sr}${inst === '0' ? '' : ` (instance ${inst})`}`; }
    return k;
  }

  function decode(msg, put, ais) {
    const d = DECODERS[msg.pgn];
    if (!d) return false;
    try { d(new R(msg.data), put, msg, ais || (() => {})); } catch (e) { return false; }
    return true;
  }

  const api = { parseLine, decode, groupOf, aisTypeName, PGN_NAMES, TEMP_SOURCES, TANK_TYPES, ENGINE_STATUS1, ENGINE_STATUS2, MANUFACTURERS,
    supported: Object.keys(DECODERS).map(Number) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // also used by the bridge (Node.js)
  global.N2K = api;
})(typeof window !== 'undefined' ? window : globalThis);
