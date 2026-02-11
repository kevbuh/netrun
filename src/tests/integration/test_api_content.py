"""
Integration tests for content API routes.

Tests content endpoints:
- POST /api/extract-text
- POST /api/extract-links
- GET /api/panel-suggest
- GET /api/search-suggest
- POST /api/annotate
- POST /api/semantic-search
- POST /api/find-similar
"""

import pytest
import json
from unittest.mock import patch, Mock

# Add src to path
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))


@pytest.mark.integration
class TestExtractText:
    """Test /api/extract-text endpoint."""

    def test_extract_text_no_url(self, client):
        """Test extract text without URL."""
        response = client.post('/api/extract-text', json={})

        assert response.status_code == 400
        assert 'url required' in response.json['error']

    @patch('urllib.request.urlopen')
    def test_extract_text_html_success(self, mock_urlopen, client):
        """Test extracting text from HTML page."""
        # Mock HTML response
        sample_html = b'''
        <html>
            <head><title>Test Page</title></head>
            <body>
                <h1>Test Article</h1>
                <p>This is the first paragraph.</p>
                <p>This is the second paragraph.</p>
                <script>console.log('ignore me');</script>
            </body>
        </html>
        '''

        mock_response = Mock()
        mock_response.read.return_value = sample_html
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.post('/api/extract-text', json={
            'url': 'https://example.com/article'
        })

        assert response.status_code == 200
        data = response.json
        assert 'text' in data
        assert 'pages' in data
        assert 'Test Article' in data['text']
        assert 'first paragraph' in data['text']
        assert 'console.log' not in data['text']  # Script content excluded
        assert data['pages'] == 1

    @patch('urllib.request.urlopen')
    def test_extract_text_arxiv_pdf(self, mock_urlopen, client):
        """Test extracting text from arXiv PDF (requires PyMuPDF)."""
        # Skip if PyMuPDF not available
        try:
            import fitz
        except ImportError:
            pytest.skip("PyMuPDF not installed")

        # For arXiv URLs, this would fetch PDF and extract text
        # We'll just verify the endpoint tries to handle it
        mock_urlopen.side_effect = Exception('Mock PDF fetch')

        response = client.post('/api/extract-text', json={
            'url': 'https://arxiv.org/abs/2301.12345'
        })

        # Should fail gracefully
        assert response.status_code == 502

    @patch('routes.content._extract_cache', {})  # Clear cache
    @patch('routes.content.cached_fetch')
    def test_extract_text_fetch_error(self, mock_cached_fetch, client):
        """Test extract text when URL fetch fails."""
        mock_cached_fetch.side_effect = Exception('Network error')

        response = client.post('/api/extract-text', json={
            'url': 'https://example.com/article'
        })

        assert response.status_code == 502


@pytest.mark.integration
class TestExtractLinks:
    """Test /api/extract-links endpoint."""

    def test_extract_links_no_url(self, client):
        """Test extract links without URL."""
        response = client.post('/api/extract-links', json={})

        assert response.status_code == 400
        assert 'url required' in response.json['error']

    @patch('routes.content.cached_fetch')
    def test_extract_links_success(self, mock_cached_fetch, client):
        """Test extracting links from HTML page."""
        sample_html = b'''
        <html>
            <body>
                <a href="https://example.com/page1">First Link</a>
                <a href="/page2">Relative Link</a>
                <a href="https://example.com/page3">Third Link</a>
                <a href="https://example.com/page1">Duplicate Link</a>
            </body>
        </html>
        '''

        mock_cached_fetch.return_value = sample_html

        response = client.post('/api/extract-links', json={
            'url': 'https://example.com/article'
        })

        assert response.status_code == 200
        data = response.json
        assert 'links' in data
        links = data['links']
        assert len(links) >= 2  # Should have at least 2 unique links
        # Should have text and url for each link
        for link in links:
            assert 'text' in link
            assert 'url' in link

    @patch('routes.content.cached_fetch')
    def test_extract_links_no_links(self, mock_cached_fetch, client):
        """Test extracting links from page with no links."""
        sample_html = b'''
        <html>
            <body>
                <p>No links here, just text.</p>
            </body>
        </html>
        '''

        mock_cached_fetch.return_value = sample_html

        response = client.post('/api/extract-links', json={
            'url': 'https://example.com/article'
        })

        assert response.status_code == 200
        data = response.json
        assert 'links' in data
        assert len(data['links']) == 0

    @patch('routes.content.cached_fetch')
    def test_extract_links_fetch_error(self, mock_cached_fetch, client):
        """Test extract links when URL fetch fails."""
        mock_cached_fetch.side_effect = Exception('Network error')

        response = client.post('/api/extract-links', json={
            'url': 'https://example.com/article'
        })

        assert response.status_code == 502


