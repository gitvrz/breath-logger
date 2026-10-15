#pragma once
#include <freertos/FreeRTOS.h>
#include "sample.h"

// Acquisition task (core 1): reads the sensors at SAMPLE_RATE_HZ and pushes every
// sample to two queues:
//  - the record queue, only while recording (consumed by the SD writer)
//  - the live queue, always (consumed by the USB sender; oldest dropped if full)
void acqBegin();                        // creates queues and starts the task
void acqSetRecording(bool on);
void acqClearRecordQueue();
bool acqPopRecord(Sample &s);           // non-blocking
bool acqPopLive(Sample &s);             // non-blocking
uint32_t acqRecordDropped();            // samples lost for the SD (must stay 0)
uint32_t acqLiveDropped();
void acqResetCounters();
int64_t acqTakeFirstDropUs();           // time of the first lost sample since last call (0 = none)
uint8_t acqFaults();                    // bit i set = channel i without valid value for 1 s
bool acqCheckStalled(uint32_t nowMs);   // called by the IO task: true if no sample for ACQ_STALL_MS
