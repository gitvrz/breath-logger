#include <Arduino.h>
#include <ArduinoJson.h>
#include <esp_system.h>
#include "clock.h"
#include "acquisition.h"
#include "commands.h"
#include "link.h"
#include "net.h"
#include "recorder.h"
#include "storage.h"

static double round3(double v) { return round(v * 1000.0) / 1000.0; }

// Standard CRC-32 (same as zlib / PNG), lets the PC check each chunk it reads
static uint32_t crc32(const uint8_t *data, size_t n) {
  uint32_t crc = 0xFFFFFFFF;
  for (size_t i = 0; i < n; i++) {
    crc ^= data[i];
    for (int k = 0; k < 8; k++) crc = (crc >> 1) ^ (0xEDB88320 & (0 - (crc & 1)));
  }
  return ~crc;
}

static void addStatus(JsonObject o) {
  o["state"] = recorderStateName();
  if (recorderState() != RecState::Idle) {
    o["rec"] = recorderRecName();
    o["session"] = recorderSessionId();
    o["t_s"] = round3(recorderElapsedS());
    o["samples"] = recorderSamples();
    o["run_samples"] = recorderRunSamples();
  }
  o["dropped"] = acqRecordDropped();
  o["live_dropped"] = acqLiveDropped();
  o["acq_ok"] = !acqCheckStalled(millis());
  JsonArray faults = o["faults"].to<JsonArray>();  // channels without a valid value for 1 s
  static const char *ids[] = {"co2", "o2", "flow", "pressure"};
  for (int c = 0; c < NUM_CHANNELS; c++)
    if (acqFaults() & (1 << c)) faults.add(ids[c]);
  JsonObject sd = o["sd"].to<JsonObject>();
  sd["ok"] = storageOk();
  sd["total_mb"] = storageTotalMb();
  sd["free_mb"] = storageFreeMb();
  o["clock"] = clockSynced();
  o["rate_hz"] = SAMPLE_RATE_HZ;
  o["uptime_s"] = millis() / 1000;
  o["wifi_clients"] = netClients();
}

uint32_t diagLoopMaxMs = 0, diagAgeMaxMs = 0;

void sendStatus(bool diag) {
  JsonDocument doc;
  JsonObject o = doc.to<JsonObject>();
  o["type"] = "status";
  addStatus(o);
  if (diag) {  // where live data could wait inside the device (docs/protocol.md)
    uint32_t txMax, stallMax;
    linkTakeStats(txMax, stallMax);
    JsonObject d = o["diag"].to<JsonObject>();
    d["tx_max"] = txMax;
    d["stall_max_ms"] = stallMax;
    d["loop_max_ms"] = diagLoopMaxMs;
    d["age_max_ms"] = diagAgeMaxMs;
    diagLoopMaxMs = diagAgeMaxMs = 0;
  }
  linkSendJson(doc, false);
}

static void addInfo(JsonObject o) {
  o["fw"] = FW_VERSION;
  o["rate_hz"] = SAMPLE_RATE_HZ;
  o["simulated"] = (bool)USE_SIMULATED_SENSORS;
  o["reset_reason"] = (int)esp_reset_reason();
  o["wifi"] = netSsid();  // "" = Wi-Fi disabled
  JsonArray ch = o["channels"].to<JsonArray>();
  const char *ids[] = {"co2", "o2", "flow", "pressure"};
  const char *names[] = {"CO2", "O2", "Flow", "Pressure"};
  const char *units[] = {"%", "%", "L/min", "cmH2O"};
  for (int i = 0; i < NUM_CHANNELS; i++) {
    JsonObject c = ch.add<JsonObject>();
    c["id"] = ids[i];
    c["name"] = names[i];
    c["unit"] = units[i];
  }
}

// ---- file management -------------------------------------------------------

// Sends one {"type":"item"} message per recording, then the reply with the count:
// the number of recordings is not limited by the ESP32's RAM.
static const char *cmdList(JsonVariantConst cmd, JsonObject reply) {
  File root = sdFs().open(REC_ROOT);
  if (!root) return "cannot open " REC_ROOT;
  JsonDocument meta, item;
  uint32_t count = 0;
  for (File f = root.openNextFile(); f; f = root.openNextFile()) {
    bool isDir = f.isDirectory();
    String name = f.name();
    f.close();
    if (!isDir) continue;
    recorderPoll();  // keep writing the recording in progress while listing
    item.clear();
    JsonObject o = item.to<JsonObject>();
    o["type"] = "item";
    o["id"] = cmd["id"];
    o["name"] = name;
    count++;
    if (!metaLoad(name.c_str(), meta)) {
      o["error"] = "meta.json missing or damaged";
      linkReplyJson(item);
      continue;
    }
    o["created"] = meta["created"];
    o["notes"] = meta["notes"];
    double total = 0;
    int64_t lastMs = 0;  // end of the most recent activity, for sorting by date
    for (JsonObject s : meta["sessions"].as<JsonArray>()) {
      total += s["duration_s"] | 0.0;
      int64_t end = s["start_ms"].as<int64_t>() + (int64_t)((s["end_s"] | 0.0) * 1000);
      if (end > lastMs) lastMs = end;
    }
    o["sessions"] = meta["sessions"].size();
    o["duration_s"] = round3(total);
    if (lastMs) o["last_ms"] = lastMs;
    linkReplyJson(item);
  }
  root.close();
  reply["count"] = count;
  return nullptr;
}

