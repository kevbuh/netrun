#!/usr/bin/env python3
"""Claude Remote — PTY WebSocket server for launching Claude Code from iPhone."""

import asyncio
import fcntl
import json
import os
import pty
import signal
import struct
import subprocess
import sys
import termios

from aiohttp import web

HOST = "0.0.0.0"
PORT = 8080
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))


# ── Folder browsing API ─────────────────────────────────────────────────────

async def handle_home(request):
    return web.json_response({"home": os.path.expanduser("~")})


async def handle_folders(request):
    path = request.query.get("path", os.path.expanduser("~"))
    path = os.path.expanduser(path)
    if not os.path.isdir(path):
        return web.json_response({"error": "Not a directory"}, status=400)
    entries = []
    try:
        for name in sorted(os.listdir(path)):
            if name.startswith("."):
                continue
            full = os.path.join(path, name)
            entries.append({
                "name": name,
                "path": full,
                "isDir": os.path.isdir(full),
            })
    except PermissionError:
        return web.json_response({"error": "Permission denied"}, status=403)
    return web.json_response({"path": path, "entries": entries})


# ── WebSocket PTY terminal ──────────────────────────────────────────────────

async def handle_terminal(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    master_fd = None
    child_pid = None

    try:
        # Wait for initial message with folder path
        msg = await ws.receive_json()
        folder = msg.get("folder", os.path.expanduser("~"))
        cols = msg.get("cols", 80)
        rows = msg.get("rows", 24)

        # Spawn PTY
        master_fd, slave_fd = pty.openpty()

        # Set initial terminal size
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(slave_fd, termios.TIOCSWINSZ, winsize)

        # Get user's shell
        shell = os.environ.get("SHELL", "/bin/zsh")

        # Spawn child process
        child_pid = os.fork()
        if child_pid == 0:
            # Child process
            os.close(master_fd)
            os.setsid()
            fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
            os.dup2(slave_fd, 0)
            os.dup2(slave_fd, 1)
            os.dup2(slave_fd, 2)
            if slave_fd > 2:
                os.close(slave_fd)
            os.chdir(folder)
            os.execvpe(shell, [shell, "-l", "-c", "claude"], os.environ)
            sys.exit(1)

        os.close(slave_fd)

        # Make master_fd non-blocking
        flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
        fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

        loop = asyncio.get_event_loop()

        # Read from PTY → send to WebSocket
        async def pty_reader():
            try:
                while True:
                    await asyncio.sleep(0.01)
                    try:
                        data = os.read(master_fd, 4096)
                        if not data:
                            break
                        await ws.send_str(data.decode("utf-8", errors="replace"))
                    except OSError:
                        # Check if child is still alive
                        try:
                            pid, status = os.waitpid(child_pid, os.WNOHANG)
                            if pid != 0:
                                break
                        except ChildProcessError:
                            break
            except Exception:
                pass

        reader_task = asyncio.ensure_future(pty_reader())

        # Read from WebSocket → write to PTY
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                    if data.get("type") == "resize":
                        winsize = struct.pack(
                            "HHHH", data["rows"], data["cols"], 0, 0
                        )
                        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
                        # Signal the child about the resize
                        os.kill(child_pid, signal.SIGWINCH)
                        continue
                except (json.JSONDecodeError, KeyError):
                    pass
                # Regular terminal input
                os.write(master_fd, msg.data.encode("utf-8"))
            elif msg.type in (web.WSMsgType.ERROR, web.WSMsgType.CLOSE):
                break

        reader_task.cancel()

    finally:
        if master_fd is not None:
            try:
                os.close(master_fd)
            except OSError:
                pass
        if child_pid and child_pid > 0:
            try:
                os.kill(child_pid, signal.SIGTERM)
                os.waitpid(child_pid, 0)
            except (OSError, ChildProcessError):
                pass
        if not ws.closed:
            await ws.close()

    return ws


# ── Static files & app setup ────────────────────────────────────────────────

async def handle_index(request):
    return web.FileResponse(os.path.join(STATIC_DIR, "index.html"))


def create_app():
    app = web.Application()
    app.router.add_get("/", handle_index)
    app.router.add_get("/api/home", handle_home)
    app.router.add_get("/api/folders", handle_folders)
    app.router.add_get("/ws/terminal", handle_terminal)
    # Serve static files (manifest.json, icons, etc.)
    app.router.add_static("/", STATIC_DIR, show_index=False)
    return app


if __name__ == "__main__":
    print(f"Starting Claude Remote on http://{HOST}:{PORT}")
    print(f"Connect from your iPhone: http://<your-mac-ip>:{PORT}")
    app = create_app()
    web.run_app(app, host=HOST, port=PORT)
