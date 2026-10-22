# Developer guide

How to compile the firmware, change the page, test, and build the Windows folder that
users get. To use the device, see the [README](../README.md).

## Set up

You need Python 3.10 or later, Git and PlatformIO. PlatformIO downloads the ESP32 compiler
and libraries by itself the first time (2 GB or so, a few minutes).

**Linux or WSL** (what we use):
```
git clone <repository> && cd esp32-local-webapp
python3 -m venv .venv
.venv/bin/pip install platformio
.venv/bin/pio run -d firmware          # first build: downloads the toolchain
```

**Windows without WSL**: install [VS Code](https://code.visualstudio.com/) and its
**PlatformIO IDE** extension, then *File → Open Folder* → `firmware`. Build with ✓ and
flash with → in the blue bar at the bottom. `package/package.py` finds this PlatformIO by
itself.

WSL does not see USB devices, so we compile in WSL and flash from Windows: see
[the WSL → Windows loop](#the-wsl--windows-loop).

## Compile and flash

```
.venv/bin/pio run -d firmware                  # compile -> firmware/.pio/build/esp32s3/firmware.bin
.venv/bin/pio run -d firmware -t upload        # compile and flash, if this computer sees the USB port
.venv/bin/pio device monitor -d firmware       # raw messages of the device (close the page first)
```

Each build also runs two scripts (`firmware/platformio.ini`, `extra_scripts`). They write
files that are not in Git:

| Script | Writes | Why |
|---|---|---|
| `embed_webapp.py` | `src/webapp_files.h` | the page, gzipped: the device serves it over Wi-Fi. A change in `webapp/` reaches Wi-Fi only after rebuilding and reinstalling the firmware. |
| `build_info.py` | `src/build_info.cpp` | version (`FW_VERSION`), build date and git commit, with `+` if the code was not committed. The page shows it; the firmware update checks it. |

The PlatformIO board profile is `esp32-s3-devkitc-1`: it matches the XIAO ESP32-S3 for
everything we use (8 MB flash, native USB). Our pins are set in `config.h`.

## The WSL → Windows loop

1. Change the code in WSL, compile.
2. Update the Windows folder in place:
   ```
   python3 package/package.py --out /mnt/c/Users/<you>/BreathLogger
   ```
   This replaces the firmware, the page, the tools and the documents. It leaves the other
   files alone (test results, older firmware files).
3. On Windows, install the firmware. The quickest way is from the page (**Update firmware**,
   with `firmware\firmware.bin`). Otherwise use `flash.bat COM5`.

The page in `webapp/` can be tried without the device: open `webapp/index.html?demo` (demo
mode) in Chrome or Edge. Over USB, the page opened from the folder (`file://`) is the
`webapp/` of the folder. Over Wi-Fi, it is the page built into the firmware.

## Settings

All in `firmware/src/config.h`:

| Setting | Default | Meaning |
|---|---|---|
| `FW_VERSION` | `"0.2.0"` | Shown by the page. Raise it for each version given out. |
| `SAMPLE_RATE_HZ` | 50 | Measurements per second; must divide 1000. |
| `USE_SIMULATED_SENSORS` | 0 | 0 = real sensors (`sensors_real.cpp`: LPS28DFW pressure, gives pressure and flow); 1 = simulated breathing, for a demo without the sensor board. |
| `PIN_I2C_SDA`, `PIN_I2C_SCL`, `I2C_FREQ` | 5, 6, 100 kHz | Sensor board bus (the DS1307 does not go faster). |
| `PRESSURE_BASELINE_S` | 60 | Pressure channel = pressure − its average over this time (the atmospheric pressure). |
| `FLOW_COEF` | −1000 | Flow = coefficient × pressure (L/min per cmH₂O). Noted in each session. Not calibrated yet. From about −67 on, the flow curve is at least as tall as the pressure curve on the page (axes ±200 L/min and ±3 cmH₂O). |
| `SIM_GAS`, `SIM_ETCO2`, `SIM_CO2_*`, `SIM_O2_*` | 1, 5 %… | CO₂ and O₂ simulated from the breath phase of the real pressure (formula in `config.h`). 0 = empty. |
| `SIM_GAS_DP_THRESHOLD`, `SIM_GAS_PHASE_INTEGRAL` | 0.05 cmH₂O, 0.02 cmH₂O·s | Breath phase deaf to noise: dead band, then integrator. Raise them if noise still switches the phase. |
| `BATTERY_SIMULATED`, `BATTERY_SIM_HOURS` | 1, 8 | 1 = made-up battery (none fitted yet), empty after 8 h; 0 = voltage read on `PIN_BATTERY`. |
| `PIN_BATTERY`, `BATTERY_DIVIDER` | 4 (D3), 2.0 | Battery voltage pin and its divider (battery voltage / pin voltage): check on the board. |
| `RTC_ENABLED` | 1 | DS1307 clock chip: the device knows the time at power-on, without a PC. |
| `PIN_SD_*`, `SD_USE_SDMMC` | SPI on our board | SD card wiring. |
| `WIFI_ENABLED` | 1 | 0 = USB only. |
| `WIFI_PASSWORD` | `"breathlogger"` | The same for every device for now. |
| `WIFI_CHANNEL` | 0 | 0 = least crowded of 1/6/11 at power-on; or a fixed channel. |
| `REC_QUEUE_LEN`, `FLUSH_PERIOD_MS` | 512, 1000 | SD buffer (~10 s), data lost at most on a power cut (~1 s). |

## How the code is organized

**Firmware** (`firmware/src/`):

| File | Role |
|---|---|
| `main.cpp` | Start-up and the IO task on core 0 (SD writes, commands, status). |
| `acquisition.*` | Task on core 1: every 20 ms, reads the sensors, timestamps, feeds the queues. |
| `sensors.h`, `sensors_sim.cpp`, `sensors_real.cpp` | Sensor interface: simulated signals, or the real sensors (pressure, flow from it). |
| `clock.*` | Date and time: DS1307 clock chip, set from the PC when it connects. |
| `i2c.h` | Register reads and writes on the I2C bus. |
| `battery.*` | Battery level: made up for now, or the voltage on D3. |
| `recorder.*` | Recording states (start, pause, continue, stop), CSV writing, `meta.json`. |
| `storage.*` | SD card: mount, remount after an error, free space. |
| `commands.*` | The commands of `docs/protocol.md`: one function per `cmd`. |
| `link.*` | USB sending (our own: Arduino's lost bytes, and packets stay under 64 bytes). |
| `net.*` | Wi-Fi: network, channel choice, web server, WebSocket, the Wi-Fi task. |
| `ota.*` | Firmware update and automatic return to the previous firmware. |
| `clock.*` | Time given by the PC. |
| `config.h` | Settings (above). |

`firmware/lib/WebSockets/` is a copy of the links2004 WebSocket library with one fix
(`PATCHED.md`). Keep it: the original closes the other screens when one leaves.

**Page** (`webapp/js/`, plain scripts loaded by `index.html`, no build step):

| File | Role |
|---|---|
| `app.js` | Navigation, device panel, recording controls, live view. |
| `device.js` | Commands and replies (`docs/protocol.md`). |
| `transport-serial.js`, `transport-ws.js` | USB (Web Serial) and Wi-Fi (WebSocket) links. |
| `mock-device.js` | Demo mode: a fake device in the page, same protocol. |
| `charts.js` | The 4 signal rows (uPlot). |
| `recordings.js` | Recordings list, details, session viewer. |
| `firmware.js` | Firmware update dialog. |
| `i18n.js` | French and English texts: add every key in both. |
| `ui.js`, `util.js`, `debug.js` | Dialogs and notifications, helpers, `?debug` timing panel. |

## Test tools

Run them from the repository (`python3 tools/...`, with `pip install -r tools/requirements.txt`),
or on Windows from the folder (`tools\python\python.exe tools\...`). Over USB, close the
page first: only one program can open the port. Over Wi-Fi, the computer must be on the
device's network.

| Command | When | Checks |
|---|---|---|
| `devtest.py COM5` | after any firmware change | live data rate, a recording with a pause, the file read back with no sample missing. `--seconds 3600` for endurance. |
| `wifitest.py` | after a Wi-Fi change (~1 min) | live data over Wi-Fi, two screens and the control rule, a screen that stops reading during a recording, a file read over Wi-Fi. |
| `soaktest.py --hours 2 --record` | before trusting a Wi-Fi change | stays connected for hours, explains every cut, checks the recording at the end. |
| `jitter.py COM5` or `--wifi 192.168.4.1` | a jerky live view | arrival time of every data message, gaps, the device's own timings. |
| `otatest.py --wifi 192.168.4.1 firmware/firmware-next.bin --crash firmware/crash-test.bin` | after a change to the update code (1–3 min) | bad file refused, damaged chunk sent again, install, and the automatic return after a firmware that crashes. |

`otatest.py` needs two test firmwares: `python3 package/package.py --test-firmware` adds them
to `firmware/`:
- `firmware-next.bin`: the same code built again, so its build id differs from the running one;
- `crash-test.bin`: built with `pio run -e crash-test`, it crashes 5 s after starting.

The page has its own timing panel: open it with `index.html?debug`.

**Finding the wiring of a new board**: `tools/pinprobe` (reads every pin, drives none) and
`tools/sdprobe` (tries the SD card on each possible CS pin) are small firmwares. Flash them
with `pio run -d tools/pinprobe -t upload`, read with `pio device monitor`, then flash the
Breath Logger firmware back.

## Build the Windows folder

```
python3 package/package.py                    # dist/BreathLogger/ and dist/BreathLogger-<version>-<commit>.zip
python3 package/package.py --test-firmware    # also firmware-next.bin and crash-test.bin
python3 package/package.py --out DIR          # update an existing folder in place (no zip)
```

It compiles the firmware, copies the page, the launcher, the tools and the documents, and
adds the Windows programs:
- `esptool.exe` 5.5.0 (Espressif), used by `flash.bat`;
- the portable (embeddable) Python 3.12.10, with pyserial 3.5.

They are downloaded once into `dist/cache/` and checked against their SHA-256, which is
written in the script. To change a version, change its URL and SHA-256 in `DOWNLOADS`.

`flash.bat` (source: `package/flash.bat`) writes the bootloader at 0x0, the partition
table at 0x8000, `boot_app0.bin` at 0xe000 and the firmware at 0x10000. Writing
`boot_app0.bin` makes the device start from the first app slot, whatever slot a firmware
update used before.

## Give out a new version

1. Raise `FW_VERSION` in `config.h`, commit.
2. `python3 package/package.py`: the build id then has no `+`.
3. Give the `.zip`, or just `firmware/firmware.bin`, to install from the page.
