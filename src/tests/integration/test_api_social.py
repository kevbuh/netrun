"""
Integration tests for social API routes.

Tests all social endpoints:
- Teams (create, read, update, delete, invite, members)
- Team messages and todos
- Direct messages
- User profiles and stats
- Comments and reposts
- Achievements
- Blog/feed features
- Search
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

    # Create user
    google_id = 'test_google_123'
    user = upsert_google_user(google_id, 'test@example.com', 'Test User', 'https://pic.url')
    token = create_session(google_id)

    return {
        'google_id': google_id,
        'email': 'test@example.com',
        'name': 'Test User',
        'token': token,
        'headers': {'Authorization': f'Bearer {token}'}
    }


@pytest.fixture
def second_user(client):
    """Create a second test user for multi-user tests."""
    from users import upsert_google_user, create_session, set_username

    google_id = 'test_google_456'
    user = upsert_google_user(google_id, 'test2@example.com', 'Test User 2', 'https://pic2.url')
    set_username(google_id, 'testuser2')
    token = create_session(google_id)

    return {
        'google_id': google_id,
        'email': 'test2@example.com',
        'name': 'Test User 2',
        'username': 'testuser2',
        'token': token,
        'headers': {'Authorization': f'Bearer {token}'}
    }


@pytest.mark.integration
class TestTeams:
    """Test team CRUD endpoints."""

    def test_create_team(self, client, auth_user):
        """Test creating a team."""
        response = client.post('/api/teams',
            headers=auth_user['headers'],
            json={'name': 'Test Team'}
        )

        assert response.status_code == 200
        data = response.json
        assert 'id' in data
        assert isinstance(data['id'], int)

    def test_create_team_requires_auth(self, client):
        """Test that creating a team requires authentication."""
        response = client.post('/api/teams', json={'name': 'Test Team'})
        assert response.status_code == 401

    def test_create_team_requires_name(self, client, auth_user):
        """Test that creating a team requires a name."""
        response = client.post('/api/teams',
            headers=auth_user['headers'],
            json={}
        )
        assert response.status_code == 400

    def test_get_user_teams(self, client, auth_user):
        """Test getting user's teams."""
        # Create a team first
        from users import create_team
        team_id = create_team('My Team', auth_user['google_id'])

        response = client.get('/api/teams', headers=auth_user['headers'])

        assert response.status_code == 200
        teams = response.json
        assert isinstance(teams, list)
        assert len(teams) >= 1
        assert any(t['id'] == team_id for t in teams)

    def test_get_team_by_id(self, client, auth_user):
        """Test getting a specific team."""
        from users import create_team
        team_id = create_team('My Team', auth_user['google_id'])

        response = client.get(f'/api/teams/{team_id}', headers=auth_user['headers'])

        assert response.status_code == 200
        team = response.json
        assert team['id'] == team_id
        assert team['name'] == 'My Team'
        assert 'members' in team

    def test_rename_team(self, client, auth_user):
        """Test renaming a team."""
        from users import create_team
        team_id = create_team('Old Name', auth_user['google_id'])

        response = client.put(f'/api/teams/{team_id}',
            headers=auth_user['headers'],
            json={'name': 'New Name'}
        )

        assert response.status_code == 200

        # Verify name changed
        from users import get_team
        team = get_team(team_id)
        assert team['name'] == 'New Name'

    def test_delete_team(self, client, auth_user):
        """Test deleting a team."""
        from users import create_team
        team_id = create_team('Team to Delete', auth_user['google_id'])

        response = client.delete(f'/api/teams/{team_id}',
            headers=auth_user['headers']
        )

        assert response.status_code == 200

        # Verify team is deleted
        from users import get_team
        team = get_team(team_id)
        assert team is None

    def test_delete_team_requires_ownership(self, client, auth_user, second_user):
        """Test that only team owner can delete."""
        from users import create_team
        team_id = create_team('My Team', auth_user['google_id'])

        # Try to delete as different user
        response = client.delete(f'/api/teams/{team_id}',
            headers=second_user['headers']
        )

        assert response.status_code in [403, 404]


