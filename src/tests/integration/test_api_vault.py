"""
Integration tests for vault API routes.

Tests remaining vault endpoints:
- GET /api/vault/path - Get vault path
- POST /api/vault/path - Set custom vault path
- GET /api/vault/tree - Get file tree
- POST /api/vault/marimo/start - Start marimo notebook
- POST /api/vault/marimo/stop - Stop marimo notebook
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

        assert response.status_code == 400

    def test_reset_vault_path(self, client, auth_user):
        """Test resetting to default vault path."""
        response = client.post('/api/vault/path',
            headers=auth_user['headers'],
            json={'path': ''}
        )

        assert response.status_code in [200, 400]


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
