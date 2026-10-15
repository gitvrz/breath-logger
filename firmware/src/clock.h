#pragma once
#include <stddef.h>
#include <stdint.h>

// Wall clock. There is no RTC yet: the PC sends its time ("hello" command) and we
// keep counting from there. Replace clockNowMs() with an RTC read once one is fitted.
void clockSet(int64_t epochMs);
bool clockSynced();
int64_t clockNowMs();                                  // Unix time in ms
void clockIso(int64_t epochMs, char *out, size_t n);   // "2026-10-12T09:41:00Z"
