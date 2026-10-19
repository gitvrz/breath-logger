// USB link to the device through the browser's Web Serial API (Chrome / Edge).
// Messages are JSON objects, one per line (see docs/protocol.md).

class SerialTransport {
  static supported() {
    return 'serial' in navigator;
  }

  // port: one this page already has permission for (reconnecting after a restart)
  constructor(port = null) {
    this.onMessage = () => {};
    this.onClose = () => {};
    this.port = port;
    this.keepPort = false; // true: keep the permission when the port closes (device restarting)
    this.reader = null;
    this.writer = null;
    this.closing = false;
    this.encoder = new TextEncoder();
  }

  async open() {
    // Opens the browser's "choose a device" window
    this.port ||= await navigator.serial.requestPort();
    await this.port.open({ baudRate: 115200, bufferSize: 65536 });
    // On the ESP32-S3 native USB port, some DTR/RTS combinations reset the chip.
    // Keep both low so connecting never interrupts a recording.
    try {
      await this.port.setSignals({ dataTerminalReady: false, requestToSend: false });
    } catch (e) {
      console.warn('setSignals failed', e);
    }
    this.writer = this.port.writable.getWriter();
    this.readLoop();
  }

  async readLoop() {
    const decoder = new TextDecoder();
    let buf = '';
    while (this.port.readable && !this.closing) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line.startsWith('{')) continue; // boot messages etc.
            let msg;
            try {
              msg = JSON.parse(line);
            } catch {
              continue; // a damaged line: ignore it
            }
            this.onMessage(msg);
          }
          if (buf.length > 1e6) buf = '';
        }
      } catch (e) {
        if (!this.closing) console.warn('serial read error', e);
      } finally {
        this.reader.releaseLock();
        this.reader = null;
      }
    }
    if (!this.closing) {
      if (!this.keepPort) this.port.forget?.().catch(() => {});
      this.onClose(); // unplugged
    }
  }

  async send(obj) {
    await this.writer.write(this.encoder.encode(JSON.stringify(obj) + '\n'));
  }

  async close() {
    this.closing = true;
    try {
      if (this.reader) await this.reader.cancel();
      if (this.writer) this.writer.releaseLock();
      await this.port.close();
      // Remove Chrome's permission: another local page can't reuse it silently
      if (this.port.forget && !this.keepPort) await this.port.forget();
    } catch (e) {
      console.warn(e);
    }
    this.onClose();
  }
}
