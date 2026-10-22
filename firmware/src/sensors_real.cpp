// Real sensors. For now only the LPS28DFW pressure sensor (I2C), which gives two
// channels: pressure (relative to the atmospheric pressure) and flow (from the pressure).
// No CO2 / O2 sensor yet: those channels are simulated from the breath phase (SIM_GAS,
// formula in config.h), or empty and marked as not fitted.
// Select this file with USE_SIMULATED_SENSORS 0 in config.h.
#include "config.h"
#if !USE_SIMULATED_SENSORS
#include <Arduino.h>
#include <atomic>
#include <math.h>
#include "i2c.h"
#include "sensors.h"

enum { CH_CO2, CH_O2, CH_FLOW, CH_PRESSURE };

// ---- LPS28DFW (ST), absolute pressure 260-1260 hPa ---------------------------------
static const uint8_t LPS_WHO_AM_I = 0x0F, LPS_ID = 0xB4;
static const uint8_t LPS_CTRL1 = 0x10, LPS_CTRL2 = 0x11, LPS_PRESS_OUT = 0x28;
static const float HPA_TO_CMH2O = 1.019716f;

static uint8_t lpsAddr = 0;      // 0x5C or 0x5D (pin SA0), 0 = not found
static int64_t lpsLastTryUs = 0;

static bool lpsFind() {
  for (uint8_t a : {0x5C, 0x5D}) {
    uint8_t id;
    if (i2cRead(a, LPS_WHO_AM_I, &id, 1) && id == LPS_ID) {
      // 100 Hz, average of 16, low-pass at 100/4 Hz: each 20 ms read gets a fresh,
      // smoothed value. Block data update: the 3 bytes always come from the same value.
      if (!i2cWrite(a, LPS_CTRL1, 0x3A) || !i2cWrite(a, LPS_CTRL2, 0x18)) return false;
      lpsAddr = a;
      return true;
    }
  }
  return false;
}

static bool lpsRead(float &hPa) {
  uint8_t b[3];
  if (!i2cRead(lpsAddr, LPS_PRESS_OUT, b, 3)) return false;
  int32_t raw = (int32_t)((uint32_t)b[2] << 24 | (uint32_t)b[1] << 16 | (uint32_t)b[0] << 8) >> 8;
  hPa = raw / 4096.0f;
  return hPa > 200 && hPa < 1300;  // outside the sensor's range: garbage
}

// ---- atmospheric pressure: long average of the measured pressure -------------------
static double atmHpa = NAN;
static uint32_t atmCount = 0;
static std::atomic<float> atmShared{NAN};

static void atmUpdate(float hPa) {
  // Plain mean for the first PRESSURE_BASELINE_S, then a moving average over that time
  static const uint32_t N = PRESSURE_BASELINE_S * SAMPLE_RATE_HZ;
  if (atmCount < N) atmCount++;
  atmHpa = isnan(atmHpa) ? hPa : atmHpa + (hPa - atmHpa) / atmCount;
  atmShared = atmHpa;
}

// ---- CO2 / O2 simulated from the breath phase (formula in config.h) ------------------
static bool breathingOut = false;
static double phaseS = 0;                      // time since the phase began
static double pushSum = 0;                     // integrator: pressure towards the other phase
static double pushS = 0;                       // how long pushSum has been filling
static double co2 = SIM_CO2_INSP, o2 = SIM_O2_INSP;  // what the "gas sensor" shows

// Breath phase from the pressure, deaf to noise (dead band + integrator, see config.h).
// At the end of a breath out nothing changes: the air in the mouthpiece keeps its CO2
// until the next breath in.
static void breathPhase(float dp, double dt) {
  double beyond = fabsf(dp) - SIM_GAS_DP_THRESHOLD;  // > 0: outside the dead band
  if (beyond > 0) {
    bool pushesOut = (FLOW_COEF * dp > 0) == (SIM_EXPIRATION_SIGN > 0);
    if (pushesOut != breathingOut) {   // towards the other phase: fill
      if (pushSum == 0) pushS = 0;
      pushSum += beyond * dt;
    } else {                           // back towards the current phase: empty
      pushSum = fmax(0, pushSum - beyond * dt);
    }
  }
  if (pushSum > 0) pushS += dt;
  if (pushSum >= SIM_GAS_PHASE_INTEGRAL) {
    breathingOut = !breathingOut;
    phaseS = pushS;  // the breath began when the sum started filling, not now
    pushSum = 0;
  }
}

static void gasSim(float dp, double dt) {
  breathPhase(dp, dt);
  phaseS += dt;
  double co2Target = SIM_CO2_INSP;
  if (breathingOut && phaseS > SIM_CO2_DEAD_S)
    co2Target += (SIM_ETCO2 - SIM_CO2_INSP) * (1 - exp(-(phaseS - SIM_CO2_DEAD_S) / SIM_CO2_RISE_S));
  double o2Target = SIM_O2_INSP - SIM_O2_PER_CO2 * (co2Target - SIM_CO2_INSP);
  co2 += (co2Target - co2) * dt / (SIM_GAS_LAG_S + dt);
  o2 += (o2Target - o2) * dt / (SIM_GAS_LAG_S + dt);
}

bool sensorsBegin() { return lpsFind(); }

uint8_t sensorsFitted() {
  return 1 << CH_FLOW | 1 << CH_PRESSURE | (SIM_GAS ? 1 << CH_CO2 | 1 << CH_O2 : 0);
}

float sensorsAtmHpa() { return atmShared.load(); }

void sensorsRead(int64_t tUs, float out[NUM_CHANNELS]) {
  out[CH_CO2] = NAN;
  out[CH_O2] = NAN;
  out[CH_FLOW] = NAN;
  out[CH_PRESSURE] = NAN;

  if (!lpsAddr) {  // not found (yet): look again every 2 s, e.g. board plugged in late
    if (tUs - lpsLastTryUs < 2000000) return;
    lpsLastTryUs = tUs;
    if (!lpsFind()) return;
  }
  float hPa;
  if (!lpsRead(hPa)) return;
  atmUpdate(hPa);
  float dp = (hPa - atmHpa) * HPA_TO_CMH2O;
  out[CH_PRESSURE] = dp;
  out[CH_FLOW] = FLOW_COEF * dp;
#if SIM_GAS
  gasSim(dp, 1.0 / SAMPLE_RATE_HZ);
  out[CH_CO2] = co2;
  out[CH_O2] = o2;
#endif
}
#endif