static const char *cmdGet(JsonVariantConst cmd, JsonObject reply) {
  const char *rec = cmd["rec"];
  if (!validRecName(rec) || !recExists(rec)) return "recording not found";
  JsonDocument meta;
  if (!metaLoad(rec, meta)) return "cannot read meta.json";
  reply["meta"] = meta;
  return nullptr;
}

static const char *cmdCreate(JsonVariantConst cmd) {
  const char *rec = cmd["rec"];
  const char *notes = cmd["notes"] | "";
  if (!validRecName(rec)) return "invalid name (letters, digits, _ and -, max 32)";
  if (recExists(rec)) return "a recording with this name already exists";
  if (strlen(notes) > NOTES_MAX) return "notes too long";
  char dir[64];
  recDirPath(rec, dir, sizeof(dir));
  if (!sdFs().mkdir(dir)) return "cannot create folder";
  JsonDocument meta;
  metaInit(meta, rec, notes);
  return metaSave(rec, meta) ? nullptr : "cannot write meta.json";
}

static const char *cmdRename(JsonVariantConst cmd) {
  const char *rec = cmd["rec"], *to = cmd["to"];
  if (!validRecName(rec) || !recExists(rec)) return "recording not found";
  if (!validRecName(to)) return "invalid new name (letters, digits, _ and -, max 32)";
  if (recExists(to)) return "a recording with this name already exists";
  char a[64], b[64];
  recDirPath(rec, a, sizeof(a));
  recDirPath(to, b, sizeof(b));
  if (!sdFs().rename(a, b)) return "rename failed";
  JsonDocument meta;
  if (!metaLoad(to, meta)) return "renamed, but cannot read meta.json";
  meta["name"] = to;
  return metaSave(to, meta) ? nullptr : "renamed, but cannot write meta.json";
}

static const char *cmdDelete(JsonVariantConst cmd) {
  const char *rec = cmd["rec"];
  if (!validRecName(rec) || !recExists(rec)) return "recording not found";
  char stamp[20], name[96], dir[64];
  trashStamp(stamp, sizeof(stamp));
  if (cmd["session"].isNull()) {
    recDirPath(rec, dir, sizeof(dir));
    snprintf(name, sizeof(name), "%s__%s", rec, stamp);
    return moveToTrash(dir, name) ? nullptr : "delete failed";
  }
  int sid = cmd["session"];
  JsonDocument meta;
  if (!metaLoad(rec, meta)) return "cannot read meta.json";
  int idx = metaSessionIndex(meta, sid);
  if (idx < 0) return "session not found";
  char path[80];
  sessionPath(rec, sid, path, sizeof(path));
  snprintf(name, sizeof(name), "%s__s%03d__%s.json", rec, sid, stamp);
  saveSessionMetaToTrash(metaFindSession(meta, sid), name);
  snprintf(name, sizeof(name), "%s__s%03d__%s.csv", rec, sid, stamp);
  if (sdFs().exists(path) && !moveToTrash(path, name)) return "delete failed";
  meta["sessions"].as<JsonArray>().remove(idx);
  return metaSave(rec, meta) ? nullptr : "cannot write meta.json";
}

static const char *cmdNotes(JsonVariantConst cmd) {
  const char *rec = cmd["rec"];
  const char *notes = cmd["notes"] | "";
  if (strlen(notes) > NOTES_MAX) return "notes too long";
  if (!validRecName(rec) || !recExists(rec)) return "recording not found";
  JsonDocument meta;
  if (!metaLoad(rec, meta)) return "cannot read meta.json";
  if (cmd["session"].isNull()) {
    meta["notes"] = notes;
  } else {
    JsonObject s = metaFindSession(meta, cmd["session"]);
    if (s.isNull()) return "session not found";
    s["notes"] = notes;
  }
  return metaSave(rec, meta) ? nullptr : "cannot write meta.json";
}

