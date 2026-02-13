"""
Integration tests for media API routes.

Tests media processing endpoints:
- POST /api/transcribe - Transcribe audio using Whisper
- POST /api/tts - Text-to-speech using Kokoro
"""

import pytest
from unittest.mock import patch, Mock

# Add src to path
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))


@pytest.fixture
def auth_user(client):
    """Create and authenticate a test user."""
    from users import upsert_google_user, create_session

    google_id = 'test_media_user'
    upsert_google_user(google_id, 'media@test.com', 'Media Tester', 'https://pic.url')
    token = create_session(google_id)

    return {
        'google_id': google_id,
        'token': token,
        'headers': {'Authorization': f'Bearer {token}'}
    }


@pytest.mark.integration
class TestTranscribe:
    """Test /api/transcribe endpoint."""

    def test_transcribe_requires_auth(self, client):
        """Test that transcription requires authentication."""
        response = client.post('/api/transcribe', data=b'fake-audio-data')

        assert response.status_code == 401

    def test_transcribe_no_data(self, client, auth_user):
        """Test transcription with no audio data returns error."""
        response = client.post('/api/transcribe', headers=auth_user['headers'])

        assert response.status_code == 400
        data = response.json
        assert 'error' in data

    @patch('pywhispercpp.model.Model')
    @patch('subprocess.run')
    @patch('os.remove')
    def test_transcribe_success(self, mock_remove, mock_subprocess, mock_whisper_class, client, auth_user):
        """Test successful audio transcription."""
        # Mock Whisper model
        mock_segment = Mock()
        mock_segment.text = 'Hello world'
        mock_model = Mock()
        mock_model.transcribe.return_value = [mock_segment]
        mock_whisper_class.return_value = mock_model

        # Mock subprocess (ffmpeg)
        mock_subprocess.return_value = Mock()

        fake_audio = b'fake-webm-audio-data'
        response = client.post('/api/transcribe',
            headers=auth_user['headers'],
            data=fake_audio,
            content_type='audio/webm'
        )

        assert response.status_code == 200
        data = response.json
        assert 'text' in data
        assert data['text'] == 'Hello world'

    @patch('pywhispercpp.model.Model')
    @patch('subprocess.run')
    @patch('os.remove')
    def test_transcribe_filters_noise(self, mock_remove, mock_subprocess, mock_whisper_class, client, auth_user):
        """Test that noise markers are filtered out."""
        mock_segment = Mock()
        mock_segment.text = '[BLANK_AUDIO]'
        mock_model = Mock()
        mock_model.transcribe.return_value = [mock_segment]
        mock_whisper_class.return_value = mock_model

        mock_subprocess.return_value = Mock()

        response = client.post('/api/transcribe',
            headers=auth_user['headers'],
            data=b'fake-audio',
            content_type='audio/webm'
        )

        assert response.status_code == 200
        data = response.json
        assert data['text'] == ''

    @patch('pywhispercpp.model.Model')
    @patch('subprocess.run')
    def test_transcribe_ffmpeg_error(self, mock_subprocess, mock_whisper_class, client, auth_user):
        """Test transcription handles ffmpeg errors."""
        mock_whisper_class.return_value = Mock()
        mock_subprocess.side_effect = Exception('ffmpeg error')

        response = client.post('/api/transcribe',
            headers=auth_user['headers'],
            data=b'fake-audio',
            content_type='audio/webm'
        )

        assert response.status_code == 500
        data = response.json
        assert 'error' in data

    @patch('pywhispercpp.model.Model')
    @patch('subprocess.run')
    @patch('os.remove')
    def test_transcribe_multiple_segments(self, mock_remove, mock_subprocess, mock_whisper_class, client, auth_user):
        """Test transcription joins multiple segments."""
        mock_seg1 = Mock()
        mock_seg1.text = 'First segment. '
        mock_seg2 = Mock()
        mock_seg2.text = ' Second segment.'
        mock_model = Mock()
        mock_model.transcribe.return_value = [mock_seg1, mock_seg2]
        mock_whisper_class.return_value = mock_model

        mock_subprocess.return_value = Mock()

        response = client.post('/api/transcribe',
            headers=auth_user['headers'],
            data=b'fake-audio',
            content_type='audio/webm'
        )

        assert response.status_code == 200
        data = response.json
        assert 'First segment' in data['text']
        assert 'Second segment' in data['text']


