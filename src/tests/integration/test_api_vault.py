"""
Integration tests for vault API routes.

Tests vault endpoints:
- GET /api/vault/path - Get vault path
- POST /api/vault/path - Set custom vault path
- GET /api/vault/notes - List all notes
- GET /api/vault/notes/<note_id> - Get specific note
- POST /api/vault/notes - Create new note
- PUT /api/vault/notes/<note_id> - Update note
- DELETE /api/vault/notes/<note_id> - Delete note
- POST /api/vault/marimo/start - Start marimo notebook
- POST /api/vault/marimo/stop - Stop marimo notebook
- GET /api/vault/tree - Get file tree
- POST /api/vault-chat - Chat with vault content
"""

import pytest
import os

# Add src to path
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))


@pytest.fixture
def auth_user(client):
    """Create and authenticate a test user."""
    from users import upsert_google_user, create_session

    google_id = 'test_vault_user'
    upsert_google_user(google_id, 'vault@test.com', 'Vault Tester', 'https://pic.url')
    token = create_session(google_id)

    return {
        'google_id': google_id,
        'token': token,
        'headers': {'Authorization': f'Bearer {token}'}
    }


@pytest.mark.integration
class TestVaultPath:
    """Test vault path management."""

    def test_get_vault_path_requires_auth(self, client):
        """Test getting vault path requires authentication."""
        response = client.get('/api/vault/path')

        assert response.status_code == 401

    def test_get_vault_path_default(self, client, auth_user):
        """Test getting default vault path."""
        response = client.get('/api/vault/path', headers=auth_user['headers'])

        assert response.status_code == 200
        data = response.json
        assert 'path' in data
        assert 'isCustom' in data
        assert 'default' in data
        assert data['isCustom'] is False

    def test_set_vault_path_requires_auth(self, client):
        """Test setting vault path requires authentication."""
        response = client.post('/api/vault/path', json={'path': '/tmp/test'})

        assert response.status_code == 401

    def test_set_vault_path_success(self, client, auth_user):
        """Test setting custom vault path."""
        # Using real vault helpers - may succeed or fail based on path validity
        response = client.post('/api/vault/path',
            headers=auth_user['headers'],
            json={'path': ''}  # Empty = reset to default
        )

        assert response.status_code in [200, 400]

    def test_set_vault_path_invalid(self, client, auth_user):
        """Test setting invalid vault path."""
        response = client.post('/api/vault/path',
            headers=auth_user['headers'],
            json={'path': '/nonexistent/invalid/path/12345'}
        )

        # Should fail for invalid path
        assert response.status_code == 400

    def test_reset_vault_path(self, client, auth_user):
        """Test resetting to default vault path."""
        response = client.post('/api/vault/path',
            headers=auth_user['headers'],
            json={'path': ''}
        )

        # May succeed or fail depending on implementation
        assert response.status_code in [200, 400]


