import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Re-implement _hydrateMessage for testing (module-private in chat-engine.js) ──

function _hydrateMessage(m) {
  const msg = { id: m.id, role: m.role, content: m.content, created_at: m.created_at, parent_id: m.parent_id || null };
  if (m.metadata && m.metadata !== '{}') {
    try {
      const meta = JSON.parse(m.metadata);
      if (meta._systemPrompt) msg._systemPrompt = meta._systemPrompt;
      if (meta._thinkingText) msg._thinkingText = meta._thinkingText;
      if (meta._toolsCalled) msg._toolsCalled = meta._toolsCalled;
      if (meta._ctxSources) msg._ctxSources = meta._ctxSources;
      if (meta._usage) msg._usage = meta._usage;
      if (meta._searchResults) msg._searchResults = meta._searchResults;
      if (meta._paperResults) msg._paperResults = meta._paperResults;
      if (meta._userResults) msg._userResults = meta._userResults;
      if (meta._webSources) msg._webSources = meta._webSources;
      if (meta._followUps) msg._followUps = meta._followUps;
      if (meta.images) msg.images = meta.images;
      if (meta._display) msg._display = meta._display;
      if (meta._activity) msg._activity = meta._activity;
      if (meta._timings) msg._timings = meta._timings;
    } catch { /* ignore bad metadata */ }
  }
  return msg;
}

// ── Re-implement _formatToolResult for testing ──

