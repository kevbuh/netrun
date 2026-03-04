"""
notebook-kernel.py — Long-lived subprocess managing Jupyter kernels via jupyter_client.

Protocol: stdin/stdout, one JSON object per line.

Commands (stdin):
  {"cmd": "start", "id": "sess1"}
  {"cmd": "execute", "id": "sess1", "code": "...", "cell_id": "abc"}
  {"cmd": "interrupt", "id": "sess1"}
  {"cmd": "restart", "id": "sess1"}
  {"cmd": "shutdown", "id": "sess1"}
  {"cmd": "complete", "id": "sess1", "code": "np.", "cursor": 3}

Events (stdout):
  {"event": "kernel_ready", "id": "sess1"}
  {"event": "status", "id": "sess1", "state": "busy"|"idle"}
  {"event": "stream", "id": "sess1", "cell_id": "abc", "name": "stdout", "text": "..."}
  {"event": "execute_result", ...}
  {"event": "display_data", ...}
  {"event": "error", ...}
  {"event": "execute_complete", ...}
  {"event": "complete_reply", ...}
"""

import sys
import json
import contextlib
import threading
import traceback

try:
    import jupyter_client
except ImportError:
    sys.stderr.write("jupyter_client not installed\n")
    sys.exit(1)


def emit(obj):
    """Write a JSON event to stdout."""
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def emit_error_event(session_id, msg):
    emit({"event": "error", "id": session_id, "cell_id": None,
          "ename": "KernelError", "evalue": msg, "traceback": []})


class KernelSession:
    def __init__(self, session_id):
        self.session_id = session_id
        self.km = jupyter_client.KernelManager()
        self.km.start_kernel()
        self.kc = self.km.client()
        self.kc.start_channels()
        self.kc.wait_for_ready(timeout=30)
        self._running = True
        self._iopub_thread = threading.Thread(target=self._poll_iopub, daemon=True)
        self._iopub_thread.start()

    def _poll_iopub(self):
        """Poll iopub channel for streaming output messages."""
        while self._running:
            try:
                msg = self.kc.get_iopub_msg(timeout=0.5)
            except Exception:
                continue
            msg_type = msg.get("msg_type", "")
            content = msg.get("content", {})
            parent = msg.get("parent_header", {})
            cell_id = parent.get("msg_id", "")

            if msg_type == "status":
                state = content.get("execution_state", "idle")
                emit({"event": "status", "id": self.session_id, "state": state})

            elif msg_type == "stream":
                emit({
                    "event": "stream",
                    "id": self.session_id,
                    "cell_id": cell_id,
                    "name": content.get("name", "stdout"),
                    "text": content.get("text", "")
                })

            elif msg_type == "execute_result":
                emit({
                    "event": "execute_result",
                    "id": self.session_id,
                    "cell_id": cell_id,
                    "data": content.get("data", {}),
                    "execution_count": content.get("execution_count")
                })

            elif msg_type == "display_data":
                emit({
                    "event": "display_data",
                    "id": self.session_id,
                    "cell_id": cell_id,
                    "data": content.get("data", {})
                })

            elif msg_type == "error":
                emit({
                    "event": "error",
                    "id": self.session_id,
                    "cell_id": cell_id,
                    "ename": content.get("ename", ""),
                    "evalue": content.get("evalue", ""),
                    "traceback": content.get("traceback", [])
                })

            elif msg_type == "execute_reply":
                emit({
                    "event": "execute_complete",
                    "id": self.session_id,
                    "cell_id": cell_id,
                    "execution_count": content.get("execution_count")
                })

    def execute(self, code, cell_id):
        """Execute code, using cell_id as the msg_id for correlation."""
        self.kc.execute(code, reply=False)
        # The msg_id from execute() goes into parent_header of replies,
        # but we need our cell_id. We'll use the last shell msg_id mapping.
        # Actually, jupyter_client.execute returns the msg_id, we send it as cell_id
        # The iopub thread will pick up outputs with parent_header.msg_id

    def execute_with_id(self, code, cell_id):
        """Execute code and map the msg_id to our cell_id."""
        msg_id = self.kc.execute(code, reply=False)
        # Store mapping so iopub thread can use our cell_id
        if not hasattr(self, '_msg_id_map'):
            self._msg_id_map = {}
        self._msg_id_map[msg_id] = cell_id

    def interrupt(self):
        self.km.interrupt_kernel()

    def restart(self):
        self.km.restart_kernel()
        self.kc = self.km.client()
        self.kc.start_channels()
        self.kc.wait_for_ready(timeout=30)

    def shutdown(self):
        self._running = False
        with contextlib.suppress(Exception):
            self.kc.stop_channels()
        with contextlib.suppress(Exception):
            self.km.shutdown_kernel(now=True)

    def complete(self, code, cursor_pos):
        self.kc.complete(code, cursor_pos)
        try:
            reply = self.kc.get_shell_msg(timeout=5)
            content = reply.get("content", {})
            return content.get("matches", [])
        except Exception:
            return []


