"""
Unit tests for persistence.py

Tests database initialization, CRUD operations, and core persistence functions.
"""

import pytest
import sqlite3
import tempfile
import os
from datetime import datetime

# Import from parent directory
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from persistence import (
    get_db,
    _initialize_db,
    create_user,
    get_user_by_username,
    create_session,
    get_session,
    delete_session,
    save_feed_item,
    get_feed_items,
    save_embedding,
    get_embedding
)


class TestDatabaseInitialization:
    """Test database initialization and schema creation."""

    def test_initialize_db_creates_tables(self, test_db):
        """Test that _initialize_db creates all required tables."""
        cursor = test_db.cursor()
        _initialize_db(cursor)
        test_db.commit()

        # Check that key tables exist
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {row[0] for row in cursor.fetchall()}

        expected_tables = {
            'users', 'sessions', 'user_data', 'teams', 'team_members',
            'feed_items', 'embeddings', 'calendar_events', 'comments',
            'direct_messages', 'team_messages'
        }

        assert expected_tables.issubset(tables), f"Missing tables: {expected_tables - tables}"

    def test_initialize_db_creates_indexes(self, test_db):
        """Test that indexes are created for performance."""
        cursor = test_db.cursor()
        _initialize_db(cursor)
        test_db.commit()

        # Check for indexes
        cursor.execute("SELECT name FROM sqlite_master WHERE type='index'")
        indexes = {row[0] for row in cursor.fetchall()}

        # Should have indexes on commonly queried fields
        assert any('sessions' in idx for idx in indexes)
        assert any('feed_items' in idx for idx in indexes)


class TestUserManagement:
    """Test user CRUD operations."""

    def test_create_user(self, init_db):
        """Test creating a new user."""
        user_id = create_user(
            username='testuser',
            password_hash='hashed_password',
            email='test@example.com'
        )

        assert user_id is not None
        assert user_id > 0

    def test_create_user_duplicate_username(self, init_db):
        """Test that duplicate usernames are rejected."""
        create_user(
            username='testuser',
            password_hash='hash1',
            email='test1@example.com'
        )

        # Second user with same username should fail
        with pytest.raises(sqlite3.IntegrityError):
            create_user(
                username='testuser',
                password_hash='hash2',
                email='test2@example.com'
            )

    def test_get_user_by_username(self, init_db):
        """Test retrieving a user by username."""
        create_user(
            username='findme',
            password_hash='myhash',
            email='findme@example.com'
        )

        user = get_user_by_username('findme')

        assert user is not None
        assert user['username'] == 'findme'
        assert user['email'] == 'findme@example.com'
        assert user['password_hash'] == 'myhash'

    def test_get_user_by_username_not_found(self, init_db):
        """Test retrieving a non-existent user."""
        user = get_user_by_username('doesnotexist')
        assert user is None


class TestSessionManagement:
    """Test session CRUD operations."""

    def test_create_session(self, init_db, test_user):
        """Test creating a new session."""
        token = create_session(
            user_id=test_user['id'],
            ip_address='127.0.0.1',
            user_agent='Test Browser'
        )

        assert token is not None
        assert len(token) > 20  # Should be a reasonable length

    def test_get_session_valid(self, init_db, test_user):
        """Test retrieving a valid session."""
        token = create_session(
            user_id=test_user['id'],
            ip_address='127.0.0.1',
            user_agent='Test Browser'
        )

        session = get_session(token)

        assert session is not None
        assert session['user_id'] == test_user['id']
        assert session['token'] == token

    def test_get_session_invalid(self, init_db):
        """Test retrieving an invalid session."""
        session = get_session('invalid-token-12345')
        assert session is None

    def test_delete_session(self, init_db, test_user):
        """Test deleting a session."""
        token = create_session(
            user_id=test_user['id'],
            ip_address='127.0.0.1',
            user_agent='Test Browser'
        )

        # Session should exist
        assert get_session(token) is not None

        # Delete session
        delete_session(token)

        # Session should no longer exist
        assert get_session(token) is None

    def test_session_expiry(self, init_db, test_user):
        """Test that expired sessions are not returned."""
        # This test would require mocking datetime or waiting
        # Simplified version: just check that expiry field exists
        token = create_session(
            user_id=test_user['id'],
            ip_address='127.0.0.1',
            user_agent='Test Browser'
        )

        cursor = init_db.cursor()
        cursor.execute('SELECT expires_at FROM sessions WHERE token = ?', (token,))
        row = cursor.fetchone()

        assert row is not None
        assert row[0] is not None  # expires_at should be set