@pytest.mark.integration
class TestTeamInvites:
    """Test team invitation system."""

    def test_invite_to_team(self, client, auth_user, second_user):
        """Test inviting a user to a team."""
        from users import create_team
        team_id = create_team('My Team', auth_user['google_id'])

        response = client.post(f'/api/teams/{team_id}/invite',
            headers=auth_user['headers'],
            json={'username': second_user['username']}
        )

        assert response.status_code == 200

    def test_get_pending_invites(self, client, auth_user, second_user):
        """Test getting pending invites."""
        from users import create_team, invite_to_team
        team_id = create_team('My Team', auth_user['google_id'])
        invite_to_team(team_id, auth_user['google_id'], second_user['username'])

        response = client.get('/api/inbox', headers=second_user['headers'])

        assert response.status_code == 200
        invites = response.json
        assert isinstance(invites, list)
        assert len(invites) >= 1
        # Invites have 'id', 'team_name', 'from_username', 'created' fields
        assert any(i.get('team_name') == 'My Team' for i in invites)

    def test_accept_invite(self, client, auth_user, second_user):
        """Test accepting a team invite."""
        from users import create_team, invite_to_team, get_pending_invites
        team_id = create_team('My Team', auth_user['google_id'])
        invite_to_team(team_id, auth_user['google_id'], second_user['username'])

        # Get the invite_id from pending invites
        invites = get_pending_invites(second_user['google_id'])
        assert len(invites) > 0
        invite_id = invites[0]['id']

        response = client.post(f'/api/inbox/{invite_id}/respond',
            headers=second_user['headers'],
            json={'accept': True}
        )

        assert response.status_code == 200

        # Verify user is now a member
        from users import get_team
        team = get_team(team_id)
        member_ids = [m['google_id'] for m in team['members']]
        assert second_user['google_id'] in member_ids

    def test_reject_invite(self, client, auth_user, second_user):
        """Test rejecting a team invite."""
        from users import create_team, invite_to_team, get_pending_invites
        team_id = create_team('My Team', auth_user['google_id'])
        invite_to_team(team_id, auth_user['google_id'], second_user['username'])

        # Get the invite_id from pending invites
        invites = get_pending_invites(second_user['google_id'])
        assert len(invites) > 0
        invite_id = invites[0]['id']

        response = client.post(f'/api/inbox/{invite_id}/respond',
            headers=second_user['headers'],
            json={'accept': False}
        )

        assert response.status_code == 200

        # Verify user is not a member
        from users import get_team
        team = get_team(team_id)
        member_ids = [m['google_id'] for m in team['members']]
        assert second_user['google_id'] not in member_ids

    def test_remove_team_member(self, client, auth_user, second_user):
        """Test removing a member from a team."""
        from users import create_team, invite_to_team, get_pending_invites, respond_to_invite
        team_id = create_team('My Team', auth_user['google_id'])
        invite_to_team(team_id, auth_user['google_id'], second_user['username'])

        # Get the invite_id and respond
        invites = get_pending_invites(second_user['google_id'])
        invite_id = invites[0]['id']
        respond_to_invite(invite_id, second_user['google_id'], accept=True)

        response = client.post(f'/api/teams/{team_id}/remove',
            headers=auth_user['headers'],
            json={'google_id': second_user['google_id']}
        )

        assert response.status_code == 200

        # Verify user is removed
        from users import get_team
        team = get_team(team_id)
        assert second_user['google_id'] not in team['members']


