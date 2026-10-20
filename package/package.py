#!/usr/bin/env python3
"""Builds the ready-to-use Windows folder: everything needed to install the firmware,
open the page and run the test tools, with nothing to install on the PC.

    python3 package/package.py                    -> dist/BreathLogger/ + dist/BreathLogger-<version>.zip
    python3 package/package.py --test-firmware    also firmware-next.bin and crash-test.bin (tools/otatest.py)
    python3 package/package.py --out /mnt/c/Users/vince/BreathLogger   update a folder in place

What goes in the folder (see README.md, "Use the device"):
    flash.bat             first install of the firmware over USB (or recovery)
    firmware/             the compiled firmware and the files flash.bat writes with it
    webapp/               the page (index.html)
    launcher/             "Creer le raccourci.bat": a Breath Logger shortcut on the Desktop
    tools/                test tools, with esptool.exe and a portable Python (pyserial)
    README.md, docs/
esptool, Python and pyserial are downloaded once (pinned versions, checked against their
SHA-256) and kept in dist/cache/. The firmware is compiled with PlatformIO (pio).

--out updates an existing folder: it replaces the files above and leaves the others
(test results, older firmware files) alone. Without --out, dist/BreathLogger is rebuilt
from scratch.
"""
import argparse
import hashlib
import os
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIRMWARE = os.path.join(ROOT, "firmware")
DIST = os.path.join(ROOT, "dist")
CACHE = os.path.join(DIST, "cache")

# Windows programs put in tools/. Changing a version: update the URL and its SHA-256.
DOWNLOADS = {
    "esptool": ("https://github.com/espressif/esptool/releases/download/v5.5.0/esptool-v5.5.0-windows-amd64.zip",
                "e7142a6b6714173b8337e6044984198344c5da31341b333f3d89a59ed8d1ea57"),
    "python": ("https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip",
               "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3"),
    "pyserial": ("https://files.pythonhosted.org/packages/07/bc/587a445451b253b285629263eb51c2d8e9bcea4fc97826266d186f96f558/pyserial-3.5-py2.py3-none-any.whl",
                 "c4451db6ba391ca6ca299fb3ec7bae67a5c55dde170964c7a14ceefec02f2cf0"),
}


def step(text):
    print(f"\n== {text}")


def find_pio(given):
    """PlatformIO: --pio, $PIO, the repository's .venv, the VS Code extension's, or PATH."""
    candidates = [given, os.environ.get("PIO"),
                  os.path.join(ROOT, ".venv", "bin", "pio"), os.path.join(ROOT, ".venv", "Scripts", "pio.exe"),
                  os.path.expanduser("~/.platformio/penv/bin/pio"),
                  os.path.expanduser("~/.platformio/penv/Scripts/pio.exe"), shutil.which("pio")]
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    sys.exit("PlatformIO not found. Install it (docs/development.md, \"Set up\") or give --pio PATH.")


def build(pio, env):
    """Compiles one PlatformIO environment, returns its build folder."""
    print(f"pio run -e {env}")
    r = subprocess.run([pio, "run", "-d", FIRMWARE, "-e", env], capture_output=True, text=True)
    out = r.stdout + r.stderr
    for line in out.splitlines():
        if line.startswith("build_info:"):
            print("  " + line)
    if r.returncode:
        print(out[-4000:])
        sys.exit(f"Build of {env} failed.")
    return os.path.join(FIRMWARE, ".pio", "build", env)


def download(name):
    url, sha = DOWNLOADS[name]
    path = os.path.join(CACHE, url.rsplit("/", 1)[1])
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        print(f"downloading {url}")
        urllib.request.urlretrieve(url, path + ".part")
        os.replace(path + ".part", path)
    digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
    if sha and digest != sha:
        os.remove(path)
        sys.exit(f"{os.path.basename(path)}: unexpected SHA-256 {digest} (download damaged or replaced).")
    if not sha:
        print(f"  {os.path.basename(path)} SHA-256 {digest} (not pinned yet)")
    return path


def copy_tree(src, dst):
    shutil.copytree(src, dst, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))


