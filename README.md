# Breath Logger

A small ESP32-S3 device that records **CO₂, O₂, air flow and pressure** 50 times a second
on an SD card. A web page shows the signals live and manages the recordings, over a USB
cable or over the device's own Wi-Fi network. No internet is needed, and nothing has to be
installed on the PC.

- **Use the device** (Windows): [below](#use-the-device).
- **Change the code**: [docs/development.md](docs/development.md).
- Messages between the page and the device, files on the SD card: [docs/protocol.md](docs/protocol.md).
- Why things are done this way (in French): [docs/choix-techniques.md](docs/choix-techniques.md).

| Folder | What it holds |
|---|---|
| `firmware/` | The device's program (C++, Arduino on PlatformIO). The page is built into it. |
| `webapp/` | The page (HTML/CSS/JavaScript, no build step). |
| `launcher/` | Makes a **Breath Logger** shortcut on Windows that opens the page like an app. |
| `package/` | `package.py` builds the ready-to-use Windows folder; `flash.bat` goes in it. |
| `tools/` | Test tools in Python (device test, Wi-Fi tests, firmware update test), and two test firmwares for finding a board's wiring. |
| `docs/` | Protocol, technical choices, developer guide. |

---

## Use the device

### 1. Get the Windows folder

The **BreathLogger** folder holds everything: the firmware, the page, a USB flashing tool
and a portable Python for the tests. You get it as a `.zip` from whoever builds it
([docs/development.md](docs/development.md#build-the-windows-folder):
`python3 package/package.py`). Unzip it anywhere, for example in `C:\Users\<you>\BreathLogger`.

```
BreathLogger\
  flash.bat           installs the firmware over USB (first time, or recovery)
  launcher\           Creer le raccourci.bat: the Breath Logger shortcut
  webapp\index.html   the page
  firmware\           firmware.bin and the files flash.bat writes with it
  tools\              test tools, esptool.exe, portable Python
  README.md, docs\
```

### 2. Prepare the SD card

Format it as **FAT32**. Cards of 64 GB and more are sold formatted as exFAT, which the
firmware does not read: reformat them (for example with [Rufus](https://rufus.ie),
"Large FAT32"), or use a card of 8–32 GB. An 8 GB card holds about 1 200 hours.

### 3. Install the firmware (once)

1. Plug the device into the PC with a USB-C cable.
2. Double-click **`flash.bat`**. Type the port (for example `COM5`, see *Device Manager →
   Ports (COM & LPT)*, "USB JTAG/serial debug unit"), or just press Enter to let it search.
3. Wait for "Firmware installe". The device restarts.

If it fails: close the Breath Logger page (it holds the USB port), check the port, or
unplug the device and plug it back **while holding its BOOT button**, then run `flash.bat`
again.

After this first time, firmware updates are done from the page ([step 7](#7-update-the-firmware)).

### 4. Open the page

**Over USB** (Chrome or Edge on Windows or Mac):
1. Once: double-click `launcher\Creer le raccourci.bat`. It makes a **Breath Logger**
   shortcut on the Desktop and in the Start menu. It opens the page in its own window,
   like an app. Run it again if you move the folder.
2. Open **Breath Logger**, click **Connect (USB)** and choose the port "USB JTAG/serial
   debug unit".

**Over Wi-Fi** (any browser: PC, tablet, phone):
1. Join the Wi-Fi network **BreathLogger-XXXX** (password `breathlogger`). The XXXX are
   different for each device. The XIAO's antenna must be plugged in.
2. The page usually opens by itself. Otherwise open **http://192.168.4.1**.
3. While on this network, the computer has no internet.

USB and Wi-Fi work at the same time, with up to 4 Wi-Fi screens. Only one screen controls
the device (start, stop, change recordings). The others watch, with a **Take control**
button. Over USB you always have control.

### 5. Record

- **Live** shows the 4 signals. Choose a recording name (an athlete, a protocol…), a new
  session or **continue** an existing one, then **Start**. **Pause** and **Stop** as needed.
- The device does the recording itself. Unplugging the cable or closing the page does not
  stop it. Reconnecting shows the recording in progress.
- The page sends the PC's time when it connects (the device has no clock yet), so connect
  before recording to get real dates.
- A yellow banner and a *Simulated* tag mean the values are not real measurements. The
  firmware simulates the sensors until the real ones are chosen.
- On a power cut, at most about 1 s of data is lost. The session then shows as *interrupted*.

### 6. Recordings

**Recordings** lists them by date, with search. For each one: notes, rename, delete, and its
sessions with their parts (first run, each resumption, pauses).

Open a session to zoom, switch the time axis between recorded time and clock time, **Keep
selection** (trim) and **Download CSV**.

Nothing is ever erased directly:
- a trim only hides the rest, and **Show all** brings it back;
- **Delete** moves the files to `/trash` on the card, until **Trash → Empty trash**.

Viewing a session first downloads it at about 65 KB/s, which is about 1 min 40 s per
recorded hour. For long sessions, reading the SD card on the PC is faster.

On the card: `/recordings/<name>/meta.json`, `session_001.csv`, `session_002.csv`… CSV
columns: `t_s,co2_pct,o2_pct,flow_lpm,pressure_cmh2o` (details in `docs/protocol.md`).

### 7. Update the firmware

You need a firmware of version 0.2.0 or later, no recording running, and control of the
device.
1. Open the device panel, at the bottom left, and click **Update firmware**.
2. Choose the new `firmware.bin`. The page shows its version and date, and refuses a file
   that is not a Breath Logger firmware.
3. Click **Install**.

It takes under a minute over USB or Wi-Fi. The device restarts and the page reconnects by
itself. Over Wi-Fi, if Windows does not rejoin the device's network by itself, rejoin it by
hand: the page then picks up.

If the new firmware does not start properly, the device goes back to the previous one by
itself, and the page says so. `flash.bat` remains the way out if a firmware breaks both USB
and Wi-Fi.

### Troubleshooting

| Problem | What to do |
|---|---|
| The port does not appear | Another cable (some only charge). Device Manager → Ports (COM & LPT). |
| "Could not open the device" | Only one program can open the USB port: close the other page, or the test tool. |
| No SD card / Start disabled | Card in, formatted FAT32, then **Refresh** in Recordings. |
| The Wi-Fi page does not come back after an update | Rejoin the BreathLogger-XXXX network by hand. |
| The device does nothing at all | Unplug it, plug it back while holding BOOT, run `flash.bat`. |

### Check a device (test tools)

The tools run with the portable Python in the folder. Over USB, close the page first.

```
tools\python\python.exe tools\devtest.py COM5        full test: live data, recording with a pause, file read back
tools\python\python.exe tools\wifitest.py            Wi-Fi test, about 1 min (PC on the device's network)
```
Others (long Wi-Fi test, timing, firmware update test): [docs/development.md](docs/development.md#test-tools).

---

## Try the page without the device

Open `webapp/index.html?demo` in Chrome or Edge, then **Demo mode**. A fake device inside
the page makes realistic breathing signals, with example recordings. Demo recordings
disappear when the page is reloaded.

## Develop

```
python3 -m venv .venv && .venv/bin/pip install platformio   # once (Linux / WSL)
.venv/bin/pio run -d firmware                               # compile the firmware
python3 package/package.py                                  # build the Windows folder + .zip
```
Everything else is in [docs/development.md](docs/development.md): settings in `config.h`, how
the code is organized, the WSL → Windows loop, the tests.

## The board

A **Seeed XIAO ESP32-S3** (8 MB flash, 8 MB PSRAM) on our own circuit board. The SD card is
wired in SPI mode:

| SD card | XIAO pin | ESP32-S3 GPIO |
|---|---|---|
| CS | D7 | 44 |
| SCK | D8 | 7 |
| MISO | D9 | 8 |
| MOSI | D10 | 9 |

GPIO 5 / 6 (D4 / D5) carry an I2C bus with external pull-ups, for the sensors. The pins
are set in `firmware/src/config.h`.

## How it works

```
core 1  acquisition task: every 20 ms, read the sensors, timestamp ──┬─> record queue (10 s) ─> SD card
                                                                      └─> live queue ─> USB and Wi-Fi
core 0  IO task: SD writes (flushed every 1 s), USB commands, status every 0.5 s
        Wi-Fi task: page and WebSocket; trades messages with the IO task, never makes it wait
```

- The device is the master: it records on its own, and the page only watches and sends
  commands.
- The 10 s queue absorbs the SD card's slow moments (often 100–500 ms), so no sample is
  lost. The **Lost** counter of the page must stay at 0.
- The ESP32's memory limits neither the length of a recording nor the number of
  recordings. One limit: keep under about 100 sessions per recording, because its
  `meta.json` is read into memory.

## Status

| Part | State |
|---|---|
| Firmware: tasks, SD recording, pause, continue a session | works on the board (`devtest.py`) |
| Page: live view, recordings, viewer, trim, export | works on the board; every function tried in demo mode |
| Wi-Fi: own network, several screens, automatic channel | works on the board (1 h test: no cut, nothing lost) |
| Firmware update from the page, automatic return | works on the board (`otatest.py`) |
| Real sensors | waiting for the sensor choice (`firmware/src/sensors_real.cpp`) |
| Robustness | still to test: power cut during a recording, SD card pulled out |
| Later | clock chip (RTC), breathing LED, buttons, Wi-Fi password per device, battery |
