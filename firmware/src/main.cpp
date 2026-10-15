// Respiratory data logger - ESP32-S3
//
//  core 1: acquisition task  -> reads sensors at SAMPLE_RATE_HZ (acquisition.cpp)
//  core 0: IO task           -> writes to SD, talks to the PC over USB (this file)
//
// Protocol: docs/protocol.md
#include <Arduino.h>
#include "acquisition.h"
#include "commands.h"
#include "config.h"
#include "link.h"
#include "recorder.h"
#include "sensors.h"
#include "storage.h"
#include "textbuf.h"

static void ledUpdate() {
#if STATUS_LED_PIN >= 0
  static int last = -1;
  int code = !storageOk() ? 3 : (int)recorderState();
  if (code == last) return;
  last = code;
  // idle = green, recording = red, paused = yellow, no SD card = blue
  static const uint8_t rgb[4][3] = {{0, 8, 0}, {12, 0, 0}, {10, 6, 0}, {0, 0, 12}};
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  rgbLedWrite(STATUS_LED_PIN, rgb[code][0], rgb[code][1], rgb[code][2]);
#else
  neopixelWrite(STATUS_LED_PIN, rgb[code][0], rgb[code][1], rgb[code][2]);
#endif
#endif
}

// Sends live samples to the PC in batches of LIVE_BATCH
static void sendLive() {
  static Sample batch[LIVE_BATCH];
  static int count = 0;
  static char out[128 + LIVE_BATCH * 96];
  static const int dec[NUM_CHANNELS] = {3, 3, 2, 3};
  Sample s;
  while (acqPopLive(s)) {
    batch[count++] = s;
    if (count < LIVE_BATCH) continue;
    TextBuf msg(out, sizeof(out));
    msg.add("{\"type\":\"data\",\"s\":[");
    for (int i = 0; i < count; i++) {
      msg.addf("%s[%lld", i ? "," : "", (long long)(batch[i].t_us / 1000));
      for (int c = 0; c < NUM_CHANNELS; c++) {
        msg.add(',');
        msg.num(batch[i].v[c], dec[c], "null");
      }
      msg.add(']');
    }
    msg.add("]}\n");
    if (!msg.overflow()) linkSend(msg.c_str(), msg.len(), false);
    count = 0;
  }
}

// Alerts the PC (and marks the recording) when no sample arrives any more,
// e.g. a sensor driver stuck on the I2C bus
static void watchAcquisition() {
  static bool stalled = false;
  bool now = acqCheckStalled(millis());
  if (now == stalled) return;
  stalled = now;
  if (stalled) {
    linkSendEvent("error", "acquisition stalled: no sample for 1 s");
    recorderNote("stall");
  } else {
    linkSendEvent("info", "acquisition running again");
  }
}

static void ioTask(void *) {
  static char line[2048];
  uint32_t lastStatus = 0;
  for (;;) {
    while (linkReadLine(line, sizeof(line))) commandsHandle(line);
    recorderPoll();
    sendLive();
    watchAcquisition();

    uint32_t now = millis();
    if (now - lastStatus >= STATUS_PERIOD_MS) {
      lastStatus = now;
      sendStatus();
    }
    ledUpdate();
    vTaskDelay(pdMS_TO_TICKS(linkPump() ? 1 : 5));  // drain the USB queue faster
  }
}

void setup() {
  linkBegin();
  storageMount();
  sensorsBegin();
  acqBegin();
  xTaskCreatePinnedToCore(ioTask, "io", 12288, nullptr, 5, nullptr, IO_CORE);
}

void loop() {
  vTaskDelete(nullptr);  // everything runs in the two tasks above
}
