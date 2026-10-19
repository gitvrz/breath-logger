#pragma once
#include <stddef.h>
#include <stdint.h>

// Wi-Fi link (config.h WIFI_ENABLED): the device's own network, the web page, and a
// WebSocket carrying the same JSON lines as the USB port. The Wi-Fi work runs in its own
// task (net.cpp), so a slow or vanished client never delays the recording or the USB
// link: the IO task only exchanges messages with it through queues.
void netBegin();
void netBroadcast(const char *line, size_t len);        // to every connected client
bool netSendTo(int client, const char *line, size_t len);
bool netReadCommand(char *out, size_t cap, int *client); // next command line from Wi-Fi
int netClients();                                       // connected WebSocket clients
// Control with several screens: only the owner may change things (USB always may)
int netOwner();                                         // -1: no screen has control
void netTakeControl(int client);
const char *netSsid();                                  // "" when Wi-Fi is disabled
int netChannel();                                       // 0 until the network is up
// What the channel choice heard at start: per candidate channel (1, 6, 11), networks
// heard on it or next to it, and their crowding score (lowest wins)
struct NetChannelScan { uint8_t channel; uint8_t networks; uint16_t score; };
int netScan(const NetChannelScan **out);                 // number of entries (0: no scan)
// Diagnostics since the last call: slowest send to a client, messages dropped because
// the Wi-Fi queue was full, clients dropped (gone or too slow)
void netTakeStats(uint32_t &sendMaxMs, uint32_t &dropped, uint32_t &kicked);
