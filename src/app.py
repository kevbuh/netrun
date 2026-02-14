#!/usr/bin/env python3
"""NetRun server — Flask-based."""
import argparse
import json
import os

# Load .env file (project root or src/) if present
def _load_dotenv():
    for candidate in [
        os.path.join(os.path.dirname(__file__), '..', '.env'),
        os.path.join(os.path.dirname(__file__), '.env'),
    ]:
        path = os.path.realpath(candidate)
        if os.path.isfile(path):
            with open(path) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#') or '=' not in line:
                        continue
                    key, _, value = line.partition('=')
                    key, value = key.strip(), value.strip()
                    # Strip surrounding quotes
                    if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                        value = value[1:-1]
                    os.environ.setdefault(key, value)
            break

_load_dotenv()

# Parse args before importing persistence so ARXIV_DATA_DIR is set
_parser = argparse.ArgumentParser(description='NetRun server')
_parser.add_argument('--port', type=int, default=8000, help='Port to listen on')
_parser.add_argument('--data-dir', default=None, help='Directory for user data (DB, experiments, etc.)')
_parser.add_argument('--static-dir', default=None, help='Directory for static files to serve')
_args = _parser.parse_args()

if _args.data_dir:
    os.environ['ARXIV_DATA_DIR'] = _args.data_dir

from flask import Flask, send_from_directory
from flask_cors import CORS
from flask_sock import Sock

from db import DIR
from logger import logger

# Uploads directory for profile pictures and backgrounds
UPLOADS_DIR = os.path.join(DIR, 'uploads')
os.makedirs(UPLOADS_DIR, exist_ok=True)

# Create Flask app
app = Flask(__name__, static_folder=None)
CORS(app)
sock = Sock(app)

_static_dir = _args.static_dir or DIR

# Register blueprints (auth, feed, content, media ported to TypeScript IPC)
from routes.experiments import bp as experiments_bp
from routes.social import bp as social_bp
from routes.browse import bp as browse_bp
from routes.vault import bp as vault_bp
from routes.neuralook import bp as neuralook_bp
from routes.dev import bp as dev_bp

app.register_blueprint(experiments_bp)
app.register_blueprint(social_bp)
app.register_blueprint(browse_bp)
app.register_blueprint(vault_bp)
app.register_blueprint(neuralook_bp)
app.register_blueprint(dev_bp)

# ── Start background feed poller ──
from feed_poller import start_poller
start_poller()


# ── WebSocket terminal ──

@sock.route('/ws/terminal')
def terminal_ws(ws):
    from flask import request as flask_request
    cwd = flask_request.args.get('cwd')
    if cwd and not os.path.isdir(cwd):
        cwd = None
    from terminal_server import handle_websocket_flask
    handle_websocket_flask(ws, cwd=cwd)


def _write_pcm_wav(pcm_bytes, sample_rate, wav_path):
    """Convert raw float32 PCM bytes → 16-bit WAV file (no ffmpeg, no numpy)."""
    import struct
    import array
    n_floats = len(pcm_bytes) // 4
    floats = struct.unpack(f'<{n_floats}f', pcm_bytes)
    int16s = array.array('h', (max(-32768, min(32767, int(s * 32767))) for s in floats))
    data_bytes = int16s.tobytes()
    with open(wav_path, 'wb') as f:
        # 44-byte WAV header
        f.write(b'RIFF')
        f.write(struct.pack('<I', 36 + len(data_bytes)))
        f.write(b'WAVE')
        f.write(b'fmt ')
        f.write(struct.pack('<IHHIIHH', 16, 1, 1, sample_rate, sample_rate * 2, 2, 16))
        f.write(b'data')
        f.write(struct.pack('<I', len(data_bytes)))
        f.write(data_bytes)


@sock.route('/ws/captions')
def captions_ws(ws):
    """Real-time closed captions: receive audio chunks, transcribe via whisper.cpp."""
    import subprocess
    import tempfile
    import uuid

    _NOISE_PATTERNS = {'[BLANK_AUDIO]', '[silence]', '[Music]', '[music]',
                       '[Applause]', '[applause]', '[Laughter]', '[laughter]',
                       '[ Silence ]', '(silence)', '...', '[MUSIC]',
                       '[NO SPEECH]', '[no speech]', '[inaudible]'}

    try:
        from pywhispercpp.model import Model as WhisperModel
        import routes.media as _media_mod
        if _media_mod._whisper_model is None:
            _media_mod._whisper_model = WhisperModel('tiny')
        model = _media_mod._whisper_model
    except Exception as e:
        ws.send(json.dumps({'error': f'Whisper init failed: {e}'}))
        return

    pcm_mode = False
    pcm_rate = 16000

    while True:
        try:
            data = ws.receive(timeout=30)
        except Exception:
            break
        if data is None:
            break

        # Detect format handshake (text JSON message)
        if isinstance(data, str):
            try:
                msg = json.loads(data)
                if msg.get('format') == 'f32pcm':
                    pcm_mode = True
                    pcm_rate = msg.get('rate', 16000)
            except (json.JSONDecodeError, AttributeError):
                pass
            continue

        uid = uuid.uuid4().hex
        tmp_wav = os.path.join(tempfile.gettempdir(), f'cc_{uid}.wav')
        try:
            if pcm_mode:
                # Raw float32 PCM → WAV (no ffmpeg)
                _write_pcm_wav(data, pcm_rate, tmp_wav)
            else:
                # Legacy: WebM → ffmpeg → WAV
                tmp_webm = os.path.join(tempfile.gettempdir(), f'cc_{uid}.webm')
                with open(tmp_webm, 'wb') as f:
                    f.write(data)
                result = subprocess.run(
                    ['ffmpeg', '-y', '-i', tmp_webm, '-ar', '16000', '-ac', '1', '-f', 'wav', tmp_wav],
                    capture_output=True, timeout=10)
                try:
                    os.remove(tmp_webm)
                except OSError:
                    pass
                if result.returncode != 0:
                    continue

            segments = model.transcribe(tmp_wav)
            text = ' '.join(seg.text.strip() for seg in segments).strip()
            if text and text not in _NOISE_PATTERNS:
                ws.send(json.dumps({'text': text}))
        except Exception:
            pass
        finally:
            try:
                os.remove(tmp_wav)
            except OSError:
                pass


# ── Static file serving ──

@app.route('/favicon.ico')
def favicon():
    favicon_path = os.path.join(_static_dir, 'favicon.png')
    if os.path.exists(favicon_path):
        return send_from_directory(_static_dir, 'favicon.png', mimetype='image/png')
    return '', 404


@app.route('/uploads/<path:filename>')
def serve_uploads(filename):
    return send_from_directory(UPLOADS_DIR, filename)


@app.route('/')
def index():
    return send_from_directory(_static_dir, 'index.html')


@app.route('/<path:path>')
def static_files(path):
    full_path = os.path.join(_static_dir, path)
    if os.path.isfile(full_path):
        return send_from_directory(_static_dir, path)
    # SPA fallback
    return send_from_directory(_static_dir, 'index.html')


if __name__ == '__main__':
    PORT = _args.port
    logger.info(f'Serving at http://localhost:{PORT}')
    app.run(host='0.0.0.0', port=PORT, threaded=True, debug=False)
