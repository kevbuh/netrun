"""
Integration tests for browser agent automation tools.

Tests the full pipeline for browser automation:
1. System prompt includes browser tool instructions + DOM context
2. CHAT_TOOLS sent to Ollama include all 6 browser tools
3. execute_chat_tool produces correct SSE action events for each tool
4. browser_read_page extracts DOM from context and returns it
5. Tool results contain correct payloads for LLM feedback

These tests mock Ollama (since it's external) but test everything else end-to-end:
Flask request handling → system prompt construction → tool definitions → tool execution → SSE events.
"""

import pytest
import json
from unittest.mock import patch, Mock

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from helpers import CHAT_TOOLS, execute_chat_tool


@pytest.fixture
def auth_user(client):
    """Create and authenticate a test user."""
    from users import upsert_google_user, create_session

    google_id = 'test_browser_agent_user'
    upsert_google_user(google_id, 'agent@test.com', 'Agent Tester', 'https://pic.url')
    token = create_session(google_id)

    return {
        'google_id': google_id,
        'token': token,
        'headers': {'Authorization': f'Bearer {token}'}
    }


DOM_CONTEXT = (
    '--- BROWSER TAB DOM (Example Page) [https://example.com] ---\n'
    '[1] <input type="search" placeholder="Search...">\n'
    '[2] <button> "Sign In"\n'
    '[3] <a href="/about"> "About Us"\n'
    '[4] <h1> "Welcome to Example.com"\n'
    '[5] <p> "We are a leading provider of..."\n'
    '--- END DOM ---'
)


def _capture_ollama_payload(mock_urlopen):
    """Set up urlopen mock that captures the first Ollama payload and returns a text response."""
    captured = []

    def side_effect(req, **kwargs):
        body = json.loads(req.data)
        captured.append(body)
        mock_resp = Mock()
        # Always return a simple text response (no tool_calls) so the loop exits
        mock_resp.read.return_value = json.dumps({
            'message': {'role': 'assistant', 'content': 'OK'},
            'done': True
        }).encode()
        mock_resp.__enter__ = Mock(return_value=mock_resp)
        mock_resp.__exit__ = Mock(return_value=False)
        return mock_resp

    mock_urlopen.side_effect = side_effect
    return captured


# ═══════════════════════════════════════════════════════════
# 1. "What's on this page?" — DOM auto-injected as context
# ═══════════════════════════════════════════════════════════