class KernelSessionWithMapping(KernelSession):
    """Extended session that maps msg_ids to cell_ids in iopub output."""

    def __init__(self, session_id):
        self._msg_id_map = {}
        super().__init__(session_id)

    def execute_with_id(self, code, cell_id):
        msg_id = self.kc.execute(code, reply=False)
        self._msg_id_map[msg_id] = cell_id

    def _poll_iopub(self):
        while self._running:
            try:
                msg = self.kc.get_iopub_msg(timeout=0.5)
            except Exception:
                continue
            msg_type = msg.get("msg_type", "")
            content = msg.get("content", {})
            parent = msg.get("parent_header", {})
            msg_id = parent.get("msg_id", "")
            cell_id = self._msg_id_map.get(msg_id, msg_id)

            if msg_type == "status":
                state = content.get("execution_state", "idle")
                emit({"event": "status", "id": self.session_id, "state": state})

            elif msg_type == "stream":
                emit({
                    "event": "stream",
                    "id": self.session_id,
                    "cell_id": cell_id,
                    "name": content.get("name", "stdout"),
                    "text": content.get("text", "")
                })

            elif msg_type == "execute_result":
                emit({
                    "event": "execute_result",
                    "id": self.session_id,
                    "cell_id": cell_id,
                    "data": content.get("data", {}),
                    "execution_count": content.get("execution_count")
                })

            elif msg_type == "display_data":
                emit({
                    "event": "display_data",
                    "id": self.session_id,
                    "cell_id": cell_id,
                    "data": content.get("data", {})
                })

            elif msg_type == "error":
                emit({
                    "event": "error",
                    "id": self.session_id,
                    "cell_id": cell_id,
                    "ename": content.get("ename", ""),
                    "evalue": content.get("evalue", ""),
                    "traceback": content.get("traceback", [])
                })

            elif msg_type == "execute_reply":
                emit({
                    "event": "execute_complete",
                    "id": self.session_id,
                    "cell_id": cell_id,
                    "execution_count": content.get("execution_count")
                })


# ── Session registry ─────────────────────────────────────────────────
sessions = {}


def handle_command(cmd_obj):
    cmd = cmd_obj.get("cmd", "")
    session_id = cmd_obj.get("id", "")

    if cmd == "start":
        if session_id in sessions:
            emit({"event": "kernel_ready", "id": session_id})
            return
        try:
            session = KernelSessionWithMapping(session_id)
            sessions[session_id] = session
            emit({"event": "kernel_ready", "id": session_id})
        except Exception as e:
            emit_error_event(session_id, f"Failed to start kernel: {e}")

    elif cmd == "execute":
        session = sessions.get(session_id)
        if not session:
            emit_error_event(session_id, "No kernel session")
            return
        code = cmd_obj.get("code", "")
        cell_id = cmd_obj.get("cell_id", "")
        try:
            session.execute_with_id(code, cell_id)
        except Exception as e:
            emit_error_event(session_id, f"Execute failed: {e}")

    elif cmd == "interrupt":
        session = sessions.get(session_id)
        if session:
            try:
                session.interrupt()
            except Exception as e:
                emit_error_event(session_id, f"Interrupt failed: {e}")

    elif cmd == "restart":
        session = sessions.get(session_id)
        if session:
            try:
                session.restart()
                emit({"event": "kernel_ready", "id": session_id})
            except Exception as e:
                emit_error_event(session_id, f"Restart failed: {e}")

    elif cmd == "shutdown":
        session = sessions.pop(session_id, None)
        if session:
            session.shutdown()
        emit({"event": "status", "id": session_id, "state": "disconnected"})

    elif cmd == "complete":
        session = sessions.get(session_id)
        if not session:
            emit({"event": "complete_reply", "id": session_id, "matches": []})
            return
        code = cmd_obj.get("code", "")
        cursor = cmd_obj.get("cursor", len(code))
        matches = session.complete(code, cursor)
        emit({"event": "complete_reply", "id": session_id, "matches": matches})

    else:
        emit_error_event(session_id, f"Unknown command: {cmd}")


# ── Main loop ────────────────────────────────────────────────────────
if __name__ == "__main__":
    sys.stderr.write("notebook-kernel.py started\n")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd_obj = json.loads(line)
            handle_command(cmd_obj)
        except json.JSONDecodeError as e:
            sys.stderr.write(f"Invalid JSON: {e}\n")
        except Exception as e:
            sys.stderr.write(f"Error: {e}\n{traceback.format_exc()}")
    # Cleanup on stdin close
    for _sid, session in list(sessions.items()):
        session.shutdown()
