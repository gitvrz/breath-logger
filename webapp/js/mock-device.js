// Demo mode: a fake device living in the browser. It speaks exactly the same
// protocol as the ESP32 firmware, so the whole page can be used without hardware.
// Recordings are kept in memory and disappear when the page is reloaded.

// Same breathing model as firmware/src/sensors_sim.cpp
class BreathSim {
  constructor() {
    this.phase = 0;
    this.co2 = 0.04;
    this.lastT = null;
  }

  static noise(amp) {
    return (Math.random() + Math.random() + Math.random() - 1.5) * amp;
  }

  next(t) {
    const dt = this.lastT == null ? 0.02 : t - this.lastT;
    this.lastT = t;
    const rr = 25 + 6 * Math.sin((2 * Math.PI * t) / 90);
    this.phase = (this.phase + (dt * rr) / 60) % 1;
    const ti = 0.45;
    const peak = 150 + 20 * Math.sin((2 * Math.PI * t) / 37);
    let flow, co2Target;
    if (this.phase < ti) {
      flow = peak * Math.sin((Math.PI * this.phase) / ti);
      co2Target = 0.04;
    } else {
      const pe = (this.phase - ti) / (1 - ti);
      flow = ((-peak * ti) / (1 - ti)) * Math.sin(Math.PI * pe);
      co2Target = 0.04 + 5.2 * (1 - Math.exp(-pe / 0.12));
    }
    this.co2 += ((co2Target - this.co2) * dt) / (0.08 + dt);
    const o2 = 20.95 - 1.04 * (this.co2 - 0.04);
    const n = BreathSim.noise;
    return [this.co2 + n(0.02), o2 + n(0.03), flow + n(1), 1e-4 * flow * Math.abs(flow) + n(0.02)];
  }
}

const CSV_HEADER = 't_s,co2_pct,o2_pct,flow_lpm,pressure_cmh2o\n';
const RATE = 50;
const r3 = (v) => Math.round(v * 1000) / 1000;

function csvRow(t, v) {
  return `${t.toFixed(3)},${v[0].toFixed(3)},${v[1].toFixed(3)},${v[2].toFixed(2)},${v[3].toFixed(3)}\n`;
}

class MockTransport {
  constructor() {
    this.onMessage = () => {};
    this.onClose = () => {};
    this.sim = new BreathSim();
    this.bootMs = performance.now() - 5000;
    this.sampleIndex = Math.floor(5000 / (1000 / RATE));
    this.state = 'idle';
    this.recs = new Map(); // name -> { meta, files: Map(sessionId -> csv text) }
    this.clockOffset = null;
    this.cur = null; // recording in progress
    this.trash = [];  // { name, bytes } like /trash on the SD card
    this.seed();
  }

  async open() {
    this.timer = setInterval(() => this.tick(), 100);
    this.statusTimer = setInterval(() => this.emit({ type: 'status', ...this.status() }), 500);
  }

  async close() {
    clearInterval(this.timer);
    clearInterval(this.statusTimer);
    this.onClose();
  }

  send(cmd) {
    // reply asynchronously, like a real device
    setTimeout(() => this.handle(cmd), 5 + Math.random() * 15);
  }

  emit(msg) {
    this.onMessage(JSON.parse(JSON.stringify(msg)));
  }

  uptimeMs() {
    return performance.now() - this.bootMs;
  }

  nowMs() {
    return (this.clockOffset ?? 0) + this.uptimeMs();
  }

  // ---- acquisition -----------------------------------------------------------

  tick() {
    const target = Math.floor(this.uptimeMs() / (1000 / RATE));
    let batch = [];
    while (this.sampleIndex < target) {
      const tMs = this.sampleIndex * (1000 / RATE);
      const v = this.sim.next(tMs / 1000);
      this.sampleIndex++;
      batch.push([Math.round(tMs), ...v.map(r3)]);
      if (this.state === 'recording') this.writeRow(tMs, v);
      if (batch.length === 5) {
        this.emit({ type: 'data', s: batch });
        batch = [];
      }
    }
    if (batch.length) this.emit({ type: 'data', s: batch });
  }

  writeRow(tMs, v) {
    const c = this.cur;
    if (tMs < c.runStartMs) return; // sampled before Start was pressed
    const t = c.runOffset + (tMs - c.runStartMs) / 1000;
    const r = this.recs.get(c.rec);
    r.files.set(c.session, r.files.get(c.session) + csvRow(t, v));
    c.samples++;
    c.runSamples++;
    c.lastT = t;
  }

