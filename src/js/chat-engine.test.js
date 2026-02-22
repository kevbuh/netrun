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

// ═══════════════════════════════════════════════════════════════
// Think-tag parsing (inline <think>...</think> stripping)
// ═══════════════════════════════════════════════════════════════

describe('Think-tag parsing', () => {
  // Re-implement the token-level think-tag parser from _handleEvent
  function processTokens(tokens) {
    let inThinkTag = false;
    let visibleText = '';
    let thinkingText = '';

    for (const token of tokens) {
      let _visibleToken = token;

      if (inThinkTag) {
        const endIdx = _visibleToken.indexOf('</think>');
        if (endIdx !== -1) {
          thinkingText += _visibleToken.slice(0, endIdx);
          _visibleToken = _visibleToken.slice(endIdx + 8);
          inThinkTag = false;
        } else {
          thinkingText += _visibleToken;
          continue;
        }
      }

      if (!inThinkTag && _visibleToken.includes('<think>')) {
        const startIdx = _visibleToken.indexOf('<think>');
        const before = _visibleToken.slice(0, startIdx);
        const after = _visibleToken.slice(startIdx + 7);
        inThinkTag = true;
        const endIdx2 = after.indexOf('</think>');
        if (endIdx2 !== -1) {
          thinkingText += after.slice(0, endIdx2);
          _visibleToken = before + after.slice(endIdx2 + 8);
          inThinkTag = false;
        } else {
          thinkingText += after;
          _visibleToken = before;
        }
      }

      if (_visibleToken) visibleText += _visibleToken;
    }

    return { visibleText, thinkingText, inThinkTag };
  }

  it('passes through tokens with no think tags', () => {
    const result = processTokens(['Hello', ' world', '!']);
    expect(result.visibleText).toBe('Hello world!');
    expect(result.thinkingText).toBe('');
    expect(result.inThinkTag).toBe(false);
  });

  it('strips a complete think tag within a single token', () => {
    const result = processTokens(['before<think>hidden</think>after']);
    expect(result.visibleText).toBe('beforeafter');
    expect(result.thinkingText).toBe('hidden');
  });

  it('handles think tag split across two tokens', () => {
    const result = processTokens(['Hello <think>part1', 'part2</think> world']);
    expect(result.visibleText).toBe('Hello  world');
    expect(result.thinkingText).toBe('part1part2');
  });

  it('handles think tag split across many tokens', () => {
    const result = processTokens(['<think>a', 'b', 'c', 'd</think>visible']);
    expect(result.visibleText).toBe('visible');
    expect(result.thinkingText).toBe('abcd');
  });

  it('handles empty think tags', () => {
    const result = processTokens(['before<think></think>after']);
    expect(result.visibleText).toBe('beforeafter');
    expect(result.thinkingText).toBe('');
  });

  it('handles think tag at start of stream', () => {
    const result = processTokens(['<think>thinking</think>The answer is 42']);
    expect(result.visibleText).toBe('The answer is 42');
    expect(result.thinkingText).toBe('thinking');
  });

  it('handles think tag at end of stream (unclosed)', () => {
    const result = processTokens(['visible<think>still thinking']);
    expect(result.visibleText).toBe('visible');
    expect(result.thinkingText).toBe('still thinking');
    expect(result.inThinkTag).toBe(true);
  });

  it('handles multiple think tags in stream', () => {
    const result = processTokens([
      '<think>first</think>visible1',
      '<think>second</think>visible2'
    ]);
    expect(result.visibleText).toBe('visible1visible2');
    expect(result.thinkingText).toBe('firstsecond');
  });
});

// ═══════════════════════════════════════════════════════════════
// Follow-up extraction
// ═══════════════════════════════════════════════════════════════

