# Device ↔ PC protocol (v1)

Transport: USB serial (CDC). Baud rate is ignored by native USB but use 115200.
Encoding: **one JSON object per line** (`\n` terminated), UTF-8, both directions.
Lines that don't start with `{` (e.g. ESP32 boot messages) must be ignored.

**Wi-Fi (`WIFI_ENABLED` in `config.h`)**: the device creates the network
`BreathLogger-XXXX` (password `breathlogger`) and serves the page at `http://192.168.4.1/`.
The same messages go through a WebSocket at `ws://192.168.4.1:81/`, **one JSON object per
WebSocket text message** (no `\n`). USB and several Wi-Fi clients work at the same time:
a `reply` (and its `item`s) goes only to the client that sent the command; `data`,
`status` and `event` go to everyone. A client that leaves the network, or does not read
for 3 s, is dropped (the Wi-Fi runs in its own task: it never delays the recording or USB).
Channel: with `WIFI_CHANNEL 0` the device listens to the networks around when it starts
(~2 s, USB works meanwhile) and takes the least crowded of channels 1, 6 and 11. A network
counts more when it is strong and on the same channel, less when up to 4 channels away.
After a restart without a power cut (firmware update, crash) it keeps the channel of before
and skips the scan, so its network is back sooner.

**Control with several screens**: only one Wi-Fi screen may change things (`start`, `pause`,
`resume`, `stop`, `create`, `rename`, `delete`, `notes`, `trim`, `restore`, `empty_trash`,
and the firmware update `fw_*`);
the others get `"error": "read-only: another screen has control"` and can only watch, list
and read. The first screen to connect has control; when it leaves, the longest connected
one gets it. `take_control` gives it to the screen that sends it. USB always may.
The `hello` reply has `client` (this screen's number, -1 over USB); status `control` is the
number of the screen that has control (-1: none).

## PC → device: commands

Every command has `cmd` and an optional numeric `id`. The device answers each
command with exactly one `reply` carrying the same `id`.

| cmd | fields | allowed while recording | notes |
|---|---|---|---|
| `hello` | `time` (Unix ms, PC clock) | yes | Sets the device clock if it has no time yet or is more than 1 s off (it then also sets the clock chip, see below). Send right after connecting. Reply contains `info` + `status`. `info`: `fw` (version), `build` (date + git commit, differs at every build), `rolled_back`, `rate_hz`, `simulated`, `rtc` (clock chip found), `reset_reason`, `wifi` (network name), `wifi_channel`, `wifi_scan` (per candidate channel: `channel`, `networks` heard, crowding `score`), `channels` (`id`, `name`, `unit`, `fitted`: false = no sensor for it, always empty, not a fault. |
| `status` | – | yes | Reply contains `status`. |
| `take_control` | – | yes | Wi-Fi: this screen gets control (see above). |
| `start` | `rec`, `session` (`"new"` or a session id), `notes`? | – (idle only) | Creates the recording folder if needed. `session` = id → continue that session (append). |
| `pause` | – | yes | Only when recording. |
| `resume` | – | yes | Only when paused. |
| `stop` | – | yes | From recording or paused. |
| `list` | – | yes | Sends one `item` message per recording (`name`, `created`, `notes`, `sessions` count, `duration_s` total recorded, `last_ms` Unix ms of the latest sample), then the reply with `count`. Streaming keeps the ESP32's RAM use constant whatever the number of recordings. |
| `get` | `rec` | yes | Reply: `meta` = full meta.json of one recording. |
| `create` | `rec`, `notes`? | idle only | Creates an empty recording. |
| `rename` | `rec`, `to` | idle only | |
| `delete` | `rec`, `session`? | idle only | Without `session` deletes the whole recording. Data is **moved to `/trash`**, not erased. |
| `notes` | `rec`, `session`?, `notes` | idle only | Without `session` sets the recording notes. |
| `read` | `rec`, `session`, `offset`, `len` (≤ 4096) | idle only | Reply: `data` (CSV text), `offset`, `size` (file size), `eof`, `n` (bytes in `data`), `crc` (CRC-32 of `data`, as zlib). Pull-based: PC asks for the next chunk, and asks again if `n` or `crc` do not match. |
| `trim` | `rec`, `session`, `from_s`, `to_s` | idle only | Hides rows outside `from_s ≤ t_s ≤ to_s`. **The CSV is never modified**: the trim is added to the session's `trims` in meta.json. At most 16 trims per session. |
| `restore` | `rec`, `session` | idle only | Cancels all trims of a session: every row is visible again. |
| `trash` | – | idle only | Reply: `items`, `bytes` of the trash. |
| `empty_trash` | – | idle only | Erases `/trash` for good. |
| `fw_begin` | `size` (bytes) | idle only | Starts a firmware update (below). |
| `fw_write` | `offset`, `crc`, `data` (base64, ≤ 2048 bytes) | – | Reply: `next` = where the next chunk starts. |
| `fw_end` | – | – | Checks the whole file; the device restarts on it 1.5 s after the reply. |
| `fw_abort` | – | – | Drops an update in progress (the running firmware is untouched). |

Recording names: `[A-Za-z0-9_-]`, 1–32 characters. The device rejects anything else.

### Firmware update (`fw_*`)

Over USB or Wi-Fi, from the page (**Update firmware** in the device panel) or
`tools/otatest.py`. The file goes to the *other* half of the flash (two 3.2 MB app slots):
the running firmware is not touched until everything has arrived and been checked.

1. `fw_begin` with the file size. Refused while recording (`start` is refused during an update).
2. `fw_write` for each chunk, in order, from offset 0. The device decodes it and checks
   its `crc` (CRC-32 as zlib) → `"firmware chunk damaged"`: send it again. A chunk sent
   twice (its reply was lost) is not written twice: just continue from `next`.
3. `fw_end`. Refused with `"not a Breath Logger firmware"` when the file has no
   `#BreathLogger-firmware <version> <build>#` text (written into every firmware by
   `firmware/build_info.py`); the ESP-IDF also checks the image (checksum, SHA-256, chip).
   Then the device restarts on the new firmware.
4. The new firmware starts "on probation": it is kept once a screen says `hello`, or
   after it has run for a minute. If it restarts before (crash, watchdog), the bootloader
   goes back to the previous firmware by itself and `info.rolled_back` becomes `true`.

Nothing received for 30 s: the update is dropped (`event` warn). The page reconnects by
itself after the restart (over Wi-Fi it then reloads: the new firmware brings its page).

## Device → PC: messages

### `reply`
```json
{"type":"reply","id":7,"ok":true, ...payload}
{"type":"reply","id":7,"ok":false,"error":"busy: recording"}
```

### `item`
One element of a long answer (`list`), with the `id` of the command. The `reply` comes after the last item.

### `data` (live samples, always sent, ~10 messages/s)
```json
{"type":"data","s":[[t_ms, co2, o2, flow, pressure], ...]}
```
`t_ms` = milliseconds since device boot (monotonic, used for live display only).

### `status` (every 500 ms and after every state change)
```json
{"type":"status","state":"idle|recording|paused","rec":"subject01","session":2,
 "t_s":12.34,"samples":617,"run_samples":617,"dropped":0,"live_dropped":0,
 "acq_ok":true,"faults":[],
 "sd":{"ok":true,"total_mb":7580,"free_mb":7012},"clock":true,"battery":{"pct":87,"v":4.05},"p_atm_hpa":1013.42,
 "rate_hz":50,"uptime_s":321,"wifi_clients":1,"control":0}
```
- `clock`: the device knows the date and time (from its clock chip or from a PC).
- `battery`: level in % (single-cell LiPo curve) and volts, measured every 5 s (absent
  before the first measurement). Made up while `BATTERY_SIMULATED 1` (config.h).
- `p_atm_hpa`: atmospheric pressure the pressure channel is relative to (absent while
  unknown, and with simulated sensors).
- `samples`: rows in the session file; `run_samples`: rows since the last `start` / `continue`.
- `sd.retries` / `sd.recoveries`: SD writes tried again / card remounted during a recording,
  since the device started (should stay 0). `diag.sd_slowest_ms`: slowest SD write or flush.
- `wifi_clients`: pages or tools connected over Wi-Fi (the `hello` reply's `info.wifi` is the network name, `""` when Wi-Fi is off).
- `dropped`: samples lost **for the SD recording** (should always be 0).
- `live_dropped`: samples not sent to the PC (harmless, display only).
- `acq_ok`: false when no sample was acquired for 1 s (e.g. a sensor driver stuck).
- `faults`: channels (`co2`, `o2`, `flow`, `pressure`) without a valid value for 1 s. Channels
  without a sensor (`fitted: false`) are never listed.
- Sensor values that are not finite or beyond ±100000 are stored as missing (empty CSV cell).
- `diag` (only in the periodic status, timing diagnostics over the last 500 ms):
  `{"tx_max":420,"stall_max_ms":3,"loop_max_ms":6,"age_max_ms":4}`.
  `tx_max`: most bytes waiting in the device's USB queue; `stall_max_ms`: longest time bytes
  were ready but the PC took nothing; `loop_max_ms`: longest turn of the IO loop;
  `age_max_ms`: oldest live sample when queued for USB. With Wi-Fi: `wifi_send_max_ms`
  (slowest send to one client), `wifi_dropped` (messages not sent: a client not reading or
  the Wi-Fi queue full), `wifi_kicked` (clients dropped: gone from the network or not
  reading for 1 s). Shown by `tools/jitter.py` and by
  the page opened with `index.html?debug`.

### `event` (asynchronous problems)
```json
{"type":"event","level":"error","msg":"SD write failed - recording stopped"}
```

## SD card layout

```
/recordings/<name>/meta.json
/recordings/<name>/session_001.csv
/recordings/<name>/session_002.csv
```

### CSV
```
t_s,co2_pct,o2_pct,flow_lpm,pressure_cmh2o
0.000,0.041,20.940,12.31,0.152
0.020,...
```
`t_s` = seconds since the **session's first start**. Pauses appear as gaps in time.
Continuing a session later keeps counting from the original start (so a gap of
hours is normal).

With the real sensors (`USE_SIMULATED_SENSORS 0`), from the LPS28DFW pressure sensor:
- `pressure_cmh2o` = measured pressure − atmospheric pressure. The atmospheric pressure is
  the average of the measured pressure over `PRESSURE_BASELINE_S` (60 s): the plain mean at
  first, then a moving average. It follows the weather, not the breaths.
- `flow_lpm` = `FLOW_COEF` (config.h) × `pressure_cmh2o`. The value used is the `flow_coef`
  of the `start` / `continue` event.
- `co2_pct`, `o2_pct`: no gas sensor yet. With `SIM_GAS 1` (config.h), computed from the breath
  phase given by the pressure (formula in config.h); with `SIM_GAS 0`, always empty.

### meta.json
```json
{
  "name": "subject01",
  "created": "2026-10-12T09:41:00Z",
  "notes": "",
  "rate_hz": 50,
  "columns": ["t_s","co2_pct","o2_pct","flow_lpm","pressure_cmh2o"],
  "next_session": 3,
  "sessions": [
    {"id": 1, "file": "session_001.csv", "start": "2026-10-12T09:42:00Z",
     "start_ms": 1760262120000, "clock": true, "notes": "",
     "samples": 14515, "hidden_samples": 0, "duration_s": 290.3, "end_s": 300.0, "dropped": 0,
     "events": [{"t_s":0,"type":"start"},{"t_s":120.5,"type":"pause"},
                {"t_s":130.2,"type":"resume"},{"t_s":300,"type":"stop"}]}
  ]
}
```
- `samples` = rows in the CSV file. `hidden_samples` = rows hidden by trims.
- `duration_s` = visible time actually recorded (`(samples - hidden_samples) / rate_hz`,
  pauses excluded).
- `end_s` = `t_s` of the last row (pauses and continuation gaps included).

- `dropped` = samples lost because the SD card was too slow (should be 0).

`start` and `continue` events also carry `flow_coef` and `p_atm_hpa`: what the flow and
pressure columns were computed with from there (flow = `flow_coef` × pressure).

Event types: `start`, `pause`, `resume`, `stop`, `continue`,
`lost` (with `n`: samples lost there), `stall` (acquisition stopped delivering samples),
`sd_error` (the card refused a write: it was remounted and the recording went on; one
row may be damaged there), `sd_failed` (the card kept refusing: the device stopped the
recording there).
A session without a final `stop` event was interrupted (power loss, reset); its CSV
is still valid up to the last second before the interruption.

### Trims (raw data is never modified)

A trim only hides rows; the CSV file on the card always holds everything recorded.
```json
"trims": [{"from_s": 32.9, "to_s": 113.9, "end_s": 180.0, "at_ms": 1792071881007}],
"edits": [{"type": "trim", "at_ms": 1792071881007, "from_s": 32.9, "to_s": 113.9},
          {"type": "restore", "at_ms": 1792072000000}]
```
- A row is visible if, for every trim, `t_s > end_s` or `from_s ≤ t_s ≤ to_s`.
  `end_s` is the session's end when the trim was made: rows recorded later (session
  continued) are not affected by it.
- `edits` is the history of trims and restores (`at_ms` = PC time, absent if the clock
  was not set). `restore` empties `trims` but keeps `edits`.
- The page shows and exports only the visible rows; the download dialog can include the
  hidden ones. When reading the card on a PC, apply `trims` yourself or use the full data.

## Trash

Deleted data is moved to `/trash` instead of being erased:
```
/trash/<rec>__20261012-143012/                         deleted recording (whole folder)
/trash/<rec>__s002__20261012-143012.csv + .json         deleted session (data + its meta)
```
To recover, read the card on a computer and copy the files back. `empty_trash` erases it.
