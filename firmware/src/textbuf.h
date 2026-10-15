#pragma once
#include <math.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdio.h>

// Builds text in a fixed-size buffer and never writes past its end.
// If the text doesn't fit, it is cut and overflow() becomes true: the caller drops it.
class TextBuf {
 public:
  TextBuf(char *buf, size_t cap) : buf_(buf), cap_(cap) { clear(); }

  void clear() {
    len_ = 0;
    overflow_ = false;
    buf_[0] = 0;
  }

  void add(char c) {
    if (len_ + 1 < cap_) {
      buf_[len_++] = c;
      buf_[len_] = 0;
    } else {
      overflow_ = true;
    }
  }

  void add(const char *s) {
    while (*s) add(*s++);
  }

  void addf(const char *fmt, ...) {
    size_t room = cap_ - len_;
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(buf_ + len_, room, fmt, ap);
    va_end(ap);
    if (n < 0 || (size_t)n >= room) {
      overflow_ = true;
      len_ = cap_ - 1;
    } else {
      len_ += n;
    }
  }

  // Missing value (NAN) -> nanText ("" in the CSV, "null" in JSON)
  void num(double v, int decimals, const char *nanText) {
    if (isfinite(v)) addf("%.*f", decimals, v);
    else add(nanText);
  }

  const char *c_str() const { return buf_; }
  size_t len() const { return len_; }
  bool overflow() const { return overflow_; }

 private:
  char *buf_;
  size_t cap_;
  size_t len_;
  bool overflow_;
};
