#include <Arduino.h>
#include <ArduinoJson.h>
#include <esp_timer.h>
#include <math.h>
#include "acquisition.h"
#include "clock.h"
#include "link.h"
#include "recorder.h"
#include "storage.h"
#include "textbuf.h"

static RecState state = RecState::Idle;
static char recName[REC_NAME_MAX + 1];
static int sessionId = 0;
static JsonDocument meta;        // meta.json of the recording in progress
static File csv;
static int64_t runStartUs;       // esp_timer time when this start/continue began
static double runOffsetS;        // t_s at runStartUs (0 for a new session)
static double lastTS, pausedTS;
static uint32_t samples;         // rows in the CSV file
static uint32_t runSamples;      // rows written since this start/continue
static char wbuf[4096];          // rows waiting to be written
static size_t wlen;
static uint32_t lastFlushMs, lastMetaMs;
static uint32_t droppedBase;     // samples lost in previous runs of this session
static uint32_t droppedReported; // lost samples of this run already written as events
static uint32_t sdRetries, sdRecoveries;  // since boot: writes tried again, card remounted
static uint32_t sdSlowestMs;              // slowest write or flush since the last status

static double round3(double v) { return round(v * 1000.0) / 1000.0; }
static double nowTS() { return runOffsetS + (esp_timer_get_time() - runStartUs) / 1e6; }

static JsonObject addEvent(const char *type, double t) {
  JsonObject s = metaFindSession(meta, sessionId);
  JsonObject e = s["events"].as<JsonArray>().add<JsonObject>();
  e["t_s"] = round3(t);
  e["type"] = type;
  return e;
}

static void updateSessionTotals() {
  JsonObject s = metaFindSession(meta, sessionId);
  s["samples"] = samples;
  uint32_t hidden = min<uint32_t>(s["hidden_samples"] | 0, samples);  // hidden by a trim
  s["duration_s"] = round3((samples - hidden) / (double)SAMPLE_RATE_HZ);  // visible recorded time
  s["end_s"] = round3(lastTS);                                  // t_s of the last row
  s["dropped"] = droppedBase + acqRecordDropped();              // samples lost (SD too slow)
}

static void noteSdTime(uint32_t t0) {
  uint32_t ms = millis() - t0;
  if (ms > sdSlowestMs) sdSlowestMs = ms;
}

// The card keeps refusing: unmount and mount it again, reopen the session file at its end
static bool reopenCsv() {
  csv.close();
  if (!storageRemount()) return false;
  char path[80];
  sessionPath(recName, sessionId, path, sizeof(path));
  csv = sdFs().open(path, FILE_APPEND);
  return (bool)csv;
}

// Writes the buffered rows. A refused write is tried again twice, then the card is
// remounted and the file reopened (seen on hardware: a write refused after ~15 min of
// recording). The 10 s sample queue absorbs the delay. The spot is marked "sd_error" in
// meta.json: one row there may be damaged, everything before and after is intact.
static bool writeOut() {
  if (wlen == 0) return true;
  uint32_t t0 = millis();
  size_t done = 0;
  for (int attempt = 0; done < wlen && attempt < 6; attempt++) {
    if (attempt == 3) {
      if (!reopenCsv()) break;
      sdRecoveries++;
      addEvent("sd_error", lastTS);
    } else if (attempt > 0) {
      sdRetries++;
      vTaskDelay(pdMS_TO_TICKS(20));
    }
    done += csv.write((const uint8_t *)wbuf + done, wlen - done);
  }
  noteSdTime(t0);
  bool ok = done == wlen;
  wlen = 0;
  return ok;
}

