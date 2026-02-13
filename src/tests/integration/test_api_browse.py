"""
Integration tests for browse API routes.

Tests all browse endpoints:
- GET /api/web-search - DuckDuckGo search
- GET /api/check-embed - Check if URL is embeddable
- GET /api/link-preview - Get OpenGraph metadata
- GET /api/browse-proxy - Proxy web pages with rewritten links
- GET /api/image-proxy - Proxy images with CORS headers
- GET /api/stock-quote - Get stock quote from Yahoo Finance
"""

import pytest
import json
from unittest.mock import patch, Mock

# Add src to path
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))


@pytest.mark.integration
class TestWebSearch:
    """Test /api/web-search endpoint."""

    def test_web_search_no_query(self, client):
        """Test search with no query returns empty results."""
        response = client.get('/api/web-search')

        assert response.status_code == 200
        data = response.json
        assert 'results' in data
        assert data['results'] == []

    def test_web_search_empty_query(self, client):
        """Test search with empty query returns empty results."""
        response = client.get('/api/web-search?q=')

        assert response.status_code == 200
        data = response.json
        assert data['results'] == []

    @patch('urllib.request.urlopen')
    def test_web_search_success(self, mock_urlopen, client):
        """Test successful web search."""
        # Mock DuckDuckGo response
        mock_html = '''
        <html>
            <a class="result__a" href="https://example.com">Example Result</a>
            <a class="result__snippet">This is a test snippet</a>
        </html>
        '''
        mock_response = Mock()
        mock_response.read.return_value = mock_html.encode('utf-8')
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.get('/api/web-search?q=test')

        assert response.status_code == 200
        data = response.json
        assert 'results' in data
        assert isinstance(data['results'], list)

    @patch('urllib.request.urlopen')
    def test_web_search_network_error(self, mock_urlopen, client):
        """Test search handles network errors gracefully."""
        mock_urlopen.side_effect = Exception('Network error')

        response = client.get('/api/web-search?q=test')

        assert response.status_code == 200
        data = response.json
        assert data['results'] == []
        assert 'error' in data


@pytest.mark.integration
class TestCheckEmbed:
    """Test /api/check-embed endpoint."""

    def test_check_embed_no_url(self, client):
        """Test check-embed with no URL."""
        response = client.get('/api/check-embed')

        assert response.status_code == 200
        data = response.json
        assert data['embeddable'] is False

    def test_check_embed_empty_url(self, client):
        """Test check-embed with empty URL."""
        response = client.get('/api/check-embed?url=')

        assert response.status_code == 200
        data = response.json
        assert data['embeddable'] is False

    @patch('urllib.request.urlopen')
    def test_check_embed_allowed(self, mock_urlopen, client):
        """Test URL without X-Frame-Options is embeddable."""
        mock_response = Mock()
        mock_response.headers = {}
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.get('/api/check-embed?url=https://example.com')

        assert response.status_code == 200
        data = response.json
        assert data['embeddable'] is True

    @patch('urllib.request.urlopen')
    def test_check_embed_blocked_xfo(self, mock_urlopen, client):
        """Test URL with X-Frame-Options is not embeddable."""
        mock_response = Mock()
        mock_response.headers = {'X-Frame-Options': 'DENY'}
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.get('/api/check-embed?url=https://example.com')

        assert response.status_code == 200
        data = response.json
        assert data['embeddable'] is False

    @patch('urllib.request.urlopen')
    def test_check_embed_blocked_csp(self, mock_urlopen, client):
        """Test URL with CSP frame-ancestors is not embeddable."""
        mock_response = Mock()
        mock_response.headers = {'Content-Security-Policy': "frame-ancestors 'none'"}
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.get('/api/check-embed?url=https://example.com')

        assert response.status_code == 200
        data = response.json
        assert data['embeddable'] is False

    @patch('urllib.request.urlopen')
    def test_check_embed_network_error(self, mock_urlopen, client):
        """Test check-embed handles network errors."""
        mock_urlopen.side_effect = Exception('Network error')

        response = client.get('/api/check-embed?url=https://example.com')

        assert response.status_code == 200
        data = response.json
        assert data['embeddable'] is False