def main():
    ap = argparse.ArgumentParser(description="Builds the ready-to-use Windows folder.")
    ap.add_argument("--out", help="folder to update in place (default: rebuild dist/BreathLogger)")
    ap.add_argument("--test-firmware", action="store_true",
                    help="also firmware-next.bin (same code built again) and crash-test.bin, for tools/otatest.py")
    ap.add_argument("--no-zip", action="store_true", help="do not make the .zip (never made with --out)")
    ap.add_argument("--pio", help="path of the pio program")
    a = ap.parse_args()

    pio = find_pio(a.pio)
    config = open(os.path.join(FIRMWARE, "src", "config.h")).read()
    version = re.search(r'#define\s+FW_VERSION\s+"([^"]+)"', config).group(1)
    dirty = subprocess.run(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT,
                           capture_output=True, text=True).stdout.strip()
    if dirty:
        print("WARNING: changes not committed yet: the firmware's build id ends with '+'.")

    out = os.path.abspath(a.out) if a.out else os.path.join(DIST, "BreathLogger")
    if not a.out and os.path.exists(out):
        shutil.rmtree(out)
    fw_dir = os.path.join(out, "firmware")
    tools_dir = os.path.join(out, "tools")
    os.makedirs(fw_dir, exist_ok=True)
    os.makedirs(tools_dir, exist_ok=True)

    step("Firmware")
    b = build(pio, "esp32s3")
    for f in ("bootloader.bin", "partitions.bin", "firmware.bin"):
        shutil.copy(os.path.join(b, f), fw_dir)
    boot_app0 = os.path.expanduser("~/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin")
    shutil.copy(boot_app0, fw_dir)  # 0xe000: says which app slot starts (flash.bat resets it)
    if a.test_firmware:
        # crash-test in between: firmware-next.bin then has a later build id than firmware.bin
        shutil.copy(os.path.join(build(pio, "crash-test"), "firmware.bin"), os.path.join(fw_dir, "crash-test.bin"))
        shutil.copy(os.path.join(build(pio, "esp32s3"), "firmware.bin"), os.path.join(fw_dir, "firmware-next.bin"))

    step("Page, launcher, documents, test tools")
    copy_tree(os.path.join(ROOT, "webapp"), os.path.join(out, "webapp"))
    copy_tree(os.path.join(ROOT, "launcher"), os.path.join(out, "launcher"))
    copy_tree(os.path.join(ROOT, "docs"), os.path.join(out, "docs"))
    shutil.copy(os.path.join(ROOT, "README.md"), out)
    shutil.copy(os.path.join(ROOT, "package", "flash.bat"), out)
    for f in sorted(os.listdir(os.path.join(ROOT, "tools"))):
        if f.endswith(".py") or f == "requirements.txt":
            shutil.copy(os.path.join(ROOT, "tools", f), tools_dir)

    step("Windows programs: esptool, portable Python + pyserial")
    with zipfile.ZipFile(download("esptool")) as z:
        exe = next(n for n in z.namelist() if n.endswith("/esptool.exe") or n == "esptool.exe")
        with z.open(exe) as src, open(os.path.join(tools_dir, "esptool.exe"), "wb") as dst:
            shutil.copyfileobj(src, dst)
    py_dir = os.path.join(tools_dir, "python")
    with zipfile.ZipFile(download("python")) as z:
        z.extractall(py_dir)
    with zipfile.ZipFile(download("pyserial")) as z:  # a wheel is a zip: keep its "serial" package
        for n in z.namelist():
            if n.startswith("serial/"):
                z.extract(n, py_dir)

    if not a.no_zip and not a.out:  # --out: the folder may hold other files (test results)
        step("Zip")
        commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT,
                                capture_output=True, text=True).stdout.strip()
        zpath = os.path.join(DIST, f"BreathLogger-{version}-{commit}{'+' if dirty else ''}.zip")
        os.makedirs(DIST, exist_ok=True)
        with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
            for base, _, files in os.walk(out):
                for f in files:
                    p = os.path.join(base, f)
                    z.write(p, os.path.join("BreathLogger", os.path.relpath(p, out)))
        print(f"{zpath} ({os.path.getsize(zpath) // (1024 * 1024)} MB)")

    print(f"\nDone: {out}")
    print("On the PC: unzip, then flash.bat (first install) and launcher\\Creer le raccourci.bat.")


if __name__ == "__main__":
    main()