@pytest.mark.integration
class TestTTS:
    """Test /api/tts endpoint."""

    def test_tts_requires_auth(self, client):
        """Test that TTS requires authentication."""
        response = client.post('/api/tts', json={'text': 'Hello'})

        assert response.status_code == 401

    def test_tts_no_text(self, client, auth_user):
        """Test TTS with no text returns error."""
        response = client.post('/api/tts',
            headers=auth_user['headers'],
            json={}
        )

        assert response.status_code == 400
        data = response.json
        assert 'error' in data

    def test_tts_empty_text(self, client, auth_user):
        """Test TTS with empty text returns error."""
        response = client.post('/api/tts',
            headers=auth_user['headers'],
            json={'text': ''}
        )

        assert response.status_code == 400

    @patch('kokoro.KPipeline')
    @patch('soundfile.write')
    @patch('os.remove')
    def test_tts_success(self, mock_remove, mock_sf_write, mock_kpipeline_class, client, auth_user):
        """Test successful text-to-speech."""
        # Mock Kokoro pipeline
        import numpy as np
        mock_audio = np.array([0.1, 0.2, 0.3])
        mock_pipeline = Mock()
        mock_pipeline.return_value = [(None, None, mock_audio)]
        mock_kpipeline_class.return_value = mock_pipeline

        response = client.post('/api/tts',
            headers=auth_user['headers'],
            json={'text': 'Hello world'}
        )

        assert response.status_code == 200
        assert response.content_type == 'audio/wav'

    @patch('kokoro.KPipeline')
    @patch('soundfile.write')
    @patch('os.remove')
    def test_tts_with_voice(self, mock_remove, mock_sf_write, mock_kpipeline_class, client, auth_user):
        """Test TTS with custom voice."""
        import numpy as np
        mock_audio = np.array([0.1, 0.2])
        mock_pipeline = Mock()
        mock_pipeline.return_value = [(None, None, mock_audio)]
        mock_kpipeline_class.return_value = mock_pipeline

        response = client.post('/api/tts',
            headers=auth_user['headers'],
            json={'text': 'Test', 'voice': 'af_sky'}
        )

        assert response.status_code == 200
        # Verify custom voice was passed
        mock_pipeline.assert_called_once_with('Test', voice='af_sky')

    @patch('kokoro.KPipeline')
    def test_tts_no_audio_generated(self, mock_kpipeline_class, client, auth_user):
        """Test TTS when no audio is generated."""
        mock_pipeline = Mock()
        mock_pipeline.return_value = []  # No audio samples
        mock_kpipeline_class.return_value = mock_pipeline

        response = client.post('/api/tts',
            headers=auth_user['headers'],
            json={'text': 'Test'}
        )

        assert response.status_code == 500
        data = response.json
        assert 'error' in data

    @patch('kokoro.KPipeline')
    def test_tts_pipeline_error(self, mock_kpipeline_class, client, auth_user):
        """Test TTS handles pipeline errors."""
        mock_kpipeline_class.side_effect = Exception('Pipeline error')

        response = client.post('/api/tts',
            headers=auth_user['headers'],
            json={'text': 'Test'}
        )

        assert response.status_code == 500
        data = response.json
        assert 'error' in data

    @patch('kokoro.KPipeline')
    @patch('soundfile.write')
    @patch('os.remove')
    def test_tts_multiple_chunks(self, mock_remove, mock_sf_write, mock_kpipeline_class, client, auth_user):
        """Test TTS concatenates multiple audio chunks."""
        import numpy as np
        mock_chunk1 = np.array([0.1, 0.2])
        mock_chunk2 = np.array([0.3, 0.4])
        mock_pipeline = Mock()
        mock_pipeline.return_value = [
            (None, None, mock_chunk1),
            (None, None, mock_chunk2)
        ]
        mock_kpipeline_class.return_value = mock_pipeline

        response = client.post('/api/tts',
            headers=auth_user['headers'],
            json={'text': 'Long text with multiple chunks'}
        )

        assert response.status_code == 200
        # Verify soundfile.write was called
        assert mock_sf_write.called