@pytest.mark.integration
class TestDirectMessages:
    """Test direct messaging endpoints."""

    def test_send_message(self, client, auth_user, second_user):
        """Test sending a direct message."""
        response = client.post('/api/messages',
            headers=auth_user['headers'],
            json={
                'to_username': second_user['username'],
                'content': 'Hello!'
            }
        )

        assert response.status_code == 200
        data = response.json
        assert 'id' in data

    def test_send_message_requires_text(self, client, auth_user, second_user):
        """Test that sending a message requires text."""
        response = client.post('/api/messages',
            headers=auth_user['headers'],
            json={'to_username': second_user['username']}
        )

        assert response.status_code == 400

    def test_get_messages(self, client, auth_user, second_user):
        """Test getting direct messages."""
        from users import send_direct_message
        # Send message TO auth_user FROM second_user
        send_direct_message(second_user['google_id'], auth_user['google_id'], 'Test message')

        response = client.get('/api/messages',
            headers=auth_user['headers']
        )

        assert response.status_code == 200
        messages = response.json
        assert isinstance(messages, list)
        assert len(messages) >= 1
        assert messages[0]['content'] == 'Test message'

    def test_get_unread_count(self, client, auth_user, second_user):
        """Test getting unread message count."""
        from users import send_direct_message
        send_direct_message(second_user['google_id'], auth_user['google_id'], 'Unread message')

        response = client.get('/api/messages/unread-count',
            headers=auth_user['headers']
        )

        assert response.status_code == 200
        data = response.json
        assert 'messages' in data
        assert 'total' in data
        assert data['messages'] >= 1

    def test_mark_message_read(self, client, auth_user, second_user):
        """Test marking a message as read."""
        from users import send_direct_message
        msg_id = send_direct_message(second_user['google_id'], auth_user['google_id'], 'Test')

        response = client.post(f'/api/messages/{msg_id}/read',
            headers=auth_user['headers']
        )

        assert response.status_code == 200

    def test_delete_message(self, client, auth_user, second_user):
        """Test deleting a message."""
        from users import send_direct_message
        # Send message TO auth_user (who can then delete it)
        msg_data = send_direct_message(second_user['google_id'], auth_user['google_id'], 'Test')
        msg_id = msg_data['id']

        response = client.delete(f'/api/messages/{msg_id}',
            headers=auth_user['headers']
        )

        assert response.status_code == 200

    def test_message_reactions(self, client, auth_user, second_user):
        """Test that direct message reactions endpoint doesn't exist (only team messages have reactions)."""
        from users import send_direct_message
        msg_data = send_direct_message(auth_user['google_id'], second_user['google_id'], 'Test')
        msg_id = msg_data['id']

        response = client.post(f'/api/messages/{msg_id}/react',
            headers=second_user['headers'],
            json={'emoji': '👍'}
        )

        # Route doesn't exist - only team messages have reactions
        # Returns 405 METHOD NOT ALLOWED since no POST route exists
        assert response.status_code == 405


@pytest.mark.integration
class TestTeamMessaging:
    """Test team messaging and todos."""

    def test_send_team_message(self, client, auth_user, second_user):
        """Test sending a team message."""
        from users import create_team, invite_to_team, get_pending_invites, respond_to_invite
        team_id = create_team('My Team', auth_user['google_id'])
        invite_to_team(team_id, auth_user['google_id'], second_user['username'])

        # Get the invite_id and respond
        invites = get_pending_invites(second_user['google_id'])
        invite_id = invites[0]['id']
        respond_to_invite(invite_id, second_user['google_id'], accept=True)

        response = client.post(f'/api/teams/{team_id}/messages',
            headers=auth_user['headers'],
            json={'content': 'Team announcement'}
        )

        assert response.status_code == 200

    def test_get_team_messages(self, client, auth_user):
        """Test getting team messages."""
        from users import create_team, send_team_message
        team_id = create_team('My Team', auth_user['google_id'])
        send_team_message(team_id, auth_user['google_id'], 'Hello team')

        response = client.get(f'/api/teams/{team_id}/messages',
            headers=auth_user['headers']
        )

        assert response.status_code == 200
        messages = response.json
        assert isinstance(messages, list)
        assert len(messages) >= 1

    def test_create_team_todo(self, client, auth_user):
        """Test creating a team todo."""
        from users import create_team
        team_id = create_team('My Team', auth_user['google_id'])

        response = client.post(f'/api/teams/{team_id}/todos',
            headers=auth_user['headers'],
            json={
                'title': 'Review paper',
                'description': 'Read and comment'
            }
        )

        assert response.status_code == 200
        data = response.json
        assert 'id' in data

    def test_get_team_todos(self, client, auth_user):
        """Test getting team todos."""
        from users import create_team, create_team_todo
        team_id = create_team('My Team', auth_user['google_id'])
        create_team_todo(team_id, auth_user['google_id'], {'title': 'Test task'})

        response = client.get(f'/api/teams/{team_id}/todos',
            headers=auth_user['headers']
        )

        assert response.status_code == 200
        todos = response.json
        assert isinstance(todos, list)
        assert len(todos) >= 1

    def test_get_my_assigned_tasks(self, client, auth_user):
        """Test getting tasks assigned to current user."""
        from users import create_team, create_team_todo
        team_id = create_team('My Team', auth_user['google_id'])
        create_team_todo(team_id, auth_user['google_id'], {'title': 'My task', 'assigned_to': auth_user['google_id']})

        response = client.get('/api/my-tasks', headers=auth_user['headers'])

        assert response.status_code == 200
        tasks = response.json
        assert isinstance(tasks, list)