@pytest.mark.integration
class TestPanelSuggest:
    """Test /api/panel-suggest endpoint."""

    def test_panel_suggest_no_text(self, client):
        """Test panel suggest without text."""
        response = client.post('/api/panel-suggest', json={})

        assert response.status_code == 200
        assert response.json['suggestion'] == ''

    def test_panel_suggest_text_too_short(self, client):
        """Test panel suggest with very short text."""
        response = client.post('/api/panel-suggest', json={
            'text': 'Hi'
        })

        assert response.status_code == 200
        assert response.json['suggestion'] == ''

    @patch('urllib.request.urlopen')
    def test_panel_suggest_success(self, mock_urlopen, client):
        """Test panel suggest generates suggestion."""
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            'message': {'content': 'What are the key findings?'},
            'done': True
        }).encode()
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.post('/api/panel-suggest', json={
            'text': 'This paper presents a novel approach to deep learning using transformers.'
        })

        assert response.status_code == 200
        data = response.json
        assert 'suggestion' in data
        assert len(data['suggestion']) > 0

    @patch('urllib.request.urlopen')
    def test_panel_suggest_ollama_error(self, mock_urlopen, client):
        """Test panel suggest when Ollama fails (should return empty)."""
        mock_urlopen.side_effect = Exception('Connection refused')

        response = client.post('/api/panel-suggest', json={
            'text': 'Some text to analyze'
        })

        assert response.status_code == 200
        assert response.json['suggestion'] == ''

    @patch('urllib.request.urlopen')
    def test_panel_suggest_truncates_long_suggestions(self, mock_urlopen, client):
        """Test that very long suggestions are truncated."""
        long_suggestion = 'x' * 200  # Very long suggestion

        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            'message': {'content': long_suggestion},
            'done': True
        }).encode()
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.post('/api/panel-suggest', json={
            'text': 'Some text'
        })

        assert response.status_code == 200
        suggestion = response.json['suggestion']
        assert len(suggestion) <= 80  # Should be truncated


@pytest.mark.integration
class TestSearchSuggest:
    """Test /api/search-suggest endpoint."""

    def test_search_suggest_no_query(self, client):
        """Test search suggest without query."""
        response = client.post('/api/search-suggest', json={})

        assert response.status_code == 200
        assert response.json['suggestions'] == []

    def test_search_suggest_query_too_short(self, client):
        """Test search suggest with very short query."""
        response = client.post('/api/search-suggest', json={
            'query': 'a'
        })

        assert response.status_code == 200
        assert response.json['suggestions'] == []

    @patch('urllib.request.urlopen')
    def test_search_suggest_success(self, mock_urlopen, client):
        """Test search suggest returns suggestions."""
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            'message': {
                'content': json.dumps([
                    'machine learning basics',
                    'machine learning tutorial',
                    'machine learning algorithms',
                    'machine learning python'
                ])
            },
            'done': True
        }).encode()
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.post('/api/search-suggest', json={
            'query': 'machine learning'
        })

        assert response.status_code == 200
        data = response.json
        assert 'suggestions' in data
        suggestions = data['suggestions']
        assert isinstance(suggestions, list)
        assert len(suggestions) <= 4  # Max 4 suggestions

    @patch('urllib.request.urlopen')
    def test_search_suggest_ollama_error(self, mock_urlopen, client):
        """Test search suggest when Ollama fails (should return empty)."""
        mock_urlopen.side_effect = Exception('Connection refused')

        response = client.post('/api/search-suggest', json={
            'query': 'test query'
        })

        assert response.status_code == 200
        assert response.json['suggestions'] == []

    @patch('urllib.request.urlopen')
    def test_search_suggest_invalid_json(self, mock_urlopen, client):
        """Test search suggest with invalid JSON response."""
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            'message': {'content': 'not a json array'},
            'done': True
        }).encode()
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.post('/api/search-suggest', json={
            'query': 'test query'
        })

        assert response.status_code == 200
        assert response.json['suggestions'] == []


@pytest.mark.integration
class TestAnnotate:
    """Test /api/annotate endpoint."""

    def test_annotate_no_text(self, client):
        """Test annotate without text."""
        response = client.post('/api/annotate', json={})

        assert response.status_code == 400
        assert 'text required' in response.json['error']

    @patch('urllib.request.urlopen')
    def test_annotate_success(self, mock_urlopen, client):
        """Test annotating page text."""
        # Mock LLM response with annotations
        annotations_json = json.dumps([
            {
                'type': 'KEY_FINDING',
                'quote': 'Our method achieves 95% accuracy',
                'explanation': 'Strong performance result'
            },
            {
                'type': 'VERIFY',
                'quote': 'This is the best approach ever',
                'explanation': 'Strong claim needs verification'
            }
        ])

        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            'message': {'content': annotations_json},
            'done': True
        }).encode()
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.post('/api/annotate', json={
            'text': 'Our method achieves 95% accuracy on the benchmark. This is the best approach ever.',
            'url': 'https://example.com/article'
        })

        assert response.status_code == 200
        data = response.json
        assert 'annotations' in data

    @patch('urllib.request.urlopen')
    def test_annotate_with_other_tabs(self, mock_urlopen, client):
        """Test annotate with other tabs for contradiction detection."""
        annotations_json = json.dumps([
            {
                'type': 'CONTRADICTION',
                'quote': 'Method A is superior',
                'explanation': 'Contradicts findings in other tab',
                'conflictsWith': 'Other Study'
            }
        ])

        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            'message': {'content': annotations_json},
            'done': True
        }).encode()
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.post('/api/annotate', json={
            'text': 'Method A is superior to Method B in all cases.',
            'url': 'https://example.com/article1',
            'otherTabs': [
                {
                    'title': 'Other Study',
                    'text': 'Method B outperforms Method A significantly.'
                }
            ]
        })

        assert response.status_code == 200
        data = response.json
        assert 'annotations' in data

    @patch('urllib.request.urlopen')
    def test_annotate_ollama_error(self, mock_urlopen, client):
        """Test annotate when Ollama fails."""
        mock_urlopen.side_effect = Exception('Connection refused')

        response = client.post('/api/annotate', json={
            'text': 'Some text to annotate'
        })

        assert response.status_code == 502