describe('Follow-up extraction', () => {
  // Re-implement the FOLLOW_UP regex from session.send
  function extractFollowUps(content) {
    const fuMatch = content.match(/\n---\nFOLLOW_UP:\n([\s\S]+)$/);
    if (!fuMatch) return { content, followUps: null };
    const followUps = fuMatch[1].split('\n')
      .map(l => l.replace(/^-\s*/, '').trim())
      .filter(Boolean);
    const trimmedContent = content.slice(0, fuMatch.index).trimEnd();
    return { content: trimmedContent, followUps };
  }

  it('extracts follow-ups when present', () => {
    const input = 'Main answer\n---\nFOLLOW_UP:\n- What about X?\n- Tell me more about Y';
    const result = extractFollowUps(input);
    expect(result.content).toBe('Main answer');
    expect(result.followUps).toEqual(['What about X?', 'Tell me more about Y']);
  });

  it('returns null follow-ups when section absent', () => {
    const result = extractFollowUps('Just an answer with no follow-ups.');
    expect(result.content).toBe('Just an answer with no follow-ups.');
    expect(result.followUps).toBeNull();
  });

  it('strips leading dashes from follow-up lines', () => {
    const input = 'Answer\n---\nFOLLOW_UP:\n- Question 1\n- Question 2';
    const result = extractFollowUps(input);
    expect(result.followUps).toEqual(['Question 1', 'Question 2']);
  });

  it('trims whitespace from follow-up lines', () => {
    const input = 'Answer\n---\nFOLLOW_UP:\n-   Padded question  \n-  Another  ';
    const result = extractFollowUps(input);
    expect(result.followUps).toEqual(['Padded question', 'Another']);
  });
});

// ═══════════════════════════════════════════════════════════════
// Timing computation
// ═══════════════════════════════════════════════════════════════

