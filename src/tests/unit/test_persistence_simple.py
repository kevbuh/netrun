"""
Unit tests for persistence utilities.

Tests basic utility functions and database operations.
"""

import pytest
import sys
import os
import sqlite3
import urllib.error

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from utils_persistence import slugify
from db import init_db


class TestSlugify:
    """Test slugify function for URL-safe identifiers."""

    def test_basic_slugify(self):
        """Test basic text slugification."""
        assert slugify('Hello World') == 'hello-world'

    def test_slugify_with_special_chars(self):
        """Test slugification removes special characters."""
        result = slugify('Test@#$%Project!')
        assert '@' not in result
        assert '#' not in result
        assert result == 'testproject'

    def test_slugify_with_spaces(self):
        """Test that spaces become hyphens."""
        assert slugify('My Cool Project') == 'my-cool-project'

    def test_slugify_with_multiple_spaces(self):
        """Test that multiple spaces become single hyphen."""
        assert slugify('Multiple   Spaces') == 'multiple-spaces'

    def test_slugify_with_underscores(self):
        """Test that underscores become hyphens."""
        assert slugify('test_project_name') == 'test-project-name'

    def test_slugify_empty_string(self):
        """Test that empty string returns fallback."""
        result = slugify('')
        assert result == 'experiment'  # Default fallback

    def test_slugify_only_special_chars(self):
        """Test string with only special characters."""
        result = slugify('@#$%^&*()')
        assert result == 'experiment'  # Should fallback

    def test_slugify_with_numbers(self):
        """Test that numbers are preserved."""
        assert slugify('Project 123') == 'project-123'

    def test_slugify_leading_trailing_hyphens(self):
        """Test that leading/trailing hyphens are removed."""
        assert slugify('--test--') == 'test'


class TestDatabase:
    """Test database initialization and connection."""

    def test_init_db_creates_tables(self, tmp_path, monkeypatch):
        """Test that init_db creates required tables."""
        import db as db_module

        db_path = tmp_path / 'test.db'

        monkeypatch.setattr(db_module, 'DB_PATH', str(db_path))
        monkeypatch.setattr(db_module, 'DIR', str(tmp_path))

        init_db()

        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {row[0] for row in cursor.fetchall()}

        assert 'users' in tables
        assert 'sessions' in tables
        assert 'feed_items' in tables
        assert 'embeddings' in tables
        assert 'quality_cache' in tables
        assert 'teams' in tables
        assert 'user_data' in tables

        conn.close()

    def test_users_table_schema(self, tmp_path, monkeypatch):
        """Test that users table has correct schema."""
        import db as db_module

        db_path = tmp_path / 'test.db'
        monkeypatch.setattr(db_module, 'DB_PATH', str(db_path))
        monkeypatch.setattr(db_module, 'DIR', str(tmp_path))

        init_db()

        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(users)")
        columns = {row[1]: row[2] for row in cursor.fetchall()}

        assert 'google_id' in columns
        assert 'email' in columns
        assert 'username' in columns
        assert 'created' in columns

        conn.close()

    def test_feed_items_table_schema(self, tmp_path, monkeypatch):
        """Test that feed_items table has correct schema."""
        import db as db_module

        db_path = tmp_path / 'test.db'
        monkeypatch.setattr(db_module, 'DB_PATH', str(db_path))
        monkeypatch.setattr(db_module, 'DIR', str(tmp_path))

        init_db()

        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(feed_items)")
        columns = {row[1]: row[2] for row in cursor.fetchall()}

        assert 'id' in columns
        assert 'source' in columns
        assert 'title' in columns
        assert 'link' in columns
        assert 'pub_date' in columns
        assert 'fetched_at' in columns

        conn.close()

    def test_feed_items_unique_constraint(self, tmp_path, monkeypatch):
        """Test that (source, link) is unique in feed_items."""
        import db as db_module

        db_path = tmp_path / 'test.db'
        monkeypatch.setattr(db_module, 'DB_PATH', str(db_path))
        monkeypatch.setattr(db_module, 'DIR', str(tmp_path))

        init_db()

        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO feed_items (source, title, link, fetched_at)
            VALUES (?, ?, ?, ?)
        """, ('arxiv', 'Test Title', 'https://example.com/1', 1234567890))
        conn.commit()

        try:
            cursor.execute("""
                INSERT INTO feed_items (source, title, link, fetched_at)
                VALUES (?, ?, ?, ?)
            """, ('arxiv', 'Different Title', 'https://example.com/1', 1234567890))
            conn.commit()

            cursor.execute("""
                SELECT COUNT(*) FROM feed_items
                WHERE source = ? AND link = ?
            """, ('arxiv', 'https://example.com/1'))

            count = cursor.fetchone()[0]
            assert count == 1

        except sqlite3.IntegrityError:
            pass

        conn.close()


class TestCachedFetch:
    """Test URL fetching with caching."""

    def test_cached_fetch_url_validation(self):
        """Test that cached_fetch validates URLs."""
        from cache import cached_fetch

        try:
            result = cached_fetch('not-a-url')
            assert result is None or result == b''
        except Exception as e:
            assert isinstance(e, (ValueError, urllib.error.URLError))


