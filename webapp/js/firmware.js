// Firmware update from the page, over USB or Wi-Fi (docs/protocol.md "Firmware update").
// The file is checked here first (a Breath Logger firmware? which version?), then sent
// in 2 KB chunks, each one checked by the device. The device restarts on the new
// firmware and the page connects again by itself. If the new firmware does not start
// properly, the device goes back to the old one by itself.

const FW_CHUNK = 2048;
// Written into every firmware by firmware/build_info.py
const FW_ID_RE = /#BreathLogger-firmware (\S+) ([^#\0]{1,60})#/;
const FW_WAIT_KEY = 'fwWaiting'; // sessionStorage: survives the page reload after an update over Wi-Fi

class FirmwareUpdate {
  constructor(app) {
    this.app = app;
    this.pageBuild = null; // Wi-Fi: build of the firmware that served this page
    this.waiting = null;   // { fromFw, fromBuild, fw, build, at } while the device restarts
    this.dlg = null;       // the open dialog's elements
    try {
      const w = JSON.parse(sessionStorage.getItem(FW_WAIT_KEY));
      sessionStorage.removeItem(FW_WAIT_KEY);
      if (w && Date.now() - w.at < 5 * 60000) this.waiting = w;
    } catch {}
  }

  // { bytes, fw, build } from a firmware file, or throws a message for the user
  static async readFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length < 4096 || bytes[0] !== 0xe9) throw new Error(t('fw.notFirmware')); // ESP32 image header
    const m = FW_ID_RE.exec(new TextDecoder('latin1').decode(bytes));
    if (!m) throw new Error(t('fw.notOurs'));
    return { bytes, fw: m[1], build: m[2] };
  }

  // ---- dialog ----------------------------------------------------------------------

  open() {
    const info = this.app.info;
    const d = $('#dialog');
    d.innerHTML = `
      <form class="dlg" novalidate>
        <div class="dlg-head"><div class="dlg-icon">${icon('upload', 20)}</div><h3>${escapeHtml(t('fw.title'))}</h3></div>
        <p class="dlg-text">${escapeHtml(t('fw.current', { v: info.fw, b: info.build || '?' }))}</p>
        ${info.rolled_back ? `<p class="fw-warn">${escapeHtml(t('fw.lastFailed'))}</p>` : ''}
        <label class="fw-pick"><input type="file" accept=".bin"><span>${icon('folder', 16)}<span data-name>${escapeHtml(t('fw.pick'))}</span></span></label>
        <p class="fw-file" data-file></p>
        <div class="fw-progress" data-progress hidden><div class="progress"><div></div></div><span data-step></span></div>
        <p class="hint" data-help>${escapeHtml(t('fw.help'))}</p>
        <div class="dlg-actions">
          <button type="button" class="btn ghost" data-cancel>${escapeHtml(t('dlg.cancel'))}</button>
          <button type="submit" class="btn primary" disabled>${escapeHtml(t('fw.install'))}</button>
        </div>
      </form>`;
    const form = $('form', d);
    this.dlg = {
      d, form, file: $('[data-file]', d), progress: $('[data-progress]', d), bar: $('.progress > div', d),
      step: $('[data-step]', d), help: $('[data-help]', d), cancel: $('[data-cancel]', d), go: $('button[type=submit]', d),
    };
    this.chosen = null;
    this.sending = false;
    $('input[type=file]', d).onchange = (e) => this.pick(e.target.files[0]);
    form.onsubmit = (e) => {
      e.preventDefault();
      if (this.chosen && !this.sending) this.install(this.chosen);
    };
    this.dlg.cancel.onclick = () => {
      if (this.sending) this.cancelled = true; // stops after the chunk being sent
      else d.close();
    };
    d.onclick = (e) => {
      if (e.target === d && !this.sending && !this.waiting) d.close();
    };
    d.oncancel = (e) => {
      if (this.sending) e.preventDefault(); // Escape must not hide an update in progress
    };
    d.onclose = () => (this.dlg = null);
    d.showModal();
  }

  async pick(file) {
    const g = this.dlg;
    this.chosen = null;
    g.go.disabled = true;
    if (!file) return;
    $('[data-name]', g.form).textContent = file.name;
    g.file.className = 'fw-file';
    try {
      const fw = await FirmwareUpdate.readFile(file);
      const same = fw.build === this.app.info.build;
      g.file.textContent = t('fw.file', { v: fw.fw, b: fw.build, size: `${Math.round(fw.bytes.length / 1024)} ${LANG === 'fr' ? 'Ko' : 'KB'}` })
        + (same ? ` ${t('fw.same')}` : '');
      this.chosen = fw;
      g.go.disabled = false;
    } catch (e) {
      g.file.className = 'fw-file bad';
      g.file.textContent = e.message;
    }
  }

  setStep(text, frac = null) {
    const g = this.dlg;
    if (!g) return;
    g.progress.hidden = false;
    g.step.textContent = text;
    if (frac != null) g.bar.style.width = `${Math.round(frac * 100)}%`;
  }

  async install(fw) {
    const g = this.dlg;
    const app = this.app;
    this.sending = true;
    this.cancelled = false;
    g.go.disabled = true;
    $('input[type=file]', g.form).disabled = true;
    const t0 = Date.now();
    try {
      await this.send(fw);
    } catch (e) {
      this.sending = false;
      app.device?.request('fw_abort').catch(() => {});
      const msg = this.cancelled ? t('fw.cancelled') : t('fw.failed', { msg: errText(e) });
      this.setStep(msg);
      g.progress.classList.add('bad');
      g.cancel.textContent = t('fw.close');
      return;
    }
    this.sending = false;
    console.info(`firmware sent in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    this.waiting = { fromFw: app.info.fw, fromBuild: app.info.build, fw: fw.fw, build: fw.build, at: Date.now() };
    g.cancel.textContent = t('fw.close');
    g.cancel.onclick = () => g.d.close();
    this.setStep(t('fw.restarting'), 1);
    if (app.mode === 'usb') app.reconnectUsbAfterRestart();
    else this.setStep(t('fw.reconnectWifi', { ssid: app.info.wifi }), 1); // the page reconnects by itself
    const w = this.waiting;
    setTimeout(() => {
      if (this.waiting === w && this.dlg) {
        this.dlg.help.textContent = t(app.served ? 'fw.slow' : 'fw.slowUsb', { ssid: app.info?.wifi || 'BreathLogger' });
        this.dlg.help.classList.add('fw-warn');
      }
    }, 45000);
  }

  async send(fw) {
    const dev = this.app.device;
    const size = fw.bytes.length;
    this.setStep(t('fw.sending', { pct: 0 }), 0);
    await dev.request('fw_begin', { size }, 10000);
    let offset = 0;
    while (offset < size) {
      if (this.cancelled) throw new Error('cancelled');
      const part = fw.bytes.subarray(offset, offset + FW_CHUNK);
      const bin = String.fromCharCode(...part);
      let r;
      for (let attempt = 1; ; attempt++) {
        try {
          r = await dev.request('fw_write', { offset, crc: crc32(bin), data: btoa(bin) }, 5000);
          break;
        } catch (e) {
          // Lost or damaged on the way: send it again (the device skips a chunk it already has)
          if (attempt === 3 || !(e.timeout || e.message.includes('damaged'))) throw e;
        }
      }
      offset = r.next;
      this.setStep(t('fw.sending', { pct: Math.floor((100 * offset) / size) }), offset / size);
    }
    this.setStep(t('fw.checking'), 1);
    await dev.request('fw_end', {}, 20000); // the device checks the whole image (SHA-256)
  }

  // ---- after a restart ----------------------------------------------------------------

  // Every successful hello. Returns true when the page is being reloaded.
  onHello(info) {
    if (this.app.served) {
      // Opened from the device: a new firmware also brings a new page. Load it.
      if (!this.pageBuild) this.pageBuild = info.build;
      else if (info.build !== this.pageBuild) {
        try {
          if (this.waiting) sessionStorage.setItem(FW_WAIT_KEY, JSON.stringify(this.waiting));
        } catch {}
        location.reload();
        return true;
      }
    }
    const w = this.waiting;
    if (!w) return false;
    this.waiting = null;
    let msg, kind = 'error';
    if (info.build === w.build) {
      msg = t('fw.done', { v: info.fw });
      kind = 'success';
    } else if (info.build === w.fromBuild) msg = t('fw.rolledBack', { v: info.fw });
    else msg = t('fw.other', { v: info.fw, b: info.build });
    if (this.dlg) {
      this.setStep(msg, 1);
      this.dlg.progress.classList.toggle('bad', kind !== 'success');
      this.dlg.help.hidden = true;
    } else toast(msg, kind);
    return false;
  }

  // The disconnection that comes with the restart is expected: no "disconnected" message
  get restarting() {
    return !!this.waiting;
  }
}
