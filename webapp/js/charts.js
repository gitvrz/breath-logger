// Monitor-style display: one row per signal (trace on the left, big value on the right).
// The four rows share the time axis and the crosshair.
//   live mode:   x follows the newest sample, y scales only grow (no jumping)
//   review mode: drag to zoom (all rows together), pause/resume markers, value under cursor

function withAlpha(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function niceStep(span) {
  const p = Math.pow(10, Math.floor(Math.log10(span)));
  const f = span / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

class MonitorStack {
  constructor(container, { live = false, syncKey, onZoom = null } = {}) {
    this.container = container;
    this.live = live;
    this.syncKey = syncKey;
    this.onZoom = onZoom;
    this.windowS = 30;
    this.data = [[], [], [], [], []]; // x, co2, o2, flow, pressure
    this.marks = [];                  // review: [{ x, label, kind }]
    this.xFormat = live ? (v) => `${Math.round(v - this.latest)} s` : (v) => fmtTimer(v);
    this.cursorLabel = null;          // review: (x) -> text under the value
    this.latest = 0;
    this.hoverIdx = null;
    this.resetRanges();
    this.build();
  }

  resetRanges() {
    this.ranges = CHANNELS.map((c) => [...c.range]);
  }

  build() {
    this.destroyPlots();
    const muted = cssVar('--muted'), grid = cssVar('--grid');
    const font = '11px Inter, system-ui, sans-serif';
    const last = CHANNELS.length - 1;
    this.container.innerHTML = '';
    this.rows = [];
    this.plots = [];

    CHANNELS.forEach((ch, i) => {
      const color = cssVar(ch.color);
      const row = document.createElement('div');
      row.className = 'mrow' + (i === last ? ' last' : '');
      row.style.setProperty('--ch', color);
      row.innerHTML = `
        <div class="mplot"></div>
        <div class="mvalue">
          <div class="mname"><span class="dot"></span>${escapeHtml(channelName(ch))}<span class="unit">${ch.unit}</span><span class="tag warn fault-tag">${escapeHtml(t('live.noSignal'))}</span></div>
          <div class="big">—</div>
          <div class="sub"></div>
        </div>`;
      this.container.appendChild(row);
      const host = $('.mplot', row);
      this.rows.push({ row, host, big: $('.big', row), sub: $('.sub', row) });

      const opts = {
        width: Math.max(100, host.clientWidth),
        height: Math.max(60, host.clientHeight),
        scales: {
          x: { time: false },
          y: { range: (u, min, max) => this.yRange(i, min, max) },
        },
        legend: { show: false },
        padding: [10, this.live ? 14 : 28, i === last ? 0 : 10, 0], // room for the edge axis labels
        cursor: {
          y: false,
          sync: { key: this.syncKey },
          drag: { x: !this.live, y: false, setScale: !this.live },
          points: { size: 7, width: 2, fill: cssVar('--surface'), stroke: color },
        },
        series: [
          {},
          {
            stroke: color,
            width: 1.75,
            ...(ch.fill === false ? {} : { fill: withAlpha(color, 0.08) }),
            ...(ch.symmetric ? { fillTo: 0 } : {}),
            points: { show: false },
            spanGaps: false,
          },
        ],
        axes: [
          {
            stroke: muted, font, grid: { stroke: grid, width: 1 }, ticks: { show: false },
            size: i === last ? 26 : 2, space: this.live ? 60 : 90,
            values: (u, splits, ax, space, incr) => splits.map((v) => (i === last ? this.xFormat(v, incr) : '')),
          },
          { stroke: muted, font, grid: { stroke: grid, width: 1 }, ticks: { show: false }, size: 44, gap: 6 },
        ],
        hooks: {
          setCursor: [(u) => this.onCursor(u)],
          setScale: [(u, key) => this.onScale(u, key)],
          draw: [(u) => this.drawMarks(u, i === 0)],
        },
      };
      const plot = new uPlot(opts, [this.data[0], this.data[i + 1]], host);
      this.plots.push(plot);
    });

    this.ro = new ResizeObserver(() => this.resize());
    this.rows.forEach((r) => this.ro.observe(r.host));
    this.refresh();
  }

  resize() {
    this.rows.forEach((r, i) => {
      const w = Math.max(100, r.host.clientWidth), h = Math.max(60, r.host.clientHeight);
      const p = this.plots[i];
      if (p.width !== w || p.height !== h) p.setSize({ width: w, height: h });
    });
  }

  // Live: ranges only grow (stable picture). Review: fit the data with a margin.
  yRange(i, min, max) {
    const ch = CHANNELS[i];
    if (min == null || max == null || !isFinite(min) || !isFinite(max)) return this.live ? this.ranges[i] : ch.range;
    if (!this.live) {
      if (ch.symmetric) {
        const m = Math.max(Math.abs(min), Math.abs(max)) * 1.1 || 1;
        return [-m, m];
      }
      const pad = (max - min) * 0.08 || 1;
      return [min - pad, max + pad];
    }
    let [lo, hi] = this.ranges[i];
    if (min < lo || max > hi) {
      const step = niceStep((Math.max(hi, max) - Math.min(lo, min)) / 4);
      if (min < lo) lo = Math.floor(min / step) * step;
      if (max > hi) hi = Math.ceil(max / step) * step;
      if (ch.symmetric) hi = Math.max(Math.abs(lo), Math.abs(hi)), lo = -hi;
      this.ranges[i] = [lo, hi];
    }
    return this.ranges[i];
  }

  // data = [x[], co2[], o2[], flow[], pressure[]]
  setData(data, marks = []) {
    this.data = data;
    this.marks = marks;
    this.refresh();
  }

  refresh() {
    const x = this.data[0];
    this.latest = x.length ? x[x.length - 1] : 0;
    this.plots.forEach((p, i) => {
      p.setData([x, this.data[i + 1]]);
      if (this.live && x.length) p.setScale('x', { min: this.latest - this.windowS, max: this.latest });
    });
    this.updateValues();
  }

  // Channels without a valid value (ids like 'co2'): greyed value + "No signal"
  setFaults(ids = []) {
    this.rows.forEach((r, c) => r.row.classList.toggle('fault', ids.includes(CHANNELS[c].id)));
  }

  setWindow(seconds) {
    this.windowS = seconds;
    this.resetRanges();
    this.refresh();
  }

  // Min / max (and mean in review mode) of the visible part
  visibleStats(c) {
    const x = this.data[0], y = this.data[c + 1];
    if (!x.length) return null;
    const { min, max } = this.live ? { min: this.latest - this.windowS, max: this.latest } : this.plots[0].scales.x;
    let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
    for (let i = bisect(x, min); i < x.length && x[i] <= max; i++) {
      const v = y[i];
      if (v == null || !isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      sum += v;
      n++;
    }
    return n ? { lo, hi, mean: sum / n } : null;
  }

  updateValues() {
    const x = this.data[0];
    this.rows.forEach((r, c) => {
      const ch = CHANNELS[c];
      if (this.hoverIdx != null && x.length) {
        r.big.textContent = fmtValue(this.data[c + 1][this.hoverIdx], ch.dec);
        r.sub.textContent = this.cursorLabel ? this.cursorLabel(x[this.hoverIdx]) : '';
        return;
      }
      const st = this.visibleStats(c);
      if (!st) {
        r.big.textContent = '—';
        r.sub.textContent = '';
        return;
      }
      const range = `${t('live.min')} ${fmtValue(st.lo, ch.dec)} · ${t('live.max')} ${fmtValue(st.hi, ch.dec)}`;
      if (this.live) {
        r.big.textContent = fmtValue(this.data[c + 1][x.length - 1], ch.dec);
        r.sub.textContent = range;
      } else {
        r.big.textContent = fmtValue(st.mean, ch.dec);
        r.sub.textContent = `${t('view.mean')} · ${range}`;
      }
    });
  }

  // The rows share the cursor, so every row fires this with the same index: update once
  onCursor(u) {
    const idx = u.cursor.idx;
    if (idx === this.hoverIdx) return;
    this.hoverIdx = idx;
    this.updateValues();
  }

  onScale(u, key) {
    if (key !== 'x' || this.live || this.syncing || !this.plots) return;
    const { min, max } = u.scales.x;
    this.syncing = true;
    this.plots.forEach((p) => p !== u && p.setScale('x', { min, max }));
    this.syncing = false;
    this.updateValues();
    this.onZoom?.(min, max);
  }

  isZoomed() {
    const x = this.data[0];
    if (!x.length) return false;
    const { min, max } = this.plots[0].scales.x;
    return min > x[0] + 1e-6 || max < x[x.length - 1] - 1e-6;
  }

  resetZoom() {
    const x = this.data[0];
    if (x.length) this.plots[0].setScale('x', { min: x[0], max: x[x.length - 1] });
  }

  xRange() {
    return { ...this.plots[0].scales.x };
  }

  // Pause / resume markers. Labels only on the first row, shifted down when they collide.
  drawMarks(u, withLabels) {
    if (!this.marks.length) return;
    const { ctx, bbox } = u;
    const dpr = devicePixelRatio;
    ctx.save();
    ctx.font = `500 ${11 * dpr}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left'; // uPlot leaves it on 'right'
    const lineColor = cssVar('--muted'), chipBg = cssVar('--surface'), chipLine = cssVar('--line-strong'), ink = cssVar('--ink-2');
    const lanes = [-Infinity, -Infinity];
    for (const m of this.marks) {
      const x = Math.round(u.valToPos(m.x, 'x', true)) + 0.5;
      if (x < bbox.left - 1 || x > bbox.left + bbox.width + 1) continue;
      if (m.kind !== 'start') {
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = dpr;
        ctx.setLineDash(m.kind === 'pause' ? [3 * dpr, 3 * dpr] : []);
        ctx.beginPath();
        ctx.moveTo(x, bbox.top);
        ctx.lineTo(x, bbox.top + bbox.height);
        ctx.stroke();
      }
      if (!withLabels || !m.label) continue;
      const w = ctx.measureText(m.label).width + 12 * dpr, h = 18 * dpr;
      const lx = Math.min(x + 4 * dpr, bbox.left + bbox.width - w);
      const lane = lanes.findIndex((right) => lx > right + 4 * dpr);
      if (lane < 0) continue;
      lanes[lane] = lx + w;
      const ly = bbox.top + 4 * dpr + lane * (h + 3 * dpr);
      ctx.setLineDash([]);
      ctx.fillStyle = chipBg;
      ctx.strokeStyle = chipLine;
      ctx.beginPath();
      ctx.roundRect(lx, ly, w, h, 5 * dpr);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.fillText(m.label, lx + 6 * dpr, ly + h / 2);
    }
    ctx.restore();
  }

  destroyPlots() {
    this.ro?.disconnect();
    this.plots?.forEach((p) => p.destroy());
  }

  destroy() {
    this.destroyPlots();
    this.container.innerHTML = '';
  }
}

// Session CSV -> chart data on a "recorded time" axis: pauses and the gap before a
// continuation are squeezed out (a session continued the next day stays readable)
// and replaced by a marker. Keeps the real t_s of every point for clock time & trim.
// Rows hidden by a trim are skipped.
function buildSessionSeries(text, session, rateHz = 50) {
  const x = [], tReal = [], ys = [[], [], [], []], breaks = [];
  const dt = 1 / rateHz, gap = 3 / rateHz;
  let prev = null, cx = 0;
  const lines = text.split('\n');
  for (let li = 1; li < lines.length; li++) {
    const f = lines[li].split(',');
    if (f.length < 5) continue; // incomplete last line after a power cut
    const tt = parseFloat(f[0]);
    if (!isFinite(tt) || !rowVisible(tt, session.trims)) continue;
    if (prev != null) {
      if (tt - prev > gap) {
        x.push(cx + dt / 2); // a null point breaks the line
        tReal.push(prev);
        ys.forEach((a) => a.push(null));
        cx += dt;
        breaks.push({ x: cx, fromT: prev, toT: tt });
      } else cx += tt - prev;
    }
    x.push(cx);
    tReal.push(tt);
    for (let c = 0; c < 4; c++) ys[c].push(f[c + 1] === '' ? null : parseFloat(f[c + 1]));
    prev = tt;
  }

  const startMs = session.start_ms;
  const events = session.events || [];
  const clockAt = (v) => {
    const i = bisect(x, v);
    return startMs + (tReal[i] + Math.max(0, v - x[i])) * 1000;
  };
  const tAt = (v) => {
    const i = bisect(x, v);
    return tReal[i] + Math.max(0, v - x[i]);
  };

  const marks = [];
  if (x.length) marks.push({ x: x[0], kind: 'start', label: t('view.start', { date: fmtWhen(startMs + tReal[0] * 1000) }) });
  for (const b of breaks) {
    const inGap = events.filter((e) => e.t_s >= b.fromT - (e.type === 'lost' ? 1 : 0.25) && e.t_s <= b.toT + 0.25);
    if (inGap.some((e) => e.type === 'continue')) {
      marks.push({ x: b.x, kind: 'continue', label: t('view.continued', { date: fmtWhen(startMs + b.toT * 1000) }) });
    } else if (inGap.some((e) => e.type === 'pause')) {
      marks.push({ x: b.x, kind: 'pause', label: t('view.pause', { dur: fmtDur(b.toT - b.fromT) }) });
    } else if (inGap.some((e) => e.type === 'lost')) {
      const n = inGap.filter((e) => e.type === 'lost').reduce((a, e) => a + (e.n || 0), 0);
      marks.push({ x: b.x, kind: 'lost', label: t('view.lost', { n: fmtNumber(n) }) });
    } else if (inGap.some((e) => e.type === 'stall')) {
      marks.push({ x: b.x, kind: 'stall', label: t('view.stall') });
    } else {
      marks.push({ x: b.x, kind: 'gap', label: t('view.gap') });
    }
  }
  return { data: [x, ...ys], marks, clockAt, tAt, multiDay: x.length > 0 && !sameDay(clockAt(x[0]), clockAt(x[x.length - 1])) };
}
