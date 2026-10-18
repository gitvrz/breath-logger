// Talks to the device (real or demo) with the protocol in docs/protocol.md.
// Every command gets exactly one reply with the same id.

class Device {
  constructor(transport) {
    this.transport = transport;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = {};
    transport.onMessage = (m) => this.handleMessage(m);
    transport.onClose = () => this.handleClose();
  }

  on(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }

  emit(type, arg) {
    (this.listeners[type] || []).forEach((fn) => fn(arg));
  }

  handleMessage(m) {
    if (m.type === 'item') {
      // Part of a long answer: collect it, and give the device more time
      const p = this.pending.get(m.id);
      if (!p) return;
      const { type, id, ...item } = m;
      p.items.push(item);
      clearTimeout(p.timer);
      p.timer = setTimeout(p.onTimeout, p.timeoutMs);
      return;
    }
    if (m.type === 'reply') {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      m.streamed = p.items; // the "item" messages received before the reply
      if (m.ok) p.resolve(m);
      else p.reject(new Error(m.error || 'error'));
      return;
    }
    this.emit(m.type, m); // data, status, event
  }

  handleClose() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('device disconnected'));
    }
    this.pending.clear();
    this.emit('close');
  }

  // Sends a command and resolves with the reply (rejects with the device's error).
  request(cmd, args = {}, timeoutMs = 5000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const onTimeout = () => {
        this.pending.delete(id);
        const e = new Error(`the device did not answer "${cmd}"`);
        e.timeout = true;
        reject(e);
      };
      const timer = setTimeout(onTimeout, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, onTimeout, timeoutMs, items: [] });
      Promise.resolve(this.transport.send({ cmd, id, ...args })).catch((e) => {
        clearTimeout(this.pending.get(id)?.timer);
        this.pending.delete(id);
        reject(e);
      });
    });
  }

  // Downloads a whole session CSV, a few 4 KB chunks at a time.
  // One chunk of a session file, checked against its length and CRC (asked again if damaged)
  // A chunk that does not come (Wi-Fi hiccup) is asked again too, up to 3 times.
  async readChunk(rec, session, offset, len) {
    for (let attempt = 1; ; attempt++) {
      let r;
      try {
        r = await this.request('read', { rec, session, offset, len }, 10000);
      } catch (e) {
        if (!e.timeout || attempt === 3) throw e;
        continue;
      }
      if (r.crc == null || (r.data.length === r.n && crc32(r.data) === r.crc)) return r;
      if (attempt === 3) throw new Error('data corrupted during transfer');
    }
  }

  async readSession(rec, session, onProgress = () => {}) {
    const CHUNK = 4096, PARALLEL = 3;
    const first = await this.readChunk(rec, session, 0, CHUNK);
    const size = first.size;
    const parts = [first.data];
    let done = first.data.length;
    onProgress(done, size);
    const offsets = [];
    for (let o = CHUNK; o < size; o += CHUNK) offsets.push(o);
    let next = 0, failed = false;
    const worker = async () => {
      while (!failed && next < offsets.length) {
        const i = next++;
        let r;
        try {
          r = await this.readChunk(rec, session, offsets[i], CHUNK);
        } catch (e) {
          failed = true; // the other workers stop asking
          throw e;
        }
        parts[i + 1] = r.data;
        done += r.data.length;
        onProgress(done, size);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    return parts.join('');
  }

  close() {
    return this.transport.close();
  }
}