  sessionT() {
    const c = this.cur;
    return c.runOffset + (this.uptimeMs() - c.runStartMs) / 1000;
  }

  status() {
    const s = {
      state: this.state, dropped: 0, live_dropped: 0, acq_ok: true, faults: [],
      sd: { ok: true, total_mb: 7580, free_mb: 7012 },
      clock: this.clockOffset != null, rate_hz: RATE, uptime_s: Math.floor(this.uptimeMs() / 1000),
    };
    if (this.state !== 'idle') {
      Object.assign(s, {
        rec: this.cur.rec, session: this.cur.session, samples: this.cur.samples, run_samples: this.cur.runSamples,
        t_s: r3(this.state === 'paused' ? this.cur.pausedT : this.sessionT()),
      });
    }
    return s;
  }

  // ---- helpers ---------------------------------------------------------------

  newMeta(name, notes = '') {
    return {
      name, created: new Date(this.nowMs()).toISOString().replace(/\.\d+Z$/, 'Z'), notes,
      rate_hz: RATE, columns: ['t_s', 'co2_pct', 'o2_pct', 'flow_lpm', 'pressure_cmh2o'],
      next_session: 1, sessions: [],
    };
  }

  session(meta, id) {
    return meta.sessions.find((s) => s.id === id);
  }

  addEvent(type, t) {
    const meta = this.recs.get(this.cur.rec).meta;
    this.session(meta, this.cur.session).events.push({ t_s: r3(t), type });
  }

  updateTotals() {
    const s = this.session(this.recs.get(this.cur.rec).meta, this.cur.session);
    s.samples = this.cur.samples;
    const hidden = Math.min(s.hidden_samples || 0, this.cur.samples); // hidden by a trim
    s.duration_s = r3((this.cur.samples - hidden) / RATE); // visible recorded time
    s.end_s = r3(this.cur.lastT); // t_s of the last row
  }

  // Example recordings so the Recordings page isn't empty: one session with a pause,
  // one session continued the next day, and a short recent one.
  seed() {
    const fr = LANG === 'fr';
    const at = (daysAgo, h, m) => {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      d.setHours(h, m, 0, 0);
      return d.getTime();
    };
    const now = Date.now();
    this.addDemo('demo_subject', fr ? 'Tapis roulant, protocole incrémental' : 'Treadmill, incremental protocol', at(2, 9, 41), [
      { start: at(2, 10, 0), notes: fr ? 'Échauffement' : 'Warm-up', runs: [{ at: 0, dur: 180, pauses: [[60, 75]] }] },
      { start: at(1, 16, 30), notes: fr ? 'Palier 12 km/h' : '12 km/h stage', runs: [
        { at: 0, dur: 120, pauses: [] },
        { at: (now - 2 * 3600e3 - at(1, 16, 30)) / 1000, dur: 90, pauses: [[30, 40]] },
      ] },
    ]);
    this.addDemo('athlete_02', '', now - 3600e3, [
      { start: now - 50 * 60e3, notes: '', runs: [{ at: 0, dur: 90, pauses: [], lost: [40, 0.4] }] },
    ]);
  }

  addDemo(name, notes, createdMs, sessions) {
    const meta = this.newMeta(name, notes);
    meta.created = new Date(createdMs).toISOString().replace(/\.\d+Z$/, 'Z');
    const files = new Map();
    sessions.forEach((def, i) => {
      const id = i + 1, sim = new BreathSim(), events = [];
      let csv = CSV_HEADER, n = 0, last = 0;
      def.runs.forEach((run, r) => {
        events.push({ t_s: r3(run.at), type: r ? 'continue' : 'start' });
        for (const [a, b] of run.pauses) events.push({ t_s: r3(run.at + a), type: 'pause' }, { t_s: r3(run.at + b), type: 'resume' });
        if (run.lost) events.push({ t_s: r3(run.at + run.lost[0]), type: 'lost', n: Math.round(run.lost[1] * RATE) });
        for (let k = 0; k <= run.dur * RATE; k++) {
          const rel = k / RATE, tt = run.at + rel;
          const v = sim.next(tt);
          if (run.pauses.some(([a, b]) => rel >= a && rel < b)) continue;
          if (run.lost && rel >= run.lost[0] && rel < run.lost[0] + run.lost[1]) continue;
          csv += csvRow(tt, v);
          n++;
          last = tt;
        }
        events.push({ t_s: r3(run.at + run.dur), type: 'stop' });
      });
      meta.sessions.push({
        id, file: `session_${String(id).padStart(3, '0')}.csv`,
        start: new Date(def.start).toISOString().replace(/\.\d+Z$/, 'Z'), start_ms: def.start, clock: true,
        notes: def.notes, samples: n, duration_s: r3(n / RATE), end_s: r3(last), events,
        dropped: def.runs.reduce((a, run) => a + (run.lost ? Math.round(run.lost[1] * RATE) : 0), 0),
      });
      files.set(id, csv);
    });
    meta.next_session = sessions.length + 1;
    this.recs.set(name, { meta, files });
  }