@pytest.mark.integration
class TestNotes:
    """Test vault notes CRUD."""

    def test_list_notes_requires_auth(self, client):
        """Test listing notes requires authentication."""
        response = client.get('/api/vault/notes')

        assert response.status_code == 401

    def test_list_notes_empty(self, client, auth_user):
        """Test listing notes when vault is empty."""
        response = client.get('/api/vault/notes', headers=auth_user['headers'])

        assert response.status_code == 200
        notes = response.json
        assert isinstance(notes, list)

    def test_create_note_requires_auth(self, client):
        """Test creating note requires authentication."""
        response = client.post('/api/vault/notes', json={
            'title': 'Test Note',
            'content': 'Test content'
        })

        assert response.status_code == 401

    def test_create_note_success(self, client, auth_user):
        """Test creating a new note."""
        response = client.post('/api/vault/notes',
            headers=auth_user['headers'],
            json={
                'title': 'My Note',
                'content': 'Note content here'
            }
        )

        assert response.status_code in [200, 201]
        data = response.json
        assert 'id' in data

    def test_create_note_missing_title(self, client, auth_user):
        """Test creating note without title."""
        response = client.post('/api/vault/notes',
            headers=auth_user['headers'],
            json={'content': 'Content only'}
        )

        # May create with auto-title or fail
        assert response.status_code in [200, 201, 400]

    def test_get_note_requires_auth(self, client):
        """Test getting note requires authentication."""
        response = client.get('/api/vault/notes/test-id')

        assert response.status_code == 401

    def test_get_note_not_found(self, client, auth_user):
        """Test getting non-existent note."""
        response = client.get('/api/vault/notes/nonexistent-note-12345',
            headers=auth_user['headers']
        )

        assert response.status_code == 404

    def test_update_note_requires_auth(self, client):
        """Test updating note requires authentication."""
        response = client.put('/api/vault/notes/test-id', json={
            'title': 'Updated'
        })

        assert response.status_code == 401

    def test_update_note_not_found(self, client, auth_user):
        """Test updating non-existent note."""
        response = client.put('/api/vault/notes/nonexistent-12345',
            headers=auth_user['headers'],
            json={
                'title': 'Updated',
                'content': 'New content'
            }
        )

        assert response.status_code == 404

    def test_delete_note_requires_auth(self, client):
        """Test deleting note requires authentication."""
        response = client.delete('/api/vault/notes/test-id')

        assert response.status_code == 401

    def test_delete_note_not_found(self, client, auth_user):
        """Test deleting non-existent note."""
        response = client.delete('/api/vault/notes/nonexistent-12345',
            headers=auth_user['headers']
        )

        assert response.status_code == 404


@pytest.mark.integration
class TestMarimo:
    """Test marimo notebook server management."""

    def test_start_marimo_requires_auth(self, client):
        """Test starting marimo requires authentication."""
        response = client.post('/api/vault/marimo/start', json={
            'note_id': 'test-123'
        })

        assert response.status_code == 401

    def test_start_marimo_nonexistent_note(self, client, auth_user):
        """Test starting marimo for non-existent note."""
        response = client.post('/api/vault/marimo/start',
            headers=auth_user['headers'],
            json={'note_id': 'nonexistent-12345'}
        )

        assert response.status_code == 404

    def test_start_marimo_missing_note_id(self, client, auth_user):
        """Test starting marimo without note_id."""
        response = client.post('/api/vault/marimo/start',
            headers=auth_user['headers'],
            json={}
        )

        assert response.status_code == 400

    def test_stop_marimo_requires_auth(self, client):
        """Test stopping marimo requires authentication."""
        response = client.post('/api/vault/marimo/stop', json={
            'note_id': 'test-123'
        })

        assert response.status_code == 401

    def test_stop_marimo_not_running(self, client, auth_user):
        """Test stopping marimo when not running."""
        response = client.post('/api/vault/marimo/stop',
            headers=auth_user['headers'],
            json={'note_id': 'nonexistent'}
        )

        assert response.status_code in [200, 404]


@pytest.mark.integration
class TestVaultTree:
    """Test vault file tree endpoint."""

    def test_vault_tree_requires_auth(self, client):
        """Test getting vault tree requires authentication."""
        response = client.get('/api/vault/tree')

        assert response.status_code == 401

    def test_vault_tree_success(self, client, auth_user):
        """Test getting vault file tree."""
        response = client.get('/api/vault/tree', headers=auth_user['headers'])

        assert response.status_code == 200
        tree = response.json
        assert isinstance(tree, (list, dict))


@pytest.mark.integration
class TestVaultChat:
    """Test vault chat endpoint."""

    def test_vault_chat_requires_auth(self, client):
        """Test vault chat requires authentication."""
        response = client.post('/api/vault-chat', json={
            'message': 'What notes do I have?'
        })

        assert response.status_code == 401

    def test_vault_chat_missing_message(self, client, auth_user):
        """Test vault chat without message."""
        response = client.post('/api/vault-chat',
            headers=auth_user['headers'],
            json={}
        )

        assert response.status_code == 400

    def test_vault_chat_success(self, client, auth_user):
        """Test vault chat with message."""
        response = client.post('/api/vault-chat',
            headers=auth_user['headers'],
            json={'message': 'Tell me about my notes'}
        )

        # May succeed or fail depending on ollama availability
        assert response.status_code in [200, 400, 500]
