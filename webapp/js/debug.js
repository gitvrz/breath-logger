// Timing panel for diagnosing a jerky live view: open the page with ?debug at the end
// of the address (index.html?debug). It shows, as Chrome sees them:
//  - gaps between "data" messages (data arriving late),
//  - gaps between drawn frames (the page itself blocked),
//  - the device's own counters (status "diag": where data waits inside the device).
// "Download log" saves everything as CSV. Developer tool: texts are not translated.

const DEBUG_GAP_MS = 150;

class DebugPanel {
  static wanted() {
    return new URLSearchParams(location.search).has('debug');
  }

  constructor() {
    this.t0 = performance.now();
    this.log = [];    // [kind, pc_ms, a, b, c, d]
    this.data = [];   // { at, last } recent data messages
    this.gaps = [];   // { at, ms } data gaps > DEBUG_GAP_MS
    this.frames = []; // { at, ms } frame gaps > 100 ms
    this.diag = [];   // { at, ...diag }
    this.minLag = Infinity;
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:999;max-width:430px;padding:10px 12px;'
      + 'border-radius:10px;background:rgba(0,0,0,.85);color:#e6e6e6;font:12px/1.45 ui-monospace,Consolas,monospace;white-space:pre-wrap';
    document.body.appendChild(this.el);
    this.btn = document.createElement('button');
    this.btn.textContent = 'Download log';
    this.btn.className = 'btn';
    this.btn.style.marginTop = '8px';
    this.btn.onclick = () => this.download();
    this.text = document.createElement('div');
    this.el.append(this.text, this.btn);

    let lastFrame = performance.now();
    const frame = (now) => {
      const gap = now - lastFrame;
      lastFrame = now;
      if (gap > 100) {
        this.frames.push({ at: now, ms: gap });
        this.log.push(['frame', now - this.t0, Math.round(gap)]);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    setInterval(() => this.render(), 500);
  }

  reset() {
    this.data = [];
    this.minLag = Infinity;
  }

  onData(samples) {
    if (!samples.length) return;
    const at = performance.now(), last = samples[samples.length - 1][0];
    const prev = this.data[this.data.length - 1];
    if (prev && at - prev.at > DEBUG_GAP_MS) this.gaps.push({ at, ms: at - prev.at });
    this.data.push({ at, last });
    this.minLag = Math.min(this.minLag, at - last);
    this.log.push(['data', at - this.t0, samples[0][0], last, samples.length]);
  }

  onStatus(st) {
    if (!st.diag) return;
    const at = performance.now();
    this.diag.push({ at, ...st.diag });
    const d = st.diag;
    this.log.push(['diag', at - this.t0, d.tx_max, d.stall_max_ms, d.loop_max_ms, d.age_max_ms]);
  }

  render() {
    const now = performance.now(), win = now - 10000;
    this.data = this.data.filter((x) => x.at >= win - 1000);
    const recent = this.data.filter((x) => x.at >= win);
    let ivMax = 0;
    for (let i = 1; i < recent.length; i++) ivMax = Math.max(ivMax, recent[i].at - recent[i - 1].at);
    const periods = this.gaps.slice(-12).map((g, i, a) => (i ? (g.at - a[i - 1].at) / 1000 : null)).filter((x) => x != null).sort((a, b) => a - b);
    const median = periods.length ? periods[Math.floor(periods.length / 2)].toFixed(2) + ' s' : '–';
    const lastGaps = this.gaps.slice(-4).map((g) => `${((g.at - this.t0) / 1000).toFixed(1)}s:${Math.round(g.ms)}ms`).join('  ') || '–';
    const frames10 = this.frames.filter((f) => f.at >= win);
    const fMax = frames10.reduce((m, f) => Math.max(m, f.ms), 0);
    const d10 = this.diag.filter((x) => x.at >= win);
    const dmax = (k) => (d10.length ? Math.max(...d10.map((x) => x[k] ?? 0)) : '–');
    const lastData = this.data[this.data.length - 1];
    const lag = lastData ? Math.round(lastData.at - lastData.last - this.minLag) : '–';
    this.text.textContent = [
      'DEBUG timing (Chrome)',
      `data msgs : ${(recent.length / 10).toFixed(1)}/s   max interval (10 s): ${Math.round(ivMax)} ms`,
      `data gaps >${DEBUG_GAP_MS}ms: ${this.gaps.length}   median period: ${median}`,
      `  last: ${lastGaps}`,
      `extra delay now: ${lag} ms`,
      `frames >100ms (10 s): ${frames10.length}   worst: ${Math.round(fMax)} ms   (total ${this.frames.length})`,
      `device (10 s max): tx ${dmax('tx_max')} B  stall ${dmax('stall_max_ms')} ms  loop ${dmax('loop_max_ms')} ms  age ${dmax('age_max_ms')} ms`,
    ].join('\n');
  }

  download() {
    const rows = this.log.map((r) => r.map((v) => (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(1) : v)).join(','));
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    downloadText(`debug-${stamp}.csv`, 'kind,pc_ms,a,b,c,d\n' + rows.join('\n') + '\n');
  }
}
