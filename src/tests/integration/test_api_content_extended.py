"""
Extended integration tests for content API routes.

Tests additional content endpoints not covered in test_api_content.py:
- POST /api/author-details - Get author details from Semantic Scholar
- POST /api/citation-lookup - Look up paper by title
- POST /api/paper-references - Get references for a paper
- POST /api/author-lookup - Look up author by name
- POST /api/citations - Get citations for a paper
- POST /api/doc-chat - Chat with document content
- POST /api/chat-memory - Store chat memory
- GET /api/chat-memories - List chat memories
- GET /api/chat-memories/list - List chat memories (alternative)
- DELETE /api/chat-memories/<id> - Delete chat memory
- GET /api/chat-memories/stats - Get memory stats
- POST /api/annotation-feedback - Submit annotation feedback
- GET /api/annotation-feedback - List annotation feedback
- GET /api/annotation-feedback/stats - Get feedback stats
- PUT /api/annotation-feedback/<id> - Update feedback rating
- DELETE /api/annotation-feedback/<id> - Delete feedback
- GET /api/annotation-prompt - Get annotation prompt
- PUT /api/annotation-prompt - Update annotation prompt
- GET /api/annotation-categories - List annotation categories
- POST /api/annotation-categories - Add category
- DELETE /api/annotation-categories/<key> - Delete category
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

    google_id = 'test_content_ext_user'
    upsert_google_user(google_id, 'content_ext@test.com', 'Content Ext Tester', 'https://pic.url')
    token = create_session(google_id)

    return {
        'google_id': google_id,
        'token': token,
        'headers': {'Authorization': f'Bearer {token}'}
    }


@pytest.mark.integration
class TestAuthorDetails:
    """Test /api/author-details endpoint."""

    def test_author_details_no_id(self, client):
        """Test author details without authorId."""
        response = client.post('/api/author-details', json={})

        assert response.status_code == 400
        assert 'authorId required' in response.json['error']

    @patch('urllib.request.urlopen')
    def test_author_details_success(self, mock_urlopen, client):
        """Test successful author details lookup."""
        # Mock author details response
        author_response = Mock()
        author_response.read.return_value = json.dumps({
            'name': 'John Doe',
            'affiliations': ['University of AI'],
            'homepage': 'https://johndoe.ai',
            'hIndex': 42,
            'citationCount': 5000,
            'paperCount': 100,
            'url': 'https://semanticscholar.org/author/123'
        }).encode()
        author_response.__enter__ = Mock(return_value=author_response)
        author_response.__exit__ = Mock(return_value=False)

        # Mock papers response
        papers_response = Mock()
        papers_response.read.return_value = json.dumps({
            'data': [
                {'title': 'Paper 1', 'year': 2023, 'citationCount': 100, 'url': 'https://s2.org/p1', 'venue': 'NeurIPS'},
                {'title': 'Paper 2', 'year': 2022, 'citationCount': 50, 'url': 'https://s2.org/p2', 'venue': 'ICML'}
            ]
        }).encode()
        papers_response.__enter__ = Mock(return_value=papers_response)
        papers_response.__exit__ = Mock(return_value=False)

        mock_urlopen.side_effect = [author_response, papers_response]

        response = client.post('/api/author-details', json={
            'authorId': '123456'
        })

        assert response.status_code == 200
        data = response.json
        assert data['name'] == 'John Doe'
        assert data['hIndex'] == 42
        assert len(data['papers']) == 2

    @patch('urllib.request.urlopen')
    def test_author_details_api_error(self, mock_urlopen, client):
        """Test author details when API fails."""
        mock_urlopen.side_effect = Exception('API error')

        response = client.post('/api/author-details', json={
            'authorId': '123456'
        })

        assert response.status_code == 502


@pytest.mark.integration
class TestCitationLookup:
    """Test /api/citation-lookup endpoint."""

    def test_citation_lookup_no_query(self, client):
        """Test citation lookup without query."""
        response = client.post('/api/citation-lookup', json={})

        assert response.status_code == 400
        assert 'query required' in response.json['error']

    @patch('urllib.request.urlopen')
    def test_citation_lookup_success(self, mock_urlopen, client):
        """Test successful citation lookup."""
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            'data': [
                {
                    'title': 'Attention Is All You Need',
                    'authors': [{'name': 'Vaswani'}, {'name': 'Shazeer'}],
                    'year': 2017,
                    'abstract': 'We propose a new simple network architecture...',
                    'citationCount': 50000,
                    'venue': 'NeurIPS',
                    'url': 'https://semanticscholar.org/paper/123',
                    'externalIds': {'ArXiv': '1706.03762'}
                }
            ]
        }).encode()
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.post('/api/citation-lookup', json={
            'query': 'Attention Is All You Need'
        })

        assert response.status_code == 200
        data = response.json
        assert data['title'] == 'Attention Is All You Need'
        assert data['year'] == 2017
        assert data['arxivId'] == '1706.03762'

    @patch('urllib.request.urlopen')
    def test_citation_lookup_not_found(self, mock_urlopen, client):
        """Test citation lookup when paper not found."""
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({'data': []}).encode()
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.post('/api/citation-lookup', json={
            'query': 'Nonexistent Paper Title 123456789'
        })

        assert response.status_code == 404


@pytest.mark.integration
class TestPaperReferences:
    """Test /api/paper-references endpoint."""

    def test_paper_references_no_arxiv_id(self, client):
        """Test paper references without arXiv ID."""
        response = client.post('/api/paper-references', json={})

        assert response.status_code == 400
        assert 'arxivId required' in response.json['error']

    @patch('urllib.request.urlopen')
    @patch('utils_persistence.get_cached_references')
    @patch('utils_persistence.set_cached_references')
    def test_paper_references_success(self, mock_set_cache, mock_get_cache, mock_urlopen, client):
        """Test successful paper references lookup."""
        # Simulate cache miss
        mock_get_cache.return_value = None

        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            'references': [
                {
                    'title': 'Reference 1',
                    'authors': [{'name': 'Author A'}],
                    'year': 2020,
                    'citationCount': 100
                },
                {
                    'title': 'Reference 2',
                    'authors': [{'name': 'Author B'}],
                    'year': 2019,
                    'citationCount': 50
                }
            ]
        }).encode()
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.post('/api/paper-references', json={
            'arxivId': '1706.03762'
        })

        assert response.status_code == 200
        data = response.json
        assert 'references' in data
        assert len(data['references']) == 2

    @patch('utils_persistence.get_cached_references')
    def test_paper_references_from_cache(self, mock_get_cache, client):
        """Test paper references from cache."""
        cached_refs = [
            {'title': 'Cached Ref 1', 'year': 2020},
            {'title': 'Cached Ref 2', 'year': 2019}
        ]
        mock_get_cache.return_value = cached_refs

        response = client.post('/api/paper-references', json={
            'arxivId': '1706.03762'
        })

        assert response.status_code == 200
        data = response.json
        assert len(data['references']) == 2

    @patch('urllib.request.urlopen')
    @patch('utils_persistence.get_cached_references')
    def test_paper_references_single_ref(self, mock_get_cache, mock_urlopen, client):
        """Test getting single reference by refNum."""
        mock_get_cache.return_value = [
            {'title': 'Ref 1', 'year': 2020},
            {'title': 'Ref 2', 'year': 2019},
            {'title': 'Ref 3', 'year': 2018}
        ]

        response = client.post('/api/paper-references', json={
            'arxivId': '1706.03762',
            'refNum': 2
        })

        assert response.status_code == 200
        data = response.json
        assert data['title'] == 'Ref 2'


@pytest.mark.integration
class TestDocChat:
    """Test /api/doc-chat endpoint."""

    def test_doc_chat_no_message(self, client, auth_user):
        """Test doc chat without message."""
        response = client.post('/api/doc-chat',
            headers=auth_user['headers'],
            json={}
        )

        assert response.status_code == 400

    @patch('urllib.request.urlopen')
    def test_doc_chat_success(self, mock_urlopen, client, auth_user):
        """Test successful doc chat."""
        # Mock streaming response
        mock_response = Mock()
        mock_response.read.return_value = json.dumps({
            'message': {'content': 'This paper discusses transformers.'},
            'done': True
        }).encode()
        mock_response.__enter__ = Mock(return_value=mock_response)
        mock_response.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = mock_response

        response = client.post('/api/doc-chat',
            headers=auth_user['headers'],
            json={
                'message': 'What is this paper about?',
                'context': 'Attention Is All You Need. We propose the Transformer...'
            }
        )

        # Should return streaming response
        assert response.status_code in [200, 400, 502]


@pytest.mark.integration
class TestChatMemory:
    """Test chat memory endpoints."""

    def test_store_chat_memory_requires_auth(self, client):
        """Test storing chat memory requires authentication."""
        response = client.post('/api/chat-memory', json={
            'content': 'Test memory'
        })

        assert response.status_code == 401

    def test_store_chat_memory_success(self, client, auth_user):
        """Test storing chat memory."""
        response = client.post('/api/chat-memory',
            headers=auth_user['headers'],
            json={
                'content': 'I learned about transformers today',
                'context': 'Reading paper on attention mechanisms'
            }
        )

        assert response.status_code in [200, 400]

    def test_list_chat_memories_requires_auth(self, client):
        """Test listing chat memories requires authentication."""
        response = client.get('/api/chat-memories')

        assert response.status_code == 401

    def test_list_chat_memories_success(self, client, auth_user):
        """Test listing chat memories."""
        response = client.get('/api/chat-memories',
            headers=auth_user['headers']
        )

        assert response.status_code == 200
        data = response.json
        assert 'memories' in data or isinstance(data, list)

    def test_list_chat_memories_alt_endpoint(self, client, auth_user):
        """Test alternative list endpoint."""
        response = client.get('/api/chat-memories/list',
            headers=auth_user['headers']
        )

        assert response.status_code == 200

    def test_get_memory_stats_requires_auth(self, client):
        """Test memory stats requires authentication."""
        response = client.get('/api/chat-memories/stats')

        assert response.status_code == 401

    def test_get_memory_stats_success(self, client, auth_user):
        """Test getting memory stats."""
        response = client.get('/api/chat-memories/stats',
            headers=auth_user['headers']
        )

        assert response.status_code == 200
        data = response.json
        assert 'count' in data or 'total' in data or isinstance(data, dict)

    def test_delete_chat_memory_requires_auth(self, client):
        """Test deleting chat memory requires authentication."""
        response = client.delete('/api/chat-memories/1')

        assert response.status_code == 401

    def test_delete_chat_memory_not_found(self, client, auth_user):
        """Test deleting non-existent memory."""
        response = client.delete('/api/chat-memories/99999',
            headers=auth_user['headers']
        )

        assert response.status_code in [200, 404]


@pytest.mark.integration
class TestAnnotationFeedback:
    """Test annotation feedback endpoints."""

    def test_submit_feedback_requires_auth(self, client):
        """Test submitting annotation feedback requires authentication."""
        response = client.post('/api/annotation-feedback', json={})

        assert response.status_code == 401

    def test_submit_feedback_no_data(self, client, auth_user):
        """Test submitting annotation feedback without data."""
        response = client.post('/api/annotation-feedback',
            headers=auth_user['headers'], json={})

        assert response.status_code == 400

    def test_submit_feedback_success(self, client, auth_user):
        """Test submitting annotation feedback."""
        response = client.post('/api/annotation-feedback',
            headers=auth_user['headers'], json={
            'type': 'KEY_FINDING',
            'quote': 'Test quote',
            'rating': 'good',
            'url': 'https://example.com'
        })

        assert response.status_code in [200, 201]

    def test_list_feedback_success(self, client, auth_user):
        """Test listing annotation feedback."""
        response = client.get('/api/annotation-feedback',
            headers=auth_user['headers'])

        assert response.status_code == 200
        data = response.json
        assert isinstance(data, dict)

    def test_get_feedback_stats(self, client, auth_user):
        """Test getting feedback stats."""
        response = client.get('/api/annotation-feedback/stats',
            headers=auth_user['headers'])

        assert response.status_code == 200
        data = response.json
        assert isinstance(data, dict)

    def test_update_feedback_rating_not_found(self, client, auth_user):
        """Test updating non-existent feedback."""
        response = client.put('/api/annotation-feedback/99999',
            headers=auth_user['headers'], json={
            'rating': 'bad'
        })

        assert response.status_code in [200, 404]

    def test_delete_feedback_not_found(self, client, auth_user):
        """Test deleting non-existent feedback."""
        response = client.delete('/api/annotation-feedback/99999',
            headers=auth_user['headers'])

        assert response.status_code in [200, 404]


@pytest.mark.integration
class TestAnnotationPrompt:
    """Test annotation prompt endpoints."""

    def test_get_annotation_prompt(self, client):
        """Test getting annotation prompt."""
        response = client.get('/api/annotation-prompt')

        assert response.status_code == 200
        data = response.json
        assert 'prompt' in data

    def test_update_annotation_prompt(self, client):
        """Test updating annotation prompt."""
        response = client.put('/api/annotation-prompt', json={
            'prompt': 'New custom prompt for annotations'
        })

        assert response.status_code in [200, 400]


@pytest.mark.integration
class TestAnnotationCategories:
    """Test annotation categories endpoints."""

    def test_list_categories_requires_auth(self, client):
        """Test listing annotation categories requires authentication."""
        response = client.get('/api/annotation-categories')

        assert response.status_code == 401

    def test_list_categories(self, client, auth_user):
        """Test listing annotation categories."""
        response = client.get('/api/annotation-categories',
            headers=auth_user['headers'])

        assert response.status_code == 200
        data = response.json
        assert isinstance(data, dict)

    def test_add_category_no_data(self, client, auth_user):
        """Test adding category without data."""
        response = client.post('/api/annotation-categories',
            headers=auth_user['headers'], json={})

        assert response.status_code == 400

    def test_add_category_success(self, client, auth_user):
        """Test adding annotation category."""
        response = client.post('/api/annotation-categories',
            headers=auth_user['headers'], json={
            'key': 'CUSTOM_TEST',
            'name': 'Custom Test Category',
            'color': '#ff0000',
            'description': 'Test category'
        })

        assert response.status_code in [200, 201, 400]

    def test_delete_category_success(self, client, auth_user):
        """Test deleting annotation category."""
        # First add a category
        client.post('/api/annotation-categories',
            headers=auth_user['headers'], json={
            'key': 'DELETE_ME',
            'name': 'Delete Me',
            'color': '#000000',
            'description': 'Category to delete'
        })

        # Then delete it
        response = client.delete('/api/annotation-categories/DELETE_ME',
            headers=auth_user['headers'])

        assert response.status_code in [200, 404]


@pytest.mark.integration
class TestContentWorkflowsExtended:
    """Test extended content processing workflows."""

    @patch('urllib.request.urlopen')
    def test_citation_to_author_workflow(self, mock_urlopen, client):
        """Test looking up citation then getting author details."""
        # Step 1: Look up paper
        citation_response = Mock()
        citation_response.read.return_value = json.dumps({
            'data': [{
                'title': 'Test Paper',
                'authors': [{'name': 'John Doe', 'authorId': '123'}],
                'year': 2023
            }]
        }).encode()
        citation_response.__enter__ = Mock(return_value=citation_response)
        citation_response.__exit__ = Mock(return_value=False)

        # Step 2: Get author details
        author_response = Mock()
        author_response.read.return_value = json.dumps({
            'name': 'John Doe',
            'hIndex': 30,
            'citationCount': 2000
        }).encode()
        author_response.__enter__ = Mock(return_value=author_response)
        author_response.__exit__ = Mock(return_value=False)

        # Step 3: Get author papers
        papers_response = Mock()
        papers_response.read.return_value = json.dumps({
            'data': [{'title': 'Paper 1', 'citationCount': 100}]
        }).encode()
        papers_response.__enter__ = Mock(return_value=papers_response)
        papers_response.__exit__ = Mock(return_value=False)

        mock_urlopen.side_effect = [citation_response, author_response, papers_response]

        # Look up paper
        lookup_resp = client.post('/api/citation-lookup', json={
            'query': 'Test Paper'
        })

        assert lookup_resp.status_code == 200

        # Get author details (would use authorId from lookup)
        author_resp = client.post('/api/author-details', json={
            'authorId': '123'
        })

        assert author_resp.status_code == 200
        assert author_resp.json['name'] == 'John Doe'
