"""
Integration tests for auth API routes.

Tests all authentication endpoints:
- Google login
- Logout
- Set username
- Delete account
- Me (user info)
- Sync (bidirectional data sync)
"""

import pytest
import json
from unittest.mock import patch, Mock
import time

# Add src to path
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))


@pytest.mark.integration
class TestGoogleLogin:
    """Test Google OAuth login endpoint."""

    @patch('urllib.request.urlopen')
    def test_google_login_success(self, mock_urlopen, client):
        """Test successful Google login."""
        # Mock Google tokeninfo response
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            'sub': 'google_123',
            'email': 'test@example.com',
            'name': 'Test User',
            'picture': 'https://example.com/pic.jpg',
            'aud': '856091829253-1n5fu44j867fu88larg1vvnqds4pmkh4.apps.googleusercontent.com'
        }).encode()
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        # Create a valid-looking JWT (doesn't need to be real since we mock verification)
        # JWT structure: header.payload.signature
        import base64
        payload = json.dumps({
            'sub': 'google_123',
            'email': 'test@example.com',
            'name': 'Test User',
            'picture': 'https://example.com/pic.jpg'
        })
        payload_b64 = base64.urlsafe_b64encode(payload.encode()).decode().rstrip('=')
        fake_jwt = f'header.{payload_b64}.signature'

        response = client.post('/api/auth/google', json={
            'credential': fake_jwt
        })

        assert response.status_code == 200
        data = response.json
        assert 'token' in data
        assert data['email'] == 'test@example.com'
        assert data['name'] == 'Test User'

    def test_google_login_missing_credential(self, client):
        """Test login with missing credential."""
        response = client.post('/api/auth/google', json={})

        assert response.status_code == 400
        assert 'error' in response.json

    @patch('urllib.request.urlopen')
    def test_google_login_invalid_token(self, mock_urlopen, client):
        """Test login with invalid token."""
        # Mock Google returning error
        mock_urlopen.side_effect = Exception('Invalid token')

        response = client.post('/api/auth/google', json={
            'credential': 'invalid_token'
        })

        assert response.status_code == 401
        assert 'error' in response.json


@pytest.mark.integration
class TestLogout:
    """Test logout endpoint."""

    def test_logout_success(self, client):
        """Test successful logout."""
        # Create a session first
        from persistence import create_session
        token = create_session('google_test_123')

        response = client.post('/api/auth/logout', headers={
            'Authorization': f'Bearer {token}'
        })

        assert response.status_code == 200
        assert response.json['ok'] is True

    def test_logout_without_token(self, client):
        """Test logout without token still returns OK."""
        response = client.post('/api/auth/logout')

        assert response.status_code == 200
        assert response.json['ok'] is True


@pytest.mark.integration
class TestSetUsername:
    """Test set username endpoint."""

    def test_set_username_success(self, client):
        """Test setting a valid username."""
        from persistence import upsert_google_user, create_session

        # Create user and session
        upsert_google_user('google_123', 'test@example.com', 'Test User', '')
        token = create_session('google_123')

        response = client.post('/api/auth/username',
            headers={'Authorization': f'Bearer {token}'},
            json={'username': 'testuser'}
        )

        assert response.status_code == 200
        assert response.json['ok'] is True
        assert response.json['username'] == 'testuser'

    def test_set_username_too_short(self, client):
        """Test username that's too short."""
        from persistence import upsert_google_user, create_session

        upsert_google_user('google_123', 'test@example.com', 'Test User', '')
        token = create_session('google_123')

        response = client.post('/api/auth/username',
            headers={'Authorization': f'Bearer {token}'},
            json={'username': 'a'}
        )

        assert response.status_code == 400
        assert 'must be 2-20 characters' in response.json['error']

    def test_set_username_too_long(self, client):
        """Test username that's too long."""
        from persistence import upsert_google_user, create_session

        upsert_google_user('google_123', 'test@example.com', 'Test User', '')
        token = create_session('google_123')

        response = client.post('/api/auth/username',
            headers={'Authorization': f'Bearer {token}'},
            json={'username': 'a' * 21}
        )

        assert response.status_code == 400
        assert 'must be 2-20 characters' in response.json['error']

    def test_set_username_invalid_characters(self, client):
        """Test username with invalid characters."""
        from persistence import upsert_google_user, create_session

        upsert_google_user('google_123', 'test@example.com', 'Test User', '')
        token = create_session('google_123')

        response = client.post('/api/auth/username',
            headers={'Authorization': f'Bearer {token}'},
            json={'username': 'test@user'}
        )

        assert response.status_code == 400
        assert 'letters, numbers' in response.json['error']

    def test_set_username_duplicate(self, client):
        """Test setting a username that's already taken."""
        from persistence import upsert_google_user, create_session, set_username

        # Create two users
        upsert_google_user('google_123', 'test1@example.com', 'User 1', '')
        upsert_google_user('google_456', 'test2@example.com', 'User 2', '')

        # User 1 claims username
        set_username('google_123', 'claimed')

        # User 2 tries to claim same username
        token = create_session('google_456')
        response = client.post('/api/auth/username',
            headers={'Authorization': f'Bearer {token}'},
            json={'username': 'claimed'}
        )

        assert response.status_code == 409
        assert 'already taken' in response.json['error']

    def test_set_username_requires_auth(self, client):
        """Test that setting username requires authentication."""
        response = client.post('/api/auth/username',
            json={'username': 'testuser'}
        )

        assert response.status_code == 401


