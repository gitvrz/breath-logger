#pragma once
#include <stddef.h>
#include <stdint.h>

// Recording state machine (runs in the IO task on core 0).
//   Idle --start--> Recording --pause--> Paused --resume--> Recording
//   Recording/Paused --stop--> Idle
// Functions returning const char* return nullptr on success, or an error message.
enum class RecState { Idle, Recording, Paused };

void recorderPoll();  // write queued samples to the SD card, flush every second
const char *recorderStart(const char *rec, int sessionId /* -1 = new */, const char *notes, int *outSession);
const char *recorderPause();
const char *recorderResume();
const char *recorderStop();

RecState recorderState();
const char *recorderStateName();
const char *recorderRecName();
int recorderSessionId();
double recorderElapsedS();   // session time (t_s) now
uint32_t recorderSamples();     // rows in the session file
uint32_t recorderRunSamples();  // rows since the last start/continue
// SD card health: writes tried again and card remounted since boot (see writeOut),
// slowest write or flush since the last call
uint32_t recorderSdRetries();
uint32_t recorderSdRecoveries();
uint32_t recorderTakeSdSlowestMs();

// Adds an event (e.g. "stall") to the session being recorded, at the current time.
void recorderNote(const char *type);
