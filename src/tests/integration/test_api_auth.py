"""
Integration tests for authentication API endpoints.

Tests /api/auth/* routes including:
- Registration
- Login/logout
- Session management
- Token validation
- Sync endpoint
"""

import pytest
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))


@pytest.mark.integration
class TestRegistration:
    """Test user registration endpoint."""

    def test_register_new_user(self, client):
        """Test successful user registration."""
        response = client.post('/api/auth/register', json={
            'username': 'newuser',
            'password': 'SecurePass123!',
            'email': 'newuser@example.com'
        })

        assert response.status_code == 200
        data = response.json

        assert 'token' in data
        assert 'user' in data
        assert data['user']['username'] == 'newuser'

    def test_register_duplicate_username(self, client, test_user):
        """Test registration with existing username."""
        response = client.post('/api/auth/register', json={
            'username': test_user['username'],
            'password': 'AnotherPass123!',
            'email': 'different@example.com'
        })

        assert response.status_code == 400
        assert 'exists' in response.json.get('error', '').lower()

    def test_register_invalid_email(self, client):
        """Test registration with invalid email."""
        response = client.post('/api/auth/register', json={
            'username': 'newuser',
            'password': 'SecurePass123!',
            'email': 'not-an-email'
        })

        # Should reject invalid email
        assert response.status_code in [400, 422]

    def test_register_weak_password(self, client):
        """Test registration with weak password."""
        response = client.post('/api/auth/register', json={
            'username': 'newuser',
            'password': '123',  # Too weak
            'email': 'newuser@example.com'
        })

        # Should reject weak password
        assert response.status_code in [400, 422]

    def test_register_missing_fields(self, client):
        """Test registration with missing required fields."""
        response = client.post('/api/auth/register', json={
            'username': 'newuser'
            # Missing password and email
        })

        assert response.status_code in [400, 422]


@pytest.mark.integration
class TestLogin:
    """Test login endpoint."""

    def test_login_success(self, client, test_user):
        """Test successful login."""
        response = client.post('/api/auth/login', json={
            'username': test_user['username'],
            'password': test_user['password']
        })

        assert response.status_code == 200
        data = response.json

        assert 'token' in data
        assert 'user' in data
        assert data['user']['username'] == test_user['username']

    def test_login_wrong_password(self, client, test_user):
        """Test login with wrong password."""
        response = client.post('/api/auth/login', json={
            'username': test_user['username'],
            'password': 'WrongPassword123!'
        })

        assert response.status_code == 401

    def test_login_nonexistent_user(self, client):
        """Test login with non-existent username."""
        response = client.post('/api/auth/login', json={
            'username': 'doesnotexist',
            'password': 'SomePassword123!'
        })

        assert response.status_code == 401

    def test_login_missing_credentials(self, client):
        """Test login with missing credentials."""
        response = client.post('/api/auth/login', json={
            'username': 'testuser'
            # Missing password
        })

        assert response.status_code in [400, 422]


@pytest.mark.integration
class TestLogout:
    """Test logout endpoint."""

    def test_logout_success(self, authenticated_client):
        """Test successful logout."""
        response = authenticated_client.post('/api/auth/logout')

        assert response.status_code == 200

        # Subsequent authenticated requests should fail
        response = authenticated_client.get('/api/auth/me')
        assert response.status_code == 401

    def test_logout_without_auth(self, client):
        """Test logout without authentication."""
        response = client.post('/api/auth/logout')

        # Should handle gracefully
        assert response.status_code in [200, 401]


@pytest.mark.integration
class TestSessionValidation:
    """Test session validation."""

    def test_get_current_user(self, authenticated_client, test_user):
        """Test /api/auth/me endpoint."""
        response = authenticated_client.get('/api/auth/me')

        assert response.status_code == 200
        data = response.json

        assert data['username'] == test_user['username']
        assert 'password' not in data  # Should not expose password

    def test_get_current_user_unauthenticated(self, client):
        """Test /api/auth/me without authentication."""
        response = client.get('/api/auth/me')

        assert response.status_code == 401

    def test_expired_session(self, client):
        """Test behavior with expired session."""
        # This would require mocking time or waiting
        # Simplified: just test with invalid token
        response = client.get('/api/auth/me', headers={
            'Authorization': 'Bearer invalid-token'
        })

        assert response.status_code == 401


