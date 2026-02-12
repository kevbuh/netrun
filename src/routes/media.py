"""Media processing routes: transcription and text-to-speech."""
import os
import subprocess
import tempfile
import uuid

from flask import Blueprint, request, jsonify, send_file

from logger import logger
from helpers import require_auth

bp = Blueprint('media', __name__)

# Media processing state
_whisper_model = None
_kokoro_pipeline = None


@bp.route('/api/transcribe', methods=['POST'])
@require_auth
def transcribe(google_id):
    length = int(request.headers.get('Content-Length', 0))
    if length == 0:
        return jsonify({'error': 'No audio data'}), 400
    audio_data = request.get_data()
    try:
        from pywhispercpp.model import Model as WhisperModel
        global _whisper_model
        if _whisper_model is None:
            _whisper_model = WhisperModel('tiny')
        uid = uuid.uuid4().hex
        tmp_webm = os.path.join(tempfile.gettempdir(), f'whisper_{uid}.webm')
        tmp_wav = os.path.join(tempfile.gettempdir(), f'whisper_{uid}.wav')
        with open(tmp_webm, 'wb') as f:
            f.write(audio_data)
        subprocess.run(['ffmpeg', '-y', '-i', tmp_webm, '-ar', '16000', '-ac', '1', '-f', 'wav', tmp_wav],
                       capture_output=True, timeout=30)
        segments = _whisper_model.transcribe(tmp_wav)
        text = ' '.join(seg.text.strip() for seg in segments).strip()
        os.remove(tmp_webm)
        os.remove(tmp_wav)
        _NOISE = {'[BLANK_AUDIO]', '[silence]', '[Music]', '[music]',
                  '[Applause]', '[applause]', '[Laughter]', '[laughter]',
                  '[ Silence ]', '(silence)', '...', '[MUSIC]',
                  '[NO SPEECH]', '[no speech]', '[inaudible]'}
        if text in _NOISE:
            text = ''
        return jsonify({'text': text})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@bp.route('/api/tts', methods=['POST'])
@require_auth
def tts(google_id):
    body = request.get_json(force=True, silent=True) or {}
    text = (body.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'No text provided'}), 400
    voice = body.get('voice', 'af_heart')
    try:
        from kokoro import KPipeline
        global _kokoro_pipeline
        if _kokoro_pipeline is None:
            _kokoro_pipeline = KPipeline(lang_code='a')
        import soundfile as sf
        samples = []
        for _, _, audio in _kokoro_pipeline(text, voice=voice):
            samples.append(audio)
        if not samples:
            return jsonify({'error': 'No audio generated'}), 500
        import numpy as np
        combined = np.concatenate(samples)
        uid = uuid.uuid4().hex
        tmp_wav = os.path.join(tempfile.gettempdir(), f'tts_{uid}.wav')
        sf.write(tmp_wav, combined, 24000)
        resp = send_file(tmp_wav, mimetype='audio/wav')
        @resp.call_on_close
        def _cleanup():
            try: os.remove(tmp_wav)
            except: pass
        return resp
    except Exception as e:
        return jsonify({'error': str(e)}), 500
