"""
Parakeet TDT transcription service — long-lived Python subprocess.
Communicates via JSON over stdin/stdout (one JSON object per line).

Commands:
  {"cmd": "transcribe", "id": "...", "path": "/path/to/audio.wav"}
  {"cmd": "transcribe_pcm", "id": "...", "pcm_base64": "...", "sample_rate": 16000}
  {"cmd": "shutdown", "id": "..."}

Responses:
  {"id": "...", "event": "ready"}
  {"id": "...", "event": "done", "data": {"text": "...", "segments": [...]}}
  {"id": "...", "event": "error", "error": "..."}
"""

import sys
import json
import base64
import contextlib
import struct
import tempfile
import os


def write_pcm_wav(pcm_bytes: bytes, sample_rate: int, wav_path: str) -> None:
    """Convert raw float32 PCM bytes to a 16-bit WAV file."""
    n_floats = len(pcm_bytes) // 4
    int16_samples = bytearray(n_floats * 2)
    for i in range(n_floats):
        f = struct.unpack_from('<f', pcm_bytes, i * 4)[0]
        clamped = max(-32768, min(32767, round(f * 32767)))
        struct.pack_into('<h', int16_samples, i * 2, clamped)

    data_len = len(int16_samples)
    header = bytearray(44)
    header[0:4] = b'RIFF'
    struct.pack_into('<I', header, 4, 36 + data_len)
    header[8:12] = b'WAVE'
    header[12:16] = b'fmt '
    struct.pack_into('<I', header, 16, 16)       # fmt chunk size
    struct.pack_into('<H', header, 20, 1)        # PCM format
    struct.pack_into('<H', header, 22, 1)        # mono
    struct.pack_into('<I', header, 24, sample_rate)
    struct.pack_into('<I', header, 28, sample_rate * 2)  # byte rate
    struct.pack_into('<H', header, 32, 2)        # block align
    struct.pack_into('<H', header, 34, 16)       # bits per sample
    header[36:40] = b'data'
    struct.pack_into('<I', header, 40, data_len)

    with open(wav_path, 'wb') as f:
        f.write(bytes(header) + bytes(int16_samples))


def send(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj) + '\n')
    sys.stdout.flush()


def ensure_model_dir() -> str:
    """Download model to a local dir (no symlinks) to avoid onnxruntime external data issues."""
    from huggingface_hub import snapshot_download
    local_dir = os.path.join(os.path.expanduser("~"), ".cache", "netrun", "parakeet-tdt-0.6b-v2")
    if os.path.exists(os.path.join(local_dir, "encoder-model.onnx")):
        return local_dir
    snapshot_download(
        repo_id="istupakov/parakeet-tdt-0.6b-v2-onnx",
        local_dir=local_dir,
    )
    return local_dir


def main() -> None:
    # Load model at startup
    try:
        import onnx_asr
        model_dir = ensure_model_dir()
        model = onnx_asr.load_model(
            "nemo-parakeet-tdt-0.6b-v2",
            path=model_dir,
            providers=["CPUExecutionProvider"],
        )
    except Exception as e:
        send({"event": "error", "error": f"Failed to load model: {e}"})
        sys.exit(1)

    send({"event": "ready"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue

        cmd = msg.get("cmd")
        req_id = msg.get("id", "")

        if cmd == "shutdown":
            send({"id": req_id, "event": "done", "data": {"ok": True}})
            break

        if cmd == "transcribe":
            audio_path = msg.get("path", "")
            try:
                text = model.recognize(audio_path)
                send({"id": req_id, "event": "done", "data": {"text": str(text)}})
            except Exception as e:
                send({"id": req_id, "event": "error", "error": str(e)})

        elif cmd == "transcribe_pcm":
            pcm_b64 = msg.get("pcm_base64", "")
            sample_rate = msg.get("sample_rate", 16000)
            tmp_path = None
            try:
                pcm_bytes = base64.b64decode(pcm_b64)
                fd, tmp_path = tempfile.mkstemp(suffix=".wav")
                os.close(fd)
                write_pcm_wav(pcm_bytes, sample_rate, tmp_path)
                text = model.recognize(tmp_path)
                send({"id": req_id, "event": "done", "data": {"text": str(text)}})
            except Exception as e:
                send({"id": req_id, "event": "error", "error": str(e)})
            finally:
                if tmp_path and os.path.exists(tmp_path):
                    with contextlib.suppress(OSError):
                        os.unlink(tmp_path)

        else:
            send({"id": req_id, "event": "error", "error": f"Unknown command: {cmd}"})


if __name__ == "__main__":
    main()
