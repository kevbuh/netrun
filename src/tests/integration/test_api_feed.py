"""
Integration tests for feed API routes.

Tests feed endpoints:
- GET /api/feed-items
- GET /api/rss-proxy
- POST /api/quality-filter
- GET /api/quality-prompt
- PUT /api/quality-prompt
- GET /api/blocked-titles
- POST /api/blocked-titles
- DELETE /api/blocked-titles
"""

import pytest
import json
import time
from unittest.mock import patch, Mock

# Add src to path
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))


@pytest.mark.integration
class TestFeedItems:
    """Test /api/feed-items endpoint."""

    def test_get_feed_items_no_sources(self, client):
        """Test feed items with no sources parameter."""
        response = client.get('/api/feed-items')

        assert response.status_code == 200
        assert response.json == []

    def test_get_feed_items_empty_sources(self, client):
        """Test feed items with empty sources parameter."""
        response = client.get('/api/feed-items?sources=')

        assert response.status_code == 200
        assert response.json == []

    def test_get_feed_items_with_data(self, client):
        """Test feed items returns data from database."""
        from persistence import _get_db

        # Insert test feed items
        conn = _get_db()
        now = time.time()
        conn.execute('''
            INSERT INTO feed_items
            (source, title, link, authors, categories, description, display_date, pub_date, arxiv_id, extra, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            'arxiv',
            'Test Paper 1',
            'https://arxiv.org/abs/2301.12345',
            'John Doe',
            '["cs.AI", "cs.LG"]',
            'A test paper about AI',
            '2023-01-15',
            '2023-01-15T00:00:00Z',
            '2301.12345',
            '{}',
            now
        ))
        conn.execute('''
            INSERT INTO feed_items
            (source, title, link, authors, categories, description, display_date, pub_date, arxiv_id, extra, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            'hn',
            'Show HN: Cool Project',
            'https://news.ycombinator.com/item?id=12345',
            'hnuser',
            '[]',
            'A cool project',
            '2023-01-16',
            '2023-01-16T00:00:00Z',
            None,
            '{"hnScore": 150}',
            now
        ))
        conn.commit()
        conn.close()

        # Request items for arxiv source
        response = client.get('/api/feed-items?sources=arxiv')

        assert response.status_code == 200
        data = response.json
        assert len(data) == 1
        assert data[0]['source'] == 'arxiv'
        assert data[0]['title'] == 'Test Paper 1'
        assert data[0]['arxivId'] == '2301.12345'
        assert data[0]['categories'] == ['cs.AI', 'cs.LG']

    def test_get_feed_items_multiple_sources(self, client):
        """Test feed items with multiple sources."""
        from persistence import _get_db

        # Insert test items for different sources
        conn = _get_db()
        now = time.time()
        conn.execute('''
            INSERT INTO feed_items
            (source, title, link, authors, categories, description, display_date, pub_date, arxiv_id, extra, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', ('arxiv', 'Paper 1', 'https://arxiv.org/abs/2301.12345', '', '[]', '', '2023-01-15', '2023-01-15T00:00:00Z', '2301.12345', '{}', now))
        conn.execute('''
            INSERT INTO feed_items
            (source, title, link, authors, categories, description, display_date, pub_date, arxiv_id, extra, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', ('hn', 'HN Post', 'https://news.ycombinator.com/item?id=123', '', '[]', '', '2023-01-16', '2023-01-16T00:00:00Z', None, '{}', now))
        conn.commit()
        conn.close()

        # Request both sources
        response = client.get('/api/feed-items?sources=arxiv,hn')

        assert response.status_code == 200
        data = response.json
        assert len(data) == 2

    def test_get_feed_items_limit(self, client):
        """Test feed items respects limit parameter."""
        from persistence import _get_db

        # Insert multiple items
        conn = _get_db()
        now = time.time()
        for i in range(10):
            conn.execute('''
                INSERT INTO feed_items
                (source, title, link, authors, categories, description, display_date, pub_date, arxiv_id, extra, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', ('arxiv', f'Paper {i}', f'https://arxiv.org/abs/230{i}.12345', '', '[]', '', '2023-01-15', '2023-01-15T00:00:00Z', f'230{i}.12345', '{}', now))
        conn.commit()
        conn.close()

        # Request with limit
        response = client.get('/api/feed-items?sources=arxiv&limit=5')

        assert response.status_code == 200
        data = response.json
        assert len(data) == 5


@pytest.mark.integration
class TestRSSProxy:
    """Test /api/rss-proxy endpoint."""

    def test_rss_proxy_no_url(self, client):
        """Test RSS proxy without URL parameter."""
        response = client.get('/api/rss-proxy')

        assert response.status_code == 400
        assert b'url parameter required' in response.data

    def test_rss_proxy_empty_url(self, client):
        """Test RSS proxy with empty URL parameter."""
        response = client.get('/api/rss-proxy?url=')

        assert response.status_code == 400

    @patch('urllib.request.urlopen')
    def test_rss_proxy_success(self, mock_urlopen, client):
        """Test successful RSS proxy."""
        # Mock RSS feed response
        sample_rss = b'''<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
    <channel>
        <title>Test Feed</title>
        <item>
            <title>Test Item</title>
            <link>https://example.com/item1</link>
            <description>Test description</description>
        </item>
    </channel>
</rss>'''

        mock_response = Mock()
        mock_response.read.return_value = sample_rss
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.get('/api/rss-proxy?url=https://example.com/feed.xml')

        assert response.status_code == 200
        assert response.content_type == 'application/xml'
        assert b'<title>Test Feed</title>' in response.data

    @patch('routes.feed.cached_fetch')
    def test_rss_proxy_fetch_error(self, mock_cached_fetch, client):
        """Test RSS proxy with fetch error."""
        mock_cached_fetch.side_effect = Exception('Network error')

        response = client.get('/api/rss-proxy?url=https://example.com/feed.xml')

        assert response.status_code == 502


@pytest.mark.integration
class TestQualityFilter:
    """Test /api/quality-filter endpoint."""

    def test_quality_filter_no_titles(self, client):
        """Test quality filter without titles."""
        response = client.post('/api/quality-filter', json={})

        assert response.status_code == 400
        assert 'titles required' in response.json['error']

    def test_quality_filter_empty_titles(self, client):
        """Test quality filter with empty titles array."""
        response = client.post('/api/quality-filter', json={'titles': []})

        assert response.status_code == 400

    @patch('urllib.request.urlopen')
    def test_quality_filter_verdict_mode(self, mock_urlopen, client):
        """Test quality filter in verdict mode (KEEP/SKIP)."""
        # Mock Ollama response
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            'message': {'content': 'keep'},
            'done': True
        }).encode()
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.post('/api/quality-filter', json={
            'titles': ['Deep Learning for Computer Vision'],
            'mode': 'verdict'
        })

        assert response.status_code == 200
        data = response.json
        assert 'Deep Learning for Computer Vision' in data
        assert data['Deep Learning for Computer Vision'] in ['keep', 'skip']

    @patch('urllib.request.urlopen')
    def test_quality_filter_score_mode(self, mock_urlopen, client):
        """Test quality filter in score mode (0-100)."""
        # Mock Ollama response
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            'message': {'content': '85'},
            'done': True
        }).encode()
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.post('/api/quality-filter', json={
            'titles': ['Attention Is All You Need'],
            'mode': 'score'
        })

        assert response.status_code == 200
        data = response.json
        assert 'Attention Is All You Need' in data
        score = data['Attention Is All You Need']
        assert isinstance(score, int)
        assert 0 <= score <= 100

    @patch('urllib.request.urlopen')
    def test_quality_filter_with_interest_context(self, mock_urlopen, client):
        """Test quality filter with interest context for personalization."""
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            'message': {'content': '90'},
            'done': True
        }).encode()
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.post('/api/quality-filter', json={
            'titles': ['Machine Learning Paper'],
            'mode': 'score',
            'interest_context': 'machine learning, deep learning, neural networks'
        })

        assert response.status_code == 200
        data = response.json
        assert 'Machine Learning Paper' in data

    @patch('routes.feed.classify_title')
    def test_quality_filter_ollama_error_fallback(self, mock_classify, client):
        """Test quality filter falls back to 'keep' when Ollama fails."""
        mock_classify.side_effect = Exception('Connection refused')

        response = client.post('/api/quality-filter', json={
            'titles': ['Test Paper'],
            'mode': 'verdict'
        })

        # Quality filter handles errors gracefully by returning 'keep' as default
        assert response.status_code == 200
        data = response.json
        assert data['Test Paper'] == 'keep'


@pytest.mark.integration
class TestQualityPrompt:
    """Test quality prompt endpoints."""

    def test_get_quality_prompt(self, client):
        """Test getting quality prompt."""
        response = client.get('/api/quality-prompt')

        assert response.status_code == 200
        data = response.json
        assert 'prompt' in data
        assert 'default' in data
        assert 'scoringPrompt' in data

    def test_put_quality_prompt(self, client):
        """Test updating quality prompt."""
        custom_prompt = "Custom quality filter prompt"

        response = client.put('/api/quality-prompt', json={
            'prompt': custom_prompt
        })

        assert response.status_code == 200
        assert response.json['ok'] is True
        assert custom_prompt in response.json['prompt']

    def test_put_quality_prompt_empty(self, client):
        """Test updating prompt with empty string (should reset to default)."""
        response = client.put('/api/quality-prompt', json={
            'prompt': ''
        })

        assert response.status_code == 200
        assert response.json['ok'] is True

    def test_quality_prompt_persistence(self, client):
        """Test that quality prompt persists across requests."""
        custom_prompt = "Persistent custom prompt"

        # Set prompt
        client.put('/api/quality-prompt', json={'prompt': custom_prompt})

        # Get prompt
        response = client.get('/api/quality-prompt')

        assert response.status_code == 200
        assert custom_prompt in response.json['prompt']


@pytest.mark.integration
class TestBlockedTitles:
    """Test blocked titles endpoints (quality filter test suite)."""

    def test_get_blocked_titles_empty(self, client):
        """Test getting blocked titles when none exist."""
        response = client.get('/api/blocked-titles')

        assert response.status_code == 200
        assert isinstance(response.json, list)

    def test_post_blocked_title(self, client):
        """Test adding a blocked title."""
        response = client.post('/api/blocked-titles', json={
            'title': 'Spam Paper Title'
        })

        assert response.status_code == 200
        assert response.json['ok'] is True

    def test_post_blocked_title_no_title(self, client):
        """Test adding blocked title without title parameter."""
        response = client.post('/api/blocked-titles', json={})

        assert response.status_code == 400
        assert 'title required' in response.json['error']

    def test_post_blocked_title_duplicate(self, client):
        """Test adding duplicate blocked title (should not duplicate)."""
        title = 'Duplicate Title'

        # Add first time
        client.post('/api/blocked-titles', json={'title': title})

        # Add second time
        response = client.post('/api/blocked-titles', json={'title': title})

        assert response.status_code == 200

        # Verify only one copy exists
        get_response = client.get('/api/blocked-titles')
        titles = get_response.json
        assert titles.count(title) == 1

    def test_delete_blocked_titles(self, client):
        """Test deleting all blocked titles."""
        # Add some titles
        client.post('/api/blocked-titles', json={'title': 'Title 1'})
        client.post('/api/blocked-titles', json={'title': 'Title 2'})

        # Delete all
        response = client.delete('/api/blocked-titles')

        assert response.status_code == 200
        assert response.json['ok'] is True

        # Verify empty
        get_response = client.get('/api/blocked-titles')
        assert get_response.json == []

    def test_blocked_titles_persistence(self, client):
        """Test that blocked titles persist across requests."""
        # Add titles
        client.post('/api/blocked-titles', json={'title': 'Persistent 1'})
        client.post('/api/blocked-titles', json={'title': 'Persistent 2'})

        # Get titles
        response = client.get('/api/blocked-titles')

        assert response.status_code == 200
        titles = response.json
        assert 'Persistent 1' in titles
        assert 'Persistent 2' in titles


@pytest.mark.integration
class TestModels:
    """Test /api/models endpoint."""

    @patch('urllib.request.urlopen')
    def test_list_models_success(self, mock_urlopen, client):
        """Test listing Ollama models."""
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            'models': [
                {'name': 'qwen2.5:1.5b'},
                {'name': 'qwen3:8b'},
                {'name': 'nomic-embed-text'}
            ]
        }).encode()
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.get('/api/models')

        assert response.status_code == 200
        data = response.json
        assert 'models' in data
        assert 'qwen2.5:1.5b' in data['models']

    @patch('urllib.request.urlopen')
    def test_list_models_error(self, mock_urlopen, client):
        """Test listing models when Ollama is unavailable."""
        mock_urlopen.side_effect = Exception('Connection refused')

        response = client.get('/api/models')

        assert response.status_code == 502
        assert 'error' in response.json


@pytest.mark.integration
class TestFeedWorkflows:
    """Test complete feed workflows."""

    @patch('urllib.request.urlopen')
    def test_complete_feed_workflow(self, mock_urlopen, client):
        """Test complete workflow: fetch feed items, filter with quality."""
        from persistence import _get_db

        # Insert test feed items
        conn = _get_db()
        now = time.time()
        conn.execute('''
            INSERT INTO feed_items
            (source, title, link, authors, categories, description, display_date, pub_date, arxiv_id, extra, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', ('arxiv', 'Deep Learning Survey', 'https://arxiv.org/abs/2301.12345', 'Author', '["cs.AI"]', 'Survey paper', '2023-01-15', '2023-01-15T00:00:00Z', '2301.12345', '{}', now))
        conn.execute('''
            INSERT INTO feed_items
            (source, title, link, authors, categories, description, display_date, pub_date, arxiv_id, extra, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', ('arxiv', 'Spam Paper', 'https://arxiv.org/abs/2301.99999', 'Spammer', '[]', 'Low quality', '2023-01-16', '2023-01-16T00:00:00Z', '2301.99999', '{}', now))
        conn.commit()
        conn.close()

        # Step 1: Fetch feed items
        response = client.get('/api/feed-items?sources=arxiv')
        assert response.status_code == 200
        items = response.json
        assert len(items) == 2

        # Step 2: Filter items with quality filter
        mock_response = Mock()
        # First call returns KEEP, second returns SKIP
        mock_response.read.side_effect = [
            json.dumps({'message': {'content': 'keep'}, 'done': True}).encode(),
            json.dumps({'message': {'content': 'skip'}, 'done': True}).encode()
        ]
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        titles = [item['title'] for item in items]
        response = client.post('/api/quality-filter', json={
            'titles': titles,
            'mode': 'verdict'
        })

        assert response.status_code == 200
        verdicts = response.json

        # Verify we got verdicts for both papers
        assert len(verdicts) == 2
