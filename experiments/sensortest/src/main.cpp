// Sensor test: reads the three I2C chips of the sensor board and prints their values
// on the USB port, in real time. Standalone: shares no code with the Breath Logger
// firmware. To get the Breath Logger back, run flash.bat again.
//
//   LPS28DFW  pressure (absolute, hPa) + temperature     0x5C or 0x5D
//   LSM6DSM   accelerometer (g) + gyroscope (deg/s)      0x6A or 0x6B
//   DS1307    real-time clock (date and time)            0x68
//
// Commands (type a line, then Enter):
//   i = scan the bus and show what answers     z = pressure change back to 0
//   t = readable text (default)                p = Arduino Serial Plotter format
//   T2026-10-21 16:30:00 = set the clock
#include <Arduino.h>
#include <Wire.h>

static const int PIN_SDA = 5;            // XIAO D4
static const int PIN_SCL = 6;            // XIAO D5
static const uint32_t I2C_HZ = 100000;   // the DS1307 does not go faster
static const uint32_t TEXT_PERIOD_MS = 200;     // 5 lines/s, readable
static const uint32_t PLOT_PERIOD_MS = 40;      // 25 points/s

// ---- I2C helpers ---------------------------------------------------------------

static bool present(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

static bool readRegs(uint8_t addr, uint8_t reg, uint8_t *buf, size_t n) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)addr, (int)n) != (int)n) return false;
  for (size_t i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}

static bool writeRegs(uint8_t addr, uint8_t reg, const uint8_t *buf, size_t n) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(buf, n);
  return Wire.endTransmission() == 0;
}

static bool writeReg(uint8_t addr, uint8_t reg, uint8_t val) { return writeRegs(addr, reg, &val, 1); }

static int whoAmI(uint8_t addr) {
  uint8_t v;
  return readRegs(addr, 0x0F, &v, 1) ? v : -1;
}

// ---- LPS28DFW: pressure ----------------------------------------------------------

static uint8_t lpsAddr = 0;   // 0 = not found

static bool lpsBegin() {
  for (uint8_t a : {0x5C, 0x5D})
    if (whoAmI(a) == 0xB4) lpsAddr = a;
  if (!lpsAddr) return false;
  writeReg(lpsAddr, 0x11, 0x04);   // CTRL_REG2: software reset
  delay(10);
  writeReg(lpsAddr, 0x11, 0x08);   // CTRL_REG2: block data update, range 260-1260 hPa
  writeReg(lpsAddr, 0x10, 0x2A);   // CTRL_REG1: 50 Hz, average of 16
  return true;
}

static bool lpsRead(float &hPa, float &degC) {
  uint8_t b[5];
  if (!lpsAddr || !readRegs(lpsAddr, 0x28, b, 5)) return false;
  int32_t p = (int32_t)((uint32_t)b[2] << 24 | (uint32_t)b[1] << 16 | (uint32_t)b[0] << 8) >> 8;
  hPa = p / 4096.0f;
  degC = (int16_t)(b[4] << 8 | b[3]) / 100.0f;
  return true;
}

// ---- LSM6DSM: accelerometer + gyroscope ------------------------------------------

static uint8_t imuAddr = 0;

static bool imuBegin() {
  for (uint8_t a : {0x6A, 0x6B})
    if (whoAmI(a) == 0x6A) imuAddr = a;
  if (!imuAddr) return false;
  writeReg(imuAddr, 0x12, 0x01);   // CTRL3_C: software reset
  delay(10);
  writeReg(imuAddr, 0x12, 0x44);   // CTRL3_C: block data update, auto-increment
  writeReg(imuAddr, 0x10, 0x48);   // CTRL1_XL: accelerometer 104 Hz, +-4 g
  writeReg(imuAddr, 0x11, 0x44);   // CTRL2_G: gyroscope 104 Hz, +-500 deg/s
  return true;
}

