// SD card probe. For each CS candidate: sends the SD reset command (CMD0) and the
// interface check (CMD8) in SPI mode. A card answers 0x01 then echoes 0xAA, whatever
// its file system. Then tries to mount the file system on the pin that answered.
#include <Arduino.h>
#include <SD.h>
#include <SPI.h>

static const int SCK_PIN = 7, MISO_PIN = 8, MOSI_PIN = 9;          // XIAO D8, D9, D10
static const int CS_CANDIDATES[] = {1, 2, 3, 4, 43, 44};            // D0, D1, D2, D3, D6, D7
static const char *CS_NAMES[] = {"D0", "D1", "D2", "D3", "D6", "D7"};

static uint8_t command(uint8_t cmd, uint32_t arg, uint8_t crc) {
  SPI.transfer(0xFF);  // one idle byte before each command
  SPI.transfer(0x40 | cmd);
  SPI.transfer(arg >> 24);
  SPI.transfer(arg >> 16);
  SPI.transfer(arg >> 8);
  SPI.transfer(arg);
  SPI.transfer(crc);
  for (int i = 0; i < 10; i++) {
    uint8_t r = SPI.transfer(0xFF);
    if (!(r & 0x80)) return r;
  }
  return 0xFF;
}

// Returns true if a card answers on this CS pin
static bool probe(int cs, String &detail) {
  pinMode(cs, OUTPUT);
  digitalWrite(cs, HIGH);
  SPI.begin(SCK_PIN, MISO_PIN, MOSI_PIN, -1);
  SPI.beginTransaction(SPISettings(250000, MSBFIRST, SPI_MODE0));
  for (int i = 0; i < 10; i++) SPI.transfer(0xFF);  // 80 clocks with CS high
  digitalWrite(cs, LOW);
  uint8_t r0 = command(0, 0, 0x95);
  uint8_t r8 = command(8, 0x1AA, 0x87);
  uint8_t echo[4] = {0xFF, 0xFF, 0xFF, 0xFF};
  if (r8 == 0x01)
    for (int i = 0; i < 4; i++) echo[i] = SPI.transfer(0xFF);
  digitalWrite(cs, HIGH);
  SPI.transfer(0xFF);
  SPI.endTransaction();
  SPI.end();
  pinMode(cs, INPUT);
  char buf[80];
  snprintf(buf, sizeof(buf), "CMD0=%02X CMD8=%02X echo=%02X%02X%02X%02X", r0, r8, echo[0], echo[1], echo[2], echo[3]);
  detail = buf;
  return r0 == 0x01;  // only a card answers "idle" (0x01) to CMD0
}

void setup() {
  Serial.begin(115200);
}

void loop() {
  int found = -1;
  for (size_t i = 0; i < sizeof(CS_CANDIDATES) / sizeof(int); i++) {
    String d;
    bool ok = probe(CS_CANDIDATES[i], d);
    Serial.printf("{\"cs\":\"%s\",\"gpio\":%d,\"card\":%s,\"detail\":\"%s\"}\n", CS_NAMES[i], CS_CANDIDATES[i], ok ? "true" : "false", d.c_str());
    if (ok && found < 0) found = (int)i;
  }
  if (found >= 0) {
    int cs = CS_CANDIDATES[found];
    SPI.begin(SCK_PIN, MISO_PIN, MOSI_PIN, cs);
    bool mounted = SD.begin(cs, SPI, 4000000);
    const char *type = "?";
    if (mounted) {
      uint8_t t = SD.cardType();
      type = t == CARD_SDHC ? "SDHC/SDXC" : t == CARD_SD ? "SD" : t == CARD_MMC ? "MMC" : "none";
    }
    Serial.printf("{\"mount\":{\"cs\":\"%s\",\"ok\":%s,\"type\":\"%s\",\"total_mb\":%llu,\"used_mb\":%llu}}\n",
                  CS_NAMES[found], mounted ? "true" : "false", type,
                  mounted ? SD.totalBytes() / 1048576ULL : 0ULL, mounted ? SD.usedBytes() / 1048576ULL : 0ULL);
    SD.end();
    SPI.end();
  }
  Serial.println("{\"done\":true}");
  delay(3000);
}
