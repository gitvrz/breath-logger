#include <esp_timer.h>
#include <stdio.h>
#include <time.h>
#include "clock.h"

static int64_t offsetMs = 0;  // epoch ms at boot
static bool synced = false;

void clockSet(int64_t epochMs) {
  offsetMs = epochMs - esp_timer_get_time() / 1000;
  synced = true;
}

bool clockSynced() { return synced; }

int64_t clockNowMs() { return offsetMs + esp_timer_get_time() / 1000; }

void clockIso(int64_t epochMs, char *out, size_t n) {
  time_t s = epochMs / 1000;
  struct tm tm;
  gmtime_r(&s, &tm);
  strftime(out, n, "%Y-%m-%dT%H:%M:%SZ", &tm);
}
