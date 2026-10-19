#include "config.h"
#include "net.h"

#if !WIFI_ENABLED
void netBegin() {}
void netBroadcast(const char *, size_t) {}
bool netSendTo(int, const char *, size_t) { return false; }
bool netReadCommand(char *, size_t, int *) { return false; }
int netClients() { return 0; }
int netOwner() { return -1; }
void netTakeControl(int) {}
const char *netSsid() { return ""; }
void netTakeStats(uint32_t &sendMaxMs, uint32_t &dropped, uint32_t &kicked) { sendMaxMs = dropped = kicked = 0; }
#else

#include <Arduino.h>
#include <DNSServer.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <WiFi.h>
#include <atomic>
#include <errno.h>
#include <esp_netif.h>
#include <esp_mac.h>
#include <esp_wifi.h>
#include <lwip/sockets.h>
#include "webapp_files.h"  // the web page, gzipped (generated from ../webapp at build time)

// Sending to a client that left without closing its connection (Wi-Fi switched off, out
// of range) blocks for up to ~10 s per message in the network libraries. So:
//  - all the Wi-Fi work runs in this task, never in the IO task: the recording and USB
//    never wait for Wi-Fi. Messages travel between the two tasks through queues.
//  - replies (a file being read, a list...) are never skipped: they wait for room in the
//    client's connection. Live data is skipped for a client that cannot take it right now
//    (checked without waiting): a busy but healthy client just misses a few live frames.
//  - a client is dropped when it takes nothing for 3 s, or when its station is no longer
//    on the device's network (checked every second).

class WsServer : public WebSocketsServer {
 public:
  using WebSocketsServer::WebSocketsServer;
  // Closes the connection without sending anything (a close message could block too)
  void drop(uint8_t n) { clientDisconnect(&_clients[n]); }
  bool up(uint8_t n) { return clientIsConnected(&_clients[n]); }
  // Room in the connection's send buffer right now? (answers at once, never waits)
  bool writable(uint8_t n) {
    WiFiClient *c = _clients[n].tcp;
    int fd = c ? c->fd() : -1;
    if (fd < 0) return false;
    fd_set set;
    FD_ZERO(&set);
    FD_SET(fd, &set);
    timeval now = {0, 0};
    return select(fd + 1, nullptr, &set, nullptr, &now) > 0;
  }
};

static WebServer http(80);
static WsServer ws(WS_PORT);
static DNSServer dns;
static char ssid[32];

struct NetMsg {
  int16_t client;  // -1 = every client
  uint16_t len;
  char *data;      // malloc'ed copy, freed once sent
};
static QueueHandle_t replyQ;  // IO task -> Wi-Fi: replies and "item"s, sent first, never skipped
static QueueHandle_t outQ;    // IO task -> Wi-Fi: live data, status, events
static QueueHandle_t inQ;     // Wi-Fi -> IO task: command lines
static const uint32_t STUCK_MS = 3000;  // a client taking nothing for this long is gone
static std::atomic<int> clientCount{0};
static std::atomic<int> owner{-1};  // the screen that has control (-1: none)
static uint32_t connectedAt[WEBSOCKETS_SERVER_CLIENT_MAX];
static uint32_t blockedSince[WEBSOCKETS_SERVER_CLIENT_MAX];  // 0 = client takes data
static std::atomic<uint32_t> statSendMaxMs{0}, statDropped{0}, statKicked{0};

static NetMsg copyMsg(int client, const char *line, size_t len) {
  if (len && line[len - 1] == '\n') len--;  // one WebSocket message = one line
  NetMsg m{(int16_t)client, (uint16_t)len, (char *)malloc(len + 1)};
  if (m.data) {
    memcpy(m.data, line, len);
    m.data[len] = 0;
  }
  return m;
}

static bool queueMsg(QueueHandle_t q, const NetMsg &m, TickType_t wait = 0) {
  if (m.data && xQueueSend(q, &m, wait) == pdTRUE) return true;
  free(m.data);
  statDropped++;  // queue full (Wi-Fi too slow): live data can be dropped, never the recording
  return false;
}

// ---- Wi-Fi task --------------------------------------------------------------------

// Control: the first screen gets it; when it leaves, the longest connected one gets it
static void onWs(uint8_t client, WStype_t type, uint8_t *payload, size_t len) {
  if (type == WStype_TEXT) {
    queueMsg(inQ, copyMsg(client, (const char *)payload, len));
  } else if (type == WStype_CONNECTED) {
    connectedAt[client] = millis();
    if (owner < 0) owner = client;
  } else if (type == WStype_DISCONNECTED) {
    if (owner == client) {
      int next = -1;
      for (uint8_t n = 0; n < WEBSOCKETS_SERVER_CLIENT_MAX; n++)
        if (n != client && ws.up(n) && (next < 0 || connectedAt[n] - connectedAt[next] > 0x80000000u)) next = n;
      owner = next;
    }
  }
  clientCount = ws.connectedClients();
}

// Files of the page. Anything else gets sent to the page: phones, tablets and Windows
// check for a "captive portal" when joining a network and then open the page by themselves.
static void onRequest() {
  String uri = http.uri();
  if (uri == "/") uri = "/index.html";
  for (size_t i = 0; i < WEB_FILES_COUNT; i++) {
    const WebFile &f = WEB_FILES[i];
    if (uri != f.path) continue;
    http.sendHeader("Content-Encoding", "gzip");
    http.sendHeader("Cache-Control", "no-cache");  // always the page of the current firmware
    http.send_P(200, f.mime, (const char *)f.data, f.len);
    return;
  }
  http.sendHeader("Location", "http://" + WiFi.softAPIP().toString() + "/", true);
  http.send(302, "text/plain", "");
}

