// Fake but realistic breathing signals (person exercising on a treadmill),
// so the whole system can be developed and tested without the real sensors.
#include "config.h"
#if USE_SIMULATED_SENSORS
#include <Arduino.h>
#include <math.h>
#include "sensors.h"

static double phase = 0;      // position in the current breath, 0..1
static int64_t lastUs = 0;
static double co2 = 0.04;     // lagged like a real gas sensor

// Roughly gaussian noise of standard deviation ~amp/2
static float noise(float amp) {
  float u = 0;
  for (int i = 0; i < 3; i++) u += esp_random() / 4294967295.0f;
  return (u - 1.5f) * amp;
}

bool sensorsBegin() { return true; }
uint8_t sensorsFitted() { return (1 << NUM_CHANNELS) - 1; }
float sensorsAtmHpa() { return NAN; }

void sensorsRead(int64_t tUs, float out[NUM_CHANNELS]) {
  double t = tUs / 1e6;
  double dt = lastUs ? (tUs - lastUs) / 1e6 : 1.0 / SAMPLE_RATE_HZ;
  lastUs = tUs;

  double rr = 25.0 + 6.0 * sin(2 * M_PI * t / 90.0);      // breaths per minute
  phase = fmod(phase + dt * rr / 60.0, 1.0);

  const double ti = 0.45;                                   // inspiration fraction
  double peak = 150.0 + 20.0 * sin(2 * M_PI * t / 37.0);   // peak flow L/min
  double flow, co2Target;
  if (phase < ti) {                                         // inspiration (+)
    flow = peak * sin(M_PI * phase / ti);
    co2Target = 0.04;
  } else {                                                  // expiration (-), same volume
    double pe = (phase - ti) / (1 - ti);
    flow = -peak * ti / (1 - ti) * sin(M_PI * pe);
    co2Target = 0.04 + 5.2 * (1 - exp(-pe / 0.12));
  }
  co2 += (co2Target - co2) * dt / (0.08 + dt);              // 80 ms sensor lag
  double o2 = 20.95 - 1.04 * (co2 - 0.04);

  out[0] = co2 + noise(0.02);
  out[1] = o2 + noise(0.03);
  out[2] = flow + noise(1.0);
  out[3] = SIM_PRESSURE_FACTOR * (1e-4 * flow * fabs(flow) + noise(0.02));  // mouthpiece resistance
}
#endif