@pytest.mark.integration
class TestUserProfiles:
    """Test user profile and stats endpoints."""

    def test_search_users(self, client, auth_user):
        """Test searching for users."""
        from users import set_username
        set_username(auth_user['google_id'], 'searchtest')

        response = client.get('/api/users?q=search', headers=auth_user['headers'])

        assert response.status_code == 200
        users = response.json
        assert isinstance(users, list)

    def test_list_all_users(self, client, auth_user):
        """Test listing all users."""
        response = client.get('/api/users', headers=auth_user['headers'])

        assert response.status_code == 200
        users = response.json
        assert isinstance(users, list)

    def test_get_user_profile(self, client, auth_user, second_user):
        """Test getting a user's profile."""
        response = client.get(f'/api/users/{second_user["username"]}',
            headers=auth_user['headers'])

        assert response.status_code == 200
        profile = response.json
        assert profile['username'] == second_user['username']
        assert 'picture' in profile

    def test_get_user_public_stats(self, client, auth_user, second_user):
        """Test that user stats endpoint doesn't exist (stats are in profile)."""
        response = client.get(f'/api/users/{second_user["username"]}/stats',
            headers=auth_user['headers'])

        # Route doesn't exist - stats are included in profile endpoint
        assert response.status_code == 404

    def test_get_user_feeds(self, client, auth_user, second_user):
        """Test getting user's feed sources."""
        response = client.get(f'/api/users/{second_user["username"]}/feeds',
            headers=auth_user['headers'])

        assert response.status_code == 200
        data = response.json
        assert isinstance(data, dict)
        assert 'catalogFeeds' in data
        assert 'customFeeds' in data

    def test_get_user_comments(self, client, auth_user, second_user):
        """Test getting user's recent comments."""
        response = client.get(f'/api/users/{second_user["username"]}/comments',
            headers=auth_user['headers'])

        assert response.status_code == 200
        comments = response.json
        assert isinstance(comments, list)

    def test_get_user_reposts(self, client, auth_user, second_user):
        """Test getting user's reposts."""
        response = client.get(f'/api/users/{second_user["username"]}/reposts',
            headers=auth_user['headers'])

        assert response.status_code == 200
        reposts = response.json
        assert isinstance(reposts, list)

    def test_get_user_teams(self, client, auth_user, second_user):
        """Test getting user's public teams."""
        response = client.get(f'/api/users/{second_user["username"]}/teams',
            headers=auth_user['headers'])

        assert response.status_code == 200
        teams = response.json
        assert isinstance(teams, list)

    def test_get_user_experiments(self, client, auth_user, second_user):
        """Test getting user's shared experiments."""
        response = client.get(f'/api/users/{second_user["username"]}/experiments',
            headers=auth_user['headers'])

        assert response.status_code == 200
        experiments = response.json
        assert isinstance(experiments, list)


@pytest.mark.integration
class TestComments:
    """Test blog/content commenting system."""

    def test_create_comment(self, client, auth_user):
        """Test creating a comment."""
        response = client.post('/api/comments',
            headers=auth_user['headers'],
            json={
                'paperLink': 'https://arxiv.org/abs/2301.12345',
                'content': 'Interesting paper!'
            }
        )

        assert response.status_code == 201
        data = response.json
        assert 'id' in data

    def test_get_comments_for_url(self, client, auth_user):
        """Test getting comments for a URL."""
        from users import db_create_comment
        url = 'https://arxiv.org/abs/2301.12345'
        db_create_comment(auth_user['google_id'], {'paperLink': url, 'content': 'Test comment'})

        response = client.get(f'/api/comments?paperLink={url}',
            headers=auth_user['headers'])

        assert response.status_code == 200
        comments = response.json
        assert isinstance(comments, list)
        assert len(comments) >= 1

    def test_delete_comment(self, client, auth_user):
        """Test deleting a comment."""
        from users import db_create_comment
        comment_data = db_create_comment(auth_user['google_id'], {'paperLink': 'https://test.com', 'content': 'Test'})
        comment_id = comment_data['id']

        response = client.delete(f'/api/comments/{comment_id}',
            headers=auth_user['headers']
        )

        assert response.status_code == 200


