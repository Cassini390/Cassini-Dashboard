/*
 * History store for the bridge.
 *
 * The bridge decodes the same N2K ASCII stream the browsers get and keeps a history of the
 * main values so charts can show 24 hours / 7 days / 30 days, and the track survives a page reload.
 *
 *   fine tier   : one sample every 30 s, kept for 24 hours
 *   coarse tier : 10-minute averages, kept for 30 days
 *
 * Saved to history.json every 10 minutes and on shutdown (not in --demo mode).
 */
'use strict';
const fs = require('fs');

const FINE_MS = 30000, FINE_KEEP = 24 * 3600000;
const COARSE_MS = 600000, COARSE_KEEP = 30 * 24 * 3600000;
const RANGES = { '24h': 24 * 3600000, '7d': 7 * 24 * 3600000, '30d': 30 * 24 * 3600000 };
// values worth keeping (store keys as produced by public/n2k.js)
const KEEP = /^(depth|sog|stw|pressure|lat|lon|wind\.(aws|awa|tws|twa)|temp\.[01]-0|bat\.\d+\.(v|a|soc)|eng\.\d+\.(rpm|coolT|oilP|fuelRate)|tank\.[\d-]+\.level)$/;
const RAD = Math.PI / 180;

class History {
  /** @param N2K decoder  @param opts {file, persist, sources: () => ({group: src})} */
  constructor(N2K, opts) {
    this.N2K = N2K; this.file = opts.file; this.persist = !!opts.persist; this.sources = opts.sources || (() => ({}));
    this.clear();
    this.put = this.put.bind(this);
    this.timers = [setInterval(() => this.tick(), FINE_MS)];
    if (this.persist) { this.load(); this.timers.push(setInterval(() => this.save(), COARSE_MS)); }
  }

  clear(tag = '') {
    this.tag = tag;                       // identifies the data source; history is dropped when it changes
    this.latest = new Map();              // key -> { v, t }
    this.fine = {}; this.coarse = {};     // key -> { t: [], v: [] }
    this.acc = {}; this.bucket = Math.floor(Date.now() / COARSE_MS);
    this.groupSrc = new Map(); this.groupSeen = new Map(); this.cur = null;
  }

  ingest(line) {
    const m = this.N2K.parseLine(line);
    if (!m) return;
    this.cur = m.src;
    this.N2K.decode(m, this.put);
    this.cur = null;
  }

  // same one-source-at-a-time rule as the dashboard, so duplicated data does not get mixed in the history
  put(k, v) {
    if (typeof v !== 'number' || !isFinite(v) || !KEEP.test(k)) return;
    const now = Date.now(), g = this.N2K.groupOf(k);
    let seen = this.groupSeen.get(g); if (!seen) this.groupSeen.set(g, (seen = new Map()));
    seen.set(this.cur, now);
    const live = (s) => s != null && seen.has(s) && now - seen.get(s) < 25000;
    const pref = this.sources()[g];
    let act = this.groupSrc.get(g);
    if (pref != null && live(pref)) act = pref; else if (!live(act)) act = this.cur;
    this.groupSrc.set(g, act);
    if (act !== this.cur) return;
    this.latest.set(k, { v, t: now });
  }