@pytest.mark.integration
class TestSemanticSearch:
    """Test /api/semantic-search and /api/find-similar endpoints."""

    def test_semantic_search_no_query(self, client):
        """Test semantic search without query."""
        response = client.post('/api/semantic-search', json={})

        assert response.status_code == 400
        assert 'query required' in response.json['error']

    @patch('urllib.request.urlopen')
    def test_semantic_search_model_unavailable(self, mock_urlopen, client):
        """Test semantic search when embedding model is unavailable."""
        # Mock Ollama tags endpoint to return no embedding model
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            'models': [{'name': 'qwen2.5:1.5b'}]
        }).encode()
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.post('/api/semantic-search', json={
            'query': 'machine learning'
        })

        assert response.status_code == 503
        assert 'nomic-embed-text' in response.json['error']

    def test_find_similar_no_title(self, client):
        """Test find similar without title."""
        response = client.post('/api/find-similar', json={})

        assert response.status_code == 400
        assert 'title required' in response.json['error']

    @patch('urllib.request.urlopen')
    def test_find_similar_model_unavailable(self, mock_urlopen, client):
        """Test find similar when embedding model is unavailable."""
        # Mock Ollama tags endpoint
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            'models': []
        }).encode()
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.post('/api/find-similar', json={
            'title': 'Deep Learning Paper',
            'link': 'https://arxiv.org/abs/2301.12345'
        })

        assert response.status_code == 503


@pytest.mark.integration
class TestContentWorkflows:
    """Test complete content processing workflows."""

    @patch('urllib.request.urlopen')
    @patch('routes.content.cached_fetch')
    def test_extract_and_annotate_workflow(self, mock_cached_fetch, mock_urlopen, client):
        """Test extracting text then annotating it."""
        # Step 1: Extract text from page
        sample_html = b'''
        <html>
            <body>
                <h1>Research Paper</h1>
                <p>Our method achieves 95% accuracy on the benchmark.</p>
                <p>This is a significant improvement over prior work.</p>
            </body>
        </html>
        '''

        mock_cached_fetch.return_value = sample_html

        extract_response = client.post('/api/extract-text', json={
            'url': 'https://example.com/paper'
        })

        assert extract_response.status_code == 200
        text = extract_response.json['text']
        assert '95% accuracy' in text

        # Step 2: Annotate the extracted text
        annotations_json = json.dumps([
            {
                'type': 'KEY_FINDING',
                'quote': 'Our method achieves 95% accuracy on the benchmark.',
                'explanation': 'Main result of the paper'
            }
        ])

        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            'message': {'content': annotations_json},
            'done': True
        }).encode()
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        annotate_response = client.post('/api/annotate', json={
            'text': text,
            'url': 'https://example.com/paper'
        })

        assert annotate_response.status_code == 200
        annotations = annotate_response.json['annotations']
        assert isinstance(annotations, list)

    @patch('urllib.request.urlopen')
    @patch('routes.content.cached_fetch')
    def test_extract_links_and_suggest_workflow(self, mock_cached_fetch, mock_urlopen, client):
        """Test extracting links then suggesting questions."""
        # Step 1: Extract links
        sample_html = b'''
        <html>
            <body>
                <a href="https://arxiv.org/abs/2301.12345">Related Paper 1</a>
                <a href="https://arxiv.org/abs/2302.23456">Related Paper 2</a>
            </body>
        </html>
        '''

        mock_cached_fetch.return_value = sample_html

        links_response = client.post('/api/extract-links', json={
            'url': 'https://example.com/paper'
        })

        assert links_response.status_code == 200
        links = links_response.json['links']
        assert len(links) > 0

        # Step 2: Generate suggestion for first link text
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            'message': {'content': 'What is this paper about?'},
            'done': True
        }).encode()
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        suggest_response = client.post('/api/panel-suggest', json={
            'text': links[0]['text']
        })

        assert suggest_response.status_code == 200
        suggestion = suggest_response.json['suggestion']
        assert len(suggestion) > 0