@pytest.mark.integration
class TestDeleteAccount:
    """Test delete account endpoint."""

    def test_delete_account_success(self, client):
        """Test successful account deletion."""
        from persistence import upsert_google_user, create_session, get_user_info

        # Create user and session
        upsert_google_user('google_123', 'test@example.com', 'Test User', '')
        token = create_session('google_123')

        # Verify user exists
        assert get_user_info('google_123') is not None

        # Delete account
        response = client.post('/api/auth/delete-account',
            headers={'Authorization': f'Bearer {token}'}
        )

        assert response.status_code == 200
        assert response.json['ok'] is True

        # Verify user is deleted
        assert get_user_info('google_123') is None

    def test_delete_account_requires_auth(self, client):
        """Test that deleting account requires authentication."""
        response = client.post('/api/auth/delete-account')

        assert response.status_code == 401


@pytest.mark.integration
class TestMe:
    """Test /api/auth/me endpoint for user info."""

    def test_me_authenticated(self, client):
        """Test getting user info when authenticated."""
        from persistence import upsert_google_user, create_session, set_username

        # Create user with username
        upsert_google_user('google_123', 'test@example.com', 'Test User', 'https://pic.jpg')
        set_username('google_123', 'testuser')
        token = create_session('google_123')

        response = client.get('/api/auth/me',
            headers={'Authorization': f'Bearer {token}'}
        )

        assert response.status_code == 200
        data = response.json
        assert data['google_id'] == 'google_123'
        assert data['email'] == 'test@example.com'
        assert data['name'] == 'Test User'
        assert data['username'] == 'testuser'

    def test_me_not_authenticated(self, client):
        """Test getting user info when not authenticated."""
        response = client.get('/api/auth/me')

        assert response.status_code == 401
        assert 'error' in response.json


