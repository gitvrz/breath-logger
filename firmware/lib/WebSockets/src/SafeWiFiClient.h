#pragma once
// Breath Logger patch (see ../PATCHED.md).
// WiFiClient::connected() of Arduino-ESP32 2.0.x decides from errno without clearing it
// first: an error left by ANOTHER connection (e.g. a screen that just closed) makes it
// report this healthy connection as lost, and the WebSocket server then closes it.
// This version asks the socket itself.
#include <WiFi.h>
#include <errno.h>
#include <lwip/sockets.h>

class SafeWiFiClient : public WiFiClient {
 public:
  SafeWiFiClient() = default;
  SafeWiFiClient(const WiFiClient &c) : WiFiClient(c) {}

  uint8_t connected() override {
    int fd = WiFiClient::fd();
    if (fd < 0) return 0;                        // stopped
    if (WiFiClient::available() > 0) return 1;   // data waiting
    uint8_t b;
    errno = 0;
    int r = recv(fd, &b, 1, MSG_PEEK | MSG_DONTWAIT);
    if (r > 0) return 1;
    if (r == 0) return 0;                        // closed by the other side
    return errno == EWOULDBLOCK || errno == EAGAIN;  // nothing to read yet: still open
  }
};