@pytest.mark.integration
class TestWhatsOnThisPage:
    """Verify that DOM context flows through to the LLM system prompt."""

    @patch('urllib.request.urlopen')
    def test_dom_appears_in_system_prompt(self, mock_urlopen, client, auth_user):
        """When context has DOM, it appears in the DOCUMENT TEXT section of system prompt."""
        captured = _capture_ollama_payload(mock_urlopen)

        client.post('/api/doc-chat',
            headers=auth_user['headers'],
            json={
                'messages': [{'role': 'user', 'content': "What's on this page?"}],
                'context': DOM_CONTEXT,
                'tools': True
            }
        )

        assert len(captured) >= 1
        system_msg = captured[0]['messages'][0]['content']
        # DOM elements should be in the system prompt
        assert '[1] <input' in system_msg
        assert '[2] <button>' in system_msg
        assert '"Sign In"' in system_msg
        assert '[3] <a href="/about">' in system_msg
        assert 'BROWSER TAB DOM' in system_msg

    @patch('urllib.request.urlopen')
    def test_system_prompt_says_dom_already_available(self, mock_urlopen, client, auth_user):
        """System prompt tells LLM the DOM is already available (don't call browser_read_page)."""
        captured = _capture_ollama_payload(mock_urlopen)

        client.post('/api/doc-chat',
            headers=auth_user['headers'],
            json={
                'messages': [{'role': 'user', 'content': "What's on this page?"}],
                'context': DOM_CONTEXT,
                'tools': True
            }
        )

        system_msg = captured[0]['messages'][0]['content']
        assert 'already available' in system_msg
        assert 'browser_click' in system_msg
        assert 'browser_type' in system_msg

    @patch('urllib.request.urlopen')
    def test_browser_tools_in_ollama_payload(self, mock_urlopen, client, auth_user):
        """Browser action tools are included in the tools list sent to Ollama.
        browser_read_page is excluded when DOM is already in context."""
        captured = _capture_ollama_payload(mock_urlopen)

        client.post('/api/doc-chat',
            headers=auth_user['headers'],
            json={
                'messages': [{'role': 'user', 'content': "What's on this page?"}],
                'context': DOM_CONTEXT,
                'tools': True
            }
        )

        tool_names = [t['function']['name'] for t in captured[0]['tools']]
        # browser_read_page excluded because DOM is in context
        assert 'browser_read_page' not in tool_names
        assert 'browser_click' in tool_names
        assert 'browser_type' in tool_names
        assert 'browser_scroll' in tool_names
        assert 'browser_navigate' in tool_names
        assert 'browser_screenshot' in tool_names

    @patch('urllib.request.urlopen')
    def test_page_url_in_system_prompt(self, mock_urlopen, client, auth_user):
        """When pageUrl is provided, it appears in the system prompt context."""
        captured = _capture_ollama_payload(mock_urlopen)

        client.post('/api/doc-chat',
            headers=auth_user['headers'],
            json={
                'messages': [{'role': 'user', 'content': "What's on this page?"}],
                'context': DOM_CONTEXT,
                'tools': True,
                'pageUrl': 'https://example.com',
                'pageTitle': 'Example Page'
            }
        )

        system_msg = captured[0]['messages'][0]['content']
        assert 'example.com' in system_msg
        assert 'Example Page' in system_msg


# ═══════════════════════════════════════════════════════════
# 2. "Click the Sign In button" — browser_click with element_id
# ═══════════════════════════════════════════════════════════

@pytest.mark.integration
class TestClickSignInButton:
    """Verify browser_click tool execution produces correct action events."""

    def test_click_emits_agent_click_action(self):
        """execute_chat_tool('browser_click') emits agent_click SSE action with element_id."""
        actions = []
        result = execute_chat_tool(
            'browser_click',
            {'element_id': 2},
            stream_callback=lambda ev, d: actions.append((ev, d))
        )

        assert result['status'] == 'ok'
        assert 'Clicked element 2' in result['message']
        assert len(actions) == 1
        assert actions[0][0] == 'action'
        assert actions[0][1]['type'] == 'agent_click'
        assert actions[0][1]['element_id'] == 2

    def test_click_tool_definition_requires_element_id(self):
        """browser_click tool requires element_id parameter."""
        tool = next(t for t in CHAT_TOOLS if t['function']['name'] == 'browser_click')
        assert 'element_id' in tool['function']['parameters']['required']
        assert tool['function']['parameters']['properties']['element_id']['type'] == 'integer'

    def test_click_result_fed_back_to_llm(self):
        """Tool result for click is JSON-serializable and contains status for LLM."""
        result = execute_chat_tool('browser_click', {'element_id': 2})
        # This is what gets appended to ollama_messages as the tool result
        serialized = json.dumps(result)
        parsed = json.loads(serialized)
        assert parsed['status'] == 'ok'
        assert '2' in parsed['message']


# ═══════════════════════════════════════════════════════════
# 3. "Type 'transformers' into the search box" — browser_type
# ═══════════════════════════════════════════════════════════

