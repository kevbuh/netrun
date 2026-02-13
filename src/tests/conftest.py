"""
Pytest configuration and fixtures for alpha project tests.

Provides common fixtures for:
- Flask app instances
- Test database
- Mock external APIs (Ollama, Semantic Scholar, arXiv)
- Test users and authentication
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
def app(monkeypatch, tmp_path):
    """Create and configure a Flask app instance for testing."""
    # Create temp directory for test data
    test_data_dir = tmp_path / 'test_data'
    test_data_dir.mkdir()
    test_db_path = test_data_dir / 'test.db'

    # Mock sys.argv to prevent argparse conflicts with pytest
    monkeypatch.setattr(sys, 'argv', ['app.py', '--data-dir', str(test_data_dir)])

    # Set environment variable before importing persistence
    monkeypatch.setenv('ARXIV_DATA_DIR', str(test_data_dir))

    # Import app after mocking argv
    from app import app as flask_app
    import db as db_module

    # Also patch db DB_PATH to use test database
    monkeypatch.setattr(db_module, 'DB_PATH', str(test_db_path))

    # Initialize the test database
    db_module.init_db()

    flask_app.config.update({
        'TESTING': True,
        'DATABASE': str(test_db_path),
        'SECRET_KEY': 'test-secret-key',
        'WTF_CSRF_ENABLED': False,  # Disable CSRF for testing
    })

    yield flask_app

    # Cleanup is automatic with tmp_path


@pytest.fixture
def client(app):
    """Create a test client for the Flask app."""
    return app.test_client()


@pytest.fixture
def runner(app):
    """Create a test CLI runner for the Flask app."""
    return app.test_cli_runner()


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
def init_db(test_db):
    """Initialize test database with schema."""
    from db import _initialize_db

    cursor = test_db.cursor()
    _initialize_db(cursor)
    test_db.commit()

    return test_db


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
def test_user(init_db):
    """Create a test user in the database."""
    cursor = init_db.cursor()

    # Create test user
    cursor.execute('''
        INSERT INTO users (username, password_hash, email, created_at)
        VALUES (?, ?, ?, datetime('now'))
    ''', ('testuser', 'hashed_password', 'test@example.com'))

    user_id = cursor.lastrowid
    init_db.commit()

    # Return user data
    return {
        'id': user_id,
        'username': 'testuser',
        'email': 'test@example.com',
        'password': 'testpass123'
    }


@pytest.fixture
def authenticated_client(client, test_user):
    """Create an authenticated test client."""
    # Login the test user
    client.post('/api/auth/login', json={
        'username': test_user['username'],
        'password': test_user['password']
    })

    return client


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


# Helper functions for tests

def assert_valid_json(response):
    """Assert that response is valid JSON."""
    assert response.content_type == 'application/json'
    assert response.json is not None


def assert_success_response(response, status_code=200):
    """Assert that response is successful."""
    assert response.status_code == status_code
    assert_valid_json(response)


def assert_error_response(response, status_code=400):
    """Assert that response is an error."""
    assert response.status_code == status_code
    # Errors may or may not be JSON depending on route