  tick() {
    const now = Date.now(), fresh = (k) => { const e = this.latest.get(k); return e && now - e.t < 25000 ? e.v : null; };
    const sample = new Map();
    for (const [k, e] of this.latest) if (now - e.t < 25000) sample.set(k, e.v);
    // true wind speed, calculated from apparent wind and boat speed when the network does not supply it
    if (!sample.has('wind.tws')) {
      const aws = fresh('wind.aws'), awa = fresh('wind.awa'), bs = fresh('stw') ?? fresh('sog');
      if (aws != null && awa != null && bs != null) sample.set('tws', Math.hypot(aws * Math.cos(awa * RAD) - bs, aws * Math.sin(awa * RAD)));
    } else sample.set('tws', sample.get('wind.tws'));
    for (const k of ['wind.aws', 'wind.awa', 'wind.tws', 'wind.twa', 'stw']) if (k !== 'stw') sample.delete(k);

    const round = (k, v) => (k === 'lat' || k === 'lon' ? Math.round(v * 1e6) / 1e6 : Math.round(v * 1000) / 1000);
    for (const [k, v] of sample) {
      const f = (this.fine[k] = this.fine[k] || { t: [], v: [] });
      f.t.push(now); f.v.push(round(k, v));
      const a = (this.acc[k] = this.acc[k] || { s: 0, n: 0 });
      a.s += v; a.n++;
    }
    const b = Math.floor(now / COARSE_MS);
    if (b !== this.bucket) {                       // 10-minute bucket finished: store the averages
      const t = this.bucket * COARSE_MS + COARSE_MS / 2;
      for (const k in this.acc) if (this.acc[k].n) { const c = (this.coarse[k] = this.coarse[k] || { t: [], v: [] }); c.t.push(t); c.v.push(round(k, this.acc[k].s / this.acc[k].n)); }
      this.acc = {}; this.bucket = b;
    }
    const trim = (tier, keep) => { for (const k in tier) { const s = tier[k]; let i = 0; while (i < s.t.length && now - s.t[i] > keep) i++; if (i) { s.t.splice(0, i); s.v.splice(0, i); } if (!s.t.length) delete tier[k]; } };
    trim(this.fine, FINE_KEEP); trim(this.coarse, COARSE_KEEP);
  }

  /** @returns [[t, v], ...] for a key over '24h' | '7d' | '30d', at most ~800 points */
  query(key, range) {
    const ms = RANGES[range] || RANGES['24h'], since = Date.now() - ms;
    const s = (ms <= FINE_KEEP ? this.fine : this.coarse)[key];
    if (!s) return [];
    const pts = [];
    for (let i = 0; i < s.t.length; i++) if (s.t[i] >= since) pts.push([s.t[i], s.v[i]]);
    if (pts.length <= 800) return pts;
    const step = Math.ceil(pts.length / 800), out = [];
    for (let i = 0; i < pts.length; i += step) {
      let sv = 0, n = 0;
      for (let j = i; j < Math.min(i + step, pts.length); j++) { sv += pts[j][1]; n++; }
      out.push([pts[Math.min(i + (step >> 1), pts.length - 1)][0], sv / n]);
    }
    return out;
  }

  /** @returns [[t, lat, lon], ...] */
  track(range) {
    const ms = RANGES[range] || RANGES['24h'], since = Date.now() - ms, tier = ms <= FINE_KEEP ? this.fine : this.coarse;
    const la = tier.lat, lo = tier.lon;
    if (!la || !lo) return [];
    const lon = new Map(lo.t.map((t, i) => [t, lo.v[i]])), out = [];
    for (let i = 0; i < la.t.length; i++) if (la.t[i] >= since && lon.has(la.t[i])) out.push([la.t[i], la.v[i], lon.get(la.t[i])]);
    return out;
  }

  save() {
    if (!this.persist) return;
    try { fs.writeFileSync(this.file, JSON.stringify({ version: 1, tag: this.tag, fine: this.fine, coarse: this.coarse })); } catch (e) { console.warn('could not save history:', e.message); }
  }

  load() {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (j.version === 1 && j.fine && j.coarse) { this.fine = j.fine; this.coarse = j.coarse; this.loadedTag = j.tag || ''; }
    } catch { /* no history yet */ }
  }

  /** call when the data source is known/changes: keeps loaded history only if it came from the same source */
  setSource(tag) {
    if (this.tag === tag) return;
    if (this.loadedTag === tag) { this.tag = tag; this.loadedTag = null; return; }
    this.clear(tag); this.loadedTag = null;
  }

  stop() { this.timers.forEach(clearInterval); this.save(); }
}

module.exports = { History };