@pytest.mark.integration
class TestTypeTransformers:
    """Verify browser_type tool execution produces correct action events."""

    def test_type_emits_agent_type_action(self):
        """execute_chat_tool('browser_type') emits agent_type SSE action with element_id and text."""
        actions = []
        result = execute_chat_tool(
            'browser_type',
            {'element_id': 1, 'text': 'transformers'},
            stream_callback=lambda ev, d: actions.append((ev, d))
        )

        assert result['status'] == 'ok'
        assert 'Typed into element 1' in result['message']
        assert len(actions) == 1
        assert actions[0][0] == 'action'
        assert actions[0][1]['type'] == 'agent_type'
        assert actions[0][1]['element_id'] == 1
        assert actions[0][1]['text'] == 'transformers'

    def test_type_tool_definition_requires_element_id_and_text(self):
        """browser_type tool requires element_id and text parameters."""
        tool = next(t for t in CHAT_TOOLS if t['function']['name'] == 'browser_type')
        required = tool['function']['parameters']['required']
        assert 'element_id' in required
        assert 'text' in required

    def test_type_result_fed_back_to_llm(self):
        """Tool result for type is JSON-serializable and mentions the element."""
        result = execute_chat_tool('browser_type', {'element_id': 1, 'text': 'transformers'})
        serialized = json.dumps(result)
        parsed = json.loads(serialized)
        assert parsed['status'] == 'ok'
        assert '1' in parsed['message']

    def test_type_preserves_special_characters(self):
        """Text with special characters is passed through correctly."""
        actions = []
        execute_chat_tool(
            'browser_type',
            {'element_id': 1, 'text': 'hello "world" & <friends>'},
            stream_callback=lambda ev, d: actions.append((ev, d))
        )
        assert actions[0][1]['text'] == 'hello "world" & <friends>'


# ═══════════════════════════════════════════════════════════
# 4. "Scroll down" — browser_scroll
# ═══════════════════════════════════════════════════════════

@pytest.mark.integration
class TestScrollDown:
    """Verify browser_scroll tool execution produces correct action events."""

    def test_scroll_down_emits_agent_scroll_action(self):
        """execute_chat_tool('browser_scroll', direction='down') emits correct action."""
        actions = []
        result = execute_chat_tool(
            'browser_scroll',
            {'direction': 'down'},
            stream_callback=lambda ev, d: actions.append((ev, d))
        )

        assert result['status'] == 'ok'
        assert 'Scrolled down' in result['message']
        assert len(actions) == 1
        assert actions[0][0] == 'action'
        assert actions[0][1]['type'] == 'agent_scroll'
        assert actions[0][1]['direction'] == 'down'

    def test_scroll_up_emits_agent_scroll_action(self):
        """browser_scroll with direction='up' also works."""
        actions = []
        result = execute_chat_tool(
            'browser_scroll',
            {'direction': 'up'},
            stream_callback=lambda ev, d: actions.append((ev, d))
        )

        assert result['status'] == 'ok'
        assert 'Scrolled up' in result['message']
        assert actions[0][1]['direction'] == 'up'

    def test_scroll_defaults_to_down(self):
        """If direction not specified, defaults to down."""
        actions = []
        execute_chat_tool(
            'browser_scroll',
            {},
            stream_callback=lambda ev, d: actions.append((ev, d))
        )
        assert actions[0][1]['direction'] == 'down'

    def test_scroll_tool_definition_has_direction_enum(self):
        """browser_scroll tool defines direction with up/down enum."""
        tool = next(t for t in CHAT_TOOLS if t['function']['name'] == 'browser_scroll')
        direction_prop = tool['function']['parameters']['properties']['direction']
        assert direction_prop['enum'] == ['up', 'down']


# ═══════════════════════════════════════════════════════════
# 5. "Go to https://arxiv.org" — browser_navigate
# ═══════════════════════════════════════════════════════════

@pytest.mark.integration
class TestGoToArxiv:
    """Verify browser_navigate tool execution produces correct action events."""

    def test_navigate_emits_agent_navigate_action(self):
        """execute_chat_tool('browser_navigate') emits agent_navigate SSE action with URL."""
        actions = []
        result = execute_chat_tool(
            'browser_navigate',
            {'url': 'https://arxiv.org'},
            stream_callback=lambda ev, d: actions.append((ev, d))
        )

        assert result['status'] == 'ok'
        assert 'arxiv.org' in result['message']
        assert len(actions) == 1
        assert actions[0][0] == 'action'
        assert actions[0][1]['type'] == 'agent_navigate'
        assert actions[0][1]['url'] == 'https://arxiv.org'

    def test_navigate_tool_definition_requires_url(self):
        """browser_navigate tool requires url parameter."""
        tool = next(t for t in CHAT_TOOLS if t['function']['name'] == 'browser_navigate')
        assert 'url' in tool['function']['parameters']['required']

    def test_navigate_result_fed_back_to_llm(self):
        """Tool result mentions the URL for LLM context."""
        result = execute_chat_tool('browser_navigate', {'url': 'https://arxiv.org'})
        assert 'arxiv.org' in result['message']


