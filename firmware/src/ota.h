#pragma once
#include <stddef.h>
#include <stdint.h>

// Firmware update from the page, over USB or Wi-Fi (docs/protocol.md "Firmware update").
// The new firmware arrives in chunks and is written to the other half of the flash: the
// running firmware is not touched until the whole file has arrived and been checked.
// The device then restarts on it. If the new firmware crashes before it has worked
// (a screen said hello, or it ran for a minute), the bootloader goes back to the old one.
extern const char BUILD_ID[];  // build_info.cpp (generated): "2026-10-19 17:42:05 a1b2c3d"
extern const char FW_ID[];     // "#BreathLogger-firmware <version> <build>#", marks the file

const char *otaBegin(uint32_t size);  // all return nullptr when OK, else the error
// One chunk (base64). `next` = where the next chunk starts (lets the PC resend a chunk safely)
const char *otaWrite(uint32_t offset, const char *b64, uint32_t crc, uint32_t &next);
const char *otaEnd();  // checks the file, then restarts on it 1.5 s later
void otaAbort();
bool otaBusy();        // an update is in progress, or the device is about to restart
void otaPoll();        // IO task: gives up an abandoned update, restarts after success
void otaConfirm();     // the new firmware works (a screen said hello): keep it
bool otaRolledBack();  // the last update did not start properly: back on the old firmware
