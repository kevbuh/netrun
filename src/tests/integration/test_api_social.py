"""
Integration tests for social API routes.

Tests remaining social endpoints:
- PUT /api/users/me/picture - Update user picture (file upload)
- PUT /api/users/me/background - Update user background (file upload)
"""

import pytest

# Add src to path
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))


@pytest.fixture
def auth_user(client):
    """Create and authenticate a test user."""
    from users import upsert_google_user, create_session

    google_id = 'test_google_123'
    upsert_google_user(google_id, 'test@example.com', 'Test User', 'https://pic.url')
    token = create_session(google_id)

    return {
        'google_id': google_id,
        'email': 'test@example.com',
        'name': 'Test User',
        'token': token,
        'headers': {'Authorization': f'Bearer {token}'}
    }


@pytest.mark.integration
class TestUserSettings:
    """Test user settings endpoints that remain on Flask (file uploads)."""

    def test_update_user_picture(self, client, auth_user):
        """Test updating user picture."""
        response = client.put('/api/users/me/picture',
            headers=auth_user['headers'],
            json={'image': 'data:image/png;base64,iVBORw0KGgo='}
        )

        assert response.status_code == 200
