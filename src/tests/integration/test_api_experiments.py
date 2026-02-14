"""
Integration tests for experiments API routes.

Tests remaining experiment endpoints:
- POST /api/experiments/<exp_id>/upload - Upload file
- POST /api/experiments/<exp_id>/execute - Execute code
- GET /api/experiments/<exp_id>/compile-tex/<fname> - Compile TeX
- POST /api/experiments/<exp_id>/venv - Create virtual environment
- GET /api/experiments/<exp_id>/venv-info - Get venv info
- DELETE /api/experiments/<exp_id>/venv - Delete venv
- GET /api/venvs - List all venvs
- POST /api/experiments/<exp_id>/packages - Install package
- GET /api/experiments/<exp_id>/packages - List packages
- DELETE /api/experiments/<exp_id>/packages/<pkg> - Uninstall package
- POST /api/experiments/<exp_id>/kernel/restart - Restart kernel
- POST /api/experiments/<exp_id>/kernel/interrupt - Interrupt kernel
- DELETE /api/experiments/<exp_id>/kernel - Kill kernel
- POST /api/experiments/<exp_id>/clone-repo - Clone git repo
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

    google_id = 'test_exp_user'
    upsert_google_user(google_id, 'exp@test.com', 'Exp Tester', 'https://pic.url')
    token = create_session(google_id)

    return {
        'google_id': google_id,
        'token': token,
        'headers': {'Authorization': f'Bearer {token}'}
    }


@pytest.mark.integration
class TestFileUploadAndCompile:
    """Test file upload and TeX compilation."""

    def test_upload_file_requires_auth(self, client):
        """Test uploading file requires authentication."""
        response = client.post('/api/experiments/test-exp/upload',
            data=b'file content'
        )

        assert response.status_code == 401

    def test_compile_tex_requires_auth(self, client):
        """Test compiling TeX requires authentication."""
        response = client.get('/api/experiments/test-exp/compile-tex/doc.tex')

        assert response.status_code == 401


@pytest.mark.integration
class TestCodeExecution:
    """Test code execution functionality."""

    def test_execute_code_requires_auth(self, client):
        """Test executing code requires authentication."""
        response = client.post('/api/experiments/test-exp/execute',
            json={'code': 'print("hello")'}
        )

        assert response.status_code == 401

    def test_execute_code_missing_code(self, client, auth_user):
        """Test executing without code."""
        response = client.post('/api/experiments/nonexistent/execute',
            headers=auth_user['headers'],
            json={}
        )

        # Should fail - experiment doesn't exist
        assert response.status_code in [400, 404]

    def test_restart_kernel_requires_auth(self, client):
        """Test restarting kernel requires authentication."""
        response = client.post('/api/experiments/test-exp/kernel/restart')

        assert response.status_code == 401

    def test_interrupt_kernel_requires_auth(self, client):
        """Test interrupting kernel requires authentication."""
        response = client.post('/api/experiments/test-exp/kernel/interrupt')

        assert response.status_code == 401

    def test_kill_kernel_requires_auth(self, client):
        """Test killing kernel requires authentication."""
        response = client.delete('/api/experiments/test-exp/kernel')

        assert response.status_code == 401


@pytest.mark.integration
class TestVirtualEnvironment:
    """Test virtual environment management."""

    def test_create_venv_requires_auth(self, client):
        """Test creating venv requires authentication."""
        response = client.post('/api/experiments/test-exp/venv')

        assert response.status_code == 401

    def test_get_venv_info_requires_auth(self, client):
        """Test getting venv info requires authentication."""
        response = client.get('/api/experiments/test-exp/venv-info')

        assert response.status_code == 401

    def test_delete_venv_requires_auth(self, client):
        """Test deleting venv requires authentication."""
        response = client.delete('/api/experiments/test-exp/venv')

        assert response.status_code == 401

    def test_list_venvs_requires_auth(self, client):
        """Test listing all venvs requires authentication."""
        response = client.get('/api/venvs')

        assert response.status_code == 401

    def test_list_venvs(self, client, auth_user):
        """Test listing all virtual environments."""
        response = client.get('/api/venvs', headers=auth_user['headers'])

        assert response.status_code == 200
        venvs = response.json
        assert isinstance(venvs, list)


@pytest.mark.integration
class TestPackageManagement:
    """Test package installation/management."""

    def test_install_package_requires_auth(self, client):
        """Test installing package requires authentication."""
        response = client.post('/api/experiments/test-exp/packages',
            json={'packages': ['numpy']}
        )

        assert response.status_code == 401

    def test_install_package_missing_packages(self, client, auth_user):
        """Test installing without package list."""
        response = client.post('/api/experiments/nonexistent/packages',
            headers=auth_user['headers'],
            json={}
        )

        assert response.status_code in [400, 404]

    def test_list_packages_requires_auth(self, client):
        """Test listing packages requires authentication."""
        response = client.get('/api/experiments/test-exp/packages')

        assert response.status_code == 401

    def test_uninstall_package_requires_auth(self, client):
        """Test uninstalling package requires authentication."""
        response = client.delete('/api/experiments/test-exp/packages/numpy')

        assert response.status_code == 401


@pytest.mark.integration
class TestGitOperations:
    """Test git repository operations."""

    def test_clone_repo_requires_auth(self, client):
        """Test cloning repo requires authentication."""
        response = client.post('/api/experiments/test-exp/clone-repo',
            json={'url': 'https://github.com/example/repo'}
        )

        assert response.status_code == 401

    def test_clone_repo_missing_url(self, client, auth_user):
        """Test cloning repo without URL."""
        response = client.post('/api/experiments/nonexistent/clone-repo',
            headers=auth_user['headers'],
            json={}
        )

        assert response.status_code in [400, 404]
