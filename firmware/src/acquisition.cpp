#include <Arduino.h>
#include <atomic>
#include <esp_timer.h>
#include <math.h>
#include "acquisition.h"
#include "sensors.h"

static QueueHandle_t recQ;
static QueueHandle_t liveQ;
static std::atomic<bool> recording{false};
static std::atomic<uint32_t> recDropped{0};
static std::atomic<uint32_t> liveDropped{0};
static std::atomic<int64_t> firstDropUs{0};
static std::atomic<uint32_t> ticks{0};     // +1 per sample: proves the task is alive
static std::atomic<uint8_t> faults{0};
static uint16_t nanStreak[NUM_CHANNELS];

static void acqTask(void *) {
  const TickType_t period = pdMS_TO_TICKS(1000 / SAMPLE_RATE_HZ);
  TickType_t last = xTaskGetTickCount();
  for (;;) {
    // Wakes up exactly every period, even if one read took a bit longer
    vTaskDelayUntil(&last, period);

    Sample s;
    s.t_us = esp_timer_get_time();
    sensorsRead(s.t_us, s.v);

    // Garbage values would corrupt the files: treat them as missing
    uint8_t f = 0;
    for (int c = 0; c < NUM_CHANNELS; c++) {
      if (!isfinite(s.v[c]) || fabsf(s.v[c]) > VALUE_LIMIT) s.v[c] = NAN;
      if (isnan(s.v[c])) {
        if (nanStreak[c] < 60000) nanStreak[c]++;
      } else {
        nanStreak[c] = 0;
      }
      if (nanStreak[c] >= FAULT_SAMPLES) f |= 1 << c;
    }
    faults = f;
    ticks++;

    if (recording.load() && xQueueSend(recQ, &s, 0) != pdTRUE) {
      recDropped++;
      int64_t none = 0;
      firstDropUs.compare_exchange_strong(none, s.t_us);
    }

    if (xQueueSend(liveQ, &s, 0) != pdTRUE) {
      Sample oldest;
      xQueueReceive(liveQ, &oldest, 0);
      xQueueSend(liveQ, &s, 0);
      liveDropped++;
    }
  }
}

void acqBegin() {
  recQ = xQueueCreate(REC_QUEUE_LEN, sizeof(Sample));
  liveQ = xQueueCreate(LIVE_QUEUE_LEN, sizeof(Sample));
  xTaskCreatePinnedToCore(acqTask, "acq", 4096, nullptr, configMAX_PRIORITIES - 2, nullptr, ACQ_CORE);
}

void acqSetRecording(bool on) { recording.store(on); }
void acqClearRecordQueue() { xQueueReset(recQ); }
bool acqPopRecord(Sample &s) { return xQueueReceive(recQ, &s, 0) == pdTRUE; }
bool acqPopLive(Sample &s) { return xQueueReceive(liveQ, &s, 0) == pdTRUE; }
uint32_t acqRecordDropped() { return recDropped.load(); }
uint32_t acqLiveDropped() { return liveDropped.load(); }
void acqResetCounters() {
  recDropped = 0;
  liveDropped = 0;
  firstDropUs = 0;
}
int64_t acqTakeFirstDropUs() { return firstDropUs.exchange(0); }
uint8_t acqFaults() { return faults.load(); }

bool acqCheckStalled(uint32_t nowMs) {
  static uint32_t lastTicks = 0, lastChangeMs = 0;
  static bool first = true;
  uint32_t t = ticks.load();
  if (first || t != lastTicks) {  // first call: start counting now, not from boot
    first = false;
    lastTicks = t;
    lastChangeMs = nowMs;
  }
  return nowMs - lastChangeMs > ACQ_STALL_MS;
}
