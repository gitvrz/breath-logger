#include <Arduino.h>
#include "config.h"
#include "clock.h"
#include "storage.h"
#if SD_USE_SDMMC
#include <SD_MMC.h>
#define SDCARD SD_MMC
#else
#include <SD.h>
#include <SPI.h>
#define SDCARD SD
#endif

static bool mounted = false;
static uint32_t totalMb = 0, freeMb = 0;

fs::FS &sdFs() { return SDCARD; }
bool storageOk() { return mounted; }
uint32_t storageTotalMb() { return totalMb; }
uint32_t storageFreeMb() { return freeMb; }

bool storageMount() {
  if (mounted) return true;
#if SD_USE_SDMMC
#if SD_MMC_4BIT
  SD_MMC.setPins(PIN_SD_CLK, PIN_SD_CMD, PIN_SD_D0, PIN_SD_D1, PIN_SD_D2, PIN_SD_D3);
  mounted = SD_MMC.begin("/sdcard", false);
#else
  SD_MMC.setPins(PIN_SD_CLK, PIN_SD_CMD, PIN_SD_D0);
  mounted = SD_MMC.begin("/sdcard", true);
#endif
#else
  static bool spiStarted = false;
  if (!spiStarted) {
    SPI.begin(PIN_SD_CLK, PIN_SD_D0, PIN_SD_CMD, PIN_SD_D3);
    spiStarted = true;
  }
  mounted = SD.begin(PIN_SD_D3, SPI, SD_SPI_FREQ);
#endif
  if (!mounted) {
    SDCARD.end();
    return false;
  }
  if (!SDCARD.exists(REC_ROOT)) SDCARD.mkdir(REC_ROOT);
  storageRefreshSpace();
  return true;
}

void storageMarkFailed() {
  SDCARD.end();
  mounted = false;
  totalMb = freeMb = 0;
}

void storageRefreshSpace() {
  if (!mounted) return;
  uint64_t total = SDCARD.totalBytes(), used = SDCARD.usedBytes();
  totalMb = total / (1024 * 1024);
  freeMb = (total - used) / (1024 * 1024);
}

bool validRecName(const char *name) {
  if (!name) return false;
  size_t n = strlen(name);
  if (n == 0 || n > REC_NAME_MAX) return false;
  for (size_t i = 0; i < n; i++) {
    char c = name[i];
    if (!(isalnum((unsigned char)c) || c == '_' || c == '-')) return false;
  }
  return true;
}

void recDirPath(const char *rec, char *out, size_t n) { snprintf(out, n, REC_ROOT "/%s", rec); }
void sessionFileName(int id, char *out, size_t n) { snprintf(out, n, "session_%03d.csv", id); }
void sessionPath(const char *rec, int id, char *out, size_t n) {
  snprintf(out, n, REC_ROOT "/%s/session_%03d.csv", rec, id);
}

bool recExists(const char *rec) {
  char p[64];
  recDirPath(rec, p, sizeof(p));
  return SDCARD.exists(p);
}

void metaInit(JsonDocument &meta, const char *rec, const char *notes) {
  char iso[32];
  clockIso(clockNowMs(), iso, sizeof(iso));
  meta.clear();
  meta["name"] = rec;
  meta["created"] = iso;
  meta["notes"] = notes ? notes : "";
  meta["rate_hz"] = SAMPLE_RATE_HZ;
  JsonArray cols = meta["columns"].to<JsonArray>();
  for (const char *c : {"t_s", "co2_pct", "o2_pct", "flow_lpm", "pressure_cmh2o"}) cols.add(c);
  meta["next_session"] = 1;
  meta["sessions"].to<JsonArray>();
}

static bool loadJson(const char *path, JsonDocument &doc) {
  File f = SDCARD.open(path, FILE_READ);
  if (!f) return false;
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  return !err;
}

bool metaLoad(const char *rec, JsonDocument &meta) {
  char p[80];
  snprintf(p, sizeof(p), REC_ROOT "/%s/meta.json", rec);
  if (loadJson(p, meta)) return true;
  // Power cut during metaSave(): the new version is complete in meta.tmp
  snprintf(p, sizeof(p), REC_ROOT "/%s/meta.tmp", rec);
  return loadJson(p, meta);
}

