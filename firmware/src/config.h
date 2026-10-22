#pragma once
// ---------------------------------------------------------------------------
// All the settings you are likely to change live here.
// ---------------------------------------------------------------------------

#define FW_VERSION "0.3.0"

// Acquisition rate. Must divide 1000 (50, 100, 125, 200, 250...).
#define SAMPLE_RATE_HZ 50
#define NUM_CHANNELS 4  // co2 %, o2 %, flow L/min, pressure cmH2O

// 1 = fake breathing signals (no sensors needed), 0 = real sensors (sensors_real.cpp)
#define USE_SIMULATED_SENSORS 1

// --- Sensor board (I2C) ----------------------------------------------------------
// LPS28DFW pressure sensor: gives the pressure channel, and the flow channel from it.
// No CO2 / O2 sensor yet: those channels stay empty ("no sensor" on the page).
#define PIN_I2C_SDA 5          // XIAO D4 (external pull-ups on our board)
#define PIN_I2C_SCL 6          // XIAO D5
#define I2C_FREQ 100000        // the DS1307 clock does not go faster
// Pressure channel = measured pressure - atmospheric pressure. The atmospheric pressure
// is the average of the measured pressure over this long a time (it follows the
// weather and the altitude, not the breaths).
#define PRESSURE_BASELINE_S 60
// Flow channel = coefficient x pressure channel, in L/min per cmH2O (negative).
// Noted in each session's meta.json ("flow_coef" of the start / continue events).
#define FLOW_COEF -76.0f
// --- CO2 and O2 simulated from the real flow (no gas sensor yet) --------------------
// The breath phase comes from the measured pressure: breathing out = flow of the sign
// SIM_EXPIRATION_SIGN (-1: negative flow, as in the simulated signals). Noise must not
// change it: pressures within +-SIM_GAS_DP_THRESHOLD count for nothing, and what goes
// beyond it, towards the other phase, is added up over time (integrator). The phase
// changes when that sum reaches SIM_GAS_PHASE_INTEGRAL; pressure back towards the current
// phase empties it. A spike is too short, a real breath gets there in ~0.3 s.
// For each breath out:
//   - the first SIM_CO2_DEAD_S: air from the mouth and airways (dead space), no CO2 yet;
//   - then CO2 = SIM_CO2_INSP + (SIM_ETCO2 - SIM_CO2_INSP) x (1 - e^(-t / SIM_CO2_RISE_S));
//   - breathing in: fresh air again, CO2 back to SIM_CO2_INSP.
//   O2 = SIM_O2_INSP - SIM_O2_PER_CO2 x (CO2 - SIM_CO2_INSP)
// Both then follow with the delay of a real gas sensor (SIM_GAS_LAG_S).
#define SIM_GAS 1                  // 0 = CO2 and O2 stay empty
#define SIM_EXPIRATION_SIGN -1     // sign of the flow when breathing out
#define SIM_GAS_DP_THRESHOLD 0.05f   // cmH2O: dead band, the noise stays inside it
#define SIM_GAS_PHASE_INTEGRAL 0.02f // cmH2O x s: e.g. 0.1 cmH2O beyond the band for 0.2 s
#define SIM_CO2_INSP 0.04f         // % CO2 in the air breathed in
#define SIM_ETCO2 5.0f             // % CO2 at the end of a breath out (end-tidal)
#define SIM_CO2_DEAD_S 0.15f       // s
#define SIM_CO2_RISE_S 0.10f       // s
#define SIM_O2_INSP 20.95f         // % O2 in the air breathed in
#define SIM_O2_PER_CO2 1.2f        // % O2 used per % CO2 given off (respiratory quotient ~0.85)
#define SIM_GAS_LAG_S 0.08f        // s, response time of a gas sensor

// DS1307 real-time clock on the I2C bus, with its battery: the device knows the time
// at power-on, without a PC. 0 = no clock chip (the PC sets the time at each connection).
#define RTC_ENABLED 1

