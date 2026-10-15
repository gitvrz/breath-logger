#!/usr/bin/env python3
"""Measures WHEN the live data reaches the PC, without the browser.

The device sends a "data" message every 100 ms. This notes the arrival time of each
one, lists the gaps (> 150 ms without a message), and shows the device's own timing
counters (status "diag"), to find where the live data waits: in the device, on the
USB link / Windows driver, or (if this shows no gap while the page does) in Chrome.

    python tools/jitter.py COM5                 (60 s)
    python tools/jitter.py COM5 --seconds 300   (5 min)

Close the web page first: only one program can open the port.
Raw arrival times are saved in jitter-<date>.csv next to this folder.
"""
import argparse
import json
import os
import statistics
import time

import serial

GAP_MS = 150


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("port")
    ap.add_argument("--seconds", type=float, default=60)
    a = ap.parse_args()

    ser = serial.Serial()
    ser.port = a.port
    ser.baudrate = 115200
    ser.timeout = 0.002
    ser.dtr = False  # avoid resetting the ESP32-S3 when opening the port
    ser.rts = False
    ser.open()

    arrivals = []  # (pc_s, first_t_ms, last_t_ms, n_samples)
    diags = []     # (pc_s, diag dict)
    buf = b""
    t0 = time.perf_counter()
    print(f"Listening for {a.seconds:.0f} s...")
    while time.perf_counter() - t0 < a.seconds:
        chunk = ser.read(65536)
        now = time.perf_counter() - t0
        if not chunk:
            continue
        buf += chunk
        *lines, buf = buf.split(b"\n")
        for line in lines:
            line = line.strip()
            if not line.startswith(b"{"):
                continue
            try:
                m = json.loads(line)
            except ValueError:
                continue
            if m.get("type") == "data" and m["s"]:
                arrivals.append((now, m["s"][0][0], m["s"][-1][0], len(m["s"])))
            elif m.get("type") == "status" and "diag" in m:
                diags.append((now, m["diag"]))
    ser.close()

    if len(arrivals) < 10:
        print("Almost no data received: is the page still open? Is it the right port?")
        return

    # Save the raw data
    name = time.strftime("jitter-%Y%m%d-%H%M%S.csv")
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), name)
    with open(path, "w") as f:
        f.write("pc_s,first_t_ms,last_t_ms,n\n")
        for r in arrivals:
            f.write(f"{r[0]:.4f},{r[1]},{r[2]},{r[3]}\n")
    with open(path.replace(".csv", "-diag.csv"), "w") as f:
        f.write("pc_s,tx_max,stall_max_ms,loop_max_ms,age_max_ms\n")
        for t, d in diags:
            f.write(f"{t:.4f},{d.get('tx_max')},{d.get('stall_max_ms')},{d.get('loop_max_ms')},{d.get('age_max_ms')}\n")

    # 1. Did the device produce every sample on time? (its own timestamps)
    dev_holes = [(b[1] - a_[2]) for a_, b in zip(arrivals, arrivals[1:]) if b[1] - a_[2] > 30]
    n_samples = sum(r[3] for r in arrivals)
    span_s = (arrivals[-1][2] - arrivals[0][1]) / 1000
    print(f"\n1. Device side: {n_samples} samples over {span_s:.1f} s "
          f"({n_samples / span_s:.1f} Hz), {len(dev_holes)} hole(s) in the device timestamps")

    # 2. When did they reach the PC?
    iv = [(b[0] - a_[0]) * 1000 for a_, b in zip(arrivals, arrivals[1:])]
    iv_sorted = sorted(iv)
    print(f"\n2. Arrival on the PC: {len(arrivals)} messages, interval median "
          f"{statistics.median(iv):.0f} ms, 99% < {iv_sorted[int(len(iv) * 0.99)]:.0f} ms, "
          f"max {max(iv):.0f} ms")
    gaps = [(arrivals[i][0], iv[i]) for i in range(len(iv)) if iv[i] > GAP_MS]
    print(f"   Gaps > {GAP_MS} ms: {len(gaps)}")
    for t, g in gaps[:15]:
        print(f"     at {t:7.2f} s: {g:4.0f} ms without data")
    if len(gaps) > 15:
        print(f"     ... ({len(gaps) - 15} more)")
    if len(gaps) >= 3:
        periods = [b[0] - a_[0] for a_, b in zip(gaps, gaps[1:])]
        print(f"   Time between gaps: median {statistics.median(periods):.2f} s "
              f"(min {min(periods):.2f}, max {max(periods):.2f})")

    # 3. Delay of the data: arrival time minus device time (relative, smallest = 0)
    lag = [r[0] * 1000 - r[2] for r in arrivals]
    base = min(lag)
    lag = [x - base for x in lag]
    print(f"\n3. Extra delay of the newest sample when it arrives (0 = best seen): "
          f"median {statistics.median(lag):.0f} ms, max {max(lag):.0f} ms")

    # 4. The device's own counters (each covers 500 ms)
    if diags:
        keys = ["tx_max", "stall_max_ms", "loop_max_ms", "age_max_ms"]
        mx = {k: max(d.get(k, 0) for _, d in diags) for k in keys}
        print("\n4. Device counters (worst over the run):")
        print(f"   tx_max       {mx['tx_max']:6} bytes  waiting in the device's USB queue")
        print(f"   stall_max_ms {mx['stall_max_ms']:6} ms     bytes ready but the PC took nothing")
        print(f"   loop_max_ms  {mx['loop_max_ms']:6} ms     longest turn of the device's IO loop")
        print(f"   age_max_ms   {mx['age_max_ms']:6} ms     oldest sample when queued for USB")
        if gaps:
            print("   Around each gap (worst of the statuses received in the next second):")
            for t, g in gaps[:8]:
                near = [d for pt, d in diags if t <= pt <= t + 1.0]
                if near:
                    print(f"     {t:7.2f} s ({g:4.0f} ms): " + ", ".join(f"{k}={max(d.get(k, 0) for d in near)}" for k in keys))
    else:
        print("\n4. No diag counters: flash the new firmware.")

    print(f"\nRaw data saved: {path}")


if __name__ == "__main__":
    main()
