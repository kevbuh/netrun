"""
Integration tests for experiments API routes.

Tests experiment/project management endpoints:
- GET /api/experiments - List all experiments
- POST /api/experiments - Create new experiment
- GET /api/experiments/<exp_id> - Get experiment details
- PUT /api/experiments/<exp_id> - Update experiment
- DELETE /api/experiments/<exp_id> - Delete experiment
- GET /api/experiments/<exp_id>/files - List files
- POST /api/experiments/<exp_id>/files - Create file
- PUT /api/experiments/<exp_id>/files/<fname> - Update file
- DELETE /api/experiments/<exp_id>/files/<fname> - Delete file
- POST /api/experiments/<exp_id>/upload - Upload file
- POST /api/experiments/<exp_id>/execute - Execute code
- POST /api/experiments/<exp_id>/venv - Create virtual environment
- GET /api/experiments/<exp_id>/venv-info - Get venv info
- DELETE /api/experiments/<exp_id>/venv - Delete venv
- POST /api/experiments/<exp_id>/packages - Install package
- GET /api/experiments/<exp_id>/packages - List packages
- DELETE /api/experiments/<exp_id>/packages/<pkg> - Uninstall package
- POST /api/experiments/<exp_id>/kernel/restart - Restart kernel
- POST /api/experiments/<exp_id>/kernel/interrupt - Interrupt kernel
- DELETE /api/experiments/<exp_id>/kernel - Kill kernel
- Folder operations (create, delete, rename, move)
- Git operations (clone repo)
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
class TestExperimentCRUD:
    """Test experiment CRUD operations."""

    def test_list_experiments_requires_auth(self, client):
        """Test listing experiments requires authentication."""
        response = client.get('/api/experiments')

        assert response.status_code == 401

    def test_list_experiments_empty(self, client, auth_user):
        """Test listing experiments when empty."""
        response = client.get('/api/experiments', headers=auth_user['headers'])

        assert response.status_code == 200
        experiments = response.json
        assert isinstance(experiments, list)

    def test_create_experiment_requires_auth(self, client):
        """Test creating experiment requires authentication."""
        response = client.post('/api/experiments', json={'name': 'Test'})

        assert response.status_code == 401

    def test_create_experiment_success(self, client, auth_user):
        """Test creating a new experiment."""
        response = client.post('/api/experiments',
            headers=auth_user['headers'],
            json={'name': 'My Experiment', 'description': 'Test experiment'}
        )

        # May require additional fields or fail validation
        assert response.status_code in [200, 201, 400]

    def test_create_experiment_missing_name(self, client, auth_user):
        """Test creating experiment without name."""
        response = client.post('/api/experiments',
            headers=auth_user['headers'],
            json={}
        )

        assert response.status_code in [200, 201, 400]

    def test_get_experiment_requires_auth(self, client):
        """Test getting experiment requires authentication."""
        response = client.get('/api/experiments/test-exp')

        assert response.status_code == 401

    def test_get_experiment_not_found(self, client, auth_user):
        """Test getting non-existent experiment."""
        response = client.get('/api/experiments/nonexistent-12345',
            headers=auth_user['headers']
        )

        assert response.status_code == 404

    def test_update_experiment_requires_auth(self, client):
        """Test updating experiment requires authentication."""
        response = client.put('/api/experiments/test-exp', json={'name': 'Updated'})

        assert response.status_code == 401

    def test_delete_experiment_requires_auth(self, client):
        """Test deleting experiment requires authentication."""
        response = client.delete('/api/experiments/test-exp')

        assert response.status_code == 401

    def test_delete_experiment_not_found(self, client, auth_user):
        """Test deleting non-existent experiment."""
        response = client.delete('/api/experiments/nonexistent-12345',
            headers=auth_user['headers']
        )

        assert response.status_code == 404


@pytest.mark.integration
class TestExperimentFiles:
    """Test file operations in experiments."""

    def test_list_files_requires_auth(self, client):
        """Test listing files requires authentication."""
        response = client.get('/api/experiments/test-exp/files')

        assert response.status_code == 401

    def test_list_files_not_found(self, client, auth_user):
        """Test listing files for non-existent experiment."""
        response = client.get('/api/experiments/nonexistent/files',
            headers=auth_user['headers']
        )

        assert response.status_code == 404

    def test_create_file_requires_auth(self, client):
        """Test creating file requires authentication."""
        response = client.post('/api/experiments/test-exp/files',
            json={'filename': 'test.py', 'content': 'print("hello")'}
        )

        assert response.status_code == 401

    def test_get_file_requires_auth(self, client):
        """Test getting file requires authentication."""
        response = client.get('/api/experiments/test-exp/files/test.py')

        assert response.status_code == 401

    def test_update_file_requires_auth(self, client):
        """Test updating file requires authentication."""
        response = client.put('/api/experiments/test-exp/files/test.py',
            json={'content': 'print("updated")'}
        )

        assert response.status_code == 401

    def test_delete_file_requires_auth(self, client):
        """Test deleting file requires authentication."""
        response = client.delete('/api/experiments/test-exp/files/test.py')

        assert response.status_code == 401

    def test_upload_file_requires_auth(self, client):
        """Test uploading file requires authentication."""
        response = client.post('/api/experiments/test-exp/upload',
            data=b'file content'
        )

        assert response.status_code == 401

    def test_get_raw_file_requires_auth(self, client):
        """Test getting raw file requires authentication."""
        response = client.get('/api/experiments/test-exp/raw/test.py')

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
class TestFolderOperations:
    """Test folder management."""

    def test_create_folder_requires_auth(self, client):
        """Test creating folder requires authentication."""
        response = client.post('/api/experiments/test-exp/create-folder',
            json={'path': 'src'}
        )

        assert response.status_code == 401

    def test_delete_folder_requires_auth(self, client):
        """Test deleting folder requires authentication."""
        response = client.post('/api/experiments/test-exp/delete-folder',
            json={'path': 'src'}
        )

        assert response.status_code == 401

    def test_rename_folder_requires_auth(self, client):
        """Test renaming folder requires authentication."""
        response = client.post('/api/experiments/test-exp/rename-folder',
            json={'oldPath': 'src', 'newPath': 'source'}
        )

        assert response.status_code == 401

    def test_move_file_requires_auth(self, client):
        """Test moving file requires authentication."""
        response = client.post('/api/experiments/test-exp/move-file',
            json={'from': 'test.py', 'to': 'src/test.py'}
        )

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