  // ---- commands (same behaviour as firmware/src/commands.cpp) ----------------

  handle(cmd) {
    const reply = { type: 'reply', id: cmd.id };
    let err = null, stateChanged = false;
    try {
      const idleOnly = ['create', 'rename', 'delete', 'notes', 'read', 'trim', 'restore', 'trash', 'empty_trash'].includes(cmd.cmd);
      if (idleOnly && this.state !== 'idle') throw new Error('busy: stop the recording first');
      switch (cmd.cmd) {
        case 'hello':
          if (cmd.time > 0) this.clockOffset = cmd.time - this.uptimeMs();
          reply.info = {
            fw: 'demo', rate_hz: RATE, simulated: true, reset_reason: 1,
            channels: CHANNELS.map((c) => ({ id: c.id, name: c.name, unit: c.unit })),
          };
          reply.status = this.status();
          break;
        case 'status': reply.status = this.status(); break;
        case 'start': reply.session = this.start(cmd); stateChanged = true; break;
        case 'pause': this.pause(); stateChanged = true; break;
        case 'resume': this.resume(); stateChanged = true; break;
        case 'stop': this.stop(); stateChanged = true; break;
        case 'list': {
          const items = this.list();
          items.forEach((it) => this.emit({ type: 'item', id: cmd.id, ...it }));
          reply.count = items.length;
          break;
        }
        case 'trash':
          reply.items = this.trash.length;
          reply.bytes = this.trash.reduce((a, x) => a + x.bytes, 0);
          break;
        case 'empty_trash': this.trash = []; break;
        case 'get': reply.meta = this.rec(cmd.rec).meta; break;
        case 'create': this.create(cmd); break;
        case 'rename': this.rename(cmd); break;
        case 'delete': this.del(cmd); break;
        case 'notes': this.notes(cmd); break;
        case 'read': Object.assign(reply, this.read(cmd)); break;
        case 'trim': this.trim(cmd); break;
        case 'restore': this.restore(cmd); break;
        default: throw new Error('unknown command');
      }
    } catch (e) {
      err = e.message;
    }
    reply.ok = !err;
    if (err) reply.error = err;
    this.emit(reply);
    if (stateChanged) this.emit({ type: 'status', ...this.status() });
  }

  rec(name) {
    const r = this.recs.get(name);
    if (!r) throw new Error('recording not found');
    return r;
  }

  start({ rec, session, notes }) {
    if (this.state !== 'idle') throw new Error('busy: already recording');
    if (!validRecName(rec || '')) throw new Error('invalid name (letters, digits, _ and -, max 32)');
    const isNew = typeof session !== 'number';
    if (!this.recs.has(rec)) {
      if (!isNew) throw new Error('recording not found');
      this.recs.set(rec, { meta: this.newMeta(rec), files: new Map() });
    }
    const r = this.recs.get(rec);
    const cur = { rec, samples: 0, runSamples: 0, lastT: 0, runStartMs: this.uptimeMs() };
    if (isNew) {
      const id = r.meta.next_session++;
      const now = this.nowMs();
      r.meta.sessions.push({
        id, file: `session_${String(id).padStart(3, '0')}.csv`,
        start: new Date(now).toISOString().replace(/\.\d+Z$/, 'Z'), start_ms: Math.round(now),
        clock: this.clockOffset != null, notes: notes || '', samples: 0, duration_s: 0, end_s: 0, events: [],
      });
      r.files.set(id, CSV_HEADER);
      Object.assign(cur, { session: id, runOffset: 0 });
    } else {
      const s = this.session(r.meta, session);
      if (!s) throw new Error('session not found');
      if (this.clockOffset == null || !s.clock) throw new Error('clock not set: cannot continue this session');
      const since = (this.nowMs() - s.start_ms) / 1000;
      Object.assign(cur, {
        session, runOffset: Math.max(since, s.end_s + 1 / RATE), samples: s.samples, lastT: s.end_s,
      });
    }
    this.cur = cur;
    this.addEvent(isNew ? 'start' : 'continue', cur.runOffset);
    this.state = 'recording';
    return cur.session;
  }

