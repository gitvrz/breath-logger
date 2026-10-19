# Breath Logger

ESP32-S3 device that records **CO₂, O₂, air flow and pressure** at 50 Hz on an SD card,
with a local web page (no internet) to watch the signals live and manage recordings over USB.

```
firmware/   ESP32-S3 code (PlatformIO + Arduino)
webapp/     the page that runs in the browser (open webapp/index.html)
docs/       protocol.md: messages between the PC and the device, SD card layout
tools/      devtest.py: hardware test without the browser
```

## Try the page now (no hardware needed)

1. Open `webapp/index.html?demo` in **Chrome** or **Edge** (type `?demo` after the file
   address: without it the page shows only *Connect*, for use with the real device).
2. Click **Demo mode**: a fake device inside the page produces realistic breathing signals,
   with example recordings (including a session continued the next day).
   Demo recordings disappear when the page is reloaded.

Simulated values are always flagged: a yellow banner above the live view and a
*Simulated* tag on each signal, in demo mode and when the firmware runs with
`USE_SIMULATED_SENSORS 1`.

What the page does:
- **Live**: 4 signals in monitor layout (trace + big value, min/max over the window),
  Start / Pause / Stop, recording name with suggestions, new session or **continue an
  existing session** (appends to its CSV; the date of each resumption is kept).
- **Recordings**: list grouped by date with search; per recording: notes, sessions with
  their dates and parts (first run, each resumption, pauses), interrupted sessions flagged.
- **Session viewer**: zoom, time axis in recorded duration or **clock time**, pause and
  resumption markers, keep only the zoomed part (trim: the rest is **hidden, never
  erased**, and "Show all" brings it back), CSV download with an optional date/time column.
- French / English, light / dark theme. Works offline (fonts and libraries are in `webapp/`).

## Wi-Fi (prototype, branch `wifi-prototype`)

The device also creates its own Wi-Fi network and serves the page itself, so any
browser (also a tablet or phone) can be used without installing anything:

1. Join the Wi-Fi network **BreathLogger-XXXX** (password `breathlogger`). Most systems
   then open the page by themselves; otherwise open **http://192.168.4.1**.
2. The page connects over Wi-Fi by itself and reconnects after a cut.