static const char *cmdRead(JsonVariantConst cmd, JsonObject reply) {
  static char buf[READ_CHUNK_MAX + 1];
  const char *rec = cmd["rec"];
  if (!validRecName(rec)) return "recording not found";
  char path[80];
  sessionPath(rec, cmd["session"] | 0, path, sizeof(path));
  File f = sdFs().open(path, FILE_READ);
  if (!f) return "session file not found";
  uint32_t size = f.size();
  uint32_t offset = cmd["offset"] | 0;
  uint32_t len = min<uint32_t>(cmd["len"] | READ_CHUNK_MAX, READ_CHUNK_MAX);
  size_t n = 0;
  if (offset < size && f.seek(offset)) n = f.read((uint8_t *)buf, len);
  f.close();
  buf[n] = 0;
  reply["offset"] = offset;
  reply["size"] = size;
  reply["eof"] = offset + n >= size;
  reply["n"] = n;
  reply["crc"] = crc32((const uint8_t *)buf, n);
  reply["data"] = buf;
  return nullptr;
}

// A trim hides rows outside from_s..to_s. The CSV file is never modified: the trim is
// written to meta.json ("trims") and applied when the session is shown or exported.
// Rows recorded after a trim (session continued later) are not affected by it.
struct TrimWindow {
  double from, to, end;  // end = end_s of the session when the trim was made
};

static bool rowVisible(double t, const TrimWindow *w, int n) {
  for (int i = 0; i < n; i++)
    if (t <= w[i].end && (t < w[i].from || t > w[i].to)) return false;
  return true;
}

// Every change to a session's visible data is logged, with the wall-clock time.
static JsonObject logEdit(JsonObject s, const char *type) {
  JsonArray edits = s["edits"].as<JsonArray>();
  if (edits.isNull()) edits = s["edits"].to<JsonArray>();
  JsonObject e = edits.add<JsonObject>();
  e["type"] = type;
  if (clockSynced()) e["at_ms"] = clockNowMs();
  return e;
}

static const char *cmdTrim(JsonVariantConst cmd) {
  const char *rec = cmd["rec"];
  int sid = cmd["session"] | 0;
  double from = cmd["from_s"] | 0.0, to = cmd["to_s"] | 0.0;
  if (!(to > from)) return "invalid range";
  if (!validRecName(rec) || !recExists(rec)) return "recording not found";
  JsonDocument meta;
  if (!metaLoad(rec, meta)) return "cannot read meta.json";
  JsonObject s = metaFindSession(meta, sid);
  if (s.isNull()) return "session not found";
  JsonArray trims = s["trims"].as<JsonArray>();
  if (trims.isNull()) trims = s["trims"].to<JsonArray>();
  if (trims.size() >= MAX_TRIMS) return "too many trims: restore the session first";

  TrimWindow w[MAX_TRIMS + 1];
  int nw = 0;
  for (JsonObject tr : trims) w[nw++] = {tr["from_s"] | 0.0, tr["to_s"] | 0.0, tr["end_s"] | 0.0};
  double end = s["end_s"] | 0.0;
  w[nw++] = {from, to, end};

  // Count the rows that stay visible (read only)
  char path[80];
  sessionPath(rec, sid, path, sizeof(path));
  File f = sdFs().open(path, FILE_READ);
  if (!f) return "session file not found";
  static uint8_t in[1024];
  char field[24];
  size_t fl = 0;
  bool header = true, first = true;
  uint32_t rows = 0, visible = 0;
  int n;
  while ((n = f.read(in, sizeof(in))) > 0) {
    for (int i = 0; i < n; i++) {
      char c = (char)in[i];
      if (c == '\n') {
        if (!header && fl) {
          field[fl] = 0;
          double t = strtod(field, nullptr);
          rows++;
          if (rowVisible(t, w, nw)) visible++;
        }
        header = false;
        first = true;
        fl = 0;
      } else if (first) {
        if (c == ',') first = false;
        else if (fl < sizeof(field) - 1) field[fl++] = c;
      }
    }
  }
  f.close();
  if (visible == 0) return "nothing to keep in this range";

  JsonObject tr = trims.add<JsonObject>();
  tr["from_s"] = round3(from);
  tr["to_s"] = round3(to);
  tr["end_s"] = round3(end);
  if (clockSynced()) tr["at_ms"] = clockNowMs();
  s["hidden_samples"] = rows - visible;
  s["duration_s"] = round3(visible / (double)(meta["rate_hz"] | SAMPLE_RATE_HZ));
  JsonObject e = logEdit(s, "trim");
  e["from_s"] = round3(from);
  e["to_s"] = round3(to);
  return metaSave(rec, meta) ? nullptr : "cannot write meta.json";
}

