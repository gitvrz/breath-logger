#include <Arduino.h>
#include "battery.h"
#include "config.h"

static const uint32_t PERIOD_MS = 5000;
static bool known = false;
static float volts = 0;
static int percent = 0;

// Single-cell LiPo at rest: voltage at 100 %, 95 %, ... 0 %
static const float CURVE[21] = {4.20f, 4.15f, 4.11f, 4.08f, 4.02f, 3.98f, 3.95f, 3.91f, 3.87f, 3.85f, 3.84f,
                                3.82f, 3.80f, 3.79f, 3.77f, 3.75f, 3.73f, 3.71f, 3.69f, 3.61f, 3.27f};

static int percentFromVolts(float v) {
  if (v >= CURVE[0]) return 100;
  for (int i = 1; i < 21; i++) {
    if (v >= CURVE[i]) {  // between two points of the curve: straight line
      float f = (v - CURVE[i]) / (CURVE[i - 1] - CURVE[i]);
      return (int)lroundf(100 - 5 * i + 5 * f);
    }
  }
  return 0;
}

static float voltsFromPercent(float p) {
  float x = (100 - constrain(p, 0.0f, 100.0f)) / 5;  // position on the curve
  int i = min((int)x, 19);
  return CURVE[i] + (CURVE[i + 1] - CURVE[i]) * (x - i);
}

void batteryPoll() {
  static uint32_t last = 0;
  uint32_t now = millis();
  if (known && now - last < PERIOD_MS) return;
  last = now;
#if BATTERY_SIMULATED
  float p = 100.0f - 100.0f * now / (BATTERY_SIM_HOURS * 3600000.0f);
  volts = voltsFromPercent(p);
  percent = (int)lroundf(max(p, 0.0f));
#else
  uint32_t mv = 0;
  for (int i = 0; i < 16; i++) mv += analogReadMilliVolts(PIN_BATTERY);  // average: less noise
  float v = mv / 16 / 1000.0f * BATTERY_DIVIDER;
  volts = known ? volts + (v - volts) * 0.3f : v;  // smooth the radio's load peaks
  percent = percentFromVolts(volts);
#endif
  known = true;
}

bool batteryKnown() { return known; }
float batteryVolts() { return volts; }
int batteryPercent() { return percent; }
