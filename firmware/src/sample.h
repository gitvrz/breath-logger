#pragma once
#include <stdint.h>
#include "config.h"

// One measurement of all channels, taken at the same instant.
struct Sample {
  int64_t t_us;               // esp_timer time (microseconds since boot)
  float v[NUM_CHANNELS];      // co2 %, o2 %, flow L/min, pressure cmH2O
};
