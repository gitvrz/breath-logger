#include <Arduino.h>
#include <Update.h>
#include <esp_ota_ops.h>
#include <mbedtls/base64.h>
#include "commands.h"
#include "config.h"
#include "link.h"
#include "ota.h"

// Every Breath Logger firmware contains its FW_ID text (build_info.cpp, generated):
// "#BreathLogger-firmware 0.2.0 2026-10-19 17:42:05 a1b2c3d#". A file without its first
// part is refused (another program, a file picked by mistake). The first character
// appears only once in that part, which keeps the search below simple.
static const size_t MARKER_LEN = sizeof("#BreathLogger-firmware ") - 1;

static const uint32_t IDLE_TIMEOUT_MS = 30000;  // nothing received for this long: give up
static const uint32_t CONFIRM_AFTER_MS = 60000; // running a minute without crashing = it works

static bool active = false;
static uint32_t total = 0, written = 0, lastMs = 0, restartAt = 0;
static size_t markerPos = 0;
static bool markerFound = false;
static bool confirmed = false;

static void scanMarker(const uint8_t *p, size_t n) {
  for (size_t i = 0; i < n && !markerFound; i++) {
    if (p[i] == (uint8_t)FW_ID[markerPos]) markerFound = ++markerPos == MARKER_LEN;
    else markerPos = p[i] == (uint8_t)FW_ID[0] ? 1 : 0;
  }
}

void otaAbort() {
  if (active) Update.abort();
  active = false;
}

const char *otaBegin(uint32_t size) {
  otaAbort();  // an earlier attempt left halfway: start again
  otaConfirm();
  if (size < 4096) return "not a Breath Logger firmware (file too small)";
  if (!Update.begin(size, U_FLASH)) return Update.errorString();  // e.g. too big for the flash slot
  active = true;
  total = size;
  written = markerPos = 0;
  markerFound = false;
  lastMs = millis();
  return nullptr;
}

const char *otaWrite(uint32_t offset, const char *b64, uint32_t crc, uint32_t &next) {
  next = written;
  if (!active) return "no firmware update in progress";
  if (offset < written) return nullptr;  // sent again (its reply was lost): already written
  if (offset > written) return "firmware chunk out of order";
  static uint8_t buf[OTA_CHUNK_MAX];
  size_t n = 0;
  if (mbedtls_base64_decode(buf, sizeof(buf), &n, (const uint8_t *)b64, strlen(b64)) != 0 || crc32(buf, n) != crc)
    return "firmware chunk damaged";  // the PC sends it again
  if (n == 0 || written + n > total) return "firmware chunk beyond the file size";
  scanMarker(buf, n);
  if (Update.write(buf, n) != n) {
    const char *err = Update.errorString();
    otaAbort();
    return err;
  }
  written += n;
  next = written;
  lastMs = millis();
  return nullptr;
}

const char *otaEnd() {
  if (!active) return "no firmware update in progress";
  if (written != total) return "firmware incomplete";
  active = false;
  if (!markerFound) {
    Update.abort();  // the new half of the flash never becomes bootable
    return "not a Breath Logger firmware";
  }
  // Checks the image (checksum, SHA-256, chip), then makes it the one to start
  if (!Update.end()) return Update.errorString();
  restartAt = (millis() + 1500) | 1;  // time for the reply to reach the PC
  return nullptr;
}

bool otaBusy() { return active || restartAt; }

void otaPoll() {
  if (active && millis() - lastMs > IDLE_TIMEOUT_MS) {
    otaAbort();
    linkSendEvent("warn", "firmware update abandoned: nothing received for 30 s");
  }
  if (!confirmed && millis() > CONFIRM_AFTER_MS) otaConfirm();
  if (restartAt && (int32_t)(millis() - restartAt) >= 0) ESP.restart();
}

// After an update the bootloader starts the new firmware "on probation": if it restarts
// (crash, watchdog...) before being confirmed, the bootloader goes back to the old one.
void otaConfirm() {
#if OTA_CRASH_TEST
  return;  // test firmware: must never be kept
#endif
  if (confirmed) return;
  confirmed = true;
  esp_ota_img_states_t state;
  if (esp_ota_get_state_partition(esp_ota_get_running_partition(), &state) == ESP_OK &&
      state == ESP_OTA_IMG_PENDING_VERIFY)
    esp_ota_mark_app_valid_cancel_rollback();
}

bool otaRolledBack() { return esp_ota_get_last_invalid_partition() != nullptr; }

// Arduino core (C function): leave the confirmation to otaConfirm() instead of confirming at boot
extern "C" bool verifyRollbackLater() { return true; }
