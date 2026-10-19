// "Recordings" page (list + details) and the session viewer page.

// Splits a session into parts: the first run, then one part per "continue".
// Each part: { from, to, active (s), pauses, continued, open }
// Only what a trim left visible is counted.
function sessionParts(s) {
  const evs = [...(s.events || [])].sort((a, b) => a.t_s - b.t_s);
  const trims = s.trims;
  const parts = [];
  let cur = null, since = null;
  const run = (a, b) => {
    const v = visibleSpan(trims, a, b);
    if (!v) return;
    cur.active += Math.max(0, v[1] - v[0]);
    cur.vFrom = Math.min(cur.vFrom ?? v[0], v[0]);
    cur.vTo = Math.max(cur.vTo ?? v[1], v[1]);
  };
  const close = (end) => {
    if (since != null) run(since, end);
    if (cur.vFrom != null) parts.push({ ...cur, from: cur.vFrom, to: cur.vTo });
    cur = since = null;
  };
  for (const e of evs) {
    if (e.type === 'start' || e.type === 'continue') {
      if (cur) { cur.interrupted = true; close(cur.lastT ?? cur.from); }
      cur = { from: e.t_s, active: 0, pauses: 0, continued: e.type === 'continue' };
      since = cur.from;
    } else if (!cur) continue;
    else if (e.type === 'pause') {
      if (since != null) run(since, e.t_s);
      since = null;
      if (rowVisible(e.t_s, trims)) cur.pauses++;
      cur.lastT = e.t_s;
    } else if (e.type === 'resume') since = e.t_s;
    else if (e.type === 'stop') close(e.t_s);
  }
  if (cur) {
    cur.open = true;
    close(Math.max(cur.from, s.end_s ?? cur.from));
  }
  return parts;
}

function isInterrupted(s) {
  const last = s.events?.[s.events.length - 1];
  return !last || last.type !== 'stop';
}

// "12 oct. 2026, 14:02 → 14:20" (end date repeated only if it is another day)
function fmtSpan(fromMs, toMs) {
  return `${fmtWhen(fromMs)} → ${sameDay(fromMs, toMs) ? fmtTime(toMs, false) : fmtWhen(toMs)}`;
}

// Local date & time for spreadsheets: "2026-10-12 14:02:10.020"
function fmtCsvDatetime(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function addDatetimeColumn(text, startMs) {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    if (!line) return line;
    if (i === 0) return line + ',datetime';
    const t = parseFloat(line);
    return isFinite(t) ? `${line},${fmtCsvDatetime(startMs + t * 1000)}` : line;
  }).join('\n');
}

class RecordingsPage {
  constructor(app) {
    this.app = app;
    this.list = [];
    this.metas = new Map();     // name -> meta.json
    this.csvCache = new Map();  // "rec/session" -> csv text
    this.selected = null;
    this.query = '';
    this.viewer = null;         // MonitorStack of the session page
    this.viewing = null;        // { rec, session, series }
    this.axis = 'elapsed';

    $('#btnRefresh').onclick = () => this.refresh();
    $('#btnNewRec').onclick = () => this.createRecording();
    $('#btnTrash').onclick = () => this.openTrash();
    $('#recSearch').oninput = (e) => { this.query = e.target.value.trim().toLowerCase(); this.renderList(); };
    $('#recList').onclick = (e) => {
      const item = e.target.closest('[data-rec]');
      if (item) this.select(item.dataset.rec);
    };
    $('#recDetail').addEventListener('click', (e) => this.onDetailClick(e));
    $('#recDetail').addEventListener('focusout', (e) => e.target.id === 'recNotes' && this.saveNotes(e.target));

    $('#viewBack').onclick = () => this.app.route('recordings');
    $('#btnResetZoom').onclick = () => this.viewer?.resetZoom();
    $('#btnTrim').onclick = () => this.trim();
    $('#btnViewDownload').onclick = () => this.download(this.viewing.rec, this.viewing.session);
    $('#btnViewContinue').onclick = () => this.continueSession(this.viewing.rec, this.viewing.session);
    $$('#axisSeg button').forEach((b) => (b.onclick = () => this.setAxis(b.dataset.axis)));
  }

  get device() {
    return this.app.device;
  }

