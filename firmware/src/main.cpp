// Respiratory data logger - ESP32-S3
//
//  core 1: acquisition task  -> reads sensors at SAMPLE_RATE_HZ (acquisition.cpp)
//  core 0: IO task           -> writes to SD, talks to the PC over USB (this file)
//
// Protocol: docs/protocol.md
#include <Arduino.h>
#include <Wire.h>
#include <esp_timer.h>
#include "acquisition.h"
#include "battery.h"
#include "clock.h"
#include "commands.h"
#include "config.h"
#include "link.h"
#include "net.h"
#include "ota.h"
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
    uint32_t age = (esp_timer_get_time() - batch[0].t_us) / 1000;  // oldest sample's wait
    if (age > diagAgeMaxMs) diagAgeMaxMs = age;
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
  static char line[CMD_LINE_MAX];
  uint32_t lastStatus = 0, lastTurn = millis();
  for (;;) {
    uint32_t turn = millis();  // time between two turns: work + sleep
    if (turn - lastTurn > diagLoopMaxMs) diagLoopMaxMs = turn - lastTurn;
    lastTurn = turn;
    while (linkReadLine(line, sizeof(line))) commandsHandle(line);
    int client;
    while (netReadCommand(line, sizeof(line), &client)) {  // commands from Wi-Fi clients
      linkSetReplyTo(client);  // the reply goes back to that client only
      commandsHandle(line);
      linkSetReplyTo(LINK_USB);
    }
    recorderPoll();
    otaPoll();
    clockPoll();
    batteryPoll();
    sendLive();
    watchAcquisition();

    uint32_t now = millis();
    if (now - lastStatus >= STATUS_PERIOD_MS) {
      lastStatus = now;
      sendStatus(true);
    }
    ledUpdate();
    vTaskDelay(pdMS_TO_TICKS(linkPump() ? 1 : 5));  // drain the USB queue faster
  }
}

void setup() {
  linkBegin();
  netBegin();
  storageMount();
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, I2C_FREQ);
  clockBegin();  // before the acquisition task: after that, only that task reads the bus
  sensorsBegin();
  acqBegin();
  xTaskCreatePinnedToCore(ioTask, "io", 12288, nullptr, 5, nullptr, IO_CORE);
}

void loop() {
#if OTA_CRASH_TEST  // platformio.ini env "crash-test" only
  delay(5000);
  abort();
#endif
  vTaskDelete(nullptr);  // everything runs in the two tasks above
}
