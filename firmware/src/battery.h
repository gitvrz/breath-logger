#pragma once

// Battery level (config.h: made up for now, or read on PIN_BATTERY).
// Call batteryPoll() often from the IO task; it measures every few seconds.
void batteryPoll();
bool batteryKnown();       // false until the first measurement
float batteryVolts();
int batteryPercent();      // 0-100, from a single-cell LiPo discharge curve