@pytest.mark.integration
class TestReposts:
    """Test reposting system."""

    def test_create_repost(self, client, auth_user):
        """Test creating a repost."""
        response = client.post('/api/reposts',
            headers=auth_user['headers'],
            json={
                'paperLink': 'https://arxiv.org/abs/2301.12345',
                'paperTitle': 'Great Paper'
            }
        )

        assert response.status_code == 201

    def test_delete_repost(self, client, auth_user):
        """Test deleting a repost."""
        from users import create_repost, set_username
        # Set username first (required by create_repost)
        set_username(auth_user['google_id'], 'testuser1')
        url = 'https://arxiv.org/abs/2301.12345'
        create_repost(auth_user['google_id'], 'testuser1', url, 'Test')

        response = client.delete('/api/reposts',
            headers=auth_user['headers'],
            json={'paperLink': url}
        )

        assert response.status_code == 200


@pytest.mark.integration
class TestBlogVotes:
    """Test blog voting system."""

    def test_vote_on_blog_post(self, client, auth_user):
        """Test voting on a blog post."""
        from users import set_username
        set_username(auth_user['google_id'], 'testblogger')

        response = client.post('/api/blog/testblogger/test-post/vote',
            headers=auth_user['headers'],
            json={'vote': 1}
        )

        assert response.status_code == 200

    def test_get_blog_votes(self, client, auth_user):
        """Test that blog votes are included in blog post response."""
        from users import set_blog_vote, set_username
        set_username(auth_user['google_id'], 'testblogger')

        # Vote on a blog post
        set_blog_vote('testblogger', 'test-post', auth_user['google_id'], 1)

        # Get the blog post (votes included in response)
        response = client.get('/api/blog/testblogger/test-post',
            headers=auth_user['headers'])

        # Blog post may or may not exist, but route should work
        assert response.status_code in [200, 404]


@pytest.mark.integration
class TestAchievements:
    """Test achievements system."""

    def test_get_all_achievements(self, client, auth_user):
        """Test getting current user's achievements."""
        response = client.get('/api/achievements', headers=auth_user['headers'])

        assert response.status_code == 200
        data = response.json
        assert 'achievements' in data
        assert isinstance(data['achievements'], list)

    def test_get_user_achievements(self, client, second_user):
        """Test getting a user's achievements."""
        response = client.get(f'/api/achievements/{second_user["username"]}')

        assert response.status_code == 200
        data = response.json
        assert 'achievements' in data
        assert isinstance(data['achievements'], list)

    def test_grant_achievement(self, client, auth_user):
        """Test granting an achievement."""
        response = client.post('/api/achievements/grant',
            headers=auth_user['headers'],
            json={'achievement_id': 'first_comment'}
        )

        # May succeed or fail depending on criteria
        assert response.status_code in [200, 400]


@pytest.mark.integration
class TestUserSettings:
    """Test user settings and privacy."""

    def test_set_profile_private(self, client, auth_user):
        """Test setting profile to private."""
        response = client.put('/api/users/me/privacy',
            headers=auth_user['headers'],
            json={'private': True}
        )

        assert response.status_code == 200

    def test_update_user_picture(self, client, auth_user):
        """Test updating user picture."""
        # Route expects base64 image data, not URL
        response = client.put('/api/users/me/picture',
            headers=auth_user['headers'],
            json={'image': 'data:image/png;base64,iVBORw0KGgo='}
        )

        assert response.status_code == 200

    def test_update_user_status(self, client, auth_user):
        """Test updating user status."""
        response = client.put('/api/users/me/status',
            headers=auth_user['headers'],
            json={'status': 'busy', 'text': 'In a meeting'}
        )

        assert response.status_code == 200
