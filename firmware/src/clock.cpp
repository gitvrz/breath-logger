#include <Arduino.h>
#include <atomic>
#include <esp_timer.h>
#include <stdio.h>
#include <time.h>
#include "clock.h"
#include "config.h"
#include "i2c.h"

static std::atomic<int64_t> offsetMs{0};  // epoch ms at boot
static std::atomic<bool> synced{false};
static bool rtcFound = false;
static int64_t rtcWriteAtUs = 0;          // 0 = nothing to write
static int64_t rtcPendingS = 0;

static void clockSet(int64_t epochMs) {
  offsetMs = epochMs - esp_timer_get_time() / 1000;
  synced = true;
}

// ---- DS1307 (Maxim): date and time in BCD, registers 0 to 6 ------------------------
static const uint8_t RTC_ADDR = 0x68;

static int bcd(uint8_t v) { return (v >> 4) * 10 + (v & 0x0F); }
static uint8_t toBcd(int v) { return (v / 10) << 4 | (v % 10); }

// Days since 1970-01-01 of a calendar date (any year after 1970)
static int64_t daysFromCivil(int y, int m, int d) {
  y -= m <= 2;
  int era = y / 400, yoe = y - era * 400;
  int doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  int doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return (int64_t)era * 146097 + doe - 719468;
}

// Time in the chip, in Unix seconds. -1 = no chip, or a clock never set (stopped,
// e.g. after a battery change) or holding nonsense.
static int64_t rtcReadEpochS(uint8_t &sec) {
  uint8_t b[7];
  if (!i2cRead(RTC_ADDR, 0x00, b, 7)) return -1;
  sec = b[0];
  if (b[0] & 0x80) return -1;  // CH bit: the clock is stopped
  int h = b[2] & 0x40 ? bcd(b[2] & 0x1F) % 12 + (b[2] & 0x20 ? 12 : 0) : bcd(b[2] & 0x3F);
  int y = 2000 + bcd(b[6]), mo = bcd(b[5] & 0x1F), d = bcd(b[4] & 0x3F);
  int mi = bcd(b[1] & 0x7F), s = bcd(b[0] & 0x7F);
  if (y < 2025 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return -1;
  return daysFromCivil(y, mo, d) * 86400 + h * 3600 + mi * 60 + s;
}

static bool rtcWriteEpochS(int64_t epochS) {
  time_t t = epochS;
  struct tm tm;
  gmtime_r(&t, &tm);
  uint8_t b[7] = {toBcd(tm.tm_sec), toBcd(tm.tm_min), toBcd(tm.tm_hour), (uint8_t)(tm.tm_wday + 1),
                  toBcd(tm.tm_mday), toBcd(tm.tm_mon + 1), toBcd(tm.tm_year % 100)};
  return i2cWrite(RTC_ADDR, 0x00, b, 7);  // seconds with CH = 0: the clock runs
}

void clockBegin() {
#if RTC_ENABLED
  rtcFound = i2cPresent(RTC_ADDR);
  if (!rtcFound) return;
  // The chip counts whole seconds: wait for the next one to know the time to the ms
  uint8_t first, sec;
  if (rtcReadEpochS(first) < 0) return;
  uint32_t t0 = millis();
  while (millis() - t0 < 1100) {
    delay(5);
    int64_t s = rtcReadEpochS(sec);
    if (s < 0) return;
    if (sec != first) {
      clockSet(s * 1000);
      return;
    }
  }
#endif
}

void clockSetFromPc(int64_t epochMs) {
  // A few ms off is normal (message delay): moving the time each time a screen
  // connects would be worse than keeping it
  if (synced && llabs(epochMs - clockNowMs()) <= 1000) return;
  clockSet(epochMs);
  if (rtcFound) {  // write the chip right at the next full second
    int64_t nextS = (epochMs + 999) / 1000;
    rtcPendingS = nextS;
    rtcWriteAtUs = esp_timer_get_time() + (nextS * 1000 - epochMs) * 1000;
  }
}

void clockPoll() {
  if (!rtcWriteAtUs || esp_timer_get_time() < rtcWriteAtUs) return;
  rtcWriteAtUs = 0;
  rtcWriteEpochS(rtcPendingS);
}

bool clockSynced() { return synced.load(); }

bool clockRtcFound() { return rtcFound; }

int64_t clockNowMs() { return offsetMs.load() + esp_timer_get_time() / 1000; }

void clockIso(int64_t epochMs, char *out, size_t n) {
  time_t s = epochMs / 1000;
  struct tm tm;
  gmtime_r(&s, &tm);
  strftime(out, n, "%Y-%m-%dT%H:%M:%SZ", &tm);
}