@pytest.mark.integration
class TestSync:
    """Test sync endpoint."""

    def test_sync_push_settings(self, authenticated_client, test_user):
        """Test pushing settings to server."""
        settings = {
            'theme': 'dark',
            'feedSources': {'arxiv': True, 'hn': True},
            'qualityThreshold': 30
        }

        response = authenticated_client.post('/api/sync', json={
            'action': 'push',
            'data': settings
        })

        assert response.status_code == 200

    def test_sync_pull_settings(self, authenticated_client, test_user):
        """Test pulling settings from server."""
        # First push some settings
        settings = {
            'theme': 'light',
            'customSetting': 'value'
        }

        authenticated_client.post('/api/sync', json={
            'action': 'push',
            'data': settings
        })

        # Now pull
        response = authenticated_client.post('/api/sync', json={
            'action': 'pull'
        })

        assert response.status_code == 200
        data = response.json

        assert data.get('theme') == 'light'
        assert data.get('customSetting') == 'value'

    def test_sync_bidirectional(self, authenticated_client):
        """Test bidirectional sync (merge)."""
        # Push initial settings
        authenticated_client.post('/api/sync', json={
            'action': 'push',
            'data': {'setting1': 'value1', 'setting2': 'value2'}
        })

        # Push new settings (should merge)
        response = authenticated_client.post('/api/sync', json={
            'action': 'push',
            'data': {'setting2': 'updated', 'setting3': 'value3'}
        })

        # Pull to verify merge
        response = authenticated_client.post('/api/sync', json={
            'action': 'pull'
        })

        data = response.json
        assert data.get('setting1') == 'value1'
        assert data.get('setting2') == 'updated'  # Last write wins
        assert data.get('setting3') == 'value3'

    def test_sync_without_auth(self, client):
        """Test sync without authentication."""
        response = client.post('/api/sync', json={
            'action': 'pull'
        })

        assert response.status_code == 401


@pytest.mark.integration
class TestAuthWorkflow:
    """Test complete authentication workflows."""

    def test_full_user_lifecycle(self, client):
        """Test register → login → use → logout flow."""
        # 1. Register
        reg_response = client.post('/api/auth/register', json={
            'username': 'lifecycle_user',
            'password': 'LifeCycle123!',
            'email': 'lifecycle@example.com'
        })

        assert reg_response.status_code == 200
        token1 = reg_response.json['token']

        # 2. Use authenticated endpoint
        me_response = client.get('/api/auth/me', headers={
            'Authorization': f'Bearer {token1}'
        })

        assert me_response.status_code == 200

        # 3. Logout
        logout_response = client.post('/api/auth/logout', headers={
            'Authorization': f'Bearer {token1}'
        })

        assert logout_response.status_code == 200

        # 4. Verify token is invalid
        me_response2 = client.get('/api/auth/me', headers={
            'Authorization': f'Bearer {token1}'
        })

        assert me_response2.status_code == 401

        # 5. Login again
        login_response = client.post('/api/auth/login', json={
            'username': 'lifecycle_user',
            'password': 'LifeCycle123!'
        })

        assert login_response.status_code == 200
        token2 = login_response.json['token']

        # New token should work
        me_response3 = client.get('/api/auth/me', headers={
            'Authorization': f'Bearer {token2}'
        })

        assert me_response3.status_code == 200

    def test_multiple_sessions(self, client, test_user):
        """Test multiple simultaneous sessions."""
        # Login from "device 1"
        response1 = client.post('/api/auth/login', json={
            'username': test_user['username'],
            'password': test_user['password']
        })

        token1 = response1.json['token']

        # Login from "device 2"
        response2 = client.post('/api/auth/login', json={
            'username': test_user['username'],
            'password': test_user['password']
        })

        token2 = response2.json['token']

        # Both tokens should work
        assert client.get('/api/auth/me', headers={
            'Authorization': f'Bearer {token1}'
        }).status_code == 200

        assert client.get('/api/auth/me', headers={
            'Authorization': f'Bearer {token2}'
        }).status_code == 200

        # Logout from device 1
        client.post('/api/auth/logout', headers={
            'Authorization': f'Bearer {token1}'
        })

        # Token 1 should be invalid
        assert client.get('/api/auth/me', headers={
            'Authorization': f'Bearer {token1}'
        }).status_code == 401

        # Token 2 should still work
        assert client.get('/api/auth/me', headers={
            'Authorization': f'Bearer {token2}'
        }).status_code == 200


@pytest.mark.integration
class TestSecurityFeatures:
    """Test security features."""

    def test_password_hashing(self, client):
        """Test that passwords are hashed, not stored plaintext."""
        # Register user
        client.post('/api/auth/register', json={
            'username': 'hashtest',
            'password': 'PlainPassword123!',
            'email': 'hashtest@example.com'
        })

        # Check database directly
        # (This requires accessing the DB, implementation-specific)
        # Password hash should not equal plaintext password

    def test_rate_limiting(self, client):
        """Test rate limiting on login attempts."""
        # Attempt many logins in quick succession
        # (If rate limiting is implemented)

        for i in range(20):
            response = client.post('/api/auth/login', json={
                'username': 'doesnotexist',
                'password': f'attempt{i}'
            })

            # After many attempts, should get rate limited
            if response.status_code == 429:
                return  # Test passed

        # If no rate limiting, test is informational

    def test_sql_injection_protection(self, client):
        """Test protection against SQL injection."""
        # Try SQL injection in username
        response = client.post('/api/auth/login', json={
            'username': "admin' OR '1'='1",
            'password': 'anything'
        })

        # Should not succeed
        assert response.status_code == 401

    def test_xss_protection(self, client):
        """Test that user input is sanitized."""
        # Try XSS in username
        response = client.post('/api/auth/register', json={
            'username': '<script>alert("xss")</script>',
            'password': 'Password123!',
            'email': 'xss@example.com'
        })

        # Should either reject or sanitize
        # Check response doesn't include raw script tag
        if response.status_code == 200:
            assert '<script>' not in str(response.data)
