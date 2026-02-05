"""WebSocket terminal: pty bridge via HTTP upgrade on the main server.

Called from server.py when a GET /ws/terminal with Upgrade: websocket arrives.
Hijacks the raw socket from the HTTP handler and runs a select loop bridging
the WebSocket and a pty subprocess.
"""
import base64
import hashlib
import json
import os
import pty
import select
import socket
import struct
import subprocess
import sys
import threading
import fcntl
import termios
import signal


WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

# Sockets hijacked for WebSocket — server.py checks this to skip shutdown_request
hijacked_sockets = set()


def _ws_send_raw(conn, data, opcode):
    """Build and send a WebSocket frame."""
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


def handle_websocket_upgrade_raw(handler):
    """Handle WebSocket upgrade at a lower level, before normal HTTP processing.

    Called from handle_one_request() BEFORE wfile.flush() is called.
    """
    try:
        key = handler.headers.get("Sec-WebSocket-Key", "").strip()
        print(f"[terminal] raw: key={key!r}", file=sys.stderr, flush=True)
        if not key:
            handler.send_error(400, "Missing Sec-WebSocket-Key")
            return

        accept = base64.b64encode(
            hashlib.sha1((key + WS_MAGIC).encode()).digest()
        ).decode()
        print(f"[terminal] raw: accept={accept!r}", file=sys.stderr, flush=True)

        conn = handler.request
        hijacked_sockets.add(id(conn))

        # Build response - MUST be exact RFC 6455 format
        response = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n"
            "\r\n"
        ).encode('ascii')

        print(f"[terminal] raw: sending {len(response)} bytes", file=sys.stderr, flush=True)

        # Send directly to socket
        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        conn.sendall(response)

        # Neuter the handler's finish() cleanup
        handler.wfile.close = lambda: None
        handler.rfile.close = lambda: None
        handler.close_connection = True

        print(f"[terminal] raw: starting terminal", file=sys.stderr, flush=True)
        _run_terminal(conn, handler.client_address, b"")

    except Exception as e:
        import traceback
        print(f"[terminal] raw: FAILED: {e}", file=sys.stderr, flush=True)
        traceback.print_exc(file=sys.stderr)


def handle_websocket_upgrade(handler):
    """Called from Handler.do_GET when path is /ws/terminal.

    Blocks this handler thread for the lifetime of the terminal session.
    """
    try:
        # Get raw key and check for encoding issues
        raw_key = handler.headers.get("Sec-WebSocket-Key", "")
        key = raw_key.strip()
        print(f"[terminal] raw_key={raw_key!r} len={len(raw_key)}", file=sys.stderr, flush=True)
        print(f"[terminal] key={key!r} len={len(key)}", file=sys.stderr, flush=True)
        print(f"[terminal] key bytes={key.encode()!r}", file=sys.stderr, flush=True)
        if not key:
            handler.send_error(400, "Missing Sec-WebSocket-Key")
            return

        # RFC 6455: accept = base64(sha1(key + GUID))
        accept = base64.b64encode(
            hashlib.sha1((key + WS_MAGIC).encode()).digest()
        ).decode()
        print(f"[terminal] accept={accept!r}", file=sys.stderr, flush=True)

        conn = handler.request

        # Verify socket consistency
        print(f"[terminal] handler.request={conn}", file=sys.stderr, flush=True)
        print(f"[terminal] handler.connection={handler.connection}", file=sys.stderr, flush=True)
        print(f"[terminal] same socket: {conn is handler.connection}", file=sys.stderr, flush=True)
        if hasattr(handler.wfile, 'raw'):
            print(f"[terminal] wfile.raw={handler.wfile.raw}", file=sys.stderr, flush=True)

        # Mark socket as hijacked BEFORE sending 101
        hijacked_sockets.add(id(conn))

        # Build the exact 101 response bytes (RFC 6455 compliant)
        response = (
            f"HTTP/1.1 101 Switching Protocols\r\n"
            f"Upgrade: websocket\r\n"
            f"Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n"
            f"Sec-WebSocket-Version: 13\r\n"
            f"\r\n"
        ).encode('ascii')

        print(f"[terminal] sending response: {response!r}", file=sys.stderr, flush=True)

        # Create a duplicate fd to have complete control
        dup_fd = os.dup(conn.fileno())
        dup_sock = socket.socket(fileno=dup_fd)
        dup_sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

        # Send via the duplicated socket
        dup_sock.sendall(response)
        print(f"[terminal] 101 sent via dup socket, {len(response)} bytes", file=sys.stderr, flush=True)

        # Close the duplicate (we'll use the original for the terminal)
        dup_sock.detach()  # detach so close doesn't close the underlying fd
        os.close(dup_fd)

        # Brief pause
        import time
        time.sleep(0.05)

        # Drain any leftover bytes from rfile buffer
        leftover = b""
        if hasattr(handler.rfile, 'peek'):
            peeked = handler.rfile.peek(65536)
            if peeked:
                leftover = handler.rfile.read(len(peeked))

        # Prevent handler.finish() from closing the socket
        handler.wfile.close = lambda: None
        handler.rfile.close = lambda: None
        handler.close_connection = True

        print(f"[terminal] upgrade done, leftover={len(leftover)}", file=sys.stderr, flush=True)

        # Block this thread — run terminal session
        _run_terminal(conn, handler.client_address, leftover)

    except Exception as e:
        import traceback
        print(f"[terminal] upgrade FAILED: {e}", file=sys.stderr, flush=True)
        traceback.print_exc(file=sys.stderr)