# ═══════════════════════════════════════════════════════════
# 6. browser_read_page — DOM extraction from context
# ═══════════════════════════════════════════════════════════

@pytest.mark.integration
class TestBrowserReadPage:
    """Verify browser_read_page returns DOM content from context."""

    def test_read_page_extracts_dom_from_context(self):
        """browser_read_page returns DOM elements when context contains them."""
        result = execute_chat_tool('browser_read_page', {}, context=DOM_CONTEXT)

        assert result['status'] == 'ok'
        assert 'dom' in result
        assert '[1] <input' in result['dom']
        assert '[2] <button>' in result['dom']
        assert '"Sign In"' in result['dom']
        assert '[5] <p>' in result['dom']

    def test_read_page_without_dom_returns_fallback(self):
        """browser_read_page without DOM context returns a helpful fallback message."""
        result = execute_chat_tool('browser_read_page', {}, context='just some text')

        assert result['status'] == 'ok'
        assert 'message' in result
        assert 'dom' not in result or result.get('dom') is None

    def test_read_page_no_context_returns_fallback(self):
        """browser_read_page with no context at all returns fallback."""
        result = execute_chat_tool('browser_read_page', {})

        assert result['status'] == 'ok'
        assert 'message' in result

    def test_read_page_emits_agent_read_page_action(self):
        """browser_read_page emits agent_read_page SSE action."""
        actions = []
        execute_chat_tool(
            'browser_read_page', {},
            stream_callback=lambda ev, d: actions.append((ev, d)),
            context=DOM_CONTEXT
        )

        assert len(actions) == 1
        assert actions[0][1]['type'] == 'agent_read_page'

    def test_read_page_dom_result_is_json_serializable(self):
        """Tool result with DOM can be serialized to JSON (for ollama_messages)."""
        result = execute_chat_tool('browser_read_page', {}, context=DOM_CONTEXT)
        serialized = json.dumps(result)
        parsed = json.loads(serialized)
        assert '[1]' in parsed['dom']


# ═══════════════════════════════════════════════════════════
# 7. browser_screenshot — emits action for frontend handling
# ═══════════════════════════════════════════════════════════

@pytest.mark.integration
class TestBrowserScreenshot:
    """Verify browser_screenshot tool emits correct action."""

    def test_screenshot_emits_agent_screenshot_action(self):
        actions = []
        result = execute_chat_tool(
            'browser_screenshot', {},
            stream_callback=lambda ev, d: actions.append((ev, d))
        )

        assert result['status'] == 'pending'
        assert len(actions) == 1
        assert actions[0][1]['type'] == 'agent_screenshot'


# ═══════════════════════════════════════════════════════════
# 8. Full SSE event format validation
# ═══════════════════════════════════════════════════════════

@pytest.mark.integration
class TestSSEEventFormat:
    """Verify SSE events are correctly formatted."""

    @patch('urllib.request.urlopen')
    def test_doc_chat_returns_sse_stream(self, mock_urlopen, client, auth_user):
        """POST /api/doc-chat with tools returns text/event-stream."""
        _capture_ollama_payload(mock_urlopen)

        response = client.post('/api/doc-chat',
            headers=auth_user['headers'],
            json={
                'messages': [{'role': 'user', 'content': "What's on this page?"}],
                'context': DOM_CONTEXT,
                'tools': True
            }
        )

        assert response.status_code == 200
        assert 'text/event-stream' in response.content_type

    @patch('urllib.request.urlopen')
    def test_system_prompt_without_tools_has_no_browser_instructions(self, mock_urlopen, client, auth_user):
        """When tools=false, system prompt does NOT mention browser tools."""
        captured = _capture_ollama_payload(mock_urlopen)

        client.post('/api/doc-chat',
            headers=auth_user['headers'],
            json={
                'messages': [{'role': 'user', 'content': "What's on this page?"}],
                'context': DOM_CONTEXT,
                'tools': False
            }
        )

        assert len(captured) >= 1
        system_msg = captured[0]['messages'][0]['content']
        assert 'browser_click' not in system_msg
        assert 'browser_type' not in system_msg
        # Tools list should not be present
        assert 'tools' not in captured[0] or not captured[0]['tools']


