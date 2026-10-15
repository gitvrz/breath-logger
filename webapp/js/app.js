// Main page logic: navigation, device panel, recording controls, live monitor.

const MAX_WINDOW_S = 60;
// The live traces are drawn this late, so that samples arriving in batches every 100 ms
// (plus USB jitter) are already there when the scrolling reaches them: smooth at 60 fps.
const LIVE_DELAY_S = 0.2;

class App {
  constructor() {
    this.device = null;
    this.mode = null;          // 'usb' | 'demo'
    this.info = null;
    this.status = null;
    this.recList = [];         // summaries from the device
    this.live = [[], [], [], [], []];
    this.lags = [];            // [{ at, lag }] PC time - device time of recent data (s)
    this.lagMin = null;        // smoothed smallest lag: maps device time to PC time
    this.loopRunning = false;
    this.page = 'live';
    this.transportMode = null; // 'setup' | 'running'
    this.runInfo = null;       // { key, startedMs, continued }
    this.setup = { name: '', mode: 'new', session: null, notes: '' };
    this.lastDataMs = 0;
    this.debug = DebugPanel.wanted() ? new DebugPanel() : null; // index.html?debug

    this.initTheme();
    document.documentElement.lang = LANG;
    applyIcons();
    applyI18n();

    this.liveStack = new MonitorStack($('#liveMonitor'), { live: true, syncKey: 'live' });
    this.recs = new RecordingsPage(this);

    $$('.nav-item').forEach((b) => (b.onclick = () => this.route(b.dataset.route)));
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action="connect"], [data-action="demo"], [data-action="disconnect"]');
      if (!a || a.disabled) return;
      if (a.dataset.action === 'connect') this.connect('usb');
      else if (a.dataset.action === 'demo') this.connect('demo');
      else this.device?.close();
    });
    $$('#winSeg button').forEach((b) => (b.onclick = () => {
      $$('#winSeg button').forEach((x) => x.classList.toggle('active', x === b));
      this.liveStack.setWindow(Number(b.dataset.win));
    }));
    $$('#langSeg button').forEach((b) => (b.onclick = () => this.setLanguage(b.dataset.lang)));
    $$('#themeSeg button').forEach((b) => (b.onclick = () => this.setTheme(b.dataset.themeChoice)));
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.rebuildCharts());

    if (!SerialTransport.supported()) $('#heroNoSerial').hidden = false;
    setInterval(() => this.checkAlerts(), 1000);
    this.renderAll();
  }

  // ---- preferences -------------------------------------------------------------

  initTheme() {
    let theme = 'system';
    try {
      theme = localStorage.getItem('theme') || 'system';
    } catch {}
    this.applyTheme(theme);
  }

  applyTheme(theme) {
    this.theme = theme;
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    $$('#themeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.themeChoice === theme));
  }

  setTheme(theme) {
    try {
      localStorage.setItem('theme', theme);
    } catch {}
    this.applyTheme(theme);
    this.rebuildCharts();
  }

  setLanguage(lang) {
    setLang(lang);
    this.transportMode = null; // rebuild with the new texts
    this.renderAll();
    this.rebuildCharts();
  }

  rebuildCharts() {
    this.liveStack.build();
    this.recs.rebuildCharts();
  }

  renderAll() {
    $$('#langSeg button').forEach((b) => b.classList.toggle('active', b.dataset.lang === LANG));
    this.renderDevice();
    this.renderLive();
    this.renderNav();
    this.recs.render();
  }

  // ---- navigation --------------------------------------------------------------

  route(page) {
    this.page = page;
    const nav = page === 'session' ? 'recordings' : page;
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.route === nav));
    $('#page-live').hidden = page !== 'live';
    $('#page-recordings').hidden = page !== 'recordings';
    $('#page-session').hidden = page !== 'session';
    if (page === 'recordings' && this.device && !this.recList.length) this.recs.refresh();
    $('.main').scrollTop = 0;
    this.startLiveLoop();
  }

  renderNav() {
    const st = this.status;
    const navRec = $('#navRec');
    navRec.hidden = !st || st.state === 'idle';
    navRec.classList.toggle('paused', st?.state === 'paused');
    $('#navCount').textContent = this.device && this.recList.length ? this.recList.length : '';
  }

  // ---- connection --------------------------------------------------------------

  async connect(mode) {
    if (this.device) await this.device.close();
    const transport = mode === 'demo' ? new MockTransport() : new SerialTransport();
    const device = new Device(transport);
    try {
      await transport.open();
    } catch (e) {
      if (e.name !== 'NotFoundError') toast(t('toast.openFailed', { msg: e.message }), 'error'); // NotFoundError = window closed
      return;
    }
    this.device = device;
    this.mode = mode;
    this.live = [[], [], [], [], []];
    this.resetLiveClock();
    this.lastDataMs = Date.now();
    this.debug?.reset();
    device.on('data', (m) => this.onData(m.s));
    device.on('status', (m) => this.onStatus(m));
    device.on('event', (m) => toast(m.level === 'error' ? errText(m.msg) : m.msg, m.level === 'error' ? 'error' : 'info'));
    device.on('close', () => this.onDisconnected());
    try {
      const r = await device.request('hello', { time: Date.now() });
      this.info = r.info;
      this.onStatus(r.status);
      if (mode === 'usb') toast(t('toast.connected'), 'success');
      await this.recs.refresh();
    } catch (e) {
      toast(t('toast.noAnswer'), 'error');
    }
    this.renderAll();
  }

  onDisconnected() {
    if (!this.device) return;
    const wasUsb = this.mode === 'usb';
    this.device = this.info = this.status = this.mode = null;
    this.recList = [];
    this.runInfo = null;
    if (wasUsb) toast(t('toast.disconnected'), 'info');
    this.recs.reset();
    this.renderAll();
  }

  onRecordingsListed(list) {
    this.recList = list;
    this.renderNav();
    if (this.transportMode === 'setup') this.updateSetup();
  }

  // ---- device panel (sidebar) -----------------------------------------------------

  renderDevice() {
    const el = $('#device');
    if (!this.device) {
      const noSerial = !SerialTransport.supported();
      el.innerHTML = `
        <div class="device-head">
          <div class="device-badge">${icon('plug', 17)}</div>
          <div><div class="device-title">${escapeHtml(t('device.title'))}</div><div class="device-sub">${escapeHtml(t('device.none'))}</div></div>
        </div>
        <div class="device-actions">
          <button class="btn primary" data-action="connect" ${noSerial ? 'disabled' : ''}>${icon('plug', 16)}${escapeHtml(t('device.connect'))}</button>
          <button class="btn" data-action="demo">${icon('flask', 16)}${escapeHtml(t('device.demo'))}</button>
        </div>`;
      return;
    }
    const sub = this.info
      ? t('device.fw', { fw: this.info.fw, rate: this.info.rate_hz }) + (this.info.simulated && this.mode !== 'demo' ? ` · ${t('device.simulated')}` : '')
      : '';
    el.innerHTML = `
      <div class="device-head">
        <div class="device-badge on">${icon(this.mode === 'demo' ? 'flask' : 'plug', 17)}</div>
        <div><div class="device-title">${escapeHtml(t(this.mode === 'demo' ? 'device.connectedDemo' : 'device.connectedUsb'))}</div><div class="device-sub">${escapeHtml(sub)}</div></div>
      </div>
      <div class="device-rows" id="deviceRows"></div>
      <div class="device-actions">
        <button class="btn ghost" data-action="disconnect">${icon('logout', 16)}${escapeHtml(t('device.disconnect'))}</button>
      </div>`;
    this.updateDeviceRows();
  }

  updateDeviceRows() {
    const el = $('#deviceRows');
    const st = this.status;
    if (!el || !st) return;
    const sd = st.sd;
    const usedPct = sd.ok && sd.total_mb ? Math.round((100 * (sd.total_mb - sd.free_mb)) / sd.total_mb) : 0;
    el.innerHTML = `
      <div class="drow ${sd.ok ? '' : 'bad'}" title="${escapeHtml(sd.ok ? t('device.sdFree', { free: fmtSize(sd.free_mb), total: fmtSize(sd.total_mb) }) : '')}"><span>${escapeHtml(t('device.sd'))}</span><span>${escapeHtml(sd.ok ? t('device.sdFreeShort', { free: fmtSize(sd.free_mb) }) : t('device.sdMissing'))}</span></div>
      ${sd.ok ? `<div class="gauge"><div style="width:${usedPct}%"></div></div>` : ''}
      <div class="drow ${st.clock ? '' : 'bad'}"><span>${escapeHtml(t('device.clock'))}</span><span>${escapeHtml(t(st.clock ? 'device.clockOk' : 'device.clockNo'))}</span></div>
      <div class="drow ${st.acq_ok === false ? 'bad' : ''}"><span>${escapeHtml(t('device.acq'))}</span><span>${escapeHtml(t(st.acq_ok === false ? 'device.acqStalled' : 'device.acqOk'))}</span></div>
      <div class="drow ${st.dropped ? 'bad' : ''}"><span>${escapeHtml(t('device.lost'))}</span><span>${fmtNumber(st.dropped)}</span></div>`;
  }

  // ---- status ----------------------------------------------------------------------

  onStatus(st) {
    const prev = this.status;
    this.status = st;
    this.debug?.onStatus(st);
    const changed = !prev || prev.state !== st.state || prev.rec !== st.rec || prev.session !== st.session;
    this.updateDeviceRows();
    this.liveStack.setFaults(st.faults || []);
    this.checkAlerts();
    if (changed) {
      this.renderNav();
      this.recs.render();
    }
    this.renderLive();
  }

  // Banner on the Live page when measurements stop or a sensor gives nothing
  checkAlerts() {
    const el = $('#liveAlert');
    const st = this.status;
    let msg = '';
    if (this.device && st) {
      const silent = Math.round((Date.now() - this.lastDataMs) / 1000);
      if (st.acq_ok === false) msg = t('alert.stalled', { s: Math.max(1, silent) });
      else if (silent >= 2) msg = t('alert.noData', { s: silent });
      else if (st.faults?.length) msg = t('alert.faults', { list: st.faults.map((id) => channelName(CHANNELS.find((c) => c.id === id) || { id, name: id })).join(', ') });
    }
    el.hidden = !msg;
    if (msg && el.dataset.msg !== msg) el.innerHTML = `${icon('alert', 18)}<span>${escapeHtml(msg)}</span>`;
    el.dataset.msg = msg;
  }

  // ---- live page -------------------------------------------------------------------

  renderLive() {
    const connected = !!this.device;
    $('#liveEmpty').hidden = connected;
    $('#transport').hidden = !connected || !this.status;
    $('#liveMonitor').hidden = !connected;
    $('#liveTools').hidden = !connected;
    if (!connected || !this.status) {
      this.transportMode = null;
      return;
    }
    const mode = this.status.state === 'idle' ? 'setup' : 'running';
    if (mode !== this.transportMode) {
      this.transportMode = mode;
      if (mode === 'setup') this.buildSetup();
      else this.buildRunning();
    }
    if (mode === 'setup') this.updateSetup();
    else this.updateRunning();
  }

  // Idle: choose recording name, new/continue session, notes, Start
  buildSetup() {
    const s = this.setup;
    $('#transport').innerHTML = `
      <div class="setup">
        <div class="field">
          <label for="recName">${escapeHtml(t('setup.recording'))}</label>
          <div class="name-wrap">
            <input id="recName" maxlength="32" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(t('setup.recordingPh'))}" value="${escapeHtml(s.name)}">
            <span class="tag" id="nameTag" hidden></span>
            <div class="suggest" id="suggest" hidden></div>
          </div>
          <div class="field-help" id="nameHelp"></div>
        </div>
        <div class="field">
          <label>${escapeHtml(t('setup.session'))}</label>
          <div class="session-pick">
            <div class="seg full" id="sessMode">
              <button data-mode="new">${escapeHtml(t('setup.newSession'))}</button>
              <button data-mode="continue">${escapeHtml(t('setup.continueSession'))}</button>
            </div>
            <select id="sessSel" hidden></select>
          </div>
        </div>
        <div class="field">
          <label for="sessNotes">${escapeHtml(t('setup.notes'))}</label>
          <input id="sessNotes" maxlength="500" placeholder="${escapeHtml(t('setup.notesPh'))}" value="${escapeHtml(s.notes)}">
        </div>
        <div class="start-col">
          <button class="btn rec lg" id="btnStart">${icon('record', 18)}${escapeHtml(t('setup.start'))}</button>
        </div>
      </div>`;

    const input = $('#recName');
    input.oninput = () => {
      s.name = input.value.trim();
      this.showSuggest();
      this.updateSetup();
    };
    input.onfocus = () => this.showSuggest();
    input.onblur = () => setTimeout(() => ($('#suggest').hidden = true), 120);
    input.onkeydown = (e) => this.suggestKey(e);
    $('#suggest').onmousedown = (e) => {
      const b = e.target.closest('button[data-name]');
      if (!b) return;
      e.preventDefault();
      this.pickName(b.dataset.name);
    };
    $$('#sessMode button').forEach((b) => (b.onclick = () => {
      s.mode = b.dataset.mode;
      this.updateSetup();
    }));
    $('#sessSel').onchange = (e) => (s.session = Number(e.target.value));
    $('#sessNotes').oninput = (e) => (s.notes = e.target.value);
    $('#btnStart').onclick = () => {
      const sid = s.mode === 'continue' ? s.session : 'new';
      this.startRecording(s.name, sid, s.mode === 'new' ? s.notes : '');
    };
  }

  existing(name) {
    return this.recList.find((r) => r.name === name);
  }

  updateSetup() {
    if (this.transportMode !== 'setup') return;
    const s = this.setup, st = this.status;
    const rec = this.existing(s.name);
    const valid = validRecName(s.name);

    const tag = $('#nameTag');
    tag.hidden = !valid;
    tag.className = rec ? 'tag' : 'tag accent';
    tag.textContent = rec ? t('setup.existing') : t('setup.new');
    $('#recName').classList.toggle('invalid', s.name !== '' && !valid);
    const help = $('#nameHelp');
    help.style.color = s.name !== '' && !valid ? 'var(--rec)' : '';
    help.textContent = s.name !== '' && !valid
      ? t('dlg.invalidName')
      : rec ? `${t('list.sessions', { n: rec.sessions })}${rec.last_ms ? ' · ' + fmtWhen(rec.last_ms) : ''}` : t('setup.nameHelp');

    // "continue" is only possible for an existing recording with sessions
    const canContinue = !!rec && rec.sessions > 0;
    if (!canContinue) s.mode = 'new';
    $$('#sessMode button').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === s.mode);
      if (b.dataset.mode === 'continue') {
        b.disabled = !canContinue;
        b.title = canContinue ? '' : t('setup.noSessions');
      }
    });
    const sel = $('#sessSel');
    sel.hidden = s.mode !== 'continue';
    if (s.mode === 'continue') this.fillSessions(s.name);
    $('#sessNotes').disabled = s.mode !== 'new';

    const btn = $('#btnStart');
    const ready = valid && st.sd.ok && (s.mode === 'new' || s.session != null);
    btn.disabled = !ready;
    btn.title = st.sd.ok ? '' : t('setup.noSd');
  }

  async fillSessions(name) {
    const sel = $('#sessSel');
    if (sel.dataset.rec === name && sel.options.length) return;
    sel.dataset.rec = name;
    let meta = this.recs.metas.get(name);
    if (!meta) {
      try {
        meta = await this.recs.loadMeta(name);
      } catch {
        return;
      }
    }
    if (this.setup.name !== name || this.transportMode !== 'setup') return;
    const sessions = [...meta.sessions].sort((a, b) => b.id - a.id);
    sel.innerHTML = sessions.map((x) => `<option value="${x.id}">${escapeHtml(t('setup.sessionOption', { id: x.id, date: fmtWhen(x.start_ms), dur: fmtDur(x.duration_s) }))}</option>`).join('');
    if (!sessions.some((x) => x.id === this.setup.session)) this.setup.session = sessions[0]?.id ?? null;
    sel.value = this.setup.session ?? '';
    this.updateSetup();
  }

  // Name suggestions (existing recordings)
  showSuggest() {
    const box = $('#suggest');
    const q = this.setup.name.toLowerCase();
    const items = this.recList.filter((r) => !r.error && r.name.toLowerCase().includes(q) && r.name !== this.setup.name).slice(0, 8);
    this.suggestIdx = -1;
    box.hidden = !items.length || document.activeElement !== $('#recName');
    box.innerHTML = items.map((r) => `
      <button type="button" data-name="${escapeHtml(r.name)}">
        <span class="s-name">${escapeHtml(r.name)}</span>
        <span class="s-meta">${escapeHtml(t('list.sessions', { n: r.sessions }))}${r.last_ms ? ' · ' + escapeHtml(fmtWhen(r.last_ms)) : ''}</span>
      </button>`).join('');
  }

  suggestKey(e) {
    const box = $('#suggest');
    const items = $$('button', box);
    if (box.hidden || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.suggestIdx = (this.suggestIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((b, i) => b.classList.toggle('hl', i === this.suggestIdx));
    } else if (e.key === 'Enter' && this.suggestIdx >= 0) {
      e.preventDefault();
      this.pickName(items[this.suggestIdx].dataset.name);
    } else if (e.key === 'Escape') box.hidden = true;
  }

  pickName(name) {
    this.setup.name = name;
    $('#recName').value = name;
    $('#suggest').hidden = true;
    this.updateSetup();
  }

  // Recording / paused: timer, what is recorded, Pause / Stop
  buildRunning() {
    $('#transport').innerHTML = `
      <div class="running">
        <span class="state-pill" id="statePill"></span>
        <div>
          <div class="timer" id="runTimer">0:00</div>
          <div class="timer-label">${escapeHtml(t('rec.recorded'))}</div>
        </div>
        <div class="run-info">
          <div class="run-name" id="runName"></div>
          <div class="run-meta" id="runMeta"></div>
        </div>
        <div class="spacer"></div>
        <div class="run-actions">
          <button class="btn lg" id="btnPause"></button>
          <button class="btn danger lg" id="btnStop">${icon('stop', 16)}${escapeHtml(t('rec.stop'))}</button>
        </div>
      </div>`;
    $('#btnPause').onclick = () => this.pauseResume();
    $('#btnStop').onclick = () => this.stopRecording();
  }

  updateRunning() {
    const st = this.status;
    const paused = st.state === 'paused';
    const pill = $('#statePill');
    pill.classList.toggle('paused', paused);
    pill.textContent = t(paused ? 'rec.paused' : 'rec.recording');
    const rate = st.rate_hz || 50, run = st.run_samples ?? st.samples;
    $('#runTimer').textContent = fmtTimer(run / rate);
    $('#runName').textContent = `${st.rec} · ${t('rec.session', { id: st.session })}`;
    const pb = $('#btnPause');
    const want = paused ? 'resume' : 'pause';
    if (pb.dataset.mode !== want) {
      pb.dataset.mode = want;
      pb.innerHTML = `${icon(paused ? 'play' : 'pause', 16)}${escapeHtml(t(paused ? 'rec.resume' : 'rec.pause'))}`;
    }
    this.loadRunInfo();
    const ri = this.runInfo;
    const when = ri?.startedMs ? `<span>${icon('calendar', 13)}${escapeHtml(t(ri.continued ? 'rec.continuedSince' : 'rec.since', { date: fmtWhen(ri.startedMs) }))}</span>` : '';
    const total = st.samples > run ? `<span>${icon('clock', 13)}${escapeHtml(t('rec.sessionTotal', { dur: fmtDur(st.samples / rate) }))}</span>` : '';
    $('#runMeta').innerHTML = `${when}${total}<span>${escapeHtml(t('rec.samples', { n: fmtNumber(st.samples) }))}</span>`;
  }

  // When did this run start? (last "start" or "continue" event of the session)
  async loadRunInfo() {
    const st = this.status;
    const key = `${st.rec}/${st.session}`;
    if (this.runInfo?.key === key) return;
    this.runInfo = { key };
    try {
      const meta = await this.recs.loadMeta(st.rec);
      const s = meta.sessions.find((x) => x.id === st.session);
      const ev = [...(s?.events || [])].reverse().find((e) => e.type === 'start' || e.type === 'continue');
      if (s && ev && this.runInfo.key === key) {
        this.runInfo = { key, startedMs: s.start_ms + ev.t_s * 1000, continued: ev.type === 'continue' };
        if (this.transportMode === 'running') this.updateRunning();
      }
    } catch {}
  }

  // ---- recording commands ---------------------------------------------------------------

  async startRecording(rec, session, notes = '') {
    try {
      const r = await this.device.request('start', { rec, session, notes }, 10000);
      toast(t(session === 'new' ? 'toast.started' : 'toast.continued', { rec, id: r.session }), 'success');
      this.setup = { name: rec, mode: 'new', session: null, notes: '' };
      this.recs.selected = rec;
      this.recs.forget(rec, r.session);
      this.route('live');
      this.recs.refresh();
    } catch (e) {
      toast(errText(e), 'error');
    }
  }

  async pauseResume() {
    try {
      await this.device.request(this.status?.state === 'paused' ? 'resume' : 'pause');
    } catch (e) {
      toast(errText(e), 'error');
    }
  }

  async stopRecording() {
    const rec = this.status?.rec, session = this.status?.session; // the "idle" status may arrive before the reply
    try {
      await this.device.request('stop', {}, 10000);
      toast(t('toast.stopped'), 'success');
      this.runInfo = null;
      this.setup.mode = 'new'; // the next Start must not append by accident
      if (rec) {
        this.recs.forget(rec, session);
        this.recs.selected = rec;
      }
      await this.recs.refresh();
    } catch (e) {
      toast(errText(e), 'error');
    }
  }

  // ---- live data ----------------------------------------------------------------------------

  onData(samples) {
    this.lastDataMs = Date.now();
    this.debug?.onData(samples);
    if (!samples.length) return;
    for (const s of samples) {
      const x = this.live[0];
      const tt = s[0] / 1000;
      if (x.length && tt < x[x.length - 1]) { // device restarted
        this.live = [[], [], [], [], []];
        this.resetLiveClock();
      }
      this.live[0].push(tt);
      for (let c = 1; c <= 4; c++) this.live[c].push(s[c]);
    }
    const x = this.live[0];
    const cutoff = x[x.length - 1] - MAX_WINDOW_S - 1;
    let n = 0;
    while (n < x.length && x[n] < cutoff) n++;
    if (n > 200) this.live.forEach((a) => a.splice(0, n));

    // How late did the newest sample arrive? The smallest delay of the last 10 s is the
    // link's true delay; the others are jitter. (Recomputed often: the device and PC
    // clocks drift apart slowly.)
    const at = performance.now() / 1000;
    this.lags.push({ at, lag: at - x[x.length - 1] });
    while (this.lags[0].at < at - 10) this.lags.shift();
    this.liveStack.setLiveData(this.live);
    this.startLiveLoop();
  }

  resetLiveClock() {
    this.lags = [];
    this.lagMin = null;
  }

  // One redraw per screen frame while the Live page shows data
  startLiveLoop() {
    if (this.loopRunning) return;
    this.loopRunning = true;
    const frame = () => {
      if (!this.device || this.page !== 'live' || !this.lags.length) {
        this.loopRunning = false; // restarted by the next data or by coming back to Live
        return;
      }
      const target = Math.min(...this.lags.map((l) => l.lag));
      // Follow changes gently (0.5 ms per frame) so the scrolling never jumps; snap on big changes
      if (this.lagMin == null || Math.abs(target - this.lagMin) > 1) this.lagMin = target;
      else this.lagMin += Math.max(-0.0005, Math.min(0.0005, target - this.lagMin));
      this.liveStack.setView(performance.now() / 1000 - this.lagMin - LIVE_DELAY_S);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}

const app = new App();
