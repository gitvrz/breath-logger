#!/usr/bin/env python3
"""Test of the firmware update from the page, without the browser (same commands).
Takes 1 to 3 minutes.

    python tools/otatest.py --wifi 192.168.4.1 firmware/firmware-next.bin
    python tools/otatest.py COM5 firmware/firmware-next.bin          (USB: close the page first)
    python tools/otatest.py --wifi 192.168.4.1 firmware/firmware-next.bin --crash firmware/crash-test.bin

Give a build other than the one running (firmware-next.bin = the same code built again),
otherwise step 3 cannot see a change.

Checks:
 1. a file that is not a Breath Logger firmware is refused, the device keeps working
 2. a chunk damaged on the way is refused, then accepted when sent again
 3. the firmware is installed: the device restarts on it (same build as the file)
 4. (--crash) a firmware that crashes after starting: the device goes back by itself
    to the firmware of step 3. crash-test.bin = "pio run -e crash-test" (platformio.ini).
Over Wi-Fi, this computer must rejoin the device's network after each restart (Windows
does it by itself for a known network).
"""
import argparse
import base64
import json
import os
import re
import sys
import time
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jitter import UsbReader, WifiReader  # noqa: E402

CHUNK = 2048
FW_ID = re.compile(rb"#BreathLogger-firmware (\S+) ([^#\0]{1,60})#")


class Link:
    """One connection to the device, over USB or Wi-Fi, speaking the JSON protocol."""

    def __init__(self, a):
        self.a = a
        self.r = WifiReader(a.wifi) if a.wifi else UsbReader(a.port)
        self.next_id = 1

    def send(self, obj):
        line = json.dumps(obj)
        if self.a.wifi:
            self.r.send(1, line.encode())
        else:
            self.r.ser.write((line + "\n").encode())

    def request(self, cmd, timeout=10, **args):
        rid = self.next_id
        self.next_id += 1
        self.send({"cmd": cmd, "id": rid, **args})
        end = time.time() + timeout
        while time.time() < end:
            for raw in self.r.lines():
                try:
                    m = json.loads(raw)
                except ValueError:
                    continue
                if m.get("type") == "reply" and m.get("id") == rid:
                    return m
                if m.get("type") == "event":
                    print(f"  device event: {m.get('level')}: {m.get('msg')}")
        raise TimeoutError(f"no reply to {cmd}")

    def close(self):
        try:
            self.r.close()
        except OSError:
            pass


def connect(a, wait_s=0):
    """Connects and says hello; keeps trying for wait_s seconds (device restarting)."""
    end = time.time() + wait_s
    while True:
        try:
            link = Link(a)
            h = link.request("hello", timeout=5, time=int(time.time() * 1000))
            return link, h["info"], h["status"]
        except Exception as e:  # noqa: BLE001 (port gone, network gone, no answer...)
            if time.time() >= end:
                raise TimeoutError(f"device not back after {wait_s} s ({e})")
            time.sleep(2)


def check(ok, label, detail=""):
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{(': ' + detail) if detail else ''}")
    return ok


def send_file(link, data, label):
    """Sends a whole file. Returns the fw_end reply."""
    r = link.request("fw_begin", size=len(data))
    if not r["ok"]:
        return r
    t0, off, last = time.time(), 0, 0
    while off < len(data):
        part = data[off:off + CHUNK]
        r = link.request("fw_write", offset=off, crc=zlib.crc32(part), data=base64.b64encode(part).decode())
        if not r["ok"]:
            return r
        off = r["next"]
        if time.time() - last > 2:
            last = time.time()
            print(f"  {label}: {100 * off // len(data)} %", end="\r")
    secs = time.time() - t0
    print(f"\r  {label}: sent {len(data) // 1024} KB in {secs:.1f} s ({len(data) / 1024 / secs:.0f} KB/s)")
    return link.request("fw_end", timeout=30)


