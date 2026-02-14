"""Media processing routes — ported to TypeScript IPC tool handlers."""
from flask import Blueprint

bp = Blueprint('media', __name__)

# Module-level state shared with app.py websocket handler
_whisper_model = None
_kokoro_pipeline = None

# All routes ported to src/core/tools/media/
