"""Centralized logging utility for NetRun backend.

Provides structured logging with consistent formatting across all modules.
Similar to the frontend logger.js pattern.
"""
import sys
import os
from datetime import datetime


class Logger:
    """Simple logger with debug, info, warn, error levels."""

    def __init__(self, debug_enabled=None):
        """Initialize logger.

        Args:
            debug_enabled: If True, enables debug logs. If None, reads from DEBUG env var.
        """
        if debug_enabled is None:
            debug_enabled = os.environ.get('DEBUG', '').lower() in ('1', 'true', 'yes')
        self.debug_enabled = debug_enabled

    def _log(self, level, *args):
        """Internal log method."""
        timestamp = datetime.now().strftime('%H:%M:%S.%f')[:-3]
        message = ' '.join(str(arg) for arg in args)
        print(f"[{timestamp}] [{level}] {message}", file=sys.stderr, flush=True)

    def debug(self, *args):
        """Log debug message (only if debug enabled)."""
        if self.debug_enabled:
            self._log('DEBUG', *args)

    def info(self, *args):
        """Log info message."""
        self._log('INFO', *args)

    def warn(self, *args):
        """Log warning message."""
        self._log('WARN', *args)

    def error(self, *args):
        """Log error message."""
        self._log('ERROR', *args)


# Global logger instance
logger = Logger()


def enable_debug():
    """Enable debug logging."""
    logger.debug_enabled = True
    logger.info('Debug logging enabled')


def disable_debug():
    """Disable debug logging."""
    logger.debug_enabled = False
    logger.info('Debug logging disabled')
