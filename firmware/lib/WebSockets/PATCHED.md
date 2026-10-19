# WebSockets library (patched copy)

Copy of [arduinoWebSockets](https://github.com/Links2004/arduinoWebSockets) 2.7.3 by
Markus Sattler, LGPL-2.1 (see LICENSE), with one fix for Breath Logger.

**Problem.** In Arduino-ESP32 2.0.x, `WiFiClient::connected()` decides whether a connection
is still open from `errno`, without clearing it first. An error left by another connection
(a screen that just disconnected, a phone checking for a captive portal) makes it report
healthy connections as lost, and the server closes them. Seen on the device: when one
screen disconnected, the next screen was disconnected too (`tools/wifitest.py`, step 3).

**Fix.** `src/SafeWiFiClient.h`: a `WiFiClient` whose `connected()` asks the socket itself
(peek one byte without waiting). `WebSocketsServer.cpp` creates its server-side connections
with it (`handleNewClients`, marked "Breath Logger patch"). Nothing else changed.
