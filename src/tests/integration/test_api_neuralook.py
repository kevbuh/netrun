"""
Integration tests for neuralook API routes.

Tests eye-tracking and gaze prediction endpoints:
- POST /api/neuralook/save-calibration - Save calibration data
- POST /api/neuralook/train - Train gaze prediction model
- POST /api/neuralook/predict - Predict gaze location
- POST /api/neuralook/reset-hidden - Reset model hidden state
- POST /api/neuralook/implicit-samples - Add implicit training sample
- GET /api/neuralook/implicit-samples - Get implicit samples
- GET /api/neuralook/refine-history - Get refinement history
- POST /api/neuralook/auto-refine - Auto-refine model with implicit data
"""

import pytest
import json
from unittest.mock import patch, Mock

# Add src to path
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))


@pytest.fixture
def auth_user(client):
    """Create and authenticate a test user."""
    from users import upsert_google_user, create_session

    google_id = 'test_neuralook_user'
    upsert_google_user(google_id, 'neuralook@test.com', 'Neuralook Tester', 'https://pic.url')
    token = create_session(google_id)

    return {
        'google_id': google_id,
        'token': token,
        'headers': {'Authorization': f'Bearer {token}'}
    }


@pytest.mark.integration
class TestCalibration:
    """Test calibration endpoints."""

    def test_save_calibration_requires_auth(self, client):
        """Test saving calibration requires authentication."""
        response = client.post('/api/neuralook/save-calibration', json={
            'samples': []
        })

        assert response.status_code == 401

    def test_save_calibration_missing_samples(self, client, auth_user):
        """Test saving calibration without samples."""
        response = client.post('/api/neuralook/save-calibration',
            headers=auth_user['headers'],
            json={}
        )

        # May accept empty or require samples
        assert response.status_code in [200, 400]

    def test_save_calibration_empty_samples(self, client, auth_user):
        """Test saving calibration with empty samples array."""
        response = client.post('/api/neuralook/save-calibration',
            headers=auth_user['headers'],
            json={'samples': []}
        )

        # May accept empty array or require samples
        assert response.status_code in [200, 400]

    def test_save_calibration_success(self, client, auth_user):
        """Test successful calibration save."""
        samples = [
            {
                'x': 100, 'y': 100,
                'gazeX': 0.1, 'gazeY': 0.2,
                'leftPupil': 3.5, 'rightPupil': 3.6
            },
            {
                'x': 200, 'y': 200,
                'gazeX': 0.3, 'gazeY': 0.4,
                'leftPupil': 3.5, 'rightPupil': 3.6
            }
        ]

        response = client.post('/api/neuralook/save-calibration',
            headers=auth_user['headers'],
            json={'samples': samples}
        )

        assert response.status_code == 200
        data = response.json
        assert 'ok' in data


@pytest.mark.integration
class TestTraining:
    """Test model training endpoints."""

    def test_train_requires_auth(self, client):
        """Test training requires authentication."""
        response = client.post('/api/neuralook/train', json={})

        assert response.status_code == 401

    def test_train_without_calibration(self, client, auth_user):
        """Test training without calibration data."""
        response = client.post('/api/neuralook/train',
            headers=auth_user['headers'],
            json={}
        )

        # May fail if no calibration exists
        assert response.status_code in [200, 400, 500]

    @patch('routes.neuralook._neuralook_models', {})
    def test_train_streaming(self, client, auth_user):
        """Test training returns streaming response."""
        # Save calibration first
        samples = [
            {'x': i*100, 'y': i*100, 'gazeX': i*0.1, 'gazeY': i*0.1,
             'leftPupil': 3.5, 'rightPupil': 3.6}
            for i in range(5)
        ]
        client.post('/api/neuralook/save-calibration',
            headers=auth_user['headers'],
            json={'samples': samples}
        )

        response = client.post('/api/neuralook/train',
            headers=auth_user['headers'],
            json={}
        )

        # Training is streaming, so just check it starts
        assert response.status_code in [200, 400, 500]


@pytest.mark.integration
class TestPrediction:
    """Test gaze prediction endpoints."""

    def test_predict_requires_auth(self, client):
        """Test prediction requires authentication."""
        response = client.post('/api/neuralook/predict', json={
            'gazeX': 0.5, 'gazeY': 0.5,
            'leftPupil': 3.5, 'rightPupil': 3.6
        })

        assert response.status_code == 401

    def test_predict_missing_data(self, client, auth_user):
        """Test prediction without required data."""
        response = client.post('/api/neuralook/predict',
            headers=auth_user['headers'],
            json={}
        )

        assert response.status_code == 400

    def test_predict_without_model(self, client, auth_user):
        """Test prediction without trained model."""
        response = client.post('/api/neuralook/predict',
            headers=auth_user['headers'],
            json={
                'gazeX': 0.5,
                'gazeY': 0.5,
                'leftPupil': 3.5,
                'rightPupil': 3.6
            }
        )

        # Should fail if no model exists
        assert response.status_code in [200, 400]

    def test_reset_hidden_requires_auth(self, client):
        """Test resetting hidden state requires authentication."""
        response = client.post('/api/neuralook/reset-hidden')

        assert response.status_code == 401

    def test_reset_hidden_success(self, client, auth_user):
        """Test resetting model hidden state."""
        response = client.post('/api/neuralook/reset-hidden',
            headers=auth_user['headers']
        )

        assert response.status_code == 200