static void dropClient(uint8_t n) {
  ws.drop(n);
  blockedSince[n] = 0;
  statKicked++;
}

static void timedSend(uint8_t n, NetMsg &m) {
  uint32_t t = millis();
  ws.sendTXT(n, (uint8_t *)m.data, m.len);
  uint32_t ms = millis() - t;
  if (ms > statSendMaxMs) statSendMaxMs = ms;
  if (ms > STUCK_MS) dropClient(n);
}

// Live data, status, events: skipped if the client cannot take it right now
static void sendLive(uint8_t n, NetMsg &m) {
  if (!ws.up(n)) return;
  if (!ws.writable(n)) {
    if (!blockedSince[n]) blockedSince[n] = millis() | 1;
    else if (millis() - blockedSince[n] > STUCK_MS) dropClient(n);
    statDropped++;
    return;
  }
  blockedSince[n] = 0;
  timedSend(n, m);
}

// Replies: wait for room (a healthy client empties its buffer within milliseconds to a
// second, even while downloading a file); only a client stuck for 3 s is given up
static void sendReply(uint8_t n, NetMsg &m) {
  uint32_t t = millis();
  while (ws.up(n) && !ws.writable(n)) {
    if (millis() - t > STUCK_MS) return dropClient(n);
    vTaskDelay(pdMS_TO_TICKS(5));
  }
  if (ws.up(n)) timedSend(n, m);
}

// Drops the clients whose phone / computer is no longer on the device's network
static void dropLeftStations() {
  wifi_sta_list_t wl;
  esp_netif_sta_list_t nl;
  if (esp_wifi_ap_get_sta_list(&wl) != ESP_OK || esp_netif_get_sta_list(&wl, &nl) != ESP_OK) return;
  for (uint8_t n = 0; n < WEBSOCKETS_SERVER_CLIENT_MAX; n++) {
    if (!ws.up(n)) continue;
    uint32_t ip = (uint32_t)ws.remoteIP(n);
    bool present = false;
    for (int i = 0; i < nl.num; i++) present |= nl.sta[i].ip.addr == ip;
    if (!present) dropClient(n);
  }
}

static void netTask(void *) {
  uint32_t lastCheck = 0;
  for (;;) {
    dns.processNextRequest();
    errno = 0;  // WiFiClient::connected() (web server) trusts errno: see lib/WebSockets/PATCHED.md
    http.handleClient();
    ws.loop();
    NetMsg m;
    while (xQueueReceive(replyQ, &m, 0) == pdTRUE) {
      sendReply((uint8_t)m.client, m);
      free(m.data);
    }
    while (uxQueueMessagesWaiting(replyQ) == 0 && xQueueReceive(outQ, &m, 0) == pdTRUE) {
      for (uint8_t n = 0; n < WEBSOCKETS_SERVER_CLIENT_MAX; n++) sendLive(n, m);
      free(m.data);
    }
    if (millis() - lastCheck >= 1000) {
      lastCheck = millis();
      dropLeftStations();
    }
    clientCount = ws.connectedClients();
    vTaskDelay(pdMS_TO_TICKS(2));
  }
}

void netBegin() {
  replyQ = xQueueCreate(16, sizeof(NetMsg));
  outQ = xQueueCreate(48, sizeof(NetMsg));  // ~3 s of live data
  inQ = xQueueCreate(8, sizeof(NetMsg));
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_SOFTAP);  // from the chip: valid before Wi-Fi starts
  snprintf(ssid, sizeof(ssid), WIFI_SSID_PREFIX "%02X%02X", mac[4], mac[5]);
  WiFi.mode(WIFI_AP);
  WiFi.softAP(ssid, WIFI_PASSWORD, WIFI_CHANNEL, 0, WIFI_MAX_CLIENTS);
  esp_wifi_set_inactive_time(WIFI_IF_AP, 15);  // forget a silent station after 15 s (default 300)
  dns.start(53, "*", WiFi.softAPIP());         // every name -> the device (captive portal)
  http.onNotFound(onRequest);
  http.begin();
  ws.begin();
  ws.onEvent(onWs);
  // No library heartbeat: its pings are written without checking for room and could block
  // ~10 s on a vanished client. A full buffer for 1 s or a station that left drops it instead.
  // Below the IO task: SD writing and USB always come first
  xTaskCreatePinnedToCore(netTask, "net", 8192, nullptr, 3, nullptr, IO_CORE);
}

// ---- called from the IO task -----------------------------------------------------------

void netBroadcast(const char *line, size_t len) {
  if (clientCount > 0) queueMsg(outQ, copyMsg(-1, line, len));
}

// Replies wait for room in their queue (like "important" messages over USB); live data never waits
bool netSendTo(int client, const char *line, size_t len) {
  return queueMsg(replyQ, copyMsg(client, line, len), pdMS_TO_TICKS(500));
}

bool netReadCommand(char *out, size_t cap, int *client) {
  NetMsg m;
  if (xQueueReceive(inQ, &m, 0) != pdTRUE) return false;
  strlcpy(out, m.data, cap);
  *client = m.client;
  free(m.data);
  return true;
}

int netClients() { return clientCount; }
int netOwner() { return owner; }
void netTakeControl(int client) { owner = client; }
const char *netSsid() { return ssid; }

void netTakeStats(uint32_t &sendMaxMs, uint32_t &dropped, uint32_t &kicked) {
  sendMaxMs = statSendMaxMs.exchange(0);
  dropped = statDropped.exchange(0);
  kicked = statKicked.exchange(0);
}
#endif
