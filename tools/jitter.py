#!/usr/bin/env python3
"""Measures WHEN the live data reaches the PC, without the browser.

The device sends a "data" message every 100 ms. This notes the arrival time of each
one, lists the gaps (> 150 ms without a message), and shows the device's own timing
counters (status "diag"), to find where the live data waits: in the device, on the
USB link / Windows driver, or (if this shows no gap while the page does) in Chrome.

    python tools/jitter.py COM5                 (USB, 60 s)
    python tools/jitter.py COM5 --seconds 300   (USB, 5 min)
    python tools/jitter.py --wifi 192.168.4.1   (Wi-Fi: join the device's network first)

USB: close the web page first, only one program can open the port.
Raw arrival times are saved in jitter-<date>.csv next to this folder.
"""
import argparse
import base64
import json
import os
import socket
import statistics
import struct
import time

GAP_MS = 150


class UsbReader:
    def __init__(self, port):
        import serial  # only needed for USB

        self.ser = serial.Serial()
        self.ser.port = port
        self.ser.baudrate = 115200
        self.ser.timeout = 0.002
        self.ser.dtr = False  # avoid resetting the ESP32-S3 when opening the port
        self.ser.rts = False
        self.ser.open()
        self.buf = b""

    def lines(self):
        self.buf += self.ser.read(65536)
        *lines, self.buf = self.buf.split(b"\n")
        return lines

    def close(self):
        self.ser.close()


class WifiReader:
    """Minimal WebSocket client (standard library only): receives the device's messages
    and answers its pings, so the device does not drop us as out of range."""

    def __init__(self, host, port=81):
        self.sock = socket.create_connection((host, port), timeout=5)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET / HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\n"
                           f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
                           "Sec-WebSocket-Version: 13\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            part = self.sock.recv(1024)
            if not part:
                raise ConnectionError("the device closed the connection")
            head += part
        head, self.buf = head.split(b"\r\n\r\n", 1)
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise ConnectionError("not a WebSocket server: " + head.split(b"\r\n")[0].decode())
        self.sock.settimeout(0.002)
        self.frag = b""

    def send(self, opcode, payload=b""):
        mask = os.urandom(4)  # client frames must be masked
        head = bytes([0x80 | opcode, 0x80 | len(payload)])  # control frames: < 126 bytes
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def lines(self):
        try:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("the device closed the connection")
            self.buf += chunk
        except socket.timeout:
            pass
        out = []
        while len(self.buf) >= 2:
            b0, b1 = self.buf[0], self.buf[1]
            n, i = b1 & 0x7F, 2
            if n == 126:
                if len(self.buf) < 4:
                    break
                n, i = struct.unpack(">H", self.buf[2:4])[0], 4
            elif n == 127:
                if len(self.buf) < 10:
                    break
                n, i = struct.unpack(">Q", self.buf[2:10])[0], 10
            if b1 & 0x80:
                i += 4  # masked (servers don't do it)
            if len(self.buf) < i + n:
                break
            payload, self.buf = self.buf[i:i + n], self.buf[i + n:]
            opcode = b0 & 0x0F
            if opcode in (0, 1):  # text, or the continuation of a fragmented one
                self.frag += payload
                if b0 & 0x80:
                    out.append(self.frag)
                    self.frag = b""
            elif opcode == 9:
                self.send(10, payload)  # ping -> pong
            elif opcode == 8:
                raise ConnectionError("the device closed the connection")
        return out

    def close(self):
        try:
            self.send(8)  # close frame: a clean goodbye
        except OSError:
            pass
        self.sock.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("port", nargs="?", help="USB serial port, e.g. COM5")
    ap.add_argument("--wifi", metavar="HOST", help="measure over Wi-Fi instead, e.g. 192.168.4.1")
    ap.add_argument("--seconds", type=float, default=60)
    a = ap.parse_args()
    if not a.port and not a.wifi:
        ap.error("give a USB port (COM5) or --wifi 192.168.4.1")

    link = WifiReader(a.wifi) if a.wifi else UsbReader(a.port)
    arrivals = []  # (pc_s, first_t_ms, last_t_ms, n_samples)
    diags = []     # (pc_s, diag dict)
    t0 = time.perf_counter()
    print(f"Listening for {a.seconds:.0f} s over {'Wi-Fi' if a.wifi else 'USB'}...")
    while time.perf_counter() - t0 < a.seconds:
        lines = link.lines()
        now = time.perf_counter() - t0
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
    link.close()

    if len(arrivals) < 10:
        print("Almost no data received: is the page still open (USB)? Is it the right port or address?")
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
        if a.wifi:
            wk = ["wifi_send_max_ms", "wifi_dropped", "wifi_kicked"]
            wmx = {k: max(d.get(k, 0) for _, d in diags) for k in wk}
            print("\n4a. Device Wi-Fi counters (worst / total over the run):")
            print(f"   wifi_send_max_ms {wmx['wifi_send_max_ms']:4} ms  slowest send to one client")
            print(f"   wifi_dropped     {sum(d.get('wifi_dropped', 0) for _, d in diags):4}     messages not sent (a client not reading)")
            print(f"   wifi_kicked      {sum(d.get('wifi_kicked', 0) for _, d in diags):4}     clients dropped (gone or too slow)")
            print("   (below: USB counters, high values are normal when nothing reads the USB port)")
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