@pytest.mark.integration
class TestLinkPreview:
    """Test /api/link-preview endpoint."""

    def test_link_preview_no_url(self, client):
        """Test preview with no URL returns error."""
        response = client.get('/api/link-preview')

        assert response.status_code == 400
        data = response.json
        assert 'error' in data

    def test_link_preview_empty_url(self, client):
        """Test preview with empty URL returns error."""
        response = client.get('/api/link-preview?url=')

        assert response.status_code == 400

    @patch('urllib.request.urlopen')
    def test_link_preview_success(self, mock_urlopen, client):
        """Test successful link preview."""
        mock_html = '''
        <html>
            <head>
                <title>Test Page</title>
                <meta property="og:title" content="Test Title">
                <meta property="og:description" content="Test description">
                <meta property="og:image" content="https://example.com/image.jpg">
                <meta property="og:site_name" content="Test Site">
            </head>
        </html>
        '''
        mock_response = Mock()
        mock_response.read.return_value = mock_html.encode('utf-8')
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.get('/api/link-preview?url=https://example.com')

        assert response.status_code == 200
        data = response.json
        assert data['title'] == 'Test Title'
        assert data['description'] == 'Test description'
        assert data['image'] == 'https://example.com/image.jpg'
        assert data['site'] == 'Test Site'
        assert 'domain' in data
        assert 'favicon' in data

    @patch('urllib.request.urlopen')
    def test_link_preview_fallback_title(self, mock_urlopen, client):
        """Test preview falls back to <title> tag."""
        mock_html = '<html><head><title>Fallback Title</title></head></html>'
        mock_response = Mock()
        mock_response.read.return_value = mock_html.encode('utf-8')
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.get('/api/link-preview?url=https://example.com')

        assert response.status_code == 200
        data = response.json
        assert data['title'] == 'Fallback Title'

    @patch('urllib.request.urlopen')
    def test_link_preview_relative_image(self, mock_urlopen, client):
        """Test preview resolves relative image URLs."""
        mock_html = '<meta property="og:image" content="/images/test.jpg">'
        mock_response = Mock()
        mock_response.read.return_value = mock_html.encode('utf-8')
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.get('/api/link-preview?url=https://example.com/page')

        assert response.status_code == 200
        data = response.json
        assert data['image'] == 'https://example.com/images/test.jpg'

    @patch('urllib.request.urlopen')
    def test_link_preview_network_error(self, mock_urlopen, client):
        """Test preview handles network errors."""
        mock_urlopen.side_effect = Exception('Network error')

        response = client.get('/api/link-preview?url=https://example.com')

        assert response.status_code == 200
        data = response.json
        assert 'error' in data


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


@pytest.mark.integration
class TestImageProxy:
    """Test /api/image-proxy endpoint."""

    def test_image_proxy_no_url(self, client):
        """Test image proxy with no URL returns error."""
        response = client.get('/api/image-proxy')

        assert response.status_code == 400
        data = response.json
        assert 'error' in data

    @patch('routes.browse.cached_fetch')
    def test_image_proxy_png(self, mock_fetch, client):
        """Test proxying PNG image."""
        mock_image = b'fake-png-data'
        mock_fetch.return_value = mock_image

        response = client.get('/api/image-proxy?url=https://example.com/image.png')

        assert response.status_code == 200
        assert response.content_type == 'image/png'
        assert 'Access-Control-Allow-Origin' in response.headers
        assert 'Cache-Control' in response.headers
        assert response.data == mock_image

    @patch('routes.browse.cached_fetch')
    def test_image_proxy_jpeg(self, mock_fetch, client):
        """Test proxying JPEG image."""
        mock_image = b'fake-jpeg-data'
        mock_fetch.return_value = mock_image

        response = client.get('/api/image-proxy?url=https://example.com/photo.jpg')

        assert response.status_code == 200
        assert response.content_type == 'image/jpeg'

    @patch('routes.browse.cached_fetch')
    def test_image_proxy_network_error(self, mock_fetch, client):
        """Test image proxy handles network errors."""
        mock_fetch.side_effect = Exception('Network error')

        response = client.get('/api/image-proxy?url=https://example.com/image.png')

        assert response.status_code == 502
        data = response.json
        assert 'error' in data


@pytest.mark.integration
class TestStockQuote:
    """Test /api/stock-quote endpoint."""

    def test_stock_quote_no_symbol(self, client):
        """Test stock quote with no symbol returns error."""
        response = client.get('/api/stock-quote')

        assert response.status_code == 400
        data = response.json
        assert 'error' in data

    def test_stock_quote_empty_symbol(self, client):
        """Test stock quote with empty symbol returns error."""
        response = client.get('/api/stock-quote?symbol=')

        assert response.status_code == 400

    @patch('urllib.request.urlopen')
    def test_stock_quote_success(self, mock_urlopen, client):
        """Test successful stock quote retrieval."""
        mock_data = {
            'chart': {
                'result': [{
                    'meta': {
                        'regularMarketPrice': 150.50,
                        'chartPreviousClose': 148.00,
                        'shortName': 'Example Corp'
                    }
                }]
            }
        }
        mock_response = Mock()
        mock_response.read.return_value = json.dumps(mock_data).encode('utf-8')
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.get('/api/stock-quote?symbol=EXMP')

        assert response.status_code == 200
        data = response.json
        assert data['price'] == 150.50
        assert data['change'] == 2.50
        assert abs(data['changePercent'] - 1.69) < 0.01
        assert data['name'] == 'Example Corp'

    @patch('urllib.request.urlopen')
    def test_stock_quote_network_error(self, mock_urlopen, client):
        """Test stock quote handles network errors."""
        mock_urlopen.side_effect = Exception('Network error')

        response = client.get('/api/stock-quote?symbol=EXMP')

        assert response.status_code == 502
        data = response.json
        assert 'error' in data

    @patch('urllib.request.urlopen')
    def test_stock_quote_invalid_symbol(self, mock_urlopen, client):
        """Test stock quote with invalid symbol."""
        mock_data = {'chart': {'result': [{}]}}
        mock_response = Mock()
        mock_response.read.return_value = json.dumps(mock_data).encode('utf-8')
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.get('/api/stock-quote?symbol=INVALID')

        assert response.status_code == 200
        data = response.json
        assert data['price'] == 0
        assert data['change'] == 0