static bool drainQueue() {
  static const int dec[NUM_CHANNELS] = {3, 3, 2, 3};
  static char line[128];
  Sample s;
  while (acqPopRecord(s)) {
    double t = runOffsetS + (s.t_us - runStartUs) / 1e6;
    TextBuf row(line, sizeof(line));
    row.addf("%.3f", t);
    for (int i = 0; i < NUM_CHANNELS; i++) {
      row.add(',');
      row.num(s.v[i], dec[i], "");  // missing value = empty cell
    }
    row.add('\n');
    if (row.overflow()) continue;  // cannot happen with values limited to VALUE_LIMIT
    if (wlen + row.len() > sizeof(wbuf) && !writeOut()) return false;
    memcpy(wbuf + wlen, row.c_str(), row.len());
    wlen += row.len();
    lastTS = t;
    samples++;
    runSamples++;
  }
  return true;
}

static void failRecording(const char *msg) {
  acqSetRecording(false);
  csv.close();
  // Best effort: say in meta.json why the session ends here (else it looks like a power cut)
  if (storageRemount()) {
    addEvent("sd_failed", lastTS);
    updateSessionTotals();
    metaSave(recName, meta);
  }
  storageMarkFailed();
  state = RecState::Idle;
  linkSendEvent("error", msg);
}

// Samples lost because the SD card was too slow: note where, so the gap is explained
static void noteLostSamples() {
  uint32_t d = acqRecordDropped();
  if (d == droppedReported) return;
  int64_t firstUs = acqTakeFirstDropUs();
  JsonObject e = addEvent("lost", firstUs ? runOffsetS + (firstUs - runStartUs) / 1e6 : lastTS);
  e["n"] = d - droppedReported;
  droppedReported = d;
  updateSessionTotals();
  metaSave(recName, meta);
}

void recorderNote(const char *type) {
  if (state == RecState::Idle) return;
  addEvent(type, state == RecState::Paused ? pausedTS : nowTS());
  metaSave(recName, meta);
}

void recorderPoll() {
  if (state == RecState::Idle) return;
  if (!drainQueue()) return failRecording("SD write failed - recording stopped");
  noteLostSamples();
  uint32_t now = millis();
  if (now - lastFlushMs >= FLUSH_PERIOD_MS) {
    lastFlushMs = now;
    if (!writeOut()) return failRecording("SD write failed - recording stopped");
    uint32_t t0 = millis();
    csv.flush();  // data is safe on the card even if power is cut
    noteSdTime(t0);
  }
  if (now - lastMetaMs >= 30000) {  // keep totals roughly right in case of power cut
    lastMetaMs = now;
    updateSessionTotals();
    metaSave(recName, meta);
  }
}

