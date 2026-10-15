#pragma once
#include <stdint.h>
#include "config.h"

// Implemented by sensors_sim.cpp (USE_SIMULATED_SENSORS=1) or sensors_real.cpp.
bool sensorsBegin();
// Called by the acquisition task at SAMPLE_RATE_HZ. Must be fast (< a few ms).
// out = {co2 %, o2 %, flow L/min, pressure cmH2O}. Use NAN for an unavailable value.
void sensorsRead(int64_t tUs, float out[NUM_CHANNELS]);
