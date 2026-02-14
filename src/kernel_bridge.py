#!/usr/bin/env python3
"""Kernel bridge — thin stdio wrapper around kernels.py for Electron IPC.

Reads JSON-line commands from stdin, writes JSON-line responses to stdout.
Commands:
  {"cmd": "execute", "project_dir": "...", "code": "..."}
  {"cmd": "restart", "project_dir": "..."}
  {"cmd": "interrupt", "project_dir": "..."}
  {"cmd": "kill", "project_dir": "..."}
  {"cmd": "shutdown"} — exit the bridge process
"""
import json
import sys
import os
import threading

# Ensure src/ is on sys.path so kernels.py can be imported
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from kernels import _get_kernel, _kill_kernel, _execute_code, _kernels, _kernels_lock


def _send(obj):
    """Write a JSON line to stdout."""
    sys.stdout.write(json.dumps(obj) + '\n')
    sys.stdout.flush()


def _handle_execute(project_dir, code, req_id):
    """Execute code and stream outputs back."""
    try:
        entry = _get_kernel(project_dir)
        with entry['lock']:
            kc = entry['kc']
            km = entry['km']

            if not km.is_alive():
                with _kernels_lock:
                    _kernels.pop(project_dir, None)
                entry = _get_kernel(project_dir)
                kc = entry['kc']

            import time
            msg_id = kc.execute(code)
            deadline = time.time() + 300

            while time.time() < deadline:
                try:
                    msg = kc.get_iopub_msg(timeout=1)
                except Exception:
                    continue

                if msg['parent_header'].get('msg_id') != msg_id:
                    continue

                msg_type = msg['msg_type']
                content = msg['content']

                if msg_type == 'stream':
                    _send({'id': req_id, 'event': 'output', 'data': {
                        'output_type': 'stream',
                        'name': content.get('name', 'stdout'),
                        'text': content.get('text', ''),
                    }})
                elif msg_type in ('display_data', 'execute_result'):
                    out = {
                        'output_type': msg_type,
                        'data': content.get('data', {}),
                        'metadata': content.get('metadata', {}),
                    }
                    if msg_type == 'execute_result':
                        out['execution_count'] = content.get('execution_count')
                    _send({'id': req_id, 'event': 'output', 'data': out})
                elif msg_type == 'error':
                    _send({'id': req_id, 'event': 'output', 'data': {
                        'output_type': 'error',
                        'ename': content.get('ename', ''),
                        'evalue': content.get('evalue', ''),
                        'traceback': content.get('traceback', []),
                    }})
                elif msg_type == 'status' and content.get('execution_state') == 'idle':
                    break

            _send({'id': req_id, 'event': 'done'})
    except Exception as e:
        _send({'id': req_id, 'event': 'error', 'error': str(e)})


def main():
    _send({'event': 'ready'})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue

        cmd = msg.get('cmd')
        req_id = msg.get('id', '')
        project_dir = msg.get('project_dir', '')

        if cmd == 'shutdown':
            # Kill all kernels and exit
            with _kernels_lock:
                dirs = list(_kernels.keys())
            for d in dirs:
                _kill_kernel(d)
            _send({'id': req_id, 'event': 'shutdown'})
            break

        elif cmd == 'execute':
            code = msg.get('code', '')
            # Run in a thread so we don't block the stdin loop
            t = threading.Thread(target=_handle_execute, args=(project_dir, code, req_id), daemon=True)
            t.start()

        elif cmd == 'restart':
            try:
                _kill_kernel(project_dir)
                _get_kernel(project_dir)
                _send({'id': req_id, 'event': 'done', 'data': {'ok': True}})
            except Exception as e:
                _send({'id': req_id, 'event': 'error', 'error': str(e)})

        elif cmd == 'interrupt':
            try:
                with _kernels_lock:
                    entry = _kernels.get(project_dir)
                if entry and entry['km'].is_alive():
                    entry['km'].interrupt_kernel()
                    _send({'id': req_id, 'event': 'done', 'data': {'ok': True}})
                else:
                    _send({'id': req_id, 'event': 'error', 'error': 'No running kernel'})
            except Exception as e:
                _send({'id': req_id, 'event': 'error', 'error': str(e)})

        elif cmd == 'kill':
            _kill_kernel(project_dir)
            _send({'id': req_id, 'event': 'done', 'data': {'ok': True}})

        else:
            _send({'id': req_id, 'event': 'error', 'error': f'Unknown command: {cmd}'})


if __name__ == '__main__':
    main()