  get busy() {
    const st = this.app.status;
    return !!st && st.state !== 'idle';
  }

  isLive(rec, id) {
    const st = this.app.status;
    return this.busy && st.rec === rec && (id == null || st.session === id);
  }

  reset() {
    this.list = [];
    this.metas.clear();
    this.csvCache.clear();
    this.selected = null;
    if (this.app.page === 'session') this.app.route('recordings');
    this.render();
  }

  async refresh() {
    if (!this.device) return this.render();
    try {
      const r = await this.device.request('list', {}, 20000);
      this.list = (r.recordings ?? r.streamed).map((x) => ({ ...x, when: x.last_ms ?? (Date.parse(x.created) || 0) }));
      this.list.sort((a, b) => b.when - a.when);
      if (this.selected && !this.list.some((x) => x.name === this.selected)) this.selected = null;
      if (!this.selected && this.list.length && !this.list[0].error) this.selected = this.list[0].name;
      if (this.selected) await this.loadMeta(this.selected).catch(() => {});
      this.app.onRecordingsListed(this.list);
      this.render();
      this.refreshTrash();
    } catch (e) {
      toast(errText(e), 'error');
    }
  }

  async loadMeta(name) {
    const r = await this.device.request('get', { rec: name }, 10000);
    this.metas.set(name, r.meta);
    return r.meta;
  }

  // Drop cached data after something changed on the device
  forget(rec, session = null) {
    for (const k of [...this.csvCache.keys()])
      if (k.startsWith(rec + '/') && (session == null || k === `${rec}/${session}`)) this.csvCache.delete(k);
    this.metas.delete(rec);
  }

  async select(name) {
    this.selected = name;
    this.renderList();
    if (!this.metas.has(name)) {
      this.renderDetail(); // shows the header while loading
      try {
        await this.loadMeta(name);
      } catch (e) {
        toast(errText(e), 'error');
      }
    }
    this.renderDetail();
  }

  render() {
    $('#recBusy').hidden = !this.busy;
    $('#btnNewRec').disabled = !this.device || this.busy;
    $('#btnRefresh').disabled = !this.device;
    $('#btnTrash').disabled = !this.device || this.busy;
    this.renderList();
    this.renderDetail();
    this.renderViewerButtons();
  }

  // ---- list ------------------------------------------------------------------

  groupLabel(ms) {
    if (!ms) return t('list.noDate');
    const now = Date.now();
    if (sameDay(ms, now)) return t('list.today');
    if (sameDay(ms, now - 864e5)) return t('list.yesterday');
    if (now - ms < 7 * 864e5) return t('list.thisWeek');
    return fmtMonth(ms);
  }

  renderList() {
    const el = $('#recList');
    if (!this.device) {
      el.innerHTML = `<p class="list-empty">${escapeHtml(t('list.notConnected'))}</p>`;
      return;
    }
    const items = this.list.filter((r) => !this.query || r.name.toLowerCase().includes(this.query) || (r.notes || '').toLowerCase().includes(this.query));
    if (!items.length) {
      el.innerHTML = `<p class="list-empty">${escapeHtml(t(this.list.length ? 'list.noMatch' : 'list.empty'))}</p>`;
      return;
    }
    let html = '', group = null;
    for (const r of items) {
      const g = this.groupLabel(r.sessions ? r.when : 0);
      if (g !== group) {
        html += `<div class="group-label">${escapeHtml(g)}</div>`;
        group = g;
      }
      const live = this.isLive(r.name) ? `<span class="tag live">REC</span>` : '';
      const meta = r.error
        ? `<div class="ri-meta err">${escapeHtml(t('list.damaged'))}</div>`
        : `<div class="ri-meta">${escapeHtml(t('list.sessions', { n: r.sessions }))} · ${escapeHtml(fmtDur(r.duration_s))}${r.notes ? ' · ' + escapeHtml(r.notes) : ''}</div>`;
      html += `<button class="rec-item ${r.name === this.selected ? 'active' : ''}" data-rec="${escapeHtml(r.name)}">
        <span class="ri-name">${escapeHtml(r.name)} ${live}</span>
        <span class="ri-when">${r.sessions ? escapeHtml(fmtWhen(r.when)) : ''}</span>
        ${meta}
      </button>`;
    }
    el.innerHTML = html;
  }

