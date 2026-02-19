"""
Pytest configuration and fixtures for project tests.

Provides common fixtures for:
- Test database
- Mock external APIs (Ollama, Semantic Scholar, arXiv)
- Sample test data
"""

import os
import sqlite3
import tempfile
from contextlib import contextmanager
import pytest
from unittest.mock import Mock, patch

# Add src to path so we can import app modules
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))


@pytest.fixture
def test_db():
    """Create a temporary test database."""
    db_fd, db_path = tempfile.mkstemp()

    # Create connection
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    yield conn

    # Cleanup
    conn.close()
    os.close(db_fd)
    os.unlink(db_path)


@pytest.fixture
def mock_ollama():
    """Mock Ollama API responses."""
    with patch('requests.post') as mock_post:
        # Default response for quality filter
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'model': 'qwen2.5:1.5b',
            'response': 'KEEP',
            'done': True
        }
        mock_post.return_value = mock_response

        yield mock_post


@pytest.fixture
def mock_semantic_scholar():
    """Mock Semantic Scholar API responses."""
    with patch('requests.get') as mock_get:
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'paperId': 'test123',
            'title': 'Test Paper',
            'authors': [{'name': 'Test Author'}],
            'abstract': 'Test abstract',
            'citations': [],
            'references': []
        }
        mock_get.return_value = mock_response

        yield mock_get


@pytest.fixture
def mock_arxiv():
    """Mock arXiv API responses."""
    sample_rss = '''<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <id>http://arxiv.org/abs/2301.12345v1</id>
        <title>Test Paper Title</title>
        <summary>Test abstract</summary>
        <author><name>Test Author</name></author>
        <published>2023-01-15T00:00:00Z</published>
        <link href="http://arxiv.org/abs/2301.12345v1" rel="alternate" type="text/html"/>
        <link href="http://arxiv.org/pdf/2301.12345v1" rel="related" type="application/pdf"/>
      </entry>
    </feed>'''

    with patch('requests.get') as mock_get:
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.text = sample_rss
        mock_response.content = sample_rss.encode('utf-8')
        mock_get.return_value = mock_response

        yield mock_get


@pytest.fixture
def sample_papers():
    """Return sample paper data for testing."""
    return [
        {
            'title': 'Deep Learning for Computer Vision',
            'authors': ['John Doe', 'Jane Smith'],
            'abstract': 'A comprehensive survey of deep learning methods...',
            'arxiv_id': '2301.12345',
            'published': '2023-01-15',
            'categories': ['cs.CV', 'cs.AI'],
            'link': 'https://arxiv.org/abs/2301.12345'
        },
        {
            'title': 'Natural Language Processing with Transformers',
            'authors': ['Alice Johnson'],
            'abstract': 'Recent advances in transformer architectures...',
            'arxiv_id': '2302.23456',
            'published': '2023-02-20',
            'categories': ['cs.CL', 'cs.AI'],
            'link': 'https://arxiv.org/abs/2302.23456'
        }
    ]


@pytest.fixture
def sample_feed_items():
    """Return sample feed item data for testing."""
    return [
        {
            'source': 'arxiv',
            'title': 'Test Paper 1',
            'link': 'https://arxiv.org/abs/2301.12345',
            'published_at': '2023-01-15T10:00:00Z',
            'authors': 'John Doe',
            'categories': 'cs.AI'
        },
        {
            'source': 'hn',
            'title': 'Show HN: My Cool Project',
            'link': 'https://news.ycombinator.com/item?id=12345',
            'published_at': '2023-01-16T14:30:00Z',
            'authors': 'hnuser',
            'score': 150
        }
    ]


@contextmanager
def does_not_raise():
    """Context manager for tests that should not raise exceptions."""
    yield
