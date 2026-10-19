#!/usr/bin/env python3
"""Wi-Fi test of the device, without the browser. Run it again after any change to the
Wi-Fi code. Takes about 1 minute.

    python tools/wifitest.py                    (device at 192.168.4.1)
    python tools/wifitest.py --keep             (keep the test recording on the SD card)

This computer must be on the device's Wi-Fi network (BreathLogger-XXXX). Checks:
 1. live data over Wi-Fi: 50 Hz, nothing missing, regular arrival
 2. two screens at once: both get the live data, each gets only its own replies
 3. a screen that stops reading while a recording runs: the device drops it, the other
    screen keeps getting live data, and the recording loses nothing
 4. reading the recorded file over Wi-Fi: every chunk checked (length + CRC), no sample missing
"""
import argparse
import json
import os
import sys
import time
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jitter import WifiReader  # noqa: E402

REC = "wifitest"


class Screen:
    """One web page / screen connected to the device over Wi-Fi."""

    def __init__(self, host, name, id_base, rcvbuf=None):
        self.name = name
        self.ws = WifiReader(host, rcvbuf=rcvbuf)
        self.next_id = id_base
        self.asked = set()
        self.replies = {}
        self.foreign = []  # replies to commands this screen never sent
        self.arrivals = []  # (pc_s, last_t_ms, n_samples)
        self.status = None
        self.kicked = 0

    def pump(self):
        for raw in self.ws.lines():
            try:
                m = json.loads(raw)
            except ValueError:
                continue
            t = m.get("type")
            if t == "data" and m["s"]:
                self.arrivals.append((time.perf_counter(), m["s"][-1][0], len(m["s"])))
            elif t == "status":
                self.status = m
                self.kicked += (m.get("diag") or {}).get("wifi_kicked", 0)
            elif t == "reply":
                if m.get("id") in self.asked:
                    self.replies[m["id"]] = m
                else:
                    self.foreign.append(m)

    def wait(self, seconds):
        end = time.perf_counter() + seconds
        while time.perf_counter() < end:
            self.pump()

    def request(self, cmd, timeout=10, **args):
        rid = self.next_id
        self.next_id += 1
        self.asked.add(rid)
        self.ws.send(1, json.dumps({"cmd": cmd, "id": rid, **args}).encode())
        end = time.perf_counter() + timeout
        while time.perf_counter() < end:
            self.pump()
            if rid in self.replies:
                r = self.replies.pop(rid)
                if not r["ok"]:
                    raise RuntimeError(f"{cmd}: {r.get('error')}")
                return r
        raise TimeoutError(f"{self.name}: no reply to {cmd}")

    def max_gap_ms(self, since=0.0):
        times = [a[0] for a in self.arrivals if a[0] >= since]
        return max(((b - a) * 1000 for a, b in zip(times, times[1:])), default=0)

    def close(self):
        self.ws.close()


def check(ok, label, detail=""):
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{(': ' + detail) if detail else ''}")
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="192.168.4.1")
    ap.add_argument("--keep", action="store_true", help="keep the test recording on the SD card")
    a = ap.parse_args()
    ok = True

    print("1. Live data over Wi-Fi (5 s)")
    s1 = Screen(a.host, "screen 1", 1)
    hello = s1.request("hello", time=int(time.time() * 1000))
    info, st = hello["info"], hello["status"]
    print(f"  firmware {info['fw']}, network {info.get('wifi')!r}, simulated={info['simulated']}, SD={st['sd']['ok']}")
    t0 = time.perf_counter()
    s1.wait(5)
    rows = sum(x[2] for x in s1.arrivals)
    holes = sum(1 for x, y in zip(s1.arrivals, s1.arrivals[1:]) if y[1] - x[1] > 100 + 30)
    ok &= check(230 <= rows <= 270, "about 250 samples in 5 s", f"{rows}")
    ok &= check(holes == 0, "no live message missing", f"{holes} missing")
    ok &= check(s1.max_gap_ms(t0) < 1000, "live arrival regular", f"longest gap {s1.max_gap_ms(t0):.0f} ms")

    print("2. Two screens at once (3 s)")
    s2 = Screen(a.host, "screen 2", 100000)
    s2.request("hello", time=int(time.time() * 1000))
    t0 = time.perf_counter()
    for _ in range(30):
        s1.wait(0.05)
        s2.wait(0.05)
    s1.request("status")
    s2.wait(0.5)
    n1 = sum(1 for x in s1.arrivals if x[0] >= t0)
    n2 = sum(1 for x in s2.arrivals if x[0] >= t0)
    ok &= check(n1 >= 20 and n2 >= 20, "both screens get the live data", f"{n1} and {n2} messages")
    ok &= check(not s2.foreign and not s1.foreign, "each screen gets only its own replies",
                f"{len(s1.foreign) + len(s2.foreign)} misrouted" if (s1.foreign or s2.foreign) else "")
    s1.close()

    if not st["sd"]["ok"]:
        print("No SD card: skipping the recording tests")
        print("RESULT:", "PASS" if ok else "FAIL")
        sys.exit(0 if ok else 1)

    print("3. Recording while a screen stops reading (25 s)")
    try:
        s2.request("delete", rec=REC)
    except RuntimeError:
        pass
    sid = s2.request("start", rec=REC, session="new")["session"]
    # Screen 3 connects with a tiny receive buffer, then never reads again: like a phone
    # that went out of range. The device must drop it without slowing anything down.
    s3 = Screen(a.host, "screen 3 (silent)", 200000, rcvbuf=2048)
    t0 = time.perf_counter()
    s2.wait(25)
    s2.request("stop")
    s2.wait(0.5)
    gap = s2.max_gap_ms(t0)
    ok &= check(gap < 1000, "the other screen keeps getting live data", f"longest gap {gap:.0f} ms")
    ok &= check(s2.kicked >= 1, "the silent screen was dropped by the device", f"{s2.kicked} dropped")
    ok &= check(s2.status["dropped"] == 0, "recording lost nothing", f"dropped = {s2.status['dropped']}")
    try:
        s3.close()
    except OSError:
        pass

    print("4. Read the recording back over Wi-Fi")
    text, offset, retries, t0 = "", 0, 0, time.perf_counter()
    while True:
        r = s2.request("read", rec=REC, session=sid, offset=offset, len=4096)
        if r["n"] != len(r["data"]) or zlib.crc32(r["data"].encode("latin-1")) != r["crc"]:
            retries += 1
            if retries > 20:
                break
            continue
        text += r["data"]
        offset += len(r["data"])
        if r["eof"]:
            break
    secs = time.perf_counter() - t0
    rows = [line.split(",") for line in text.strip().split("\n")[1:]]
    meta = s2.request("get", rec=REC)["meta"]
    s = next(x for x in meta["sessions"] if x["id"] == sid)
    times = [float(r[0]) for r in rows]
    holes = sum(1 for x, y in zip(times, times[1:]) if y - x > 0.03)
    print(f"  {len(text)} bytes in {secs:.1f} s ({len(text) / 1024 / max(secs, 0.001):.0f} KB/s), {retries} chunk(s) re-read")
    ok &= check(len(rows) == s["samples"], "every row of the file arrived", f"{len(rows)} of {s['samples']}")
    ok &= check(holes == 0, "no sample missing in the recording", f"{holes} holes")
    ok &= check(1200 <= len(rows) <= 1350, "about 25 s recorded", f"{len(rows) / 50:.1f} s")

    if not a.keep:
        s2.request("delete", rec=REC)
    s2.close()
    print("RESULT:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