bool metaSave(const char *rec, JsonDocument &meta) {
  char tmp[80], path[80];
  snprintf(tmp, sizeof(tmp), REC_ROOT "/%s/meta.tmp", rec);
  snprintf(path, sizeof(path), REC_ROOT "/%s/meta.json", rec);
  File f = SDCARD.open(tmp, FILE_WRITE);
  if (!f) return false;
  size_t n = serializeJsonPretty(meta, f);
  f.close();
  if (n == 0) return false;
  SDCARD.remove(path);  // FAT can't rename over an existing file
  return SDCARD.rename(tmp, path);
}

int metaSessionIndex(JsonDocument &meta, int id) {
  JsonArray arr = meta["sessions"].as<JsonArray>();
  int i = 0;
  for (JsonObject s : arr) {
    if (s["id"].as<int>() == id) return i;
    i++;
  }
  return -1;
}

JsonObject metaFindSession(JsonDocument &meta, int id) {
  for (JsonObject s : meta["sessions"].as<JsonArray>())
    if (s["id"].as<int>() == id) return s;
  return JsonObject();
}

// Deletes a file, or a folder with everything inside it
static bool removeTree(const char *path) {
  File f = SDCARD.open(path);
  if (!f) return false;
  bool isDir = f.isDirectory();
  f.close();
  if (!isDir) return SDCARD.remove(path);
  // Delete in batches: removing entries while iterating confuses the directory reader
  for (;;) {
    File d = SDCARD.open(path);
    if (!d) return false;
    String names[16];
    int count = 0;
    for (File e = d.openNextFile(); e && count < 16; e = d.openNextFile()) {
      names[count++] = String(path) + "/" + e.name();
      e.close();
    }
    d.close();
    if (count == 0) break;
    for (int i = 0; i < count; i++)
      if (!removeTree(names[i].c_str())) return false;
  }
  return SDCARD.rmdir(path);
}

void trashStamp(char *out, size_t n) {
  time_t s = clockNowMs() / 1000;
  struct tm tm;
  gmtime_r(&s, &tm);
  strftime(out, n, "%Y%m%d-%H%M%S", &tm);
}

static void ensureTrash() {
  if (!SDCARD.exists(TRASH_ROOT)) SDCARD.mkdir(TRASH_ROOT);
}

bool moveToTrash(const char *path, const char *trashName) {
  ensureTrash();
  char dst[160];
  snprintf(dst, sizeof(dst), TRASH_ROOT "/%s", trashName);
  for (int i = 2; SDCARD.exists(dst) && i < 100; i++) snprintf(dst, sizeof(dst), TRASH_ROOT "/%s-%d", trashName, i);
  return SDCARD.rename(path, dst);
}

bool saveSessionMetaToTrash(JsonObjectConst session, const char *trashName) {
  ensureTrash();
  char dst[160];
  snprintf(dst, sizeof(dst), TRASH_ROOT "/%s", trashName);
  File f = SDCARD.open(dst, FILE_WRITE);
  if (!f) return false;
  serializeJsonPretty(session, f);
  f.close();
  return true;
}

static uint64_t treeBytes(const char *path) {
  File f = SDCARD.open(path);
  if (!f) return 0;
  if (!f.isDirectory()) {
    uint64_t n = f.size();
    f.close();
    return n;
  }
  uint64_t total = 0;
  for (File e = f.openNextFile(); e; e = f.openNextFile()) {
    total += e.isDirectory() ? treeBytes((String(path) + "/" + e.name()).c_str()) : e.size();
    e.close();
  }
  f.close();
  return total;
}

void trashInfo(uint32_t &items, uint64_t &bytes) {
  items = 0;
  bytes = 0;
  File d = SDCARD.open(TRASH_ROOT);
  if (!d || !d.isDirectory()) return;
  for (File e = d.openNextFile(); e; e = d.openNextFile()) {
    String name = String(TRASH_ROOT) + "/" + e.name();
    bool isDir = e.isDirectory();
    uint64_t size = isDir ? 0 : e.size();
    e.close();
    if (isDir) size = treeBytes(name.c_str());
    if (!name.endsWith(".json")) items++;  // a deleted session = .csv + .json: count once
    bytes += size;
  }
  d.close();
}

bool emptyTrash() {
  if (!SDCARD.exists(TRASH_ROOT)) return true;
  bool ok = removeTree(TRASH_ROOT);
  ensureTrash();
  return ok;
}
