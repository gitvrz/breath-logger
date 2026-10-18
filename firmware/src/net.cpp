#include "config.h"
#include "net.h"

#if !WIFI_ENABLED
void netBegin() {}
void netPoll() {}
void netBroadcast(const char *, size_t) {}
bool netSendTo(int, const char *, size_t) { return false; }
int netClients() { return 0; }
const char *netSsid() { return ""; }
#else

#include <Arduino.h>
#include <DNSServer.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <WiFi.h>
#include "commands.h"
#include "link.h"
#include "webapp_files.h"  // the web page, gzipped (generated from ../webapp at build time)

static WebServer http(80);
static WebSocketsServer ws(WS_PORT);
static DNSServer dns;
static char ssid[32];

// Messages are lines ending with '\n' over USB; over the WebSocket, one message = one line
static size_t trimNewline(const char *line, size_t len) {
  return len && line[len - 1] == '\n' ? len - 1 : len;
}

static void onWs(uint8_t client, WStype_t type, uint8_t *payload, size_t len) {
  if (type != WStype_TEXT) return;
  static char line[2048];
  size_t n = len < sizeof(line) - 1 ? len : sizeof(line) - 1;
  memcpy(line, payload, n);
  line[n] = 0;
  linkSetReplyTo(client);  // the reply goes back to this client only
  commandsHandle(line);
  linkSetReplyTo(LINK_USB);
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

void netBegin() {
  uint8_t mac[6];
  WiFi.softAPmacAddress(mac);
  snprintf(ssid, sizeof(ssid), WIFI_SSID_PREFIX "%02X%02X", mac[4], mac[5]);
  WiFi.mode(WIFI_AP);
  WiFi.softAP(ssid, WIFI_PASSWORD, WIFI_CHANNEL, 0, WIFI_MAX_CLIENTS);
  dns.start(53, "*", WiFi.softAPIP());  // every name -> the device (captive portal)
  http.onNotFound(onRequest);
  http.begin();
  ws.begin();
  ws.onEvent(onWs);
  // A client that went out of range is dropped after ~5 s instead of slowing every send
  ws.enableHeartbeat(2000, 1500, 2);
}

void netPoll() {
  dns.processNextRequest();
  http.handleClient();
  ws.loop();
}

void netBroadcast(const char *line, size_t len) {
  if (ws.connectedClients() == 0) return;
  ws.broadcastTXT((uint8_t *)line, trimNewline(line, len));
}

bool netSendTo(int client, const char *line, size_t len) {
  return ws.sendTXT((uint8_t)client, (uint8_t *)line, trimNewline(line, len));
}

int netClients() { return ws.connectedClients(); }
const char *netSsid() { return ssid; }
#endif