def _run_terminal(conn, addr, initial_data=b""):
    """Bridge a WebSocket connection to a pty shell."""
    print(f"[terminal] session started for {addr}", file=sys.stderr, flush=True)

    shell = os.environ.get("SHELL", "/bin/zsh")
    master_fd, slave_fd = pty.openpty()

    try:
        proc = subprocess.Popen(
            [shell, "-l"],
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            preexec_fn=os.setsid,
            env={**os.environ, "TERM": "xterm-256color"},
        )
    except Exception as e:
        print(f"[terminal] Popen failed: {e}", file=sys.stderr, flush=True)
        os.close(master_fd)
        os.close(slave_fd)
        conn.close()
        return
    os.close(slave_fd)
    print(f"[terminal] shell pid={proc.pid}", file=sys.stderr, flush=True)

    conn.setblocking(False)
    sock_fd = conn.fileno()
    ws_buf = bytearray(initial_data)

    def parse_frame():
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

    def send_ws(data, opcode):
        conn.setblocking(True)
        try:
            _ws_send_raw(conn, data, opcode)
        finally:
            conn.setblocking(False)

    def process_frames():
        while True:
            result = parse_frame()
            if result is None:
                return True
            opcode, payload = result
            if opcode == 0x08:
                return False
            if opcode == 0x09:
                try:
                    send_ws(payload, 0x0A)
                except Exception:
                    return False
                continue
            if opcode == 0x01:
                text = payload.decode(errors="replace")
                if text.startswith('{"type":"resize"'):
                    try:
                        msg = json.loads(text)
                        cols = int(msg.get("cols", 80))
                        rows = int(msg.get("rows", 24))
                        winsize = struct.pack("HHHH", rows, cols, 0, 0)
                        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
                    except Exception:
                        pass
                else:
                    os.write(master_fd, payload)
            elif opcode == 0x02:
                os.write(master_fd, payload)
        return True

    try:
        if ws_buf:
            if not process_frames():
                raise ConnectionError("close during initial frames")

        while True:
            try:
                readable, _, _ = select.select([master_fd, sock_fd], [], [], 1.0)
            except (ValueError, OSError) as e:
                print(f"[terminal] select error: {e}", file=sys.stderr, flush=True)
                break

            if master_fd in readable:
                try:
                    data = os.read(master_fd, 16384)
                except OSError:
                    break
                if not data:
                    break
                try:
                    send_ws(data, 0x02)
                except Exception:
                    break

            if sock_fd in readable:
                try:
                    chunk = conn.recv(65536)
                except (BlockingIOError, InterruptedError):
                    continue
                except OSError:
                    break
                if not chunk:
                    print("[terminal] ws EOF", file=sys.stderr, flush=True)
                    break
                ws_buf.extend(chunk)
                if not process_frames():
                    break
    except Exception as e:
        print(f"[terminal] session ended: {e}", file=sys.stderr, flush=True)
    finally:
        try:
            os.close(master_fd)
        except OSError:
            pass
        try:
            os.kill(proc.pid, signal.SIGHUP)
        except Exception:
            pass
        proc.wait()
        try:
            conn.close()
        except OSError:
            pass
        print(f"[terminal] {addr} cleaned up", file=sys.stderr, flush=True)