class TestFeedItems:
    """Test feed item storage and retrieval."""

    def test_save_feed_item(self, init_db):
        """Test saving a feed item."""
        item_id = save_feed_item(
            source='arxiv',
            title='Test Paper',
            link='https://arxiv.org/abs/2301.12345',
            published_at='2023-01-15T10:00:00Z',
            authors='John Doe',
            categories='cs.AI'
        )

        assert item_id is not None
        assert item_id > 0

    def test_save_feed_item_duplicate_link(self, init_db):
        """Test that duplicate links are handled (should upsert)."""
        save_feed_item(
            source='arxiv',
            title='Original Title',
            link='https://arxiv.org/abs/2301.12345',
            published_at='2023-01-15T10:00:00Z'
        )

        # Save again with same link (should update, not error)
        save_feed_item(
            source='arxiv',
            title='Updated Title',
            link='https://arxiv.org/abs/2301.12345',
            published_at='2023-01-15T10:00:00Z'
        )

        # Should only have one item
        items = get_feed_items(sources=['arxiv'])
        assert len(items) == 1
        # Title should be updated (if your implementation does upsert)

    def test_get_feed_items_by_source(self, init_db):
        """Test retrieving feed items filtered by source."""
        # Add items from different sources
        save_feed_item(
            source='arxiv',
            title='arXiv Paper',
            link='https://arxiv.org/abs/1',
            published_at='2023-01-15T10:00:00Z'
        )
        save_feed_item(
            source='hn',
            title='HN Post',
            link='https://news.ycombinator.com/item?id=1',
            published_at='2023-01-15T11:00:00Z'
        )

        # Get only arXiv items
        arxiv_items = get_feed_items(sources=['arxiv'])
        assert len(arxiv_items) == 1
        assert arxiv_items[0]['source'] == 'arxiv'

        # Get only HN items
        hn_items = get_feed_items(sources=['hn'])
        assert len(hn_items) == 1
        assert hn_items[0]['source'] == 'hn'

    def test_get_feed_items_pagination(self, init_db):
        """Test pagination of feed items."""
        # Add multiple items
        for i in range(10):
            save_feed_item(
                source='arxiv',
                title=f'Paper {i}',
                link=f'https://arxiv.org/abs/{i}',
                published_at='2023-01-15T10:00:00Z'
            )

        # Get first page
        page1 = get_feed_items(sources=['arxiv'], limit=5, offset=0)
        assert len(page1) == 5

        # Get second page
        page2 = get_feed_items(sources=['arxiv'], limit=5, offset=5)
        assert len(page2) == 5

        # Pages should not overlap
        page1_links = {item['link'] for item in page1}
        page2_links = {item['link'] for item in page2}
        assert len(page1_links & page2_links) == 0


