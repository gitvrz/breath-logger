#pragma once
// Parses one JSON command line from the PC and sends the reply (docs/protocol.md).
void commandsHandle(const char *line);
void sendStatus();
