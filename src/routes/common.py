"""Shared imports and utilities for route modules."""

# Standard library imports used across most routes
import base64
import hashlib
import json
import os
import re
import shutil
import ssl
import subprocess
import tempfile
import time
import urllib.request
import uuid
from urllib.parse import unquote as url_unquote

# Flask imports
from flask import Blueprint, request, jsonify, Response, stream_with_context, send_file

# Re-export commonly used modules for convenience
# (ruff complains these are unused, but they're imported by other route modules)
urllib = urllib  # noqa: F401
os = os  # noqa: F401
json = json  # noqa: F401
re = re  # noqa: F401
shutil = shutil  # noqa: F401

# Common SSL context for urllib requests
def get_ssl_context():
    """Return an SSL context for urllib requests.

    By default, SSL verification is disabled for compatibility with
    self-signed certs and dev environments. Set NETRUN_VERIFY_SSL=1
    to enable full certificate verification.
    """
    if os.environ.get('NETRUN_VERIFY_SSL', '') == '1':
        return ssl.create_default_context()
    return ssl._create_unverified_context()

# Ollama API base URL
OLLAMA_HOST = os.environ.get('OLLAMA_HOST', 'http://localhost:11434')

# Common user agent for web requests
USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

