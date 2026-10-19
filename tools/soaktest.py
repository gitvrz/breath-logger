#!/usr/bin/env python3
"""Long Wi-Fi test: stays connected for hours and notes every cut, to find out WHY the
connection drops now and then. Run it on a computer on the device's Wi-Fi network.

    python tools/soaktest.py --hours 2              (watch the live data)
    python tools/soaktest.py --hours 2 --record     (also record on the SD card, then check it)

For each cut it tells who caused it:
  - the device restarted (and why: crash, watchdog, power too low...)
  - the device closed the connection (it thought this screen had gone)
  - this computer left the device's network (Windows switched to another Wi-Fi...)
It reconnects by itself, prints a line every minute, and saves every event in
soak-<date>.csv next to this folder. Keep the computer from going to sleep meanwhile.
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wifitest import RESET, Screen  # noqa: E402

REC = "soaktest"
SILENT_S = 5  # no message at all for this long = connection lost (status comes every 0.5 s)


class Soak:
    def __init__(self, host, log_path):
        self.host = host
        self.log = open(log_path, "w", buffering=1)
        self.log.write("time,elapsed_s,event,detail\n")
        self.t0 = time.time()
        self.screen = None
        self.up = None            # (pc time, device uptime) at the last contact
        self.connected_s = 0.0
        self.cuts = {"device restarted": 0, "device closed the connection": 0,
                     "computer off the device's network": 0, "no data any more": 0}
        self.big_gaps = []        # (elapsed, ms) live gaps > 1 s while connected
        self.kicked = 0           # other screens the device dropped
        self.last_contact = time.time()
        self.last_cut = None      # kind of the last cut, until we know whether it was a restart

    def event(self, kind, detail=""):
        el = time.time() - self.t0
        self.log.write(f"{time.strftime('%H:%M:%S')},{el:.1f},{kind},\"{detail}\"\n")
        print(f"  [{time.strftime('%H:%M:%S')} +{el / 60:5.1f} min] {kind}{': ' + detail if detail else ''}")

    def connect(self):
        """Connects (retrying every 2 s) and tells whether the device restarted meanwhile."""
        while True:
            try:
                s = Screen(self.host, "soak", 1)
                h = s.request("hello", time=int(time.time() * 1000))
                break
            except (OSError, TimeoutError) as e:
                self.event("cannot connect", str(e))
                time.sleep(2)
        st, info = h["status"], h["info"]
        if self.up:
            expected = self.up[1] + (time.time() - self.up[0])
            if st["uptime_s"] + 5 < expected:
                r = info["reset_reason"]
                if self.last_cut:  # that cut was the restart: count it once, as a restart
                    self.cuts[self.last_cut] -= 1
                self.cuts["device restarted"] += 1
                self.event("DEVICE RESTARTED", f"reason {r} ({RESET.get(r, '?')}), up for {st['uptime_s']} s")
        self.last_cut = None
        self.up = (time.time(), st["uptime_s"])
        self.screen = s
        self.last_contact = time.time()
        self.event("connected", f"device up for {st['uptime_s']} s, state {st['state']}")
        return h

    def classify_cut(self, error):
        """The connection is gone: find out why (before reconnecting)."""
        try:
            self.screen.close()
        except OSError:
            pass
        self.screen = None
        # Windows: 10051/10065 = network unreachable, 10053 = this computer aborted the link
        if any(code in error for code in ("10051", "10053", "10065")) or "unreachable" in error.lower():
            self.last_cut = "computer off the device's network"
            self.cuts[self.last_cut] += 1
            self.event("CUT: this computer left the device's network", error)
        elif error == "silent":
            self.last_cut = "no data any more"
            self.cuts[self.last_cut] += 1
            self.event(f"CUT: nothing received for {SILENT_S} s", "Wi-Fi link lost (range, interference) or device stuck")
        else:
            self.last_cut = "device closed the connection"
            self.cuts[self.last_cut] += 1
            self.event("CUT: the connection was closed", error)
        # connect() then says whether the device had restarted

    def run(self, hours, record):
        end = self.t0 + hours * 3600
        self.connect()
        sid = None
        if record:
            self.screen.request("take_control")
            try:
                self.screen.request("delete", rec=REC)
            except RuntimeError:
                pass
            sid = self.screen.request("start", rec=REC, session="new")["session"]
            rec_t0 = time.time()
            self.event("recording started", f"{REC} session {sid}")
        next_print = time.time() + 60
        minute_gap = 0.0
        while time.time() < end:
            s = self.screen
            before = len(s.arrivals)
            try:
                s.wait(0.2)
            except (OSError, TimeoutError) as e:
                self.classify_cut(str(e))
                self.connect()
                continue
            now = time.time()
            if s.status and s.status.get("uptime_s") is not None:
                self.up = (now, s.status["uptime_s"])
            if len(s.arrivals) > before or s.status:
                self.last_contact = now
            if s.status:
                self.kicked += (s.status.get("diag") or {}).get("wifi_kicked", 0)
                s.status = None
            if now - self.last_contact > SILENT_S:
                self.classify_cut("silent")
                self.connect()
                continue
            self.connected_s += 0.2
            # live gaps over 1 s (connected but data late)
            arr = s.arrivals[max(0, before - 1):]
            for a, b in zip(arr, arr[1:]):
                g = (b[0] - a[0]) * 1000
                minute_gap = max(minute_gap, g)
                if g > 1000:
                    self.big_gaps.append((now - self.t0, g))
                    self.event("live data late", f"{g:.0f} ms without data")
            del s.arrivals[:-2]  # keep memory flat over hours
            if now >= next_print:
                next_print += 60
                el = (now - self.t0) / 60
                cuts = sum(self.cuts.values())
                print(f"  +{el:5.1f} min  connected, cuts so far {cuts}, longest gap this minute {minute_gap:.0f} ms")
                minute_gap = 0.0

        # ---- summary --------------------------------------------------------------------
        print("\nSummary")
        total = time.time() - self.t0
        print(f"  duration {total / 3600:.2f} h, connected {100 * self.connected_s / total:.1f} % of the time")
        for k, v in self.cuts.items():
            print(f"  {k:36} {v}")
        print(f"  live gaps over 1 s while connected   {len(self.big_gaps)}")
        print(f"  other screens dropped by the device  {self.kicked}")
        ok = sum(self.cuts.values()) == 0 and not self.big_gaps
        if record:
            try:
                ok &= self.check_recording(sid, rec_t0)
            except (OSError, TimeoutError, RuntimeError, KeyError, StopIteration) as e:
                print(f"  recording: could not check it ({e!r})")
                ok = False
        print(f"\nEvents saved in {self.log.name}")
        print("RESULT:", "PASS" if ok else "FAIL (see the events above)")
        return ok

    def check_recording(self, sid, rec_t0):
        """Stops the test recording and checks it lost nothing."""
        if self.screen is None:
            self.connect()
        self.screen.request("take_control")
        st = self.screen.request("status").get("status", {})
        if st.get("state") != "idle":
            self.screen.request("stop")
        meta = self.screen.request("get", rec=REC)["meta"]
        sess = next(x for x in meta["sessions"] if x["id"] == sid)
        ev = [e["type"] for e in sess["events"]]
        expected = (time.time() - rec_t0) * 50
        print(f"  recording: {sess['samples']} rows ({sess['samples'] / 50 / 60:.1f} min), "
              f"lost {sess['dropped']}, events {sorted(set(ev))}")
        rec_ok = sess["dropped"] == 0 and "lost" not in ev and "stall" not in ev and sess["samples"] > 0.98 * expected
        if self.cuts["device restarted"]:
            print("  (the device restarted: the recording stopped there and shows as interrupted)")
        print(f"  recording {'OK' if rec_ok else 'NOT OK'}: expected about {expected:.0f} rows")
        return rec_ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="192.168.4.1")
    ap.add_argument("--hours", type=float, default=2)
    ap.add_argument("--record", action="store_true", help="record on the SD card during the test and check it")
    a = ap.parse_args()
    name = time.strftime("soak-%Y%m%d-%H%M%S.csv")
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), name)
    print(f"Soak test for {a.hours:g} h over Wi-Fi ({a.host}){' with a recording' if a.record else ''}. Ctrl+C stops early.")
    soak = Soak(a.host, path)
    try:
        ok = soak.run(a.hours, a.record)
    except KeyboardInterrupt:
        print("\nStopped early.")
        ok = False
        if a.record and soak.screen:  # don't leave the device recording
            try:
                soak.screen.request("stop")
                print(f"Recording stopped ({REC} on the SD card).")
            except (OSError, TimeoutError, RuntimeError) as e:
                print(f"Could not stop the recording ({e}): stop it from the page.")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
