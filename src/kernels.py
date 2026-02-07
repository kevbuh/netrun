import os
import json
import re
import sys
import time
import subprocess
import threading


# Persistent Jupyter kernels: project_dir -> { "km": KernelManager, "kc": KernelClient, "lock": Lock }
_kernels = {}
_kernels_lock = threading.Lock()


def _get_kernel(project_dir):
    """Get or start a persistent Jupyter kernel for a project directory."""
    import jupyter_client
    from jupyter_client.kernelspec import KernelSpecManager
    with _kernels_lock:
        entry = _kernels.get(project_dir)
        if entry and entry['km'].is_alive():
            return entry
        # Check for venv python
        venv_python = os.path.join(project_dir, 'venv', 'bin', 'python')
        if os.path.isfile(venv_python):
            # Write a kernel spec pointing to the venv python
            spec_dir = os.path.join(project_dir, '.kernels', 'venv')
            os.makedirs(spec_dir, exist_ok=True)
            with open(os.path.join(spec_dir, 'kernel.json'), 'w') as f:
                json.dump({
                    'argv': [venv_python, '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
                    'display_name': 'Python (venv)',
                    'language': 'python'
                }, f)
            ksm = KernelSpecManager()
            ksm.kernel_dirs = [os.path.join(project_dir, '.kernels')]
            km = jupyter_client.KernelManager(kernel_name='venv', kernel_spec_manager=ksm)
        else:
            km = jupyter_client.KernelManager(kernel_name='python3')
        km.start_kernel(cwd=project_dir)
        kc = km.client()
        kc.start_channels()
        kc.wait_for_ready(timeout=30)
        entry = {'km': km, 'kc': kc, 'lock': threading.Lock()}
        _kernels[project_dir] = entry
        return entry


def _kill_kernel(project_dir):
    """Kill a kernel if it exists."""
    with _kernels_lock:
        entry = _kernels.pop(project_dir, None)
    if entry:
        try:
            entry['kc'].stop_channels()
        except Exception:
            pass
        try:
            entry['km'].shutdown_kernel(now=True)
        except Exception:
            pass


def _get_python_path(project_dir):
    """Get the python path for a project, defaulting to python3."""
    venv_python = os.path.join(project_dir, 'venv', 'bin', 'python')
    if os.path.isfile(venv_python):
        return venv_python
    return 'python3'


def _validate_package_names(packages_str):
    """Validate package names string to prevent shell injection."""
    if re.search(r'[;&|$`\\]', packages_str):
        return False
    return True


def _create_venv(project_dir):
    """Create a venv for a project, install ipykernel."""
    venv_dir = os.path.join(project_dir, 'venv')
    subprocess.run([sys.executable, '-m', 'venv', venv_dir], check=True)
    python_path = os.path.join(venv_dir, 'bin', 'python')
    subprocess.run([python_path, '-m', 'pip', 'install', '-q', 'ipykernel'], check=True)
    _kill_kernel(project_dir)
    return python_path


def _execute_code(project_dir, code):
    """Execute code in the Jupyter kernel, return rich outputs."""
    entry = _get_kernel(project_dir)
    with entry['lock']:
        kc = entry['kc']
        km = entry['km']

        if not km.is_alive():
            with _kernels_lock:
                _kernels.pop(project_dir, None)
            entry = _get_kernel(project_dir)
            kc = entry['kc']

        msg_id = kc.execute(code)

        outputs = []
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
                outputs.append({
                    'output_type': 'stream',
                    'name': content.get('name', 'stdout'),
                    'text': content.get('text', '')
                })
            elif msg_type in ('display_data', 'execute_result'):
                out = {
                    'output_type': msg_type,
                    'data': content.get('data', {}),
                    'metadata': content.get('metadata', {})
                }
                if msg_type == 'execute_result':
                    out['execution_count'] = content.get('execution_count')
                outputs.append(out)
            elif msg_type == 'error':
                outputs.append({
                    'output_type': 'error',
                    'ename': content.get('ename', ''),
                    'evalue': content.get('evalue', ''),
                    'traceback': content.get('traceback', [])
                })
            elif msg_type == 'status' and content.get('execution_state') == 'idle':
                break

        return outputs


def _execute_code_streaming(project_dir, code, wfile, is_connected):
    """Execute code and stream SSE events as outputs arrive."""
    entry = _get_kernel(project_dir)
    with entry['lock']:
        kc = entry['kc']
        km = entry['km']

        if not km.is_alive():
            with _kernels_lock:
                _kernels.pop(project_dir, None)
            entry = _get_kernel(project_dir)
            kc = entry['kc']

        msg_id = kc.execute(code)
        deadline = time.time() + 300

        while time.time() < deadline:
            if not is_connected():
                # Client disconnected — interrupt the kernel
                try:
                    km.interrupt_kernel()
                except Exception:
                    pass
                return

            try:
                msg = kc.get_iopub_msg(timeout=0.5)
            except Exception:
                continue

            if msg['parent_header'].get('msg_id') != msg_id:
                continue

            msg_type = msg['msg_type']
            content = msg['content']
            out = None

            if msg_type == 'stream':
                out = {
                    'output_type': 'stream',
                    'name': content.get('name', 'stdout'),
                    'text': content.get('text', '')
                }
            elif msg_type in ('display_data', 'execute_result'):
                out = {
                    'output_type': msg_type,
                    'data': content.get('data', {}),
                    'metadata': content.get('metadata', {})
                }
                if msg_type == 'execute_result':
                    out['execution_count'] = content.get('execution_count')
            elif msg_type == 'error':
                out = {
                    'output_type': 'error',
                    'ename': content.get('ename', ''),
                    'evalue': content.get('evalue', ''),
                    'traceback': content.get('traceback', [])
                }
            elif msg_type == 'status' and content.get('execution_state') == 'idle':
                try:
                    wfile.write(b'event: done\ndata: {}\n\n')
                    wfile.flush()
                except Exception:
                    pass
                return

            if out:
                try:
                    data = json.dumps(out)
                    wfile.write(f'event: output\ndata: {data}\n\n'.encode())
                    wfile.flush()
                except Exception:
                    return

        # Timed out
        try:
            wfile.write(b'event: done\ndata: {"timeout":true}\n\n')
            wfile.flush()
        except Exception:
            pass
