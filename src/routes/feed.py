"""Feed routes — ported to TypeScript IPC handlers."""
from flask import Blueprint

bp = Blueprint('feed', __name__)
# All routes ported to src/core/ipc-handlers.ts
