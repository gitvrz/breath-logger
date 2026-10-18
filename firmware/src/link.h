#pragma once
#include <ArduinoJson.h>
#include <stddef.h>

// Link to the PC: one JSON object per line (see docs/protocol.md), over the USB port
// and, if enabled, over Wi-Fi (net.cpp). Writes never block for long, so recording
// continues if the PC stops reading.
static const int LINK_USB = -1;

void linkBegin();
// Returns true when a complete line is available in `out` (non-blocking).
bool linkReadLine(char *out, size_t cap);
// important = wait (up to ~500 ms) until the message is sent instead of dropping it.
bool linkSend(const char *buf, size_t len, bool important);
// Sent to the USB port and to every Wi-Fi client (live data, status, events)
bool linkSendJson(JsonDocument &doc, bool important);
// Sent only where the command being handled came from (replies, "item" messages)
bool linkReplyJson(JsonDocument &doc);
// Where replies go while a command is handled: LINK_USB or a Wi-Fi client number
void linkSetReplyTo(int channel);
void linkSendEvent(const char *level, const char *msg);
// Feeds queued bytes to the USB hardware. Call often; returns true if bytes are waiting.
bool linkPump();
// Diagnostics since the last call (then reset): most bytes waiting in the queue, and the
// longest time bytes were waiting while the USB hardware took nothing (PC not reading).
void linkTakeStats(uint32_t &txMax, uint32_t &stallMaxMs);
