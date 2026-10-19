#pragma once
#include <ArduinoJson.h>
#include <FS.h>

// SD card + recording folders:
//   /recordings/<name>/meta.json
//   /recordings/<name>/session_001.csv ...
#define REC_ROOT "/recordings"
#define CSV_HEADER "t_s,co2_pct,o2_pct,flow_lpm,pressure_cmh2o\n"

fs::FS &sdFs();
bool storageMount();          // mount the card (safe to call again after a failure)
void storageMarkFailed();     // call after a write error: unmount, retry later
bool storageRemount();        // during a recording, after a write error: quick unmount + mount
bool storageOk();
void storageRefreshSpace();   // can take a moment on big cards: not while recording
uint32_t storageTotalMb();
uint32_t storageFreeMb();

bool validRecName(const char *name);
void recDirPath(const char *rec, char *out, size_t n);
void sessionPath(const char *rec, int id, char *out, size_t n);
void sessionFileName(int id, char *out, size_t n);
bool recExists(const char *rec);

void metaInit(JsonDocument &meta, const char *rec, const char *notes);
bool metaLoad(const char *rec, JsonDocument &meta);
bool metaSave(const char *rec, JsonDocument &meta);  // write tmp file, then swap
JsonObject metaFindSession(JsonDocument &meta, int id);
int metaSessionIndex(JsonDocument &meta, int id);

// Trash: deleted recordings / sessions are moved to /trash instead of being erased
// (recoverable by reading the card on a PC).
//   /trash/<rec>__<stamp>/                      a deleted recording (whole folder)
//   /trash/<rec>__s002__<stamp>.csv + .json      a deleted session (data + its meta)
void trashStamp(char *out, size_t n);                      // "20261012-143012"
bool moveToTrash(const char *path, const char *trashName);
bool saveSessionMetaToTrash(JsonObjectConst session, const char *trashName);
void trashInfo(uint32_t &items, uint64_t &bytes);
bool emptyTrash();
