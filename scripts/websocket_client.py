"""Small RFC 6455 client for loopback-only integration tests (Python stdlib)."""
import base64
import hashlib
import json
import os
import socket
import struct
import time
from urllib.parse import urlsplit


class LocalWebSocket:
    def __init__(self, client, path):
        origin = urlsplit(client.origin)
        assert origin.hostname in {"127.0.0.1", "localhost"}, "Tests must remain local"
        self.socket = socket.create_connection((origin.hostname, origin.port), timeout=5)
        self.buffer = b""
        key = base64.b64encode(os.urandom(16)).decode()
        cookie = "; ".join(f"{k}={v}" for k, v in client.cookies.items())
        request = (
            f"GET {path} HTTP/1.1\r\nHost: {origin.netloc}\r\n"
            f"Origin: {client.origin}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nCookie: {cookie}\r\n\r\n"
        )
        self.socket.sendall(request.encode())
        while b"\r\n\r\n" not in self.buffer:
            part = self.socket.recv(4096)
            if not part:
                raise AssertionError("WebSocket handshake closed unexpectedly")
            self.buffer += part
            assert len(self.buffer) < 64000, "Oversized handshake"
        headers, self.buffer = self.buffer.split(b"\r\n\r\n", 1)
        assert b" 101 " in headers.split(b"\r\n", 1)[0], headers.split(b"\r\n", 1)[0].decode()
        expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).lower()
        assert b"sec-websocket-accept: " + expected in headers.lower()

    def _read(self, count):
        while len(self.buffer) < count:
            part = self.socket.recv(max(4096, count - len(self.buffer)))
            if not part:
                raise AssertionError("WebSocket closed without a close frame")
            self.buffer += part
        result, self.buffer = self.buffer[:count], self.buffer[count:]
        return result

    def _send(self, opcode, payload):
        mask = os.urandom(4)
        size = len(payload)
        header = bytes([0x80 | opcode])
        if size < 126:
            header += bytes([0x80 | size])
        elif size < 65536:
            header += bytes([0x80 | 126]) + struct.pack("!H", size)
        else:
            header += bytes([0x80 | 127]) + struct.pack("!Q", size)
        self.socket.sendall(header + mask + bytes(value ^ mask[index % 4] for index, value in enumerate(payload)))

    def send_json(self, value):
        self._send(1, json.dumps(value).encode())

    def receive(self, timeout=5):
        self.socket.settimeout(timeout)
        while True:
            first, second = self._read(2)
            assert first & 0x80, "Fragmented test messages are not supported"
            opcode = first & 0x0F
            size = second & 0x7F
            if size == 126:
                size = struct.unpack("!H", self._read(2))[0]
            elif size == 127:
                size = struct.unpack("!Q", self._read(8))[0]
            assert size <= 1_000_000, "Oversized frame"
            mask = self._read(4) if second & 0x80 else None
            payload = self._read(size)
            if mask:
                payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
            if opcode == 1:
                return json.loads(payload)
            if opcode == 8:
                return {"type": "closed", "code": struct.unpack("!H", payload[:2])[0] if len(payload) >= 2 else None}
            if opcode == 9:
                self._send(10, payload)

    def expect(self, message_type, timeout=6):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            value = self.receive(max(0.1, deadline - time.monotonic()))
            if value.get("type") == message_type:
                return value
            assert value.get("type") != "closed", f"Closed before {message_type}: {value}"
        raise AssertionError(f"Expected {message_type}")

    def expect_invalid(self):
        self.expect("session-invalid")
        closed = self.receive()
        assert closed == {"type": "closed", "code": 1008}, closed

    def close(self):
        try:
            self._send(8, struct.pack("!H", 1000))
        except OSError:
            pass
        self.socket.close()