function _formatToolResult(agentEvent) {
  const r = agentEvent.result;
  const data = (typeof r === 'object' && r !== null) ? r : {};
  switch (agentEvent.name) {
    case 'browser-scroll': return 'Scrolled.';
    case 'browser-click': return 'Clicked.';
    case 'browser-type': return 'Typed.';
    case 'browser-navigate': return 'Navigating\u2026';
    case 'browser-screenshot': return 'Took screenshot.';
    case 'browser-back': return data.url ? 'Back \u2192 ' + data.url : 'Went back.';
    case 'browser-forward': return data.url ? 'Forward \u2192 ' + data.url : 'Went forward.';
    case 'browser-get-url':
      return data.url ? '**' + (data.title || 'Untitled') + '**\n' + data.url : 'Got URL.';
    case 'browser-get-tabs':
      if (data.tabs?.length) {
        return data.tabs.map(t =>
          (t.active ? '\u2192 ' : '  ') + '**' + (t.title || 'Untitled') + '** (tab ' + t.id + ')\n  ' + (t.url || '')
        ).join('\n');
      }
      return 'No tabs open.';
    case 'browser-switch-tab':
      return data.url ? 'Switched \u2192 **' + (data.title || 'Tab') + '**\n' + data.url : 'Switched tab.';
    case 'browser-query-selector':
      if (data.elements) return 'Found ' + (data.count || '?') + ' element(s):\n```\n' + data.elements + '\n```';
      return data.error || 'No elements found.';
    case 'browser-wait-for':
      if (data.found) return 'Found: `<' + (data.tag || '?') + '>` ' + (data.text ? '"' + data.text.slice(0, 100) + '"' : '');
      return data.timeout ? 'Timed out waiting.' : 'Not found.';
    case 'browser-press-key': return 'Pressed key.';
    case 'browser-get-storage':
      if (data.entries?.length) {
        return '**' + (data.type || 'Storage') + '** (' + data.count + ' entries):\n```\n' +
          data.entries.map(e => e.key + '=' + e.value).join('\n') + '\n```';
      }
      return data.error || 'No entries found.';
    default: return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// _hydrateMessage
// ═══════════════════════════════════════════════════════════════

describe('_hydrateMessage', () => {
  it('extracts basic fields', () => {
    const msg = _hydrateMessage({
      id: 1, role: 'user', content: 'Hello', created_at: '2024-01-01', parent_id: null,
      metadata: '{}'
    });
    expect(msg.id).toBe(1);
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello');
    expect(msg.created_at).toBe('2024-01-01');
    expect(msg.parent_id).toBe(null);
  });

  it('defaults parent_id to null when missing', () => {
    const msg = _hydrateMessage({ id: 1, role: 'user', content: 'hi' });
    expect(msg.parent_id).toBe(null);
  });

  it('parses _thinkingText from metadata', () => {
    const msg = _hydrateMessage({
      id: 2, role: 'assistant', content: 'response',
      metadata: JSON.stringify({ _thinkingText: 'Let me think...' })
    });
    expect(msg._thinkingText).toBe('Let me think...');
  });

  it('parses _toolsCalled from metadata', () => {
    const msg = _hydrateMessage({
      id: 3, role: 'assistant', content: 'result',
      metadata: JSON.stringify({ _toolsCalled: ['web-search("AI")'] })
    });
    expect(msg._toolsCalled).toEqual(['web-search("AI")']);
  });

  it('parses _usage from metadata', () => {
    const usage = { promptTokens: 100, completionTokens: 50 };
    const msg = _hydrateMessage({
      id: 4, role: 'assistant', content: 'ok',
      metadata: JSON.stringify({ _usage: usage })
    });
    expect(msg._usage).toEqual(usage);
  });

  it('parses images from metadata', () => {
    const msg = _hydrateMessage({
      id: 5, role: 'user', content: 'look',
      metadata: JSON.stringify({ images: ['data:image/png;base64,abc'] })
    });
    expect(msg.images).toEqual(['data:image/png;base64,abc']);
  });

  it('parses _webSources from metadata', () => {
    const sources = [{ n: 1, title: 'Test', url: 'https://example.com', snippet: 'snip' }];
    const msg = _hydrateMessage({
      id: 6, role: 'assistant', content: 'found stuff',
      metadata: JSON.stringify({ _webSources: sources })
    });
    expect(msg._webSources).toEqual(sources);
  });

  it('parses _followUps from metadata', () => {
    const msg = _hydrateMessage({
      id: 7, role: 'assistant', content: 'answer',
      metadata: JSON.stringify({ _followUps: ['What about X?', 'Tell me more about Y'] })
    });
    expect(msg._followUps).toEqual(['What about X?', 'Tell me more about Y']);
  });

  it('parses _display and _activity from metadata', () => {
    const msg = _hydrateMessage({
      id: 8, role: 'user', content: 'full content',
      metadata: JSON.stringify({ _display: 'short display', _activity: [{ type: 'thinking' }] })
    });
    expect(msg._display).toBe('short display');
    expect(msg._activity).toEqual([{ type: 'thinking' }]);
  });

  it('parses _timings from metadata', () => {
    const timings = { total: 1500, search: 800, inference: 500 };
    const msg = _hydrateMessage({
      id: 9, role: 'assistant', content: 'done',
      metadata: JSON.stringify({ _timings: timings })
    });
    expect(msg._timings).toEqual(timings);
  });

  it('gracefully handles bad JSON metadata', () => {
    const msg = _hydrateMessage({
      id: 10, role: 'assistant', content: 'hello',
      metadata: '{bad json'
    });
    expect(msg.id).toBe(10);
    expect(msg.content).toBe('hello');
    expect(msg._thinkingText).toBeUndefined();
  });

  it('handles empty metadata string', () => {
    const msg = _hydrateMessage({
      id: 11, role: 'user', content: 'hi',
      metadata: '{}'
    });
    expect(msg._thinkingText).toBeUndefined();
    expect(msg._toolsCalled).toBeUndefined();
  });

  it('handles missing metadata field', () => {
    const msg = _hydrateMessage({
      id: 12, role: 'user', content: 'hi'
    });
    expect(msg.content).toBe('hi');
  });

  it('parses multiple metadata fields at once', () => {
    const msg = _hydrateMessage({
      id: 13, role: 'assistant', content: 'multi',
      metadata: JSON.stringify({
        _thinkingText: 'hmm',
        _toolsCalled: ['search("q")'],
        _ctxSources: [{ label: 'tools' }],
        _webSources: [{ n: 1, title: 'T', url: 'u', snippet: 's' }],
        _followUps: ['question?'],
        _timings: { total: 500 },
      })
    });
    expect(msg._thinkingText).toBe('hmm');
    expect(msg._toolsCalled).toHaveLength(1);
    expect(msg._ctxSources).toHaveLength(1);
    expect(msg._webSources).toHaveLength(1);
    expect(msg._followUps).toEqual(['question?']);
    expect(msg._timings.total).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════
// _formatToolResult
// ═══════════════════════════════════════════════════════════════

describe('_formatToolResult', () => {
  it('formats browser-scroll', () => {
    expect(_formatToolResult({ name: 'browser-scroll', result: {} })).toBe('Scrolled.');
  });

  it('formats browser-click', () => {
    expect(_formatToolResult({ name: 'browser-click', result: {} })).toBe('Clicked.');
  });

  it('formats browser-type', () => {
    expect(_formatToolResult({ name: 'browser-type', result: {} })).toBe('Typed.');
  });

  it('formats browser-navigate', () => {
    expect(_formatToolResult({ name: 'browser-navigate', result: {} })).toBe('Navigating\u2026');
  });

  it('formats browser-back with URL', () => {
    expect(_formatToolResult({ name: 'browser-back', result: { url: 'https://example.com' } }))
      .toBe('Back \u2192 https://example.com');
  });

  it('formats browser-back without URL', () => {
    expect(_formatToolResult({ name: 'browser-back', result: {} })).toBe('Went back.');
  });

  it('formats browser-get-url with data', () => {
    const result = _formatToolResult({
      name: 'browser-get-url',
      result: { url: 'https://example.com', title: 'Example' }
    });
    expect(result).toContain('**Example**');
    expect(result).toContain('https://example.com');
  });

  it('formats browser-get-tabs with tabs', () => {
    const result = _formatToolResult({
      name: 'browser-get-tabs',
      result: { tabs: [
        { id: 1, title: 'Tab 1', url: 'https://a.com', active: true },
        { id: 2, title: 'Tab 2', url: 'https://b.com', active: false }
      ]}
    });
    expect(result).toContain('\u2192 **Tab 1**');
    expect(result).toContain('**Tab 2**');
  });

  it('formats browser-get-tabs with no tabs', () => {
    expect(_formatToolResult({ name: 'browser-get-tabs', result: {} })).toBe('No tabs open.');
  });

  it('formats browser-query-selector with elements', () => {
    const result = _formatToolResult({
      name: 'browser-query-selector',
      result: { elements: '<div>test</div>', count: 1 }
    });
    expect(result).toContain('Found 1 element(s)');
    expect(result).toContain('<div>test</div>');
  });

  it('formats browser-wait-for found', () => {
    const result = _formatToolResult({
      name: 'browser-wait-for',
      result: { found: true, tag: 'button', text: 'Click me' }
    });
    expect(result).toContain('Found:');
    expect(result).toContain('<button>');
    expect(result).toContain('Click me');
  });

  it('formats browser-wait-for timeout', () => {
    expect(_formatToolResult({ name: 'browser-wait-for', result: { timeout: true } }))
      .toBe('Timed out waiting.');
  });

  it('formats browser-get-storage with entries', () => {
    const result = _formatToolResult({
      name: 'browser-get-storage',
      result: { type: 'localStorage', count: 2, entries: [
        { key: 'a', value: '1' },
        { key: 'b', value: '2' }
      ]}
    });
    expect(result).toContain('**localStorage**');
    expect(result).toContain('a=1');
    expect(result).toContain('b=2');
  });

  it('returns null for unknown tool', () => {
    expect(_formatToolResult({ name: 'unknown-tool', result: {} })).toBeNull();
  });

  it('handles null result gracefully', () => {
    expect(_formatToolResult({ name: 'browser-scroll', result: null })).toBe('Scrolled.');
  });
});

// ═══════════════════════════════════════════════════════════════
// Session tree logic (unit testing the leaf-finding algorithm)
// ═══════════════════════════════════════════════════════════════

describe('Session tree logic', () => {
  // Replicate the leaf-finding algorithm from loadSession
  function findLeafId(allMessages, activeLeafId) {
    if (activeLeafId) return activeLeafId;
    if (!allMessages.length) return null;
    const leaves = allMessages.filter(m => {
      return !allMessages.some(c => c.parent_id === m.id);
    });
    if (leaves.length) return leaves[leaves.length - 1].id;
    return allMessages[allMessages.length - 1].id;
  }

  it('finds the leaf in a linear chain', () => {
    const msgs = [
      { id: 1, parent_id: null },
      { id: 2, parent_id: 1 },
      { id: 3, parent_id: 2 },
    ];
    expect(findLeafId(msgs, null)).toBe(3);
  });

  it('finds the most recent leaf in a branching tree', () => {
    const msgs = [
      { id: 1, parent_id: null },
      { id: 2, parent_id: 1 },
      { id: 3, parent_id: 1 }, // branch from 1
      { id: 4, parent_id: 2 },
    ];
    // Leaves: 3 (no children), 4 (no children). Most recent = 4
    expect(findLeafId(msgs, null)).toBe(4);
  });

  it('respects activeLeafId when provided', () => {
    const msgs = [
      { id: 1, parent_id: null },
      { id: 2, parent_id: 1 },
      { id: 3, parent_id: 1 },
    ];
    expect(findLeafId(msgs, 2)).toBe(2);
  });

  it('returns null for empty message list', () => {
    expect(findLeafId([], null)).toBe(null);
  });

  it('handles single message', () => {
    const msgs = [{ id: 1, parent_id: null }];
    expect(findLeafId(msgs, null)).toBe(1);
  });

  // Replicate getSiblings logic
  function getSiblings(allMessages, messageId) {
    const msg = allMessages.find(m => m.id === messageId);
    if (!msg) return [];
    return allMessages.filter(m => m.parent_id === msg.parent_id && m.id !== messageId);
  }

  it('getSiblings returns other children of same parent', () => {
    const msgs = [
      { id: 1, parent_id: null },
      { id: 2, parent_id: 1 },
      { id: 3, parent_id: 1 },
      { id: 4, parent_id: 2 },
    ];
    expect(getSiblings(msgs, 2).map(m => m.id)).toEqual([3]);
    expect(getSiblings(msgs, 4)).toEqual([]);
  });

  // Replicate isBranchPoint logic
  function isBranchPoint(allMessages, messageId) {
    return allMessages.filter(m => m.parent_id === messageId).length > 1;
  }

  it('isBranchPoint detects branching', () => {
    const msgs = [
      { id: 1, parent_id: null },
      { id: 2, parent_id: 1 },
      { id: 3, parent_id: 1 },
    ];
    expect(isBranchPoint(msgs, 1)).toBe(true);
    expect(isBranchPoint(msgs, 2)).toBe(false);
  });
});
