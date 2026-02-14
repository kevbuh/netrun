"""Unit tests for browser automation tools in helpers.py."""

import pytest
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from helpers import CHAT_TOOLS, execute_chat_tool


class TestBrowserToolDefinitions:
    """Test that browser tools are properly defined in CHAT_TOOLS."""

    def _tool_names(self):
        return [t['function']['name'] for t in CHAT_TOOLS]

    def test_browser_read_page_defined(self):
        assert 'browser_read_page' in self._tool_names()

    def test_browser_click_defined(self):
        assert 'browser_click' in self._tool_names()

    def test_browser_type_defined(self):
        assert 'browser_type' in self._tool_names()

    def test_browser_scroll_defined(self):
        assert 'browser_scroll' in self._tool_names()

    def test_browser_navigate_defined(self):
        assert 'browser_navigate' in self._tool_names()

    def test_browser_screenshot_defined(self):
        assert 'browser_screenshot' in self._tool_names()

    def test_browser_click_requires_element_id(self):
        tool = next(t for t in CHAT_TOOLS if t['function']['name'] == 'browser_click')
        assert 'element_id' in tool['function']['parameters']['required']

    def test_browser_type_requires_element_id_and_text(self):
        tool = next(t for t in CHAT_TOOLS if t['function']['name'] == 'browser_type')
        required = tool['function']['parameters']['required']
        assert 'element_id' in required
        assert 'text' in required

    def test_browser_scroll_requires_direction(self):
        tool = next(t for t in CHAT_TOOLS if t['function']['name'] == 'browser_scroll')
        assert 'direction' in tool['function']['parameters']['required']

    def test_browser_navigate_requires_url(self):
        tool = next(t for t in CHAT_TOOLS if t['function']['name'] == 'browser_navigate')
        assert 'url' in tool['function']['parameters']['required']

    def test_total_tool_count(self):
        """Should have 14 tools total (8 original + 6 browser)."""
        assert len(CHAT_TOOLS) == 14


class TestBrowserToolExecution:
    """Test execute_chat_tool for browser tools."""

    def test_browser_read_page_emits_action(self):
        actions = []
        def cb(event, data):
            actions.append((event, data))
        result = execute_chat_tool('browser_read_page', {}, stream_callback=cb)
        assert result['status'] == 'ok'
        assert len(actions) == 1
        assert actions[0][1]['type'] == 'agent_read_page'

    def test_browser_read_page_returns_dom_from_context(self):
        ctx = 'some text\n--- BROWSER TAB DOM (Test) [http://example.com] ---\n[1] <button> "Click"\n--- END DOM ---'
        result = execute_chat_tool('browser_read_page', {}, context=ctx)
        assert result['status'] == 'ok'
        assert '[1] <button>' in result['dom']

    def test_browser_click_emits_action(self):
        actions = []
        def cb(event, data):
            actions.append((event, data))
        result = execute_chat_tool('browser_click', {'element_id': 5}, stream_callback=cb)
        assert result['status'] == 'ok'
        assert actions[0][1]['type'] == 'agent_click'
        assert actions[0][1]['element_id'] == 5

    def test_browser_type_emits_action(self):
        actions = []
        def cb(event, data):
            actions.append((event, data))
        result = execute_chat_tool('browser_type', {'element_id': 3, 'text': 'hello'}, stream_callback=cb)
        assert result['status'] == 'ok'
        assert actions[0][1]['type'] == 'agent_type'
        assert actions[0][1]['element_id'] == 3
        assert actions[0][1]['text'] == 'hello'

    def test_browser_scroll_emits_action(self):
        actions = []
        def cb(event, data):
            actions.append((event, data))
        result = execute_chat_tool('browser_scroll', {'direction': 'down'}, stream_callback=cb)
        assert result['status'] == 'ok'
        assert actions[0][1]['type'] == 'agent_scroll'
        assert actions[0][1]['direction'] == 'down'

    def test_browser_scroll_defaults_to_down(self):
        actions = []
        def cb(event, data):
            actions.append((event, data))
        result = execute_chat_tool('browser_scroll', {}, stream_callback=cb)
        assert actions[0][1]['direction'] == 'down'

    def test_browser_navigate_emits_action(self):
        actions = []
        def cb(event, data):
            actions.append((event, data))
        result = execute_chat_tool('browser_navigate', {'url': 'https://example.com'}, stream_callback=cb)
        assert result['status'] == 'ok'
        assert actions[0][1]['type'] == 'agent_navigate'
        assert actions[0][1]['url'] == 'https://example.com'

    def test_browser_screenshot_emits_action(self):
        actions = []
        def cb(event, data):
            actions.append((event, data))
        result = execute_chat_tool('browser_screenshot', {}, stream_callback=cb)
        assert result['status'] == 'pending'
        assert actions[0][1]['type'] == 'agent_screenshot'

    def test_browser_tools_no_callback(self):
        """Browser tools should work without stream_callback (no error)."""
        result = execute_chat_tool('browser_click', {'element_id': 1})
        assert result['status'] == 'ok'

    def test_browser_read_page_no_callback(self):
        result = execute_chat_tool('browser_read_page', {})
        assert result['status'] == 'ok'