describe('Timing computation', () => {
  // Re-implement timing calc from session.send
  function computeTimings(activity, streamStart, endTime) {
    const _timings = { total: endTime - streamStart };
    const toolEntries = activity.filter(a => a.type === 'tool');
    const searchTime = toolEntries.filter(a => a.category === 'search').reduce((s, a) => s + (a.endedAt - a.startedAt), 0);
    const extractTime = toolEntries.filter(a => a.category === 'extract').reduce((s, a) => s + (a.endedAt - a.startedAt), 0);
    const inferenceEntry = activity.find(a => a.type === 'inference');
    if (searchTime) _timings.search = searchTime;
    if (extractTime) _timings.extract = extractTime;
    if (inferenceEntry) _timings.inference = inferenceEntry.endedAt - inferenceEntry.startedAt;
    const toolsTime = toolEntries.reduce((s, a) => s + (a.endedAt - a.startedAt), 0);
    if (toolsTime) _timings.tools = toolsTime;
    return _timings;
  }

  it('computes total time', () => {
    const result = computeTimings([], 1000, 5000);
    expect(result.total).toBe(4000);
  });

  it('computes search time from search-category tools', () => {
    const activity = [
      { type: 'tool', category: 'search', startedAt: 1000, endedAt: 2000 },
      { type: 'tool', category: 'search', startedAt: 2500, endedAt: 3000 },
    ];
    const result = computeTimings(activity, 0, 5000);
    expect(result.search).toBe(1500);
    expect(result.tools).toBe(1500);
  });

  it('computes extract time from extract-category tools', () => {
    const activity = [
      { type: 'tool', category: 'extract', startedAt: 1000, endedAt: 3000 },
    ];
    const result = computeTimings(activity, 0, 5000);
    expect(result.extract).toBe(2000);
  });

  it('computes inference time', () => {
    const activity = [
      { type: 'inference', startedAt: 2000, endedAt: 4500 },
    ];
    const result = computeTimings(activity, 0, 5000);
    expect(result.inference).toBe(2500);
  });

  it('omits zero-value timing fields', () => {
    const result = computeTimings([], 0, 3000);
    expect(result.total).toBe(3000);
    expect(result.search).toBeUndefined();
    expect(result.extract).toBeUndefined();
    expect(result.inference).toBeUndefined();
    expect(result.tools).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// Session listener management (onUpdate / _notify pattern)
// ═══════════════════════════════════════════════════════════════

describe('Session listener management', () => {
  function makeListenerManager() {
    let _listeners = [];
    return {
      onUpdate(fn) {
        _listeners.push(fn);
        return () => { _listeners = _listeners.filter(f => f !== fn); };
      },
      _notify(type) {
        for (const fn of _listeners) {
          try { fn(type); } catch { /* swallow */ }
        }
      },
      get listenerCount() { return _listeners.length; }
    };
  }

  it('registers a listener', () => {
    const mgr = makeListenerManager();
    const fn = vi.fn();
    mgr.onUpdate(fn);
    mgr._notify('test');
    expect(fn).toHaveBeenCalledWith('test');
  });

  it('supports multiple listeners', () => {
    const mgr = makeListenerManager();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    mgr.onUpdate(fn1);
    mgr.onUpdate(fn2);
    mgr._notify('stream');
    expect(fn1).toHaveBeenCalledWith('stream');
    expect(fn2).toHaveBeenCalledWith('stream');
  });

  it('unsubscribes via returned function', () => {
    const mgr = makeListenerManager();
    const fn = vi.fn();
    const unsub = mgr.onUpdate(fn);
    unsub();
    mgr._notify('stream');
    expect(fn).not.toHaveBeenCalled();
  });

  it('does not crash when listener throws', () => {
    const mgr = makeListenerManager();
    mgr.onUpdate(() => { throw new Error('oops'); });
    const fn2 = vi.fn();
    mgr.onUpdate(fn2);
    expect(() => mgr._notify('test')).not.toThrow();
    expect(fn2).toHaveBeenCalled();
  });

  it('passes type argument to listeners', () => {
    const mgr = makeListenerManager();
    const types = [];
    mgr.onUpdate(t => types.push(t));
    mgr._notify('message');
    mgr._notify('stream');
    mgr._notify('done');
    expect(types).toEqual(['message', 'stream', 'done']);
  });
});

// ═══════════════════════════════════════════════════════════════
// Session cancel logic
// ═══════════════════════════════════════════════════════════════

describe('Session cancel logic', () => {
  function makeSession() {
    let _streaming = false;
    let _abortController = null;
    const _listeners = [];
    const notifications = [];

    return {
      startStreaming() {
        _streaming = true;
        _abortController = new AbortController();
      },
      get streaming() { return _streaming; },
      get abortController() { return _abortController; },
      onUpdate(fn) { _listeners.push(fn); },
      _notify(type) { notifications.push(type); for (const fn of _listeners) fn(type); },
      get notifications() { return notifications; },
      cancel() {
        if (_abortController) {
          _abortController.abort();
          _abortController = null;
        }
        if (_streaming) {
          _streaming = false;
          this._notify('cancel');
        }
      }
    };
  }

  it('aborts the abort controller on cancel', () => {
    const session = makeSession();
    session.startStreaming();
    const ac = session.abortController;
    session.cancel();
    expect(ac.signal.aborted).toBe(true);
  });

  it('sets streaming to false on cancel', () => {
    const session = makeSession();
    session.startStreaming();
    session.cancel();
    expect(session.streaming).toBe(false);
  });

  it('notifies cancel event', () => {
    const session = makeSession();
    session.startStreaming();
    session.cancel();
    expect(session.notifications).toContain('cancel');
  });

  it('does not notify if not streaming', () => {
    const session = makeSession();
    session.cancel();
    expect(session.notifications).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// Session redo / editFrom logic
// ═══════════════════════════════════════════════════════════════

describe('Session redo / editFrom logic', () => {
  function makeMessages() {
    return [
      { id: 1, role: 'user', content: 'Hello', _display: 'Hello' },
      { id: 2, role: 'assistant', content: 'Hi there!' },
      { id: 3, role: 'user', content: 'How are you?', _display: 'How are you?' },
      { id: 4, role: 'assistant', content: 'I am fine.' },
    ];
  }

  // Re-implement redo logic
  function redo(messages) {
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx < 0) return null;
    const lastUserMsg = messages[lastUserIdx];
    messages.splice(lastUserIdx);
    return lastUserMsg._display || lastUserMsg.content;
  }

  // Re-implement editFrom logic
  function editFrom(messages, msgIdx) {
    const msg = messages[msgIdx];
    if (!msg || msg.role !== 'user') return null;
    const text = msg.content;
    messages.splice(msgIdx);
    return text;
  }

  it('redo returns last user message display text', () => {
    const msgs = makeMessages();
    const text = redo(msgs);
    expect(text).toBe('How are you?');
  });

  it('redo truncates messages to before last user msg', () => {
    const msgs = makeMessages();
    redo(msgs);
    expect(msgs).toHaveLength(2);
    expect(msgs[1].role).toBe('assistant');
  });

  it('redo returns null when no user messages', () => {
    const msgs = [{ id: 1, role: 'assistant', content: 'Hi' }];
    expect(redo(msgs)).toBeNull();
  });

  it('editFrom returns content of the specified user message', () => {
    const msgs = makeMessages();
    const text = editFrom(msgs, 0);
    expect(text).toBe('Hello');
    expect(msgs).toHaveLength(0);
  });

  it('editFrom rejects non-user messages', () => {
    const msgs = makeMessages();
    expect(editFrom(msgs, 1)).toBeNull(); // assistant message
    expect(msgs).toHaveLength(4); // unchanged
  });

  it('editFrom returns null for out-of-bounds index', () => {
    const msgs = makeMessages();
    expect(editFrom(msgs, 99)).toBeNull();
  });
});