// --- SD card -----------------------------------------------------------------
// Our board: Seeed XIAO ESP32-S3 on the custom PCB, SD slot in SPI mode on the XIAO's
// SPI pins (found with tools/sdprobe on 2026-10-15). 1 = SDMMC, for a future PCB.
// The SDMMC pins are named so that the same wiring works in both modes:
//   SPI SCK = SD CLK, SPI MOSI = SD CMD, SPI MISO = SD D0, SPI CS = SD D3.
#define SD_USE_SDMMC 0
#define SD_MMC_4BIT 0          // SDMMC only: 1 = 4 data lines (also wire D1, D2)
#define PIN_SD_CLK 7           // SPI: SCK   (XIAO D8)
#define PIN_SD_CMD 9           // SPI: MOSI  (XIAO D10)
#define PIN_SD_D0 8            // SPI: MISO  (XIAO D9)
#define PIN_SD_D1 -1           // SDMMC 4-bit only (not wired on our board)
#define PIN_SD_D2 -1
#define PIN_SD_D3 44           // SPI: CS    (XIAO D7)
#define SD_SPI_FREQ 20000000


// --- Battery ---------------------------------------------------------------------
// Other pins of our board (not used yet): button D6 (GPIO 43), LED red D1 (GPIO 2),
// green D0 (GPIO 1), blue D2 (GPIO 3).
// 1 = made-up battery (none fitted yet): full at power-on, empty after BATTERY_SIM_HOURS.
// 0 = battery voltage read on PIN_BATTERY, through a divider (BATTERY_DIVIDER = battery
//     voltage / pin voltage; 2 for two equal resistors: check on the board).
#define BATTERY_SIMULATED 1
#define BATTERY_SIM_HOURS 8
#define PIN_BATTERY 4          // XIAO D3 (A3)
#define BATTERY_DIVIDER 2.0f
// RGB status LED (DevKitC-1: 48 or 38). -1 = none (the XIAO has no RGB LED).
#define STATUS_LED_PIN -1

// --- Wi-Fi ----------------------------------------------------------------
// The device creates its own Wi-Fi network and serves the web page itself: join
// "BreathLogger-XXXX" and open http://192.168.4.1 (most systems open it by themselves).
// Same messages as over USB, through a WebSocket. USB keeps working at the same time.
#define WIFI_ENABLED 1
#define WIFI_SSID_PREFIX "BreathLogger-"    // + 4 hex digits of the device's MAC address
#define WIFI_PASSWORD "breathlogger"         // for now the same for every device
// 0 = at each power-on, listen to the Wi-Fi networks around and take the least crowded of
// channels 1, 6 and 11 (the three that do not overlap). Or a fixed channel, 1 to 13.
#define WIFI_CHANNEL 0
#define WIFI_MAX_CLIENTS 4
#define WS_PORT 81                           // WebSocket (the page itself is on port 80)

// --- Tasks & buffers -----------------------------------------------------------
#define ACQ_CORE 1             // acquisition alone on core 1
#define IO_CORE 0              // SD writing + USB communication on core 0
#define REC_QUEUE_LEN 512      // samples waiting to be written to SD (~10 s at 50 Hz)
#define LIVE_QUEUE_LEN 64      // samples waiting to be sent to the PC
#define LIVE_BATCH 5           // samples per "data" message (50 Hz / 5 = 10 messages/s)
#define STATUS_PERIOD_MS 500
#define FLUSH_PERIOD_MS 1000   // max data lost on power cut ~ this duration

// Sensor values beyond +-VALUE_LIMIT are treated as missing (driver bug / garbage).
#define VALUE_LIMIT 100000.0f
#define FAULT_SAMPLES SAMPLE_RATE_HZ   // channel "faulty" after 1 s without a valid value
#define ACQ_STALL_MS 1000              // acquisition "stalled" after 1 s without a sample

#define TRASH_ROOT "/trash"            // deleted data goes here, not erased
#define MAX_TRIMS 16                   // trims kept per session (meta.json "trims")

#define REC_NAME_MAX 32
#define NOTES_MAX 500
#define READ_CHUNK_MAX 4096
#define OTA_CHUNK_MAX 2048             // firmware update: bytes per chunk (base64 in a JSON line)
#define CMD_LINE_MAX 4096              // longest command line from the PC (a firmware chunk)

static_assert(1000 % SAMPLE_RATE_HZ == 0, "SAMPLE_RATE_HZ must divide 1000");