  // ---- detail ----------------------------------------------------------------

  renderDetail() {
    const el = $('#recDetail');
    const r = this.list.find((x) => x.name === this.selected);
    if (!this.device || !r) {
      el.innerHTML = `<div class="detail-empty">${icon('folder', 40)}<h3>${escapeHtml(t('list.select'))}</h3><p>${escapeHtml(t('list.selectText'))}</p></div>`;
      return;
    }
    const meta = this.metas.get(r.name);
    const dis = this.busy ? 'disabled' : '';
    const name = escapeHtml(r.name);
    const sessions = meta ? [...meta.sessions].sort((a, b) => b.id - a.id) : [];
    const created = Date.parse(meta?.created ?? r.created);

    const head = `
      <div class="card">
        <div class="detail-head">
          <div>
            <h2>${name} ${this.isLive(r.name) ? `<span class="tag live">${escapeHtml(t('detail.inProgress'))}</span>` : ''}</h2>
            <p class="page-sub">${icon('calendar', 14)}${escapeHtml(t('detail.created', { date: fmtDateTime(created) }))}</p>
          </div>
          <div class="detail-actions" data-rec="${name}">
            <button class="btn ghost" data-action="rename" ${dis}>${icon('pencil', 16)}${escapeHtml(t('detail.rename'))}</button>
            <button class="btn ghost" data-action="delete" ${dis}>${icon('trash', 16)}${escapeHtml(t('detail.delete'))}</button>
            <button class="btn rec" data-action="new-session" ${dis}>${icon('record', 16)}${escapeHtml(t('detail.newSession'))}</button>
          </div>
        </div>
        <div class="kpis">
          <div class="kpi"><div class="kpi-label">${escapeHtml(t('detail.kpiSessions'))}</div><div class="kpi-value">${r.sessions ?? '—'}</div></div>
          <div class="kpi"><div class="kpi-label">${escapeHtml(t('detail.kpiDuration'))}</div><div class="kpi-value">${escapeHtml(fmtDur(r.duration_s))}</div></div>
          <div class="kpi"><div class="kpi-label">${escapeHtml(t('detail.kpiLast'))}</div><div class="kpi-value">${r.last_ms ? escapeHtml(fmtWhen(r.last_ms)) : '—'}</div></div>
        </div>
      </div>
      <div class="card notes-card">
        <div class="field">
          <label for="recNotes">${escapeHtml(t('detail.notes'))}<span class="saved" id="notesSaved">${icon('check', 13)}${escapeHtml(t('detail.saved'))}</span></label>
          <textarea id="recNotes" data-rec="${name}" rows="2" maxlength="500" placeholder="${escapeHtml(t('detail.notesPh'))}" ${dis}>${escapeHtml(meta?.notes ?? r.notes ?? '')}</textarea>
        </div>
      </div>
      <div class="section-title"><h3>${escapeHtml(t('detail.sessions'))}</h3><span class="count">${sessions.length || ''}</span></div>`;

    const body = !meta
      ? `<div class="card session"><div class="progress" style="margin:20px auto"><div style="width:40%"></div></div></div>`
      : sessions.length
        ? sessions.map((s) => this.sessionCard(r.name, s, meta)).join('')
        : `<div class="detail-empty" style="min-height:160px">${escapeHtml(t('detail.noSessions'))}</div>`;
    el.innerHTML = head + body;
  }

