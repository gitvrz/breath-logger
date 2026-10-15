// Passive pin scan. For each GPIO that is safe to read, reads the level twice: once
// with the internal pull-down, once with the internal pull-up (~45 kOhm). Prints one
// line per second:
//   up    = reads high even with the pull-down: external pull-up or something driving high
//   down  = reads low even with the pull-up: external pull-down, ground, or driven low
//   float = follows the internal pull: nothing strong connected
// SD card lines (CMD, D0-D3) normally have external pull-ups. Comparing a scan with the
// card inserted and one without shows the card's own pull-up on D3 and any card-detect pin.
#include <Arduino.h>

// Not scanned: 19/20 = USB (our link), 26-32 = flash, 33-37 = octal PSRAM (N8R8 module)
static const uint8_t PINS[] = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
                               17, 18, 21, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48};

static int readWith(uint8_t pin, uint8_t mode) {
  pinMode(pin, mode);
  delay(3);
  int v = 0;
  for (int i = 0; i < 8; i++) v += digitalRead(pin);
  return v;  // 0..8
}

void setup() {
  Serial.begin(115200);
  for (uint8_t p : PINS) pinMode(p, INPUT);
}

void loop() {
  String up, down, flt, odd;
  for (uint8_t p : PINS) {
    int withDown = readWith(p, INPUT_PULLDOWN);
    int withUp = readWith(p, INPUT_PULLUP);
    pinMode(p, INPUT);
    String n = String(p);
    if (withDown == 8 && withUp == 8) up += (up.length() ? "," : "") + n;
    else if (withDown == 0 && withUp == 0) down += (down.length() ? "," : "") + n;
    else if (withDown == 0 && withUp == 8) flt += (flt.length() ? "," : "") + n;
    else odd += (odd.length() ? "," : "") + n + ":" + withDown + "/" + withUp;
  }
  Serial.printf("{\"scan\":{\"up\":[%s],\"down\":[%s],\"float\":[%s],\"unstable\":\"%s\",\"uptime_s\":%lu}}\n",
                up.c_str(), down.c_str(), flt.c_str(), odd.c_str(), millis() / 1000);
  delay(1000);
}
