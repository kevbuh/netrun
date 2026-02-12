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

# Common SSL context for urllib requests
def get_ssl_context():
    """Return an unverified SSL context for urllib requests."""
    return ssl._create_unverified_context()

# Common user agent for web requests
USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

def make_request(url, headers=None, data=None, method='GET'):
    """Make an HTTP request with standard headers and SSL context.

    Args:
        url: URL to request
        headers: Optional dict of headers (User-Agent added automatically)
        data: Optional request body (bytes)
        method: HTTP method (GET, POST, etc.)

    Returns:
        Response data as bytes
    """
    if headers is None:
        headers = {}
    if 'User-Agent' not in headers:
        headers['User-Agent'] = USER_AGENT

    req = urllib.request.Request(url, headers=headers, data=data, method=method)
    ctx = get_ssl_context()
    with urllib.request.urlopen(req, context=ctx, timeout=30) as response:
        return response.read()

def safe_json_response(data, status=200):
    """Return a JSON response, handling errors gracefully."""
    try:
        return jsonify(data), status
    except Exception as e:
        return jsonify({'error': str(e)}), 500
