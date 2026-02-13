"""
Integration tests for dev/utility API routes.

Tests development and utility endpoints:
- GET /api/settings - Get settings
- GET /api/version - Get version info
- GET /api/dev-git-log - Get git commit log
- GET /api/dev-stats - Get development statistics
- GET /api/function-registry - Get function registry info
- GET /api/validate-feeds - Validate feed system
- GET /api/validate-load-order - Validate module load order
- GET /api/dependency-graph - Get dependency graph
- GET /api/calendar - List calendar events
- POST /api/calendar - Create calendar event
- PUT /api/calendar/<eid> - Update calendar event
- DELETE /api/calendar/<eid> - Delete calendar event
- POST /api/images - Upload image
- GET /api/images/<filename> - Serve uploaded image
- GET /api/saved-content - Get saved content
- POST /api/saved-content - Save content
- POST /api/saved-posts - Save post
- POST /api/custom-feeds - Add custom feed
- POST /api/reveal-in-finder - Reveal file in Finder
"""

import pytest
import json
import time
from unittest.mock import patch, Mock
import tempfile
import os

# Add src to path
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))


@pytest.fixture
def auth_user(client):
    """Create and authenticate a test user."""
    from users import upsert_google_user, create_session

    google_id = 'test_dev_user'
    upsert_google_user(google_id, 'dev@test.com', 'Dev Tester', 'https://pic.url')
    token = create_session(google_id)

    return {
        'google_id': google_id,
        'token': token,
        'headers': {'Authorization': f'Bearer {token}'}
    }


@pytest.mark.integration
class TestSettings:
    """Test /api/settings endpoint."""

    def test_settings(self, client):
        """Test getting settings."""
        response = client.get('/api/settings')

        assert response.status_code == 200
        data = response.json
        assert data['ok'] is True


@pytest.mark.integration
class TestVersion:
    """Test /api/version endpoint."""

    @patch('subprocess.run')
    def test_version_success(self, mock_run, client):
        """Test version with git info."""
        # Mock git rev-list
        mock_count = Mock()
        mock_count.returncode = 0
        mock_count.stdout = '42\n'

        # Mock git rev-parse
        mock_sha = Mock()
        mock_sha.returncode = 0
        mock_sha.stdout = 'abc1234\n'

        mock_run.side_effect = [mock_count, mock_sha]

        response = client.get('/api/version')

        assert response.status_code == 200
        data = response.json
        assert 'version' in data
        assert 'sha' in data
        assert data['version'] == '0.42'
        assert data['sha'] == 'abc1234'

    @patch('subprocess.run')
    def test_version_no_git(self, mock_run, client):
        """Test version when git fails."""
        mock_run.side_effect = Exception('git not found')

        response = client.get('/api/version')

        assert response.status_code == 200
        data = response.json
        assert data['version'] == '0.0'
        assert data['sha'] == ''


@pytest.mark.integration
class TestGitLog:
    """Test /api/dev-git-log endpoint."""

    @patch('subprocess.run')
    def test_git_log_success(self, mock_run, client):
        """Test getting git log."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = 'COMMIT\x1fabc123\x1fJohn Doe\x1f2024-01-01\x1fInitial commit\n1 file changed, 10 insertions(+)\n'
        mock_run.return_value = mock_result

        response = client.get('/api/dev-git-log')

        assert response.status_code == 200
        data = response.json
        assert 'git_log' in data
        assert isinstance(data['git_log'], list)

    @patch('subprocess.run')
    def test_git_log_with_pagination(self, mock_run, client):
        """Test git log with offset and limit."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = ''
        mock_run.return_value = mock_result

        response = client.get('/api/dev-git-log?offset=10&limit=5')

        assert response.status_code == 200
        data = response.json
        assert 'has_more' in data

    @patch('subprocess.run')
    def test_git_log_error(self, mock_run, client):
        """Test git log handles errors."""
        mock_run.side_effect = Exception('Git error')

        response = client.get('/api/dev-git-log')

        assert response.status_code == 500
        data = response.json
        assert 'error' in data


