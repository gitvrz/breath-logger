#include <Arduino.h>
#include "hal/usb_serial_jtag_ll.h"
#include "link.h"
#include "net.h"

static char rxBuf[2048];
static size_t rxLen = 0;
static bool rxOverflow = false;

static char txBuf[8192];

// ---- TX ----------------------------------------------------------------------
// Sending does not go through Serial.write(): the Arduino 2.0.x driver copies its buffer
// into the USB hardware FIFO without checking how many bytes the FIFO accepted, and
// silently loses the rest (seen on hardware: ~1 damaged 4 KB chunk in 25). We keep our
// own queue and feed the FIFO ourselves, advancing only by what it really took.
static uint8_t txq[16384];
static size_t txHead = 0, txTail = 0, txCount = 0;  // head = next write, tail = next read
static uint32_t lastProgressMs = 0;
static bool hostReading = true;  // false once the PC stopped reading for 1 s
static uint32_t statTxMax = 0, statStallMaxMs = 0;

static void txPush(const uint8_t *p, size_t n) {  // caller checked the room
  if (txCount == 0) lastProgressMs = millis();
  while (n) {
    size_t c = min(n, sizeof(txq) - txHead);
    memcpy(txq + txHead, p, c);
    txHead = (txHead + c) % sizeof(txq);
    txCount += c;
    p += c;
    n -= c;
  }
  if (txCount > statTxMax) statTxMax = txCount;
}

// Packets of at most 63 bytes: Windows keeps full 64-byte USB packets for itself until a
// shorter one arrives, which held the live data back for up to 0.5 s (measured with
// tools/jitter.py). A packet shorter than 64 bytes is always handed to the program at once.
static const size_t USB_PACKET_MAX = 63;

bool linkPump() {
  while (txCount && usb_serial_jtag_ll_txfifo_writable()) {
    size_t c = min(min(txCount, sizeof(txq) - txTail), USB_PACKET_MAX);
    uint32_t n = usb_serial_jtag_ll_write_txfifo(txq + txTail, c);
    if (n == 0) break;
    usb_serial_jtag_ll_txfifo_flush();
    txTail = (txTail + n) % sizeof(txq);
    txCount -= n;
    lastProgressMs = millis();
    hostReading = true;
  }
  if (txCount) {
    uint32_t stall = millis() - lastProgressMs;
    if (stall > statStallMaxMs) statStallMaxMs = stall;
  }
  if (txCount && millis() - lastProgressMs > 1000) {
    // Nobody reads the port (page closed): drop what is queued, send again when it reads
    hostReading = false;
    txHead = txTail = txCount = 0;
  }
  return txCount > 0;
}

void linkTakeStats(uint32_t &txMax, uint32_t &stallMaxMs) {
  txMax = statTxMax;
  stallMaxMs = statStallMaxMs;
  statTxMax = txCount;
  statStallMaxMs = 0;
}

void linkBegin() {
  Serial.setRxBufferSize(4096);
  Serial.begin(115200);
}

bool linkReadLine(char *out, size_t cap) {
  while (Serial.available()) {
    int c = Serial.read();
    if (c < 0) break;
    if (c == '\r') continue;
    if (c == '\n') {
      bool ok = !rxOverflow && rxLen > 0;
      if (ok) {
        size_t n = rxLen < cap - 1 ? rxLen : cap - 1;
        memcpy(out, rxBuf, n);
        out[n] = 0;
      }
      rxLen = 0;
      rxOverflow = false;
      if (ok) return true;
      continue;
    }
    if (rxLen < sizeof(rxBuf)) rxBuf[rxLen++] = (char)c;
    else rxOverflow = true;
  }
  return false;
}

// Who gets the replies of the command being handled: LINK_USB or a Wi-Fi client number
static int replyTo = LINK_USB;

void linkSetReplyTo(int channel) { replyTo = channel; }
int linkReplyTo() { return replyTo; }

static bool usbSend(const char *buf, size_t len, bool important) {
  linkPump();
  if (len > sizeof(txq)) return false;
  uint32_t start = millis();
  // Drop whole messages rather than sending half a line
  while (sizeof(txq) - txCount < len) {
    if (!important || !hostReading || millis() - start > 500) return false;
    linkPump();
    delayMicroseconds(20);
  }
  txPush((const uint8_t *)buf, len);
  // Important messages (replies) go out right away
  while (important && linkPump() && hostReading && millis() - start < 500) delayMicroseconds(20);
  return true;
}

// Live data, status and events: to the USB port and to every Wi-Fi client
bool linkSend(const char *buf, size_t len, bool important) {
  bool ok = usbSend(buf, len, important);
  netBroadcast(buf, len);
  return ok;
}

// Replies (and "item" messages): only to where the command came from
static bool replySend(const char *buf, size_t len) {
  if (replyTo == LINK_USB) return usbSend(buf, len, true);
  return netSendTo(replyTo, buf, len);
}

// Serializes doc as one line and hands it to `out` (big documents go through the heap)
template <typename Out>
static bool sendJsonLine(JsonDocument &doc, Out out) {
  size_t n = measureJson(doc);
  if (n + 1 <= sizeof(txBuf)) {
    serializeJson(doc, txBuf, sizeof(txBuf));
    txBuf[n] = '\n';
    return out(txBuf, n + 1);
  }
  char *big = (char *)malloc(n + 2);
  if (!big) return false;
  serializeJson(doc, big, n + 1);
  big[n] = '\n';
  bool ok = out(big, n + 1);
  free(big);
  return ok;
}

bool linkSendJson(JsonDocument &doc, bool important) {
  return sendJsonLine(doc, [important](const char *b, size_t n) { return linkSend(b, n, important); });
}

bool linkReplyJson(JsonDocument &doc) { return sendJsonLine(doc, replySend); }

void linkSendEvent(const char *level, const char *msg) {
  JsonDocument doc;
  doc["type"] = "event";
  doc["level"] = level;
  doc["msg"] = msg;
  linkSendJson(doc, true);
}