// acc in g, gyro in deg/s
static bool imuRead(float acc[3], float gyro[3], float &degC) {
  uint8_t b[14];   // OUT_TEMP, then gyro x y z, then accelerometer x y z (low byte first)
  if (!imuAddr || !readRegs(imuAddr, 0x20, b, 14)) return false;
  auto s16 = [&](int i) { return (int16_t)(b[i + 1] << 8 | b[i]); };
  degC = 25.0f + s16(0) / 256.0f;
  for (int k = 0; k < 3; k++) {
    gyro[k] = s16(2 + 2 * k) * 0.0175f;   // 17.5 mdeg/s per unit at +-500 deg/s
    acc[k] = s16(8 + 2 * k) * 0.000122f;  // 0.122 mg per unit at +-4 g
  }
  return true;
}

// ---- DS1307: clock ---------------------------------------------------------------

static const uint8_t RTC_ADDR = 0x68;
static bool rtcFound = false;

static uint8_t bcd2bin(uint8_t v) { return (v >> 4) * 10 + (v & 0x0F); }
static uint8_t bin2bcd(uint8_t v) { return (v / 10) << 4 | (v % 10); }

struct DateTime { int year, month, day, hour, minute, second; };

static bool rtcSet(const DateTime &t) {
  uint8_t b[7] = {bin2bcd(t.second), bin2bcd(t.minute), bin2bcd(t.hour), 1,
                  bin2bcd(t.day), bin2bcd(t.month), bin2bcd(t.year % 100)};
  return writeRegs(RTC_ADDR, 0x00, b, 7);   // bit 7 of seconds = 0: the clock runs
}

// running = false when the clock was never set (or lost its battery)
static bool rtcRead(DateTime &t, bool &running) {
  uint8_t b[7];
  if (!rtcFound || !readRegs(RTC_ADDR, 0x00, b, 7)) return false;
  running = !(b[0] & 0x80);
  t.second = bcd2bin(b[0] & 0x7F);
  t.minute = bcd2bin(b[1]);
  if (b[2] & 0x40) {   // 12-hour mode
    int h = bcd2bin(b[2] & 0x1F) % 12;
    t.hour = (b[2] & 0x20) ? h + 12 : h;
  } else {
    t.hour = bcd2bin(b[2] & 0x3F);
  }
  t.day = bcd2bin(b[4]);
  t.month = bcd2bin(b[5]);
  t.year = 2000 + bcd2bin(b[6]);
  return true;
}

// The time this program was compiled, as a starting point for a clock never set
static DateTime compileTime() {
  static const char months[] = "JanFebMarAprMayJunJulAugSepOctNovDec";
  char m[4] = {0};
  DateTime t{};
  sscanf(__DATE__, "%3s %d %d", m, &t.day, &t.year);
  t.month = (strstr(months, m) - months) / 3 + 1;
  sscanf(__TIME__, "%d:%d:%d", &t.hour, &t.minute, &t.second);
  return t;
}

static void rtcBegin() {
  rtcFound = present(RTC_ADDR);
  DateTime t;
  bool running;
  if (rtcRead(t, running) && !running) {
    rtcSet(compileTime());
    Serial.println("# DS1307 : horloge jamais reglee, mise a l'heure de la compilation");
  }
}

// ---- Display ---------------------------------------------------------------------

static bool plotMode = false;
static float pressureZero = NAN;   // hPa, for the "change" shown on the plotter