const char *recorderStart(const char *rec, int sid, const char *notes, int *outSession) {
  if (state != RecState::Idle) return "busy: already recording";
  if (!storageOk()) return "no SD card";
  if (!validRecName(rec)) return "invalid name (letters, digits, _ and -, max 32)";

  if (recExists(rec)) {
    if (!metaLoad(rec, meta)) return "cannot read meta.json";
  } else {
    if (sid >= 0) return "recording not found";
    char dir[64];
    recDirPath(rec, dir, sizeof(dir));
    if (!sdFs().mkdir(dir)) return "cannot create folder";
    metaInit(meta, rec, "");
  }

  char path[80];
  if (sid < 0) {  // new session
    sid = meta["next_session"] | 1;
    meta["next_session"] = sid + 1;
    sessionPath(rec, sid, path, sizeof(path));
    csv = sdFs().open(path, FILE_WRITE);
    if (!csv) return "cannot create session file";
    csv.print(CSV_HEADER);

    char fname[24], iso[32];
    int64_t now = clockNowMs();
    sessionFileName(sid, fname, sizeof(fname));
    clockIso(now, iso, sizeof(iso));
    JsonObject s = meta["sessions"].as<JsonArray>().add<JsonObject>();
    s["id"] = sid;
    s["file"] = fname;
    s["start"] = iso;
    s["start_ms"] = now;
    s["clock"] = clockSynced();
    s["notes"] = String(notes ? notes : "");
    s["samples"] = 0;
    s["duration_s"] = 0;
    s["end_s"] = 0;
    s["dropped"] = 0;
    s["events"].to<JsonArray>();
    sessionId = sid;
    runOffsetS = 0;
    samples = 0;
    lastTS = 0;
    addEvent("start", 0);
  } else {  // continue an existing session: append to its CSV
    JsonObject s = metaFindSession(meta, sid);
    if (s.isNull()) return "session not found";
    if (!clockSynced() || !(s["clock"] | false)) return "clock not set: cannot continue this session";
    sessionPath(rec, sid, path, sizeof(path));
    csv = sdFs().open(path, FILE_APPEND);
    if (!csv) return "cannot open session file";
    double end = s["end_s"] | 0.0;
    double sinceStart = (clockNowMs() - s["start_ms"].as<int64_t>()) / 1000.0;
    sessionId = sid;
    runOffsetS = max(sinceStart, end + 1.0 / SAMPLE_RATE_HZ);  // time never goes back
    samples = s["samples"] | 0;
    lastTS = end;
    addEvent("continue", runOffsetS);
  }

  if (!metaSave(rec, meta)) {
    csv.close();
    return "cannot write meta.json";
  }
  strlcpy(recName, rec, sizeof(recName));
  wlen = 0;
  runSamples = 0;
  droppedBase = metaFindSession(meta, sessionId)["dropped"] | 0;
  droppedReported = 0;
  lastFlushMs = lastMetaMs = millis();
  acqResetCounters();
  acqClearRecordQueue();
  runStartUs = esp_timer_get_time();
  acqSetRecording(true);
  state = RecState::Recording;
  *outSession = sid;
  return nullptr;
}

const char *recorderPause() {
  if (state != RecState::Recording) return "not recording";
  acqSetRecording(false);
  pausedTS = nowTS();
  if (!drainQueue() || !writeOut()) {
    failRecording("SD write failed - recording stopped");
    return "SD write failed";
  }
  csv.flush();
  addEvent("pause", pausedTS);
  updateSessionTotals();
  metaSave(recName, meta);
  state = RecState::Paused;
  return nullptr;
}

const char *recorderResume() {
  if (state != RecState::Paused) return "not paused";
  addEvent("resume", nowTS());
  metaSave(recName, meta);
  acqSetRecording(true);
  state = RecState::Recording;
  return nullptr;
}

const char *recorderStop() {
  if (state == RecState::Idle) return "not recording";
  acqSetRecording(false);
  vTaskDelay(pdMS_TO_TICKS(1000 / SAMPLE_RATE_HZ + 5));  // let an in-flight sample land
  bool ok = drainQueue() && writeOut();
  csv.close();
  noteLostSamples();
  addEvent("stop", state == RecState::Paused ? pausedTS : nowTS());
  updateSessionTotals();
  bool metaOk = metaSave(recName, meta);
  state = RecState::Idle;
  if (!ok) {
    storageMarkFailed();
    return "SD write failed";
  }
  storageRefreshSpace();
  return metaOk ? nullptr : "cannot write meta.json";
}

RecState recorderState() { return state; }
const char *recorderStateName() {
  switch (state) {
    case RecState::Recording: return "recording";
    case RecState::Paused: return "paused";
    default: return "idle";
  }
}
const char *recorderRecName() { return recName; }
int recorderSessionId() { return sessionId; }
double recorderElapsedS() {
  if (state == RecState::Recording) return nowTS();
  if (state == RecState::Paused) return pausedTS;
  return 0;
}
uint32_t recorderSamples() { return samples; }
uint32_t recorderRunSamples() { return runSamples; }
uint32_t recorderSdRetries() { return sdRetries; }
uint32_t recorderSdRecoveries() { return sdRecoveries; }
uint32_t recorderTakeSdSlowestMs() {
  uint32_t ms = sdSlowestMs;
  sdSlowestMs = 0;
  return ms;
}
