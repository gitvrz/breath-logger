#!/usr/bin/env python3
"""Hardware test for the firmware, without the browser.

Checks the live data rate, then makes a short recording with a pause, reads the
CSV back over USB and verifies that no sample is missing.

    pip install pyserial
    python tools/devtest.py COM5            (Windows)
    python tools/devtest.py /dev/ttyACM0    (Linux)
    python tools/devtest.py COM5 --seconds 600   (longer endurance test)
"""
import argparse
import json
import sys
import time
import zlib

import serial


class Dev:
    def __init__(self, port):
        self.ser = serial.Serial()
        self.ser.port = port
        self.ser.baudrate = 115200
        self.ser.timeout = 0.05
        self.ser.dtr = False  # avoid resetting the ESP32-S3 when opening the port
        self.ser.rts = False
        self.ser.open()
        self.buf = b""
        self.next_id = 1
        self.data = []      # live samples received
        self.status = None

    def messages(self):
        self.buf += self.ser.read(65536)
        *lines, self.buf = self.buf.split(b"\n")
        for line in lines:
            line = line.strip()
            if not line.startswith(b"{"):
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if msg["type"] == "data":
                self.data.extend(msg["s"])
            elif msg["type"] == "status":
                self.status = msg
            elif msg["type"] == "event":
                print("  device event:", msg)
            yield msg

    def request(self, cmd, timeout=10, **args):
        rid = self.next_id
        self.next_id += 1
        self.ser.write((json.dumps({"cmd": cmd, "id": rid, **args}) + "\n").encode())
        end = time.time() + timeout
        while time.time() < end:
            for msg in self.messages():
                if msg["type"] == "reply" and msg.get("id") == rid:
                    if not msg["ok"]:
                        raise RuntimeError(f"{cmd}: {msg['error']}")
                    return msg
        raise TimeoutError(f"no reply to {cmd}")

    def wait(self, seconds):
        end = time.time() + seconds
        while time.time() < end:
            for _ in self.messages():
                pass


def check_intervals(times, expected, label, allowed_gaps=0):
    gaps = [(a, b) for a, b in zip(times, times[1:]) if abs((b - a) - expected) > expected * 0.5]
    ok = len(gaps) <= allowed_gaps
    print(f"  {label}: {len(times)} samples, {len(gaps)} irregular interval(s) {'OK' if ok else 'FAIL'}")
    for a, b in gaps[:5]:
        print(f"    {a:.3f} -> {b:.3f} ({(b - a) * 1000:.0f} ms)")
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("port")
    ap.add_argument("--seconds", type=float, default=10, help="recording length")
    ap.add_argument("--keep", action="store_true", help="keep the test recording on the SD card")
    a = ap.parse_args()

    d = Dev(a.port)
    hello = d.request("hello", time=int(time.time() * 1000))
    info, st = hello["info"], hello["status"]
    rate = info["rate_hz"]
    print(f"firmware {info['fw']}, {rate} Hz, simulated={info['simulated']}, reset_reason={info['reset_reason']}")
    print(f"state={st['state']}, SD={st['sd']}")
    ok = True

    print("1. Live data for 5 s")
    d.data.clear()
    d.wait(5)
    ok &= check_intervals([s[0] / 1000 for s in d.data], 1 / rate, "live stream")

    if not st["sd"]["ok"]:
        print("No SD card: skipping the recording test")
        sys.exit(0 if ok else 1)

    print(f"2. Record {a.seconds:.0f} s with a 2 s pause")
    name = "devtest"
    try:
        d.request("delete", rec=name)
    except RuntimeError:
        pass
    sid = d.request("start", rec=name, session="new")["session"]
    d.wait(a.seconds / 2)
    d.request("pause")
    d.wait(2)
    d.request("resume")
    d.wait(a.seconds / 2)
    d.request("stop")
    d.wait(0.3)
    print(f"  dropped (SD) = {d.status['dropped']}")
    ok &= d.status["dropped"] == 0

    print("3. Read the CSV back")
    text, offset, t0, retries = "", 0, time.time(), 0
    while True:
        r = d.request("read", rec=name, session=sid, offset=offset, len=4096)
        if r["n"] != len(r["data"]) or zlib.crc32(r["data"].encode("latin-1")) != r["crc"]:
            retries += 1  # damaged in transfer: ask again
            if retries > 20:
                print("  too many damaged chunks\nRESULT: FAIL")
                sys.exit(1)
            continue
        text += r["data"]
        offset += len(r["data"])
        if r["eof"]:
            break
    print(f"  {len(text)} bytes in {time.time() - t0:.1f} s, {retries} damaged chunk(s) re-read")
    rows = [line.split(",") for line in text.strip().split("\n")[1:]]
    meta = d.request("get", rec=name)["meta"]
    s = next(x for x in meta["sessions"] if x["id"] == sid)
    print(f"  meta: samples={s['samples']} duration_s={s['duration_s']} events={[e['type'] for e in s['events']]}")
    ok &= len(rows) == s["samples"]
    ok &= check_intervals([float(r[0]) for r in rows], 1 / rate, "SD file", allowed_gaps=1)  # the pause

    if not a.keep:
        d.request("delete", rec=name)
    print("RESULT:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