  sessionCard(rec, s, meta) {
    const live = this.isLive(rec, s.id);
    const dis = this.busy ? 'disabled' : '';
    const parts = sessionParts(s);
    const at = (tt) => s.start_ms + tt * 1000;
    const first = parts[0], last = parts[parts.length - 1];
    const pauses = parts.reduce((a, p) => a + p.pauses, 0);
    const ev = s.events || [];
    const sdFailed = ev.some((e) => e.type === 'sd_failed'); // the device stopped: card failed
    const sdErrors = ev.filter((e) => e.type === 'sd_error').length; // card remounted, went on
    const tags = [
      live ? `<span class="tag live">${escapeHtml(t('detail.inProgress'))}</span>` : '',
      sdFailed ? `<span class="tag warn" title="${escapeHtml(t('detail.sdFailedHelp'))}">${icon('alert', 12)}${escapeHtml(t('detail.sdFailed'))}</span>` : '',
      sdErrors ? `<span class="tag warn" title="${escapeHtml(t('detail.sdErrorHelp'))}">${icon('alert', 12)}${escapeHtml(t('detail.sdError', { n: sdErrors }))}</span>` : '',
      !live && !sdFailed && isInterrupted(s) ? `<span class="tag warn" title="${escapeHtml(t('detail.interruptedHelp'))}">${icon('alert', 12)}${escapeHtml(t('detail.interrupted'))}</span>` : '',
      s.trims?.length ? `<span class="tag" title="${escapeHtml(t('detail.trimmedHelp'))}">${icon('scissors', 12)}${escapeHtml(t('detail.trimmed'))}</span>` : '',
      s.dropped > 0 ? `<span class="tag warn" title="${escapeHtml(t('detail.lostHelp'))}">${icon('alert', 12)}${escapeHtml(t('detail.lost', { n: fmtNumber(s.dropped) }))}</span>` : '',
    ].join('');
    const partsHtml = parts.length > 1
      ? `<div class="parts">${parts.map((p, i) => `
          <div class="part">
            <span class="p-when">${escapeHtml(fmtSpan(at(p.from), at(p.to)))}</span>
            <span class="p-meta">${escapeHtml(fmtDur(p.active))}${p.pauses ? ' · ' + escapeHtml(t('detail.pauses', { n: p.pauses })) : ''}</span>
            ${p.continued ? `<span class="tag accent">${escapeHtml(t('detail.partContinued'))}</span>` : `<span class="tag">${escapeHtml(t('detail.part', { n: i + 1 }))}</span>`}
          </div>`).join('')}</div>`
      : '';
    return `
      <div class="card session ${live ? 'is-live' : ''}">
        <div>
          <div class="s-head"><span class="s-title">${escapeHtml(t('rec.session', { id: s.id }))}</span>${tags}</div>
          <div class="s-sub">
            <span>${icon('calendar', 14)}${first ? escapeHtml(fmtSpan(at(first.from), at(last.to))) : escapeHtml(fmtWhen(s.start_ms))}</span>
            <span>${icon('clock', 14)}${escapeHtml(fmtDur(s.duration_s))}</span>
            ${pauses ? `<span>${icon('pause', 12)}${escapeHtml(t('detail.pauses', { n: pauses }))}</span>` : ''}
          </div>
        </div>
        ${partsHtml}
        ${s.notes ? `<div class="s-notes">${escapeHtml(s.notes)}</div>` : ''}
        <div class="s-actions" data-rec="${escapeHtml(rec)}" data-session="${s.id}">
          <button class="btn" data-action="view" ${dis}>${icon('chart', 16)}${escapeHtml(t('detail.view'))}</button>
          <button class="btn" data-action="continue" ${dis}>${icon('resume', 16)}${escapeHtml(t('detail.continue'))}</button>
          <button class="btn ghost" data-action="download" ${dis}>${icon('download', 16)}${escapeHtml(t('detail.csv'))}</button>
          ${s.trims?.length ? `<button class="btn ghost" data-action="restore" ${dis}>${icon('refresh', 16)}${escapeHtml(t('detail.restore'))}</button>` : ''}
          <span class="spacer"></span>
          <button class="btn ghost icon-only" data-action="session-notes" title="${escapeHtml(t('detail.editNotes'))}" ${dis}>${icon('notes', 16)}</button>
          <button class="btn ghost icon-only" data-action="delete-session" title="${escapeHtml(t('detail.deleteSession'))}" ${dis}>${icon('trash', 16)}</button>
        </div>
      </div>`;
  }