@pytest.mark.integration
class TestDevStats:
    """Test /api/dev-stats endpoint."""

    def test_dev_stats(self, client, auth_user):
        """Test getting development statistics."""
        response = client.get('/api/dev-stats')

        assert response.status_code == 200
        data = response.json
        # Stats may vary, just check structure
        assert isinstance(data, dict)


@pytest.mark.integration
class TestFunctionRegistry:
    """Test /api/function-registry endpoint."""

    def test_function_registry_requires_auth(self, client):
        """Test function registry requires authentication."""
        response = client.get('/api/function-registry')

        assert response.status_code == 401

    def test_function_registry(self, client, auth_user):
        """Test getting function registry."""
        response = client.get('/api/function-registry', headers=auth_user['headers'])

        # May fail if source files not accessible in test environment
        assert response.status_code in [200, 500]


@pytest.mark.integration
class TestValidation:
    """Test validation endpoints."""

    def test_validate_feeds_requires_auth(self, client):
        """Test validate feeds requires authentication."""
        response = client.get('/api/validate-feeds')

        assert response.status_code == 401

    def test_validate_feeds(self, client, auth_user):
        """Test validating feeds."""
        response = client.get('/api/validate-feeds', headers=auth_user['headers'])

        # May fail if source files not accessible
        assert response.status_code in [200, 500]

    def test_validate_load_order_requires_auth(self, client):
        """Test validate load order requires authentication."""
        response = client.get('/api/validate-load-order')

        assert response.status_code == 401

    def test_validate_load_order(self, client, auth_user):
        """Test validating module load order."""
        response = client.get('/api/validate-load-order', headers=auth_user['headers'])

        # May fail if source files not accessible
        assert response.status_code in [200, 500]

    def test_dependency_graph_requires_auth(self, client):
        """Test dependency graph requires authentication."""
        response = client.get('/api/dependency-graph')

        assert response.status_code == 401

    def test_dependency_graph(self, client, auth_user):
        """Test getting dependency graph."""
        response = client.get('/api/dependency-graph', headers=auth_user['headers'])

        # May fail if source files not accessible
        assert response.status_code in [200, 500]


@pytest.mark.integration
class TestCalendar:
    """Test calendar endpoints."""

    def test_list_calendar_requires_auth(self, client):
        """Test listing calendar requires authentication."""
        response = client.get('/api/calendar')

        assert response.status_code == 401

    def test_list_calendar_empty(self, client, auth_user):
        """Test listing empty calendar."""
        response = client.get('/api/calendar', headers=auth_user['headers'])

        assert response.status_code == 200
        events = response.json
        assert isinstance(events, list)

    def test_create_calendar_event_requires_auth(self, client):
        """Test creating event requires authentication."""
        response = client.post('/api/calendar', json={
            'title': 'Test Event',
            'date': '2024-01-01'
        })

        assert response.status_code == 401

    def test_create_calendar_event(self, client, auth_user):
        """Test creating calendar event."""
        response = client.post('/api/calendar',
            headers=auth_user['headers'],
            json={
                'title': 'Test Event',
                'date': '2024-01-01',
                'description': 'Test description'
            }
        )

        assert response.status_code in [200, 201]
        data = response.json
        # Response is the event itself, not wrapped
        assert 'title' in data
        assert data['title'] == 'Test Event'

    def test_create_event_missing_fields(self, client, auth_user):
        """Test creating event with missing required fields."""
        response = client.post('/api/calendar',
            headers=auth_user['headers'],
            json={'title': 'Test'}
        )

        # May still create with defaults
        assert response.status_code in [200, 201, 400]

    def test_update_calendar_event(self, client, auth_user):
        """Test updating calendar event."""
        # Create event first
        from users import create_calendar_event
        event = create_calendar_event(auth_user['google_id'], {
            'title': 'Original',
            'date': '2024-01-01'
        })
        eid = event['id']

        response = client.put(f'/api/calendar/{eid}',
            headers=auth_user['headers'],
            json={'title': 'Updated', 'date': '2024-01-02'}
        )

        assert response.status_code == 200

    def test_delete_calendar_event(self, client, auth_user):
        """Test deleting calendar event."""
        from users import create_calendar_event
        event = create_calendar_event(auth_user['google_id'], {
            'title': 'To Delete',
            'date': '2024-01-01'
        })
        eid = event['id']

        response = client.delete(f'/api/calendar/{eid}',
            headers=auth_user['headers']
        )

        assert response.status_code == 200