// Cancels every trim of a session: all recorded rows are visible again.
static const char *cmdRestore(JsonVariantConst cmd) {
  const char *rec = cmd["rec"];
  if (!validRecName(rec) || !recExists(rec)) return "recording not found";
  JsonDocument meta;
  if (!metaLoad(rec, meta)) return "cannot read meta.json";
  JsonObject s = metaFindSession(meta, cmd["session"] | 0);
  if (s.isNull()) return "session not found";
  if (s["trims"].size() == 0) return nullptr;
  s.remove("trims");
  s["hidden_samples"] = 0;
  s["duration_s"] = round3((s["samples"] | 0) / (double)(meta["rate_hz"] | SAMPLE_RATE_HZ));
  logEdit(s, "restore");
  return metaSave(rec, meta) ? nullptr : "cannot write meta.json";
}

static const char *cmdTrash(JsonObject reply) {
  uint32_t items;
  uint64_t bytes;
  trashInfo(items, bytes);
  reply["items"] = items;
  reply["bytes"] = bytes;
  return nullptr;
}

static const char *cmdEmptyTrash() {
  const char *err = emptyTrash() ? nullptr : "could not empty the trash";
  storageRefreshSpace();
  return err;
}

// ---- dispatcher --------------------------------------------------------------

void commandsHandle(const char *line) {
  JsonDocument cmd;
  if (deserializeJson(cmd, line)) {
    linkSendEvent("warn", "invalid JSON command");
    return;
  }
  const char *c = cmd["cmd"] | "";
  JsonDocument doc;
  JsonObject reply = doc.to<JsonObject>();
  reply["type"] = "reply";
  if (!cmd["id"].isNull()) reply["id"] = cmd["id"];

  const char *err = nullptr;
  bool stateChanged = false;
  bool idle = recorderState() == RecState::Idle;
  bool needsSd = strcmp(c, "list") == 0 || strcmp(c, "get") == 0;
  bool idleOnly = strcmp(c, "create") == 0 || strcmp(c, "rename") == 0 || strcmp(c, "delete") == 0 ||
                  strcmp(c, "notes") == 0 || strcmp(c, "read") == 0 || strcmp(c, "trim") == 0 || strcmp(c, "restore") == 0 ||
                  strcmp(c, "trash") == 0 || strcmp(c, "empty_trash") == 0;

  // The card is looked for only when it is needed (and when the page connects): a
  // failed attempt blocks this task for about 1 s, which would freeze the live view.
  bool wantsSd = needsSd || idleOnly || !strcmp(c, "start") || !strcmp(c, "hello");
  if (wantsSd && idle && !storageOk()) storageMount();

  if ((needsSd || idleOnly) && !storageOk()) err = "no SD card";
  else if (idleOnly && !idle) err = "busy: stop the recording first";
  else if (!strcmp(c, "hello")) {
    int64_t t = cmd["time"] | (int64_t)0;
    if (t > 0) clockSet(t);
    addInfo(reply["info"].to<JsonObject>());
    addStatus(reply["status"].to<JsonObject>());
  } else if (!strcmp(c, "status")) {
    addStatus(reply["status"].to<JsonObject>());
  } else if (!strcmp(c, "start")) {
    int sid = cmd["session"].is<int>() ? cmd["session"].as<int>() : -1;
    int out = 0;
    err = recorderStart(cmd["rec"] | "", sid, cmd["notes"] | "", &out);
    if (!err) reply["session"] = out;
    stateChanged = true;
  } else if (!strcmp(c, "pause")) {
    err = recorderPause();
    stateChanged = true;
  } else if (!strcmp(c, "resume")) {
    err = recorderResume();
    stateChanged = true;
  } else if (!strcmp(c, "stop")) {
    err = recorderStop();
    stateChanged = true;
  } else if (!strcmp(c, "list")) err = cmdList(cmd, reply);
  else if (!strcmp(c, "get")) err = cmdGet(cmd, reply);
  else if (!strcmp(c, "create")) err = cmdCreate(cmd);
  else if (!strcmp(c, "rename")) err = cmdRename(cmd);
  else if (!strcmp(c, "delete")) err = cmdDelete(cmd);
  else if (!strcmp(c, "notes")) err = cmdNotes(cmd);
  else if (!strcmp(c, "read")) err = cmdRead(cmd, reply);
  else if (!strcmp(c, "trim")) err = cmdTrim(cmd);
  else if (!strcmp(c, "restore")) err = cmdRestore(cmd);
  else if (!strcmp(c, "trash")) err = cmdTrash(reply);
  else if (!strcmp(c, "empty_trash")) err = cmdEmptyTrash();
  else err = "unknown command";

  reply["ok"] = err == nullptr;
  if (err) reply["error"] = err;
  linkReplyJson(doc);
  if (stateChanged) sendStatus();
}
