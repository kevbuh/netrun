"""WebSocket handler for neuralook neural gaze prediction.

Handles /ws/neuralook — trains GazeNet on calibration data and runs
real-time inference on eye crop frames.

Protocol:
  Client -> Server:
    Text frame: {"type":"train","samples":[...]}  -> triggers training
    Binary frame: 2048 bytes (left 1024 + right 1024) -> inference
  Server -> Client:
    Text frame: {"type":"trained","accuracy":..., ...}
    Binary frame: 8 bytes (2x float32 x,y)
"""
import base64
import hashlib
import json
import os
import socket
import struct
import sys
import threading
import time

WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

# Reuse the hijacked_sockets set from terminal_server
from terminal_server import hijacked_sockets


def _ws_send_raw(conn, data, opcode):
    """Build and send a WebSocket frame (same as terminal_server)."""
    frame = bytes([0x80 | opcode])
    length = len(data)
    if length < 126:
        frame += bytes([length])
    elif length < 65536:
        frame += bytes([126]) + struct.pack("!H", length)
    else:
        frame += bytes([127]) + struct.pack("!Q", length)
    frame += data
    conn.sendall(frame)


def _parse_frame(ws_buf):
    """Parse one WebSocket frame from buffer. Returns (opcode, payload) or None."""
    if len(ws_buf) < 2:
        return None
    opcode = ws_buf[0] & 0x0F
    masked = bool(ws_buf[1] & 0x80)
    length = ws_buf[1] & 0x7F
    offset = 2
    if length == 126:
        if len(ws_buf) < 4:
            return None
        length = struct.unpack("!H", bytes(ws_buf[2:4]))[0]
        offset = 4
    elif length == 127:
        if len(ws_buf) < 10:
            return None
        length = struct.unpack("!Q", bytes(ws_buf[2:10]))[0]
        offset = 10
    if masked:
        if len(ws_buf) < offset + 4:
            return None
        mask = bytes(ws_buf[offset:offset + 4])
        offset += 4
    else:
        mask = None
    total = offset + length
    if len(ws_buf) < total:
        return None
    payload = bytes(ws_buf[offset:total])
    if mask:
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    del ws_buf[:total]
    return (opcode, payload)


def handle_neuralook_ws(handler):
    """Handle WebSocket upgrade for /ws/neuralook, then run inference loop."""
    try:
        key = handler.headers.get("Sec-WebSocket-Key", "").strip()
        if not key:
            handler.send_error(400, "Missing Sec-WebSocket-Key")
            return

        accept = base64.b64encode(
            hashlib.sha1((key + WS_MAGIC).encode()).digest()
        ).decode()

        conn = handler.request
        hijacked_sockets.add(id(conn))

        response = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n"
            "\r\n"
        ).encode("ascii")

        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        conn.sendall(response)

        handler.wfile.close = lambda: None
        handler.rfile.close = lambda: None
        handler.close_connection = True

        print("[neuralook] WebSocket connected", file=sys.stderr, flush=True)
        _run_neuralook(conn)

    except Exception as e:
        import traceback
        print(f"[neuralook] upgrade FAILED: {e}", file=sys.stderr, flush=True)
        traceback.print_exc(file=sys.stderr)


def _run_neuralook(conn):
    """Main loop: receive eye crops -> predict gaze, or train on calibration data."""
    model = None

    # Try loading existing weights
    try:
        from neuralook_model import load_model
        model = load_model()
        if model:
            print("[neuralook] loaded existing model weights", file=sys.stderr, flush=True)
    except Exception as e:
        print(f"[neuralook] no existing model: {e}", file=sys.stderr, flush=True)

    ws_buf = bytearray()

    def send_text(obj):
        data = json.dumps(obj).encode("utf-8")
        conn.setblocking(True)
        try:
            _ws_send_raw(conn, data, 0x01)
        finally:
            conn.setblocking(False)

    def send_binary(data):
        conn.setblocking(True)
        try:
            _ws_send_raw(conn, data, 0x02)
        finally:
            conn.setblocking(False)

    conn.setblocking(False)

    try:
        while True:
            # Block until data available (with timeout for graceful shutdown)
            import select
            try:
                readable, _, _ = select.select([conn.fileno()], [], [], 1.0)
            except (ValueError, OSError):
                break

            if not readable:
                continue

            try:
                chunk = conn.recv(65536)
            except (BlockingIOError, InterruptedError):
                continue
            except OSError:
                break
            if not chunk:
                break

            ws_buf.extend(chunk)

            # Process all complete frames
            while True:
                result = _parse_frame(ws_buf)
                if result is None:
                    break
                opcode, payload = result

                if opcode == 0x08:
                    # Close frame
                    print("[neuralook] close frame received", file=sys.stderr, flush=True)
                    return

                if opcode == 0x09:
                    # Ping -> Pong
                    try:
                        conn.setblocking(True)
                        _ws_send_raw(conn, payload, 0x0A)
                        conn.setblocking(False)
                    except Exception:
                        return
                    continue

                if opcode == 0x01:
                    # Text frame — JSON message
                    try:
                        msg = json.loads(payload.decode("utf-8"))
                    except Exception:
                        continue

                    if msg.get("type") == "train":
                        # Train the model
                        samples = msg.get("samples", [])
                        print(f"[neuralook] training on {len(samples)} samples...",
                              file=sys.stderr, flush=True)
                        try:
                            from neuralook_model import train as train_model
                            model, info = train_model(samples)
                            print(f"[neuralook] training done: {info}",
                                  file=sys.stderr, flush=True)
                            send_text({"type": "trained", **info})
                        except Exception as e:
                            import traceback
                            traceback.print_exc(file=sys.stderr)
                            send_text({"type": "error", "msg": str(e)})

                    elif msg.get("type") == "status":
                        # Status check
                        has_model = model is not None
                        try:
                            from neuralook_model import HAS_TINYGRAD, _count_params
                            info = {
                                "type": "status",
                                "has_tinygrad": HAS_TINYGRAD,
                                "model_loaded": has_model,
                                "params": _count_params(model) if has_model else 0,
                            }
                        except Exception:
                            info = {"type": "status", "has_tinygrad": False,
                                    "model_loaded": False, "params": 0}
                        send_text(info)

                elif opcode == 0x02:
                    # Binary frame — eye crop inference
                    if len(payload) != 2048:
                        continue  # ignore malformed frames
                    if model is None:
                        continue  # no model trained yet, skip

                    left_patch = payload[:1024]
                    right_patch = payload[1024:]

                    try:
                        from neuralook_model import predict
                        x, y = predict(model, left_patch, right_patch)
                        # Pack as 2x float32 little-endian (8 bytes)
                        send_binary(struct.pack("<ff", x, y))
                    except Exception as e:
                        print(f"[neuralook] predict error: {e}",
                              file=sys.stderr, flush=True)

    except Exception as e:
        print(f"[neuralook] session error: {e}", file=sys.stderr, flush=True)
    finally:
        try:
            conn.close()
        except OSError:
            pass
        print("[neuralook] session closed", file=sys.stderr, flush=True)