USB keeps working at the same time. The page is built into the firmware
(`firmware/embed_webapp.py` packs `webapp/` at every build), so it always matches it.
The XIAO needs its antenna plugged in. Measure the link with
`python tools/jitter.py --wifi 192.168.4.1` (from a computer on the device's network).
`python tools/wifitest.py` checks the Wi-Fi in about 1 minute (live data, two screens,
a screen that stops reading during a recording, reading a file back): run it after any
change to the Wi-Fi code. `python tools/soaktest.py --hours 2 --record` stays connected for
hours and explains every cut (device restarted and why, device closed the connection, or
the computer left the device's network).

With several screens, only one controls the device (start, stop, change recordings); the
others watch, with a **Take control** button.

The device picks its Wi-Fi channel at each start: the least crowded of 1, 6 and 11 (the
device panel shows it, hover for what it heard). Restart it to choose again.
`WIFI_CHANNEL` in `config.h` forces one.

## Update the firmware from the page

Version 0.2.0 and later: **Update firmware** in the device panel (screen with control, no
recording running) → choose `firmware.bin` → **Install**. About a minute over USB or Wi-Fi;
the device restarts by itself and the page reconnects. If the new firmware does not start
properly, the device goes back to the old one by itself. Details: `docs/protocol.md`.
The first 0.2.0 must still be installed with `flash.bat` (USB); so does any firmware
that breaks USB and Wi-Fi (hold BOOT while plugging in if needed).

Test it on the device (1 to 3 minutes):
```
python tools/otatest.py --wifi 192.168.4.1 firmware/firmware.bin
python tools/otatest.py COM5 firmware/firmware.bin --crash firmware/crash-test.bin
```
`--crash` also installs a firmware that crashes 5 s after starting (`pio run -e crash-test`)
and checks that the device goes back to the previous one by itself.

## Open the app like a program

Double-click `launcher/Creer le raccourci.bat` once: it creates a **Breath Logger** shortcut
on the Desktop and in the Start menu (so Windows search finds it). The shortcut opens the
page in its own Chrome window (Edge if Chrome is missing), without tabs or address bar.
Run it again if the folder moves.

## Flash the device

1. On **Windows** (not WSL: WSL can't see USB devices without extra setup), install
   [VS Code](https://code.visualstudio.com/) and the **PlatformIO IDE** extension.
2. *File → Open Folder* → `firmware`.
3. Plug the ESP32-S3-DevKitC-1 with its port labelled **USB** (not "UART").
4. Click the → arrow (*Upload*) in the blue bar at the bottom.
   If the upload doesn't start: hold **BOOT**, press **RESET**, release **BOOT**, retry.
5. Open `webapp/index.html` → **Connect device** → choose the ESP32 port
   ("USB JTAG/serial debug unit").

The firmware starts with **simulated sensors** (`USE_SIMULATED_SENSORS 1` in
`firmware/src/config.h`), so everything can be tested before the real sensors exist.
Without an SD card the live view works; Begin stays disabled.

## Our board and its SD card

The board is a **Seeed XIAO ESP32-S3** (8 MB flash, 8 MB PSRAM) on our custom PCB. The
SD slot is wired in **SPI mode** to the XIAO's SPI pins (found with `tools/sdprobe`):

| SD card | XIAO pin | ESP32-S3 GPIO |
|---|---|---|
| CS | D7 | 44 |
| SCK | D8 | 7 |
| MISO | D9 | 8 |
| MOSI | D10 | 9 |

GPIO 5 / 6 (D4 / D5) carry an I2C bus with external pull-ups (sensors). The pins are set
in `firmware/src/config.h`. For another board, `tools/pinprobe` (passive, reads only) and
`tools/sdprobe` (tries the SD card on each possible CS pin) help find the wiring.

Format the card as **FAT32**. Cards of 64 GB and more come as exFAT, which the firmware
does not read: reformat them (e.g. Rufus, "Large FAT32") or use a card of 32 GB or less.
The device looks for the card when the page connects, on Begin and on Refresh in
Recordings (not in a loop: a failed attempt blocks the USB link for about 1 s).

## How it works

```
core 1  acquisition task ── every 20 ms: read sensors, timestamp ──┬─> record queue (10 s buffer) ─> SD writer
                                                                    └─> live queue ─> USB to the page
core 0  IO task: SD writer (flush every 1 s), USB commands, status every 0.5 s
```

- The device is the master: it keeps recording if the cable or the browser is
  disconnected. Reconnecting shows the recording in progress.
- The 10 s buffer absorbs SD card write delays (often 100–500 ms), so samples are
  not lost. The **Lost** counter in the page must stay at 0.
- On a power cut, at most ~1 s of data is lost; the session shows as *interrupted*.
- The PC sends its time when connecting (no clock chip yet). Files get real dates.

Files on the SD card: `/recordings/<name>/meta.json` and `session_001.csv`, `session_002.csv`, …
CSV columns: `t_s,co2_pct,o2_pct,flow_lpm,pressure_cmh2o`. Details in `docs/protocol.md`.

## Capacity

| | 50 Hz | 100 Hz |
|---|---|---|
| Data rate | 1.9 KB/s · 6.7 MB/hour | 3.7 KB/s · 13 MB/hour |
| 8 GB card | ~1 200 hours | ~600 hours |
| 32 GB card | ~4 800 hours | ~2 400 hours |
| Longest session (FAT32 4 GB file limit) | ~600 hours | ~300 hours |

- **Use an 8–32 GB card formatted FAT32.** Cards of 64 GB and more come formatted exFAT,
  which the firmware can't read: reformat them as FAT32 first.
- The ESP32's memory does not limit the recording length (only a 10 s buffer is used)
  nor the number of recordings (the list is sent one recording at a time).
- What does live in its memory is the `meta.json` of one recording: keep it under ~100
  sessions per recording (fewer with hundreds of pauses). Start a new recording otherwise.
- Viewing a session in the page first downloads it over USB at about 65 KB/s (measured):
  about 1 min 40 s per recorded hour. For multi-hour sessions, reading the SD card
  directly on the PC is faster. Every chunk is checked (length + CRC-32) and re-read if
  damaged.
- Deleted data stays in `/trash` until the trash is emptied (Recordings → Trash). A trim
  frees no space: the session file is kept whole.

## Hardware test

```
pip install pyserial
python tools/devtest.py COM5
```
Checks the live data rate, records ~10 s with a pause, reads the file back and checks
that no sample is missing. Use `--seconds 3600` for an endurance test.

## Status

| Phase | State |
|---|---|
| 0. Project setup | done (compiles; not yet run on hardware) |
| 1. Simulated sensors | done |
| 2. Firmware core: tasks, buffers, SD, recording states | written, **to test on hardware** |
| 3. Web page: live monitor, Start/Pause/Stop, naming | done, tested in demo mode (v2 design) |
| 4. Recording manager: dates, continue a session, rename, notes, delete, view, trim, download | done, tested in demo mode |
| 5. Real sensors | waiting for the sensor choice (`firmware/src/sensors_real.cpp`) |
| 6. Robustness tests (power cut, SD removed, long runs) | to do on hardware |
| Later | clock chip (RTC), breathing LED, device buttons, Wi-Fi |

### To check first on the real board
1. **Connecting must not reset the board.** Start a recording, close the page, reopen
   it and connect: the recording must still be running.
2. `devtest.py` passes, with **Lost 0**, both for the live stream and for the SD file.
3. Pull the SD card during a recording: the page must show an error and the device must not crash.