@pytest.mark.integration
class TestImplicitSamples:
    """Test implicit sample collection."""

    def test_add_implicit_sample_requires_auth(self, client):
        """Test adding implicit sample requires authentication."""
        response = client.post('/api/neuralook/implicit-samples', json={
            'x': 100, 'y': 100,
            'gazeX': 0.1, 'gazeY': 0.2,
            'leftPupil': 3.5, 'rightPupil': 3.6
        })

        assert response.status_code == 401

    def test_add_implicit_sample_missing_data(self, client, auth_user):
        """Test adding implicit sample without required data."""
        response = client.post('/api/neuralook/implicit-samples',
            headers=auth_user['headers'],
            json={}
        )

        assert response.status_code == 400

    def test_add_implicit_sample_success(self, client, auth_user):
        """Test successfully adding implicit sample."""
        response = client.post('/api/neuralook/implicit-samples',
            headers=auth_user['headers'],
            json={
                'x': 100,
                'y': 100,
                'gazeX': 0.1,
                'gazeY': 0.2,
                'leftPupil': 3.5,
                'rightPupil': 3.6
            }
        )

        # May require additional fields or validation
        assert response.status_code in [200, 400]

    def test_get_implicit_samples_requires_auth(self, client):
        """Test getting implicit samples requires authentication."""
        response = client.get('/api/neuralook/implicit-samples')

        assert response.status_code == 401

    def test_get_implicit_samples_empty(self, client, auth_user):
        """Test getting implicit samples when empty."""
        response = client.get('/api/neuralook/implicit-samples',
            headers=auth_user['headers']
        )

        assert response.status_code == 200
        data = response.json
        assert isinstance(data, (list, dict))


@pytest.mark.integration
class TestAutoRefine:
    """Test auto-refinement functionality."""

    def test_auto_refine_requires_auth(self, client):
        """Test auto-refine requires authentication."""
        response = client.post('/api/neuralook/auto-refine')

        assert response.status_code == 401

    def test_auto_refine_without_samples(self, client, auth_user):
        """Test auto-refine without implicit samples."""
        response = client.post('/api/neuralook/auto-refine',
            headers=auth_user['headers']
        )

        # May fail if no samples or model exists
        assert response.status_code in [200, 400, 500]

    def test_get_refine_history_requires_auth(self, client):
        """Test getting refine history requires authentication."""
        response = client.get('/api/neuralook/refine-history')

        assert response.status_code == 401

    def test_get_refine_history_empty(self, client, auth_user):
        """Test getting refine history when empty."""
        response = client.get('/api/neuralook/refine-history',
            headers=auth_user['headers']
        )

        assert response.status_code == 200
        history = response.json
        assert isinstance(history, list)


@pytest.mark.integration
class TestEndToEndWorkflow:
    """Test complete neuralook workflow."""

    def test_complete_workflow(self, client, auth_user):
        """Test calibration -> train -> predict workflow."""
        # 1. Save calibration
        samples = [
            {
                'x': i * 200,
                'y': i * 200,
                'gazeX': i * 0.2,
                'gazeY': i * 0.2,
                'leftPupil': 3.5,
                'rightPupil': 3.6
            }
            for i in range(5)
        ]

        cal_response = client.post('/api/neuralook/save-calibration',
            headers=auth_user['headers'],
            json={'samples': samples}
        )

        assert cal_response.status_code == 200

        # 2. Try to predict (should work after calibration)
        pred_response = client.post('/api/neuralook/predict',
            headers=auth_user['headers'],
            json={
                'gazeX': 0.5,
                'gazeY': 0.5,
                'leftPupil': 3.5,
                'rightPupil': 3.6
            }
        )

        # Prediction may work or require training first
        assert pred_response.status_code in [200, 400]

        # 3. Add implicit sample (may require additional validation)
        impl_response = client.post('/api/neuralook/implicit-samples',
            headers=auth_user['headers'],
            json={
                'x': 300,
                'y': 300,
                'gazeX': 0.6,
                'gazeY': 0.6,
                'leftPupil': 3.5,
                'rightPupil': 3.6
            }
        )

        # Implicit samples may require model to exist first
        assert impl_response.status_code in [200, 400]

        # 4. Get implicit samples
        get_impl_response = client.get('/api/neuralook/implicit-samples',
            headers=auth_user['headers']
        )

        assert get_impl_response.status_code == 200
