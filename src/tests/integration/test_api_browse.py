"""
Integration tests for browse API routes.

Tests remaining browse endpoints:
- GET /api/browse-proxy - Proxy web pages with rewritten links
"""

import pytest
from unittest.mock import patch, Mock

# Add src to path
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))


@pytest.mark.integration
class TestBrowseProxy:
    """Test /api/browse-proxy endpoint."""

    def test_browse_proxy_no_url(self, client):
        """Test proxy with no URL returns error."""
        response = client.get('/api/browse-proxy')

        assert response.status_code == 400
        data = response.json
        assert 'error' in data

    @patch('routes.browse.cached_fetch')
    def test_browse_proxy_success(self, mock_fetch, client):
        """Test successful page proxying."""
        mock_html = '<html><body><a href="/test">Link</a></body></html>'
        mock_fetch.return_value = mock_html.encode('utf-8')

        response = client.get('/api/browse-proxy?url=https://example.com')

        assert response.status_code == 200
        assert response.content_type.startswith('text/html')
        assert 'Access-Control-Allow-Origin' in response.headers

    @patch('routes.browse.cached_fetch')
    def test_browse_proxy_network_error(self, mock_fetch, client):
        """Test proxy handles network errors."""
        mock_fetch.side_effect = Exception('Network error')

        response = client.get('/api/browse-proxy?url=https://example.com')

        # Browse proxy wraps errors, may return 200 with error in HTML
        assert response.status_code in [200, 502]