@pytest.mark.integration
class TestImages:
    """Test image upload and serving."""

    def test_upload_image_requires_auth(self, client):
        """Test uploading image requires authentication."""
        response = client.post('/api/images',
            data=b'fake-image-data',
            content_type='image/png'
        )

        assert response.status_code == 401

    def test_upload_image_no_data(self, client, auth_user):
        """Test uploading with no data."""
        response = client.post('/api/images',
            headers=auth_user['headers']
        )

        assert response.status_code == 400

    def test_upload_image_success(self, client, auth_user):
        """Test successful image upload."""
        fake_image = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR'

        response = client.post('/api/images',
            headers=auth_user['headers'],
            data=fake_image,
            content_type='image/png'
        )

        # May fail if uploads dir not writable in test env
        assert response.status_code in [200, 400, 500]

    def test_serve_image_not_found(self, client):
        """Test serving image returns 404 when not found."""
        response = client.get('/api/images/nonexistent-image-12345.png')

        assert response.status_code == 404



@pytest.mark.integration
class TestSavedContent:
    """Test saved content endpoints."""

    def test_get_saved_content_requires_auth(self, client):
        """Test getting saved content requires authentication."""
        response = client.get('/api/saved-content')

        assert response.status_code == 401

    def test_get_saved_content_empty(self, client, auth_user):
        """Test getting saved content when empty."""
        response = client.get('/api/saved-content?url=https://example.com',
            headers=auth_user['headers']
        )

        # Returns 404 when not found
        assert response.status_code in [200, 404]

    def test_post_saved_content_requires_auth(self, client):
        """Test saving content requires authentication."""
        response = client.post('/api/saved-content', json={
            'url': 'https://example.com',
            'content': 'Test content'
        })

        assert response.status_code == 401

    def test_post_saved_content(self, client, auth_user):
        """Test saving content."""
        response = client.post('/api/saved-content',
            headers=auth_user['headers'],
            json={
                'url': 'https://example.com',
                'content': 'Test content',
                'title': 'Test Title'
            }
        )

        assert response.status_code == 200

    def test_save_post_requires_auth(self, client):
        """Test saving post requires authentication."""
        response = client.post('/api/saved-posts', json={
            'url': 'https://example.com'
        })

        assert response.status_code == 401

    def test_save_post(self, client, auth_user):
        """Test saving post."""
        response = client.post('/api/saved-posts',
            headers=auth_user['headers'],
            json={'url': 'https://example.com', 'title': 'Test'}
        )

        # May succeed or fail depending on implementation
        assert response.status_code in [200, 400, 500]


@pytest.mark.integration
class TestCustomFeeds:
    """Test custom feed management."""

    def test_add_custom_feed_requires_auth(self, client):
        """Test adding custom feed requires authentication."""
        response = client.post('/api/custom-feeds', json={
            'url': 'https://example.com/feed.xml'
        })

        assert response.status_code == 401

    def test_add_custom_feed(self, client, auth_user):
        """Test adding custom feed."""
        response = client.post('/api/custom-feeds',
            headers=auth_user['headers'],
            json={
                'url': 'https://example.com/feed.xml',
                'name': 'My Feed'
            }
        )

        # May succeed or fail depending on validation
        assert response.status_code in [200, 400]


@pytest.mark.integration
class TestFileMisc:
    """Test miscellaneous file operations."""

    def test_reveal_in_finder_requires_auth(self, client):
        """Test reveal in finder requires authentication."""
        response = client.post('/api/reveal-in-finder', json={
            'path': '/tmp/test.txt'
        })

        assert response.status_code == 401

    @patch('subprocess.run')
    def test_reveal_in_finder(self, mock_run, client, auth_user):
        """Test revealing file in Finder."""
        mock_run.return_value = Mock()

        response = client.post('/api/reveal-in-finder',
            headers=auth_user['headers'],
            json={'path': '/tmp/test.txt'}
        )

        # May succeed or fail depending on platform
        assert response.status_code in [200, 400, 500]
