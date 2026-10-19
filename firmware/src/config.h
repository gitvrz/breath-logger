#pragma once
// ---------------------------------------------------------------------------
// All the settings you are likely to change live here.
// ---------------------------------------------------------------------------

#define FW_VERSION "0.2.0"

// Acquisition rate. Must divide 1000 (50, 100, 125, 200, 250...).
#define SAMPLE_RATE_HZ 50
#define NUM_CHANNELS 4  // co2 %, o2 %, flow L/min, pressure cmH2O

// 1 = fake breathing signals (no sensors needed), 0 = real sensors (sensors_real.cpp)
#define USE_SIMULATED_SENSORS 1

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

// Other pins used on our board: GPIO 5 / 6 (XIAO D4 / D5) = I2C bus (external pull-ups).

// RGB status LED (DevKitC-1: 48 or 38). -1 = none (the XIAO has no RGB LED).
#define STATUS_LED_PIN -1

// --- Wi-Fi (prototype) -----------------------------------------------------------
// The device creates its own Wi-Fi network and serves the web page itself: join
// "BreathLogger-XXXX" and open http://192.168.4.1 (most systems open it by themselves).
// Same messages as over USB, through a WebSocket. USB keeps working at the same time.
#define WIFI_ENABLED 1
#define WIFI_SSID_PREFIX "BreathLogger-"    // + 4 hex digits of the device's MAC address
#define WIFI_PASSWORD "breathlogger"         // prototype: the same for every device
// 0 = at each start, listen to the Wi-Fi networks around and take the least crowded of
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
