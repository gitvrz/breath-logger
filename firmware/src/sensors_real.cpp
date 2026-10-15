// Real sensor drivers. Fill this in once the sensors are chosen.
// Select it with USE_SIMULATED_SENSORS 0 in config.h.
#include "config.h"
#if !USE_SIMULATED_SENSORS
#include <Arduino.h>
#include <math.h>
#include "sensors.h"

bool sensorsBegin() {
  // TODO: Wire.begin(SDA, SCL, 400000); init each sensor; return false if one is missing.
  return true;
}

void sensorsRead(int64_t tUs, float out[NUM_CHANNELS]) {
  (void)tUs;
  // TODO: read each sensor. Slow sensors (e.g. a 10 Hz CO2 sensor) should be read
  // only when they have a new value; keep and return the last value in between.
  out[0] = NAN;  // CO2 %
  out[1] = NAN;  // O2 %
  out[2] = NAN;  // flow L/min
  out[3] = NAN;  // pressure cmH2O
}
#endif
