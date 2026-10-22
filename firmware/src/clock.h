#pragma once
#include <stddef.h>
#include <stdint.h>

// Wall clock, in UTC. Where the time comes from:
//  - the DS1307 clock chip (RTC_ENABLED), read at power-on: it kept counting on its
//    battery, so the device knows the time without a PC, and a session can be
//    continued after a restart even if no page is connected;
//  - the PC ("hello" command), when the device has no time yet or is more than 1 s off.
//    The PC's time is then written to the clock chip too.
// Between the two, the ESP32's own timer counts the milliseconds.
void clockBegin();                       // reads the clock chip: once, before the tasks start
void clockSetFromPc(int64_t epochMs);
void clockPoll();                        // IO task: writes the PC's time to the clock chip
bool clockSynced();
bool clockRtcFound();                    // clock chip present on the bus
int64_t clockNowMs();                                  // Unix time in ms
void clockIso(int64_t epochMs, char *out, size_t n);   // "2026-10-12T09:41:00Z"
