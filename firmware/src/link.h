#pragma once
#include <ArduinoJson.h>
#include <stddef.h>

// USB serial link to the PC: one JSON object per line (see docs/protocol.md).
// Writes never block for long, so recording continues if the PC stops reading.
void linkBegin();
// Returns true when a complete line is available in `out` (non-blocking).
bool linkReadLine(char *out, size_t cap);
// important = wait (up to ~500 ms) until the message is sent instead of dropping it.
bool linkSend(const char *buf, size_t len, bool important);
bool linkSendJson(JsonDocument &doc, bool important);
void linkSendEvent(const char *level, const char *msg);
// Feeds queued bytes to the USB hardware. Call often; returns true if bytes are waiting.
bool linkPump();
