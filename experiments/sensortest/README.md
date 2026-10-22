# Sensor test

A small standalone program, separate from the Breath Logger firmware. It reads the three I2C
chips of the sensor board and prints their values on the USB port in real time:

| Chip | What it gives | I2C address |
|---|---|---|
| LPS28DFW | absolute pressure (hPa), temperature | 0x5C or 0x5D |
| LSM6DSM | accelerometer (g), gyroscope (deg/s), temperature | 0x6A or 0x6B |
| DS1307 | date and time (needs 5 V and its battery) | 0x68 |

I2C bus on GPIO 5 (SDA) / 6 (SCL), at 100 kHz because the DS1307 does not go faster.
A clock that was never set is set to the time the program was compiled.

## Use (Windows)

The `sensortest\` folder goes inside the BreathLogger folder: it uses its `tools\` and
`firmware\` (bootloader, partitions).

1. Close the Breath Logger page. Run `flash-sensortest.bat`.
2. Run `moniteur.bat`. At boot it lists what answers on the bus; type `i` + Enter to see
   it again.
3. Commands (then Enter): `t` readable text, `p` Arduino Serial Plotter format,
   `z` pressure change back to 0, `T2026-10-21 16:30:00` set the clock. Quit: Ctrl+].

The Arduino IDE's Serial Plotter also works (115200 baud) after typing `p`.

To get the Breath Logger back: `..\flash.bat`. The page cannot update this program.

## Build

    cd experiments/sensortest
    ../../.venv/bin/pio run        # -> .pio/build/sensortest/firmware.bin = sensortest.bin