  async onDetailClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn || btn.disabled) return;
    const holder = btn.closest('[data-rec]');
    const rec = holder.dataset.rec;
    const session = holder.dataset.session != null ? Number(holder.dataset.session) : null;
    try {
      switch (btn.dataset.action) {
        case 'view': return await this.openSession(rec, session);
        case 'continue': return await this.continueSession(rec, session);
        case 'download': return await this.download(rec, session);
        case 'new-session': return await this.newSession(rec);
        case 'rename': return await this.rename(rec);
        case 'delete': return await this.deleteRecording(rec);
        case 'session-notes': return await this.editSessionNotes(rec, session);
        case 'delete-session': return await this.deleteSession(rec, session);
        case 'restore': return await this.restore(rec, session);
      }
    } catch (err) {
      toast(errText(err), 'error');
    }
  }

  async saveNotes(el) {
    const rec = el.dataset.rec;
    const meta = this.metas.get(rec);
    if (!meta || el.value === meta.notes || this.busy) return;
    try {
      await this.device.request('notes', { rec, notes: el.value });
      meta.notes = el.value;
      const r = this.list.find((x) => x.name === rec);
      if (r) r.notes = el.value;
      this.renderList();
      const ok = $('#notesSaved');
      ok?.classList.add('show');
      setTimeout(() => ok?.classList.remove('show'), 1800);
    } catch (e) {
      toast(errText(e), 'error');
    }
  }

  nameValidator(except = null) {
    return (v) => {
      if (!validRecName(v)) return t('dlg.invalidName');
      if (v !== except && this.list.some((r) => r.name === v)) return t('dlg.nameTaken');
      return null;
    };
  }

  async createRecording() {
    const res = await openDialog({
      title: t('dlg.newRecTitle'), text: t('dlg.newRecText'), iconName: 'folder', confirm: t('dlg.save'),
      fields: [
        { name: 'rec', label: t('dlg.name'), placeholder: t('setup.recordingPh'), maxlength: 32, validate: this.nameValidator() },
        { name: 'notes', label: t('detail.notes'), placeholder: t('setup.notesPh'), type: 'textarea' },
      ],
    });
    if (!res) return;
    try {
      await this.device.request('create', { rec: res.rec, notes: res.notes });
      toast(t('toast.created', { rec: res.rec }), 'success');
      this.selected = res.rec;
      await this.refresh();
    } catch (e) {
      toast(errText(e), 'error');
    }
  }

  async rename(rec) {
    const res = await openDialog({
      title: t('dlg.renameTitle', { rec }), iconName: 'pencil', confirm: t('dlg.save'),
      fields: [{ name: 'to', label: t('dlg.name'), value: rec, maxlength: 32, validate: (v) => (v === rec ? '' : this.nameValidator(rec)(v)) }],
    });
    if (!res || res.to === rec) return;
    await this.device.request('rename', { rec, to: res.to });
    this.forget(rec);
    this.selected = res.to;
    toast(t('toast.renamed'), 'success');
    await this.refresh();
  }

  async deleteRecording(rec) {
    const ok = await openDialog({ title: t('dlg.deleteRecTitle', { rec }), text: t('dlg.deleteRecText'), iconName: 'trash', danger: true, confirm: t('dlg.delete') });
    if (!ok) return;
    await this.device.request('delete', { rec }, 30000);
    this.forget(rec);
    this.selected = null;
    toast(t('toast.deleted'), 'success');
    await this.refresh();
  }

  async newSession(rec) {
    const res = await openDialog({
      title: t('dlg.newSessionTitle', { rec }), text: t('dlg.newSessionText'), iconName: 'record', confirm: t('dlg.startNow'),
      fields: [{ name: 'notes', label: t('setup.notes'), placeholder: t('setup.notesPh') }],
    });
    if (res) await this.app.startRecording(rec, 'new', res.notes);
  }

  async continueSession(rec, session) {
    const ok = await openDialog({
      title: t('dlg.continueTitle', { id: session }), text: t('dlg.continueText', { id: session, rec }),
      iconName: 'resume', confirm: t('dlg.continueGo'),
    });
    if (ok) await this.app.startRecording(rec, session);
  }

  async editSessionNotes(rec, session) {
    const s = this.metas.get(rec)?.sessions.find((x) => x.id === session);
    const res = await openDialog({
      title: t('dlg.sessionNotesTitle', { id: session }), iconName: 'notes', confirm: t('dlg.save'),
      fields: [{ name: 'notes', label: t('setup.notes'), value: s?.notes ?? '', type: 'textarea' }],
    });
    if (!res) return;
    await this.device.request('notes', { rec, session, notes: res.notes });
    if (s) s.notes = res.notes;
    this.renderDetail();
  }

  async deleteSession(rec, session) {
    const ok = await openDialog({ title: t('dlg.deleteSessionTitle', { id: session }), text: t('dlg.deleteSessionText'), iconName: 'trash', danger: true, confirm: t('dlg.delete') });
    if (!ok) return;
    await this.device.request('delete', { rec, session });
    this.forget(rec, session);
    toast(t('toast.deleted'), 'success');
    await this.refresh();
  }

  async restore(rec, session) {
    const ok = await openDialog({ title: t('dlg.restoreTitle', { id: session }), text: t('dlg.restoreText'), iconName: 'refresh', confirm: t('dlg.restoreGo') });
    if (!ok) return;
    await this.device.request('restore', { rec, session }, 20000);
    this.metas.delete(rec);
    toast(t('toast.restored'), 'success');
    await this.refresh();
  }

  async fetchCsv(rec, session, onProgress = () => {}) {
    const key = `${rec}/${session}`;
    if (!this.csvCache.has(key)) this.csvCache.set(key, await this.device.readSession(rec, session, onProgress));
    return this.csvCache.get(key);
  }

  async download(rec, session) {
    const meta = this.metas.get(rec) || (await this.loadMeta(rec));
    const s = meta.sessions.find((x) => x.id === session);
    const fields = [{ name: 'datetime', label: t('dlg.addDatetime'), type: 'checkbox', value: true }];
    if (s?.trims?.length) fields.push({ name: 'full', label: t('dlg.includeHidden'), type: 'checkbox', value: false });
    const res = await openDialog({
      title: t('dlg.downloadTitle', { id: session }), text: t('dlg.downloadText'), iconName: 'download', confirm: t('dlg.download'), fields,
    });
    if (!res) return;
    let text = await this.fetchCsv(rec, session);
    if (!res.full) text = visibleCsv(text, s?.trims);
    if (res.datetime && s) text = addDatetimeColumn(text, s.start_ms);
    downloadText(`${rec}_session_${String(session).padStart(3, '0')}.csv`, text);
  }

  // ---- trash (deleted data kept in /trash on the SD card) --------------------------

  async refreshTrash() {
    const label = $('#trashCount');
    if (!this.device || this.busy) return;
    try {
      const r = await this.device.request('trash', {}, 20000);
      this.trashInfo = r;
      label.textContent = r.items ? r.items : '';
    } catch {
      label.textContent = '';
    }
  }

  async openTrash() {
    await this.refreshTrash();
    const info = this.trashInfo;
    if (!info) return;
    if (!info.items) return toast(t('toast.trashIsEmpty'), 'info');
    const ok = await openDialog({
      title: t('dlg.trashTitle'), iconName: 'trash', danger: true, confirm: t('dlg.trashEmpty'),
      text: t('dlg.trashText', { n: info.items, size: info.bytes < 1048576 ? `${Math.max(1, Math.round(info.bytes / 1024))} ${LANG === 'fr' ? 'Ko' : 'KB'}` : fmtSize(Math.round(info.bytes / 1048576)) }),
    });
    if (!ok) return;
    try {
      await this.device.request('empty_trash', {}, 60000);
      toast(t('toast.trashEmptied'), 'success');
      await this.refreshTrash();
    } catch (e) {
      toast(errText(e), 'error');
    }
  }

  // ---- session viewer ------------------------------------------------------------

  async openSession(rec, session) {
    const meta = this.metas.get(rec) || (await this.loadMeta(rec));
    const s = meta.sessions.find((x) => x.id === session);
    this.viewing = { rec, session, s, series: null };
    this.app.route('session');
    $('#viewTitle').textContent = `${rec} · ${t('rec.session', { id: session })}`;
    const parts = sessionParts(s);
    const span = parts.length ? fmtSpan(s.start_ms + parts[0].from * 1000, s.start_ms + parts[parts.length - 1].to * 1000) : fmtWhen(s.start_ms);
    $('#viewSub').innerHTML = `<span>${icon('calendar', 14)}${escapeHtml(span)}</span><span>${icon('clock', 14)}${escapeHtml(fmtDur(s.duration_s))}</span><span>${escapeHtml(t('rec.samples', { n: fmtNumber(s.samples - (s.hidden_samples || 0)) }))}</span>`;
    this.renderViewerButtons();

    const loading = $('#viewLoading'), bar = $('#viewLoading .progress > div');
    const cached = this.csvCache.has(`${rec}/${session}`);
    loading.hidden = cached;
    $('#viewMonitor').hidden = !cached;
    bar.style.width = '0';
    let text;
    try {
      text = await this.fetchCsv(rec, session, (done, size) => (bar.style.width = `${size ? (100 * done) / size : 100}%`));
    } catch (e) {
      // Back to the list, with nothing left half-open (the session can be opened again)
      if (this.viewing?.rec === rec && this.viewing.session === session) this.viewing = null;
      loading.hidden = true;
      toast(errText(e), 'error');
      return this.app.route('recordings');
    }
    loading.hidden = true;
    $('#viewMonitor').hidden = false;
    if (this.viewing?.rec !== rec || this.viewing.session !== session) return;
    this.viewing.series = buildSessionSeries(text, s, meta.rate_hz || 50);
    if (!this.viewer) this.viewer = new MonitorStack($('#viewMonitor'), { syncKey: 'viewer', onZoom: () => this.renderViewerButtons() });
    this.applyAxis();
    this.viewer.setData(this.viewing.series.data, this.viewing.series.marks);
    this.viewer.resetZoom();
  }

  setAxis(axis) {
    this.axis = axis;
    $$('#axisSeg button').forEach((b) => b.classList.toggle('active', b.dataset.axis === axis));
    this.applyAxis();
    this.viewer?.plots.forEach((p) => p.redraw(false, true));
  }

  applyAxis() {
    const v = this.viewing?.series;
    if (!this.viewer || !v) return;
    const startDay = v.data[0].length ? v.clockAt(v.data[0][0]) : 0;
    // incr = spacing between axis ticks: no seconds when ticks are a minute or more apart
    const clockFmt = (x, incr = 0) => {
      const ms = v.clockAt(x);
      const time = fmtTime(ms, !(incr >= 60));
      return v.multiDay && !sameDay(ms, startDay) ? `${fmtShortDay(ms)} ${time}` : time;
    };
    this.viewer.xFormat = this.axis === 'clock' ? clockFmt : (x) => fmtTimer(x);
    this.viewer.cursorLabel = (x) => t('view.at', { time: `${fmtTimer(x)} · ${clockFmt(x)}` });
  }

  renderViewerButtons() {
    if (!this.viewing) return;
    const zoomed = !!this.viewer?.isZoomed();
    $('#btnTrim').disabled = this.busy || !zoomed;
    $('#btnResetZoom').disabled = !zoomed;
    $('#btnViewDownload').disabled = this.busy;
    $('#btnViewContinue').disabled = this.busy;
  }

  async trim() {
    const { rec, session, series } = this.viewing;
    const { min, max } = this.viewer.xRange();
    const from = series.tAt(Math.max(min, series.data[0][0])), to = series.tAt(max);
    const label = (x) => `${fmtTimer(x)} (${fmtTime(series.clockAt(x))})`;
    const ok = await openDialog({
      title: t('dlg.trimTitle'), iconName: 'scissors', danger: true, confirm: t('dlg.trimGo'),
      text: t('dlg.trimText', { from: label(Math.max(0, min)), to: label(max), id: session }),
    });
    if (!ok) return;
    try {
      await this.device.request('trim', { rec, session, from_s: from, to_s: to }, 120000);
      toast(t('toast.trimmed'), 'success');
      this.metas.delete(rec); // the CSV did not change: keep it cached
      await this.refresh();
      await this.openSession(rec, session);
    } catch (e) {
      toast(errText(e), 'error');
    }
  }

  rebuildCharts() {
    if (!this.viewer) return;
    if (this.viewing?.series) {
      const meta = this.metas.get(this.viewing.rec);
      // marks contain translated, formatted labels: rebuild them
      const text = this.csvCache.get(`${this.viewing.rec}/${this.viewing.session}`);
      if (text && meta) this.viewing.series = buildSessionSeries(text, this.viewing.s, meta.rate_hz || 50);
      this.viewer.marks = this.viewing.series.marks;
      this.applyAxis();
    }
    const range = this.viewer.data[0].length ? this.viewer.xRange() : null;
    this.viewer.build();
    if (range) this.viewer.plots[0].setScale('x', range);
  }
}