@pytest.mark.integration
class TestSync:
    """Test bidirectional data sync endpoint."""

    def test_sync_client_wins_newer(self, client):
        """Test sync where client data is newer."""
        from persistence import upsert_google_user, create_session, set_user_data_bulk

        # Create user
        upsert_google_user('google_123', 'test@example.com', 'Test User', '')
        token = create_session('google_123')

        # Server has old data
        set_user_data_bulk('google_123', {
            'theme': {'value': 'light', 'updated': 1000}
        })

        # Client sends newer data
        response = client.post('/api/sync',
            headers={'Authorization': f'Bearer {token}'},
            json={
                'data': {
                    'theme': {'value': 'dark', 'updated': 2000}
                }
            }
        )

        assert response.status_code == 200
        merged = response.json['data']
        assert merged['theme']['value'] == 'dark'

    def test_sync_server_wins_newer(self, client):
        """Test sync where server data is newer."""
        from persistence import upsert_google_user, create_session, set_user_data_bulk

        # Create user
        upsert_google_user('google_123', 'test@example.com', 'Test User', '')
        token = create_session('google_123')

        # Server has newer data
        set_user_data_bulk('google_123', {
            'theme': {'value': 'light', 'updated': 3000}
        })

        # Client sends older data
        response = client.post('/api/sync',
            headers={'Authorization': f'Bearer {token}'},
            json={
                'data': {
                    'theme': {'value': 'dark', 'updated': 1000}
                }
            }
        )

        assert response.status_code == 200
        merged = response.json['data']
        assert merged['theme']['value'] == 'light'

    def test_sync_merge_different_keys(self, client):
        """Test sync merging different keys from client and server."""
        from persistence import upsert_google_user, create_session, set_user_data_bulk

        # Create user
        upsert_google_user('google_123', 'test@example.com', 'Test User', '')
        token = create_session('google_123')

        # Server has some keys
        set_user_data_bulk('google_123', {
            'feedSources': {'value': '{"arxiv": true}', 'updated': 1000},
            'theme': {'value': 'light', 'updated': 2000}
        })

        # Client has different keys
        response = client.post('/api/sync',
            headers={'Authorization': f'Bearer {token}'},
            json={
                'data': {
                    'accentColor': {'value': '#b4451a', 'updated': 1500},
                    'theme': {'value': 'dark', 'updated': 2500}
                }
            }
        )

        assert response.status_code == 200
        merged = response.json['data']

        # Should have all keys
        assert 'feedSources' in merged  # From server
        assert 'accentColor' in merged  # From client
        assert 'theme' in merged  # From both, client wins
        assert merged['theme']['value'] == 'dark'

    def test_sync_empty_client_data(self, client):
        """Test sync with empty client data."""
        from persistence import upsert_google_user, create_session, set_user_data_bulk

        # Create user
        upsert_google_user('google_123', 'test@example.com', 'Test User', '')
        token = create_session('google_123')

        # Server has data
        set_user_data_bulk('google_123', {
            'theme': {'value': 'light', 'updated': 1000}
        })

        # Client sends empty data
        response = client.post('/api/sync',
            headers={'Authorization': f'Bearer {token}'},
            json={'data': {}}
        )

        assert response.status_code == 200
        merged = response.json['data']
        assert merged['theme']['value'] == 'light'

    def test_sync_requires_auth(self, client):
        """Test that sync requires authentication."""
        response = client.post('/api/sync', json={'data': {}})

        assert response.status_code == 401


@pytest.mark.integration
class TestAuthWorkflow:
    """Test complete authentication workflows."""

    @patch('urllib.request.urlopen')
    def test_complete_signup_flow(self, mock_urlopen, client):
        """Test complete user signup and setup flow."""
        # Mock Google OAuth
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            'sub': 'google_new_user',
            'email': 'newuser@example.com',
            'name': 'New User',
            'picture': 'https://example.com/pic.jpg',
            'aud': '856091829253-1n5fu44j867fu88larg1vvnqds4pmkh4.apps.googleusercontent.com'
        }).encode()
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        # Create JWT
        import base64
        payload = json.dumps({
            'sub': 'google_new_user',
            'email': 'newuser@example.com',
            'name': 'New User',
            'picture': 'https://example.com/pic.jpg'
        })
        payload_b64 = base64.urlsafe_b64encode(payload.encode()).decode().rstrip('=')
        fake_jwt = f'header.{payload_b64}.signature'

        # Step 1: Login with Google
        response = client.post('/api/auth/google', json={'credential': fake_jwt})
        assert response.status_code == 200
        token = response.json['token']
        assert response.json['username'] is None  # No username yet

        # Step 2: Check /me endpoint
        response = client.get('/api/auth/me', headers={'Authorization': f'Bearer {token}'})
        assert response.status_code == 200
        assert response.json['email'] == 'newuser@example.com'

        # Step 3: Set username
        response = client.post('/api/auth/username',
            headers={'Authorization': f'Bearer {token}'},
            json={'username': 'newuser'}
        )
        assert response.status_code == 200

        # Step 4: Sync initial settings
        response = client.post('/api/sync',
            headers={'Authorization': f'Bearer {token}'},
            json={
                'data': {
                    'theme': {'value': 'dark', 'updated': time.time()},
                    'feedSources': {'value': '{"arxiv": true}', 'updated': time.time()}
                }
            }
        )
        assert response.status_code == 200
        merged = response.json['data']
        assert 'theme' in merged
        assert 'feedSources' in merged

        # Step 5: Verify user info includes username
        response = client.get('/api/auth/me', headers={'Authorization': f'Bearer {token}'})
        assert response.status_code == 200
        assert response.json['username'] == 'newuser'

        # Step 6: Logout
        response = client.post('/api/auth/logout', headers={'Authorization': f'Bearer {token}'})
        assert response.status_code == 200

        # Step 7: Verify token is invalidated
        response = client.get('/api/auth/me', headers={'Authorization': f'Bearer {token}'})
        assert response.status_code == 401
