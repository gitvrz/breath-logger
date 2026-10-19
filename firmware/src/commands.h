#pragma once
#include <stddef.h>
#include <stdint.h>
// Parses one JSON command line from the PC and sends the reply (docs/protocol.md).
void commandsHandle(const char *line);
// diag = also send the "diag" timing counters (periodic status only)
void sendStatus(bool diag = false);
// Longest IO loop turn and oldest live sample at sending since the last periodic status
extern uint32_t diagLoopMaxMs, diagAgeMaxMs;
// Standard CRC-32 (same as zlib / PNG): checks the chunks of files read or written
uint32_t crc32(const uint8_t *data, size_t n);