def install(a, link, info, path, label):
    """Installs a firmware file, waits for the restart. Returns (link, info) after it."""
    data = open(path, "rb").read()
    m = FW_ID.search(data)
    print(f"  file {os.path.basename(path)}: version {m.group(1).decode()}, build {m.group(2).decode()}")
    r = send_file(link, data, label)
    if not r["ok"]:
        raise RuntimeError(f"fw_end refused: {r.get('error')}")
    link.close()
    print("  device restarting...")
    time.sleep(5)
    return connect(a, wait_s=120)[:2]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("port", nargs="?", help="USB port (COM5); or use --wifi")
    ap.add_argument("firmware", help="firmware.bin to install")
    ap.add_argument("--wifi", metavar="HOST", help="device address over Wi-Fi (192.168.4.1)")
    ap.add_argument("--crash", metavar="BIN", help="crash-test firmware: check the automatic return")
    a = ap.parse_args()
    if not a.port and not a.wifi:
        ap.error("give a USB port (COM5) or --wifi 192.168.4.1")
    data = open(a.firmware, "rb").read()
    m = FW_ID.search(data)
    if not m:
        sys.exit(f"{a.firmware} is not a Breath Logger firmware (0.2.0 or later)")
    want = m.group(2).decode()
    ok = True

    link, info, st = connect(a)
    print(f"Device: firmware {info['fw']} build {info.get('build', '?')}, Wi-Fi channel {info.get('wifi_channel')}")
    for c in info.get("wifi_scan", []):
        print(f"  channel {c['channel']:2}: {c['networks']} network(s) heard, crowding {c['score']}")
    if info.get("build") == want:
        print(f"  WARNING: the device already runs this build: step 3 cannot tell whether the update"
              f" happened. Use another build (e.g. firmware-next.bin).")
    if st["state"] != "idle":
        sys.exit("A recording is running: stop it first.")
    link.request("take_control")

    print("1. A file that is not a Breath Logger firmware")
    junk = bytes([0xE9]) + os.urandom(64 * 1024 - 1)
    r = send_file(link, junk, "junk")
    ok &= check(not r["ok"] and "not a Breath Logger" in r.get("error", ""), "refused", r.get("error", "accepted!"))
    r = link.request("status")
    ok &= check(r["ok"], "the device keeps working")

    print("2. A damaged chunk")
    link.request("fw_begin", size=len(data))
    part = data[:CHUNK]
    r = link.request("fw_write", offset=0, crc=zlib.crc32(part) ^ 1, data=base64.b64encode(part).decode())
    ok &= check(not r["ok"] and "damaged" in r.get("error", ""), "refused", r.get("error", "accepted!"))
    r = link.request("fw_write", offset=0, crc=zlib.crc32(part), data=base64.b64encode(part).decode())
    ok &= check(r["ok"] and r["next"] == len(part), "accepted when sent again")
    r = link.request("fw_write", offset=0, crc=zlib.crc32(part), data=base64.b64encode(part).decode())
    ok &= check(r["ok"] and r["next"] == len(part), "a chunk sent twice is written once")
    link.request("fw_abort")

    print("3. Install the firmware")
    link, info = install(a, link, info, a.firmware, "firmware")
    ok &= check(info.get("build") == want, "the device runs the new firmware", f"build {info.get('build')}")

    if a.crash:
        print("4. A firmware that crashes 5 s after starting")
        link.request("take_control")
        before = info.get("build")
        link, info = install(a, link, info, a.crash, "crash-test")
        if info.get("build") != before:  # first boot of the crash firmware: wait for its crash
            print("  crash-test firmware running, waiting for its crash and the return...")
            link.close()
            time.sleep(10)
            link, info = connect(a, wait_s=120)[:2]
        ok &= check(info.get("build") == before, "back on the previous firmware by itself", f"build {info.get('build')}")
        ok &= check(info.get("rolled_back") is True, "the device reports the failed update")

    link.close()
    print("RESULT:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