# ═══════════════════════════════════════════════════════════
# 9. Fallback JSON tool call parsing (unit-level)
# ═══════════════════════════════════════════════════════════

@pytest.mark.integration
class TestFallbackToolCallParsing:
    """Test the fallback parser that detects tool calls emitted as text JSON.

    The parser lives in content.py's generate() function. We test the parsing
    logic directly here since the SSE streaming endpoint is hard to test with
    Flask's test client (request context issues with generators).
    """

    def _parse_text_tool_call(self, content):
        """Replicate the fallback parsing logic from content.py generate()."""
        import re
        content = content.strip()
        # Strip <think>...</think> tags (qwen3 thinking mode)
        content = re.sub(r'<think>.*?</think>\s*', '', content, flags=re.DOTALL).strip()
        if content.startswith("```"):
            content = re.sub(r'^```\w*\n?', '', content)
            content = re.sub(r'\n?```$', '', content).strip()
        if content.startswith("{") and '"name"' in content:
            try:
                parsed = json.loads(content)
                if "name" in parsed:
                    return [{
                        "function": {
                            "name": parsed["name"],
                            "arguments": parsed.get("arguments", parsed.get("parameters", {}))
                        }
                    }]
            except (json.JSONDecodeError, KeyError):
                pass
        return None

    def test_plain_json_tool_call_detected(self):
        """Raw JSON tool call text is parsed into a structured tool call."""
        result = self._parse_text_tool_call(
            '{"name": "browser_scroll", "arguments": {"direction": "down"}}'
        )
        assert result is not None
        assert result[0]['function']['name'] == 'browser_scroll'
        assert result[0]['function']['arguments']['direction'] == 'down'

    def test_code_fence_json_tool_call_detected(self):
        """JSON in markdown code fences is parsed."""
        result = self._parse_text_tool_call(
            '```json\n{"name": "browser_click", "arguments": {"element_id": 3}}\n```'
        )
        assert result is not None
        assert result[0]['function']['name'] == 'browser_click'
        assert result[0]['function']['arguments']['element_id'] == 3

    def test_code_fence_no_lang_detected(self):
        """Code fences without language tag are also handled."""
        result = self._parse_text_tool_call(
            '```\n{"name": "browser_type", "arguments": {"element_id": 1, "text": "hello"}}\n```'
        )
        assert result is not None
        assert result[0]['function']['name'] == 'browser_type'

    def test_plain_text_not_parsed(self):
        """Normal text is NOT parsed as a tool call."""
        result = self._parse_text_tool_call(
            'I can help you scroll down the page.'
        )
        assert result is None

    def test_json_without_name_not_parsed(self):
        """JSON without 'name' field is NOT parsed as tool call."""
        result = self._parse_text_tool_call(
            '{"status": "ok", "message": "done"}'
        )
        assert result is None

    def test_invalid_json_not_parsed(self):
        """Malformed JSON is NOT parsed."""
        result = self._parse_text_tool_call(
            '{"name": "browser_click", arguments: {element_id: 3}}'
        )
        assert result is None

    def test_parameters_key_also_works(self):
        """Some models use 'parameters' instead of 'arguments'."""
        result = self._parse_text_tool_call(
            '{"name": "browser_navigate", "parameters": {"url": "https://arxiv.org"}}'
        )
        assert result is not None
        assert result[0]['function']['arguments']['url'] == 'https://arxiv.org'

    def test_parsed_tool_call_executes_correctly(self):
        """End-to-end: parsed fallback tool call produces correct action when executed."""
        result = self._parse_text_tool_call(
            '{"name": "browser_scroll", "arguments": {"direction": "down"}}'
        )
        assert result is not None
        fn = result[0]['function']
        actions = []
        tool_result = execute_chat_tool(
            fn['name'], fn['arguments'],
            stream_callback=lambda ev, d: actions.append((ev, d))
        )
        assert tool_result['status'] == 'ok'
        assert 'Scrolled down' in tool_result['message']
        assert actions[0][1]['type'] == 'agent_scroll'
        assert actions[0][1]['direction'] == 'down'

    def test_click_fallback_executes_correctly(self):
        """Fallback-parsed browser_click produces correct action."""
        result = self._parse_text_tool_call(
            '```json\n{"name": "browser_click", "arguments": {"element_id": 2}}\n```'
        )
        fn = result[0]['function']
        actions = []
        tool_result = execute_chat_tool(
            fn['name'], fn['arguments'],
            stream_callback=lambda ev, d: actions.append((ev, d))
        )
        assert tool_result['status'] == 'ok'
        assert actions[0][1]['type'] == 'agent_click'
        assert actions[0][1]['element_id'] == 2

    def test_thinking_tags_stripped_before_parsing(self):
        """Tool call wrapped in <think>...</think> tags is detected."""
        result = self._parse_text_tool_call(
            '<think>\nI should scroll the page down for the user.\n</think>\n'
            '{"name": "browser_scroll", "arguments": {"direction": "down"}}'
        )
        assert result is not None
        assert result[0]['function']['name'] == 'browser_scroll'
        assert result[0]['function']['arguments']['direction'] == 'down'

    def test_thinking_tags_with_code_fence(self):
        """Thinking tags + code fence combination works."""
        result = self._parse_text_tool_call(
            '<think>\nLet me click element 5.\n</think>\n'
            '```json\n{"name": "browser_click", "arguments": {"element_id": 5}}\n```'
        )
        assert result is not None
        assert result[0]['function']['name'] == 'browser_click'
        assert result[0]['function']['arguments']['element_id'] == 5

    def test_thinking_tags_only_no_tool_call(self):
        """Pure thinking content without a tool call is not parsed."""
        result = self._parse_text_tool_call(
            '<think>\nThe user wants to scroll but I cannot do that.\n</think>\n'
            'I cannot scroll the page for you.'
        )
        assert result is None


