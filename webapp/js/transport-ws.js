// Wi-Fi link to the device: same JSON messages as over USB (docs/protocol.md), one per
// WebSocket message. Used when the page was opened from the device itself
// (http://192.168.4.1 on the device's own Wi-Fi network).

class WsTransport {
  // The page came from the device (not from a file on this computer)
  static served() {
    return location.protocol === 'http:' || location.protocol === 'https:';
  }

  constructor() {
    this.onMessage = () => {};
    this.onClose = () => {};
    this.ws = null;
    this.closed = false;
  }

  open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${location.hostname}:81/`);
      let opened = false;
      ws.onopen = () => {
        opened = true;
        this.ws = ws;
        resolve();
      };
      ws.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return; // a damaged message: ignore it
        }
        this.onMessage(msg);
      };
      ws.onclose = () => {
        if (!opened) reject(new Error('no Wi-Fi connection to the device'));
        else this.finish();
      };
    });
  }

  finish() {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
  }

  async send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('device disconnected');
    this.ws.send(JSON.stringify(obj));
  }

  async close() {
    this.ws?.close();
    this.finish();
  }
}
