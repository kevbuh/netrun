"""WebSocket terminal: pty bridge for flask-sock.

Called from app.py via @sock.route('/ws/terminal').
flask-sock handles all WebSocket framing — this module just bridges
ws.send/ws.receive to a pty subprocess.
"""
import json
import os
import pty
import select
import struct
import subprocess
import sys
import threading
import fcntl
import termios
import signal


def handle_websocket_flask(ws, cwd=None):
    """Bridge a flask-sock WebSocket to a pty shell."""
    print(f"[terminal] session started cwd={cwd}", file=sys.stderr, flush=True)

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
            cwd=cwd,
        )
    except Exception as e:
        print(f"[terminal] Popen failed: {e}", file=sys.stderr, flush=True)
        os.close(master_fd)
        os.close(slave_fd)
        return
    os.close(slave_fd)
    print(f"[terminal] shell pid={proc.pid}", file=sys.stderr, flush=True)

    running = True
    send_lock = threading.Lock()

    def pty_reader():
        """Read from pty master and send to WebSocket."""
        nonlocal running
        try:
            while running:
                try:
                    r, _, _ = select.select([master_fd], [], [], 0.5)
                except (ValueError, OSError):
                    break
                if not r:
                    continue
                try:
                    data = os.read(master_fd, 16384)
                except OSError:
                    break
                if not data:
                    break
                try:
                    with send_lock:
                        ws.send(data)
                except Exception:
                    break
        except Exception as e:
            print(f"[terminal] pty_reader ended: {e}", file=sys.stderr, flush=True)
        finally:
            running = False

    reader_thread = threading.Thread(target=pty_reader, daemon=True)
    reader_thread.start()

    try:
        while running:
            try:
                msg = ws.receive(timeout=1)
            except Exception:
                break
            if msg is None:
                continue  # timeout — not a disconnect
            if isinstance(msg, str):
                if msg.startswith('{"type":"resize"'):
                    try:
                        parsed = json.loads(msg)
                        cols = int(parsed.get("cols", 80))
                        rows = int(parsed.get("rows", 24))
                        winsize = struct.pack("HHHH", rows, cols, 0, 0)
                        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
                    except Exception:
                        pass
                else:
                    os.write(master_fd, msg.encode())
            elif isinstance(msg, bytes):
                os.write(master_fd, msg)
    except Exception as e:
        print(f"[terminal] session ended: {e}", file=sys.stderr, flush=True)
    finally:
        running = False
        try:
            os.close(master_fd)
        except OSError:
            pass
        try:
            os.kill(proc.pid, signal.SIGHUP)
        except Exception:
            pass
        proc.wait()
        reader_thread.join(timeout=2)
        print(f"[terminal] session cleaned up", file=sys.stderr, flush=True)