static void printInfo() {
  Serial.println();
  Serial.println("# ---- Test capteurs Breath Logger ----");
  Serial.print("# Bus I2C (SDA 5, SCL 6), adresses qui repondent :");
  int n = 0;
  for (uint8_t a = 1; a < 127; a++)
    if (present(a)) { Serial.printf(" 0x%02X", a); n++; }
  Serial.println(n ? "" : " aucune (cablage ? alimentation ? resistances de tirage ?)");
  Serial.printf("# LPS28DFW (pression)       : %s\n",
                lpsAddr ? (lpsAddr == 0x5C ? "OK en 0x5C" : "OK en 0x5D") : "ABSENT");
  Serial.printf("# LSM6DSM (accelero + gyro) : %s\n",
                imuAddr ? (imuAddr == 0x6A ? "OK en 0x6A" : "OK en 0x6B") : "ABSENT");
  Serial.printf("# DS1307 (horloge)          : %s\n",
                rtcFound ? "OK en 0x68" : "ABSENT (il doit etre alimente en 5 V)");
  Serial.println("# Commandes : i = infos, t = texte, p = traceur, z = pression a zero,");
  Serial.println("#             T2026-10-21 16:30:00 = regler l'horloge");
  Serial.println();
}

static void printValues() {
  float hPa = NAN, tP = NAN, tI = NAN, acc[3] = {NAN, NAN, NAN}, gyro[3] = {NAN, NAN, NAN};
  bool okP = lpsRead(hPa, tP);
  bool okI = imuRead(acc, gyro, tI);
  if (okP && isnan(pressureZero)) pressureZero = hPa;

  if (plotMode) {   // "name:value" pairs, one line per point (Arduino Serial Plotter)
    Serial.printf("dP_Pa:%.1f,ax_g:%.3f,ay_g:%.3f,az_g:%.3f,gx_dps:%.1f,gy_dps:%.1f,gz_dps:%.1f\n",
                  (hPa - pressureZero) * 100.0f, acc[0], acc[1], acc[2], gyro[0], gyro[1], gyro[2]);
    return;
  }

  DateTime t;
  bool running;
  if (rtcRead(t, running))
    Serial.printf("%04d-%02d-%02d %02d:%02d:%02d%s", t.year, t.month, t.day, t.hour, t.minute,
                  t.second, running ? "" : " (arretee)");
  else
    Serial.print("horloge --");
  if (okP) Serial.printf(" | P %.2f hPa  %.1f C", hPa, tP);
  else Serial.print(" | P --");
  if (okI)
    Serial.printf(" | acc %+.3f %+.3f %+.3f g | gyro %+6.1f %+6.1f %+6.1f deg/s", acc[0], acc[1],
                  acc[2], gyro[0], gyro[1], gyro[2]);
  else Serial.print(" | acc -- | gyro --");
  Serial.println();
}

static void handleLine(const char *line) {
  DateTime t;
  if (!strcmp(line, "i")) printInfo();
  else if (!strcmp(line, "t")) plotMode = false;
  else if (!strcmp(line, "p")) plotMode = true;
  else if (!strcmp(line, "z")) pressureZero = NAN;
  else if (line[0] == 'T' && sscanf(line + 1, "%d-%d-%d %d:%d:%d", &t.year, &t.month, &t.day,
                                    &t.hour, &t.minute, &t.second) == 6) {
    Serial.println(rtcSet(t) ? "# horloge reglee" : "# horloge : echec (DS1307 absent ?)");
  } else if (line[0]) {
    Serial.println("# commande inconnue (i, t, p, z ou T2026-10-21 16:30:00)");
  }
}

void setup() {
  Serial.begin(115200);
  Wire.begin(PIN_SDA, PIN_SCL, I2C_HZ);
  uint32_t t0 = millis();
  while (!Serial && millis() - t0 < 3000) delay(10);   // give the PC time to open the port
  lpsBegin();
  imuBegin();
  rtcBegin();
  printInfo();
}

void loop() {
  static char line[40];
  static size_t len = 0;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r' || c == '\n') {
      line[len] = 0;
      handleLine(line);
      len = 0;
    } else if (len + 1 < sizeof line) {
      line[len++] = c;
    }
  }

  static uint32_t last = 0;
  uint32_t period = plotMode ? PLOT_PERIOD_MS : TEXT_PERIOD_MS;
  if (millis() - last >= period) {
    last += period;
    if (millis() - last >= period) last = millis();   // fell behind: start again from now
    printValues();
  }
}