  pause() {
    if (this.state !== 'recording') throw new Error('not recording');
    this.cur.pausedT = this.sessionT();
    this.addEvent('pause', this.cur.pausedT);
    this.updateTotals();
    this.state = 'paused';
  }

  resume() {
    if (this.state !== 'paused') throw new Error('not paused');
    this.addEvent('resume', this.sessionT());
    this.state = 'recording';
  }

  stop() {
    if (this.state === 'idle') throw new Error('not recording');
    this.addEvent('stop', this.state === 'paused' ? this.cur.pausedT : this.sessionT());
    this.updateTotals();
    this.state = 'idle';
    this.cur = null;
  }

  list() {
    return [...this.recs.values()].map(({ meta }) => {
      const last = Math.max(0, ...meta.sessions.map((s) => s.start_ms + (s.end_s || 0) * 1000));
      return {
        name: meta.name, created: meta.created, notes: meta.notes, sessions: meta.sessions.length,
        duration_s: r3(meta.sessions.reduce((a, s) => a + s.duration_s, 0)),
        ...(last ? { last_ms: Math.round(last) } : {}),
      };
    });
  }

  create({ rec, notes = '' }) {
    if (!validRecName(rec || '')) throw new Error('invalid name (letters, digits, _ and -, max 32)');
    if (this.recs.has(rec)) throw new Error('a recording with this name already exists');
    this.recs.set(rec, { meta: this.newMeta(rec, notes), files: new Map() });
  }

  rename({ rec, to }) {
    const r = this.rec(rec);
    if (!validRecName(to || '')) throw new Error('invalid new name (letters, digits, _ and -, max 32)');
    if (this.recs.has(to)) throw new Error('a recording with this name already exists');
    this.recs.delete(rec);
    r.meta.name = to;
    this.recs.set(to, r);
  }

  del({ rec, session }) {
    const r = this.rec(rec);
    const size = (id) => (r.files.get(id) || '').length;
    if (session == null) {
      this.trash.push({ name: rec, bytes: [...r.files.keys()].reduce((a, id) => a + size(id), 0) });
      return this.recs.delete(rec);
    }
    const i = r.meta.sessions.findIndex((s) => s.id === session);
    if (i < 0) throw new Error('session not found');
    this.trash.push({ name: `${rec}__s${session}`, bytes: size(session) });
    r.meta.sessions.splice(i, 1);
    r.files.delete(session);
  }

  notes({ rec, session, notes = '' }) {
    const r = this.rec(rec);
    if (notes.length > 500) throw new Error('notes too long');
    if (session == null) r.meta.notes = notes;
    else {
      const s = this.session(r.meta, session);
      if (!s) throw new Error('session not found');
      s.notes = notes;
    }
  }

  read({ rec, session, offset = 0, len = 4096 }) {
    const text = this.rec(rec).files.get(session);
    if (text == null) throw new Error('session file not found');
    const data = text.slice(offset, offset + Math.min(len, 4096));
    return { offset, size: text.length, eof: offset + data.length >= text.length, n: data.length, crc: crc32(data), data };
  }

  // Like the firmware: the CSV is never modified, the trim goes into meta.json
  trim({ rec, session, from_s, to_s }) {
    if (!(to_s > from_s)) throw new Error('invalid range');
    const r = this.rec(rec);
    const s = this.session(r.meta, session);
    if (!s) throw new Error('session not found');
    const trims = [...(s.trims || []), { from_s: r3(from_s), to_s: r3(to_s), end_s: s.end_s, at_ms: this.nowMs() }];
    let rows = 0, visible = 0;
    for (const line of r.files.get(session).split('\n').slice(1)) {
      if (!line) continue;
      rows++;
      if (rowVisible(parseFloat(line), trims)) visible++;
    }
    if (!visible) throw new Error('nothing to keep in this range');
    s.trims = trims;
    s.hidden_samples = rows - visible;
    s.duration_s = r3(visible / RATE);
    (s.edits ||= []).push({ type: 'trim', at_ms: this.nowMs(), from_s: r3(from_s), to_s: r3(to_s) });
  }

  restore({ rec, session }) {
    const s = this.session(this.rec(rec).meta, session);
    if (!s) throw new Error('session not found');
    if (!s.trims?.length) return;
    delete s.trims;
    s.hidden_samples = 0;
    s.duration_s = r3(s.samples / RATE);
    (s.edits ||= []).push({ type: 'restore', at_ms: this.nowMs() });
  }
}