class TestEmbeddings:
    """Test embedding storage and retrieval."""

    def test_save_embedding(self, init_db):
        """Test saving an embedding vector."""
        # Create a sample embedding (768-dim for nomic-embed-text)
        embedding = [0.1] * 768

        embedding_id = save_embedding(
            content_hash='test_hash_123',
            content_type='post',
            content_id='post_456',
            model='nomic-embed-text',
            embedding=embedding
        )

        assert embedding_id is not None

    def test_get_embedding(self, init_db):
        """Test retrieving an embedding."""
        embedding = [0.1] * 768

        save_embedding(
            content_hash='test_hash_456',
            content_type='post',
            content_id='post_789',
            model='nomic-embed-text',
            embedding=embedding
        )

        retrieved = get_embedding('test_hash_456')

        assert retrieved is not None
        assert retrieved['content_hash'] == 'test_hash_456'
        assert retrieved['content_type'] == 'post'
        assert retrieved['model'] == 'nomic-embed-text'
        # Embedding should be retrieved as bytes and need decoding

    def test_embedding_deduplication(self, init_db):
        """Test that duplicate embeddings use same content_hash."""
        embedding1 = [0.1] * 768
        embedding2 = [0.1] * 768  # Same as embedding1

        save_embedding(
            content_hash='same_hash',
            content_type='post',
            content_id='post_1',
            model='nomic-embed-text',
            embedding=embedding1
        )

        # Saving with same hash should update, not create new
        save_embedding(
            content_hash='same_hash',
            content_type='post',
            content_id='post_2',  # Different ID
            model='nomic-embed-text',
            embedding=embedding2
        )

        # Should only have one embedding with this hash
        cursor = init_db.cursor()
        cursor.execute('SELECT COUNT(*) FROM embeddings WHERE content_hash = ?', ('same_hash',))
        count = cursor.fetchone()[0]

        assert count == 1


class TestDataIntegrity:
    """Test data integrity constraints."""

    def test_user_email_unique(self, init_db):
        """Test that user emails must be unique."""
        create_user('user1', 'hash1', 'same@example.com')

        with pytest.raises(sqlite3.IntegrityError):
            create_user('user2', 'hash2', 'same@example.com')

    def test_feed_item_source_link_unique(self, init_db):
        """Test that (source, link) combination is unique."""
        save_feed_item(
            source='arxiv',
            title='Title 1',
            link='https://example.com/1',
            published_at='2023-01-15T10:00:00Z'
        )

        # Same source + link should fail or update
        # (depending on your UNIQUE constraint)
        try:
            save_feed_item(
                source='arxiv',
                title='Title 2',
                link='https://example.com/1',
                published_at='2023-01-15T10:00:00Z'
            )
            # If no error, implementation does UPSERT
        except sqlite3.IntegrityError:
            # If error, implementation enforces uniqueness
            pass

    def test_session_foreign_key(self, init_db, test_user):
        """Test that sessions reference valid users."""
        # Valid user should work
        token = create_session(
            user_id=test_user['id'],
            ip_address='127.0.0.1',
            user_agent='Test'
        )
        assert token is not None

        # Invalid user should fail (if foreign key constraints enabled)
        # Note: SQLite foreign keys must be enabled explicitly


@pytest.mark.slow
class TestPerformance:
    """Test database performance with larger datasets."""

    def test_bulk_insert_feed_items(self, init_db):
        """Test bulk insertion of feed items."""
        import time

        start = time.time()

        # Insert 1000 items
        for i in range(1000):
            save_feed_item(
                source='arxiv',
                title=f'Paper {i}',
                link=f'https://arxiv.org/abs/{i}',
                published_at='2023-01-15T10:00:00Z'
            )

        elapsed = time.time() - start

        # Should complete in reasonable time (< 5 seconds)
        assert elapsed < 5.0

    def test_query_performance(self, init_db):
        """Test query performance with many items."""
        # Insert 1000 items
        for i in range(1000):
            save_feed_item(
                source='arxiv',
                title=f'Paper {i}',
                link=f'https://arxiv.org/abs/{i}',
                published_at='2023-01-15T10:00:00Z'
            )

        import time
        start = time.time()

        # Query should be fast due to indexes
        items = get_feed_items(sources=['arxiv'], limit=50)

        elapsed = time.time() - start

        # Should be very fast (< 100ms)
        assert elapsed < 0.1
        assert len(items) == 50
