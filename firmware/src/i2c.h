#pragma once
#include <Wire.h>

// Register access on the I2C bus (sensor board). Wire locks the bus for each
// transaction, but the bytes read land in one buffer shared by every task: only the
// acquisition task reads once it runs (other tasks may only write, see clock.cpp).

inline bool i2cPresent(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

inline bool i2cRead(uint8_t addr, uint8_t reg, uint8_t *buf, size_t n) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.endTransmission(false);  // repeated start: the bus stays ours until requestFrom
  if (Wire.requestFrom(addr, n) != n) return false;
  for (size_t i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}

inline bool i2cWrite(uint8_t addr, uint8_t reg, const uint8_t *buf, size_t n) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(buf, n);
  return Wire.endTransmission() == 0;
}

inline bool i2cWrite(uint8_t addr, uint8_t reg, uint8_t val) { return i2cWrite(addr, reg, &val, 1); }