# ═══════════════════════════════════════════════════════════
# 10. Tool filtering when DOM is in context
# ═══════════════════════════════════════════════════════════

@pytest.mark.integration
class TestToolFilteringWithDOM:
    """When DOM is already in context, browser_read_page should be excluded from tools."""

    @patch('urllib.request.urlopen')
    def test_read_page_excluded_when_dom_in_context(self, mock_urlopen, client, auth_user):
        """browser_read_page is NOT in tool list when DOM context is present."""
        captured = _capture_ollama_payload(mock_urlopen)

        client.post('/api/doc-chat',
            headers=auth_user['headers'],
            json={
                'messages': [{'role': 'user', 'content': 'Scroll down'}],
                'context': DOM_CONTEXT,
                'tools': True
            }
        )

        tool_names = [t['function']['name'] for t in captured[0]['tools']]
        assert 'browser_read_page' not in tool_names
        # Other browser tools should still be present
        assert 'browser_click' in tool_names
        assert 'browser_scroll' in tool_names
        assert 'browser_type' in tool_names

    @patch('urllib.request.urlopen')
    def test_read_page_included_when_no_dom_context(self, mock_urlopen, client, auth_user):
        """browser_read_page IS in tool list when no DOM context is present."""
        captured = _capture_ollama_payload(mock_urlopen)

        client.post('/api/doc-chat',
            headers=auth_user['headers'],
            json={
                'messages': [{'role': 'user', 'content': 'What is on this page?'}],
                'tools': True
            }
        )

        tool_names = [t['function']['name'] for t in captured[0]['tools']]
        assert 'browser_read_page' in tool_names
