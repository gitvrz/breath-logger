#pragma once
#include <stddef.h>

// Wi-Fi link (config.h WIFI_ENABLED): the device's own network, the web page, and a
// WebSocket carrying the same JSON lines as the USB port. Everything runs in the IO task
// through netPoll(), like the USB link: no other task touches the SD card or commands.
void netBegin();
void netPoll();                                         // call often from the IO task
void netBroadcast(const char *line, size_t len);        // to every connected client
bool netSendTo(int client, const char *line, size_t len);
int netClients();                                       // connected WebSocket clients
const char *netSsid();                                  // "" when Wi-Fi is disabled
