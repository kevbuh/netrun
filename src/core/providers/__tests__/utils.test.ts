import { describe, it, expect } from 'vitest';
import { toAIMessages } from '../utils';
import type { ChatMessage } from '../types';

// ═══════════════════════════════════════════════════════════════
// Basic message conversion
// ═══════════════════════════════════════════════════════════════

describe('toAIMessages — basic messages', () => {
  it('converts simple user message', () => {
    const result = toAIMessages([{ role: 'user', content: 'Hello' }]);
    expect(result).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('converts simple assistant message', () => {
    const result = toAIMessages([{ role: 'assistant', content: 'Hi there' }]);
    expect(result).toEqual([{ role: 'assistant', content: 'Hi there' }]);
  });

  it('converts system message', () => {
    const result = toAIMessages([{ role: 'system', content: 'You are helpful' }]);
    expect(result).toEqual([{ role: 'system', content: 'You are helpful' }]);
  });

  it('handles empty message array', () => {
    expect(toAIMessages([])).toEqual([]);
  });

  it('preserves message order across roles', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Answer' },
    ];
    const result = toAIMessages(messages);
    expect(result).toHaveLength(3);
    expect(result[0].role).toBe('system');
    expect(result[1].role).toBe('user');
    expect(result[2].role).toBe('assistant');
  });

  it('returns new array (does not mutate input)', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'test' }];
    const result = toAIMessages(messages);
    expect(result).not.toBe(messages);
  });
});

// ═══════════════════════════════════════════════════════════════
// Assistant messages with tool calls
// ═══════════════════════════════════════════════════════════════

describe('toAIMessages — assistant with tool calls', () => {
  it('converts assistant message with tool calls to content array', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'tc1',
          type: 'function',
          function: { name: 'search', arguments: '{"q":"test"}' },
        }],
      },
    ];
    const result = toAIMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
    expect(result[0].content).toHaveLength(1);
    expect(result[0].content[0]).toEqual({
      type: 'tool-call',
      toolCallId: 'tc1',
      toolName: 'search',
      args: { q: 'test' },
    });
  });

  it('includes text content alongside tool calls', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'Let me search',
        tool_calls: [{
          id: 'tc1',
          type: 'function',
          function: { name: 'web-search', arguments: '{"query":"test"}' },
        }],
      },
    ];
    const result = toAIMessages(messages);
    expect(result[0].content).toHaveLength(2);
    expect(result[0].content[0]).toEqual({ type: 'text', text: 'Let me search' });
    expect(result[0].content[1]).toEqual({
      type: 'tool-call',
      toolCallId: 'tc1',
      toolName: 'web-search',
      args: { query: 'test' },
    });
  });

  it('omits text content block when assistant content is empty', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'tc1',
          type: 'function',
          function: { name: 'navigate', arguments: '{"view":"home"}' },
        }],
      },
    ];
    const result = toAIMessages(messages);
    expect(result[0].content).toHaveLength(1);
    expect(result[0].content[0].type).toBe('tool-call');
  });

  it('handles multiple tool calls in one message', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'tc1', type: 'function', function: { name: 'search', arguments: '{"q":"a"}' } },
          { id: 'tc2', type: 'function', function: { name: 'fetch', arguments: '{"url":"b"}' } },
          { id: 'tc3', type: 'function', function: { name: 'write', arguments: '{"data":"c"}' } },
        ],
      },
    ];
    const result = toAIMessages(messages);
    expect(result[0].content).toHaveLength(3);
    expect(result[0].content[0].toolName).toBe('search');
    expect(result[0].content[1].toolName).toBe('fetch');
    expect(result[0].content[2].toolName).toBe('write');
  });

  it('parses JSON arguments into args object', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'tc1',
          type: 'function',
          function: { name: 'test', arguments: '{"nested":{"key":"val"},"arr":[1,2]}' },
        }],
      },
    ];
    const result = toAIMessages(messages);
    expect(result[0].content[0].args).toEqual({ nested: { key: 'val' }, arr: [1, 2] });
  });

  it('handles tool_calls as empty array — treated as plain message', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', content: 'No tools', tool_calls: [] },
    ];
    const result = toAIMessages(messages);
    expect(result[0]).toEqual({ role: 'assistant', content: 'No tools' });
  });

  it('handles assistant with no tool_calls property — treated as plain message', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', content: 'Plain response' },
    ];
    const result = toAIMessages(messages);
    expect(result[0]).toEqual({ role: 'assistant', content: 'Plain response' });
  });

  it('handles tool arguments with special characters', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'tc_special',
          type: 'function',
          function: { name: 'tool', arguments: '{"text":"line1\\nline2","path":"C:\\\\Users"}' },
        }],
      },
    ];
    const result = toAIMessages(messages);
    expect(result[0].content[0].args.text).toBe('line1\nline2');
    expect(result[0].content[0].args.path).toBe('C:\\Users');
  });
});

// ═══════════════════════════════════════════════════════════════
// Tool result messages
// ═══════════════════════════════════════════════════════════════

describe('toAIMessages — tool result messages', () => {
  it('converts tool message to tool-result format', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'tc1',
          type: 'function',
          function: { name: 'search', arguments: '{"q":"test"}' },
        }],
      },
      {
        role: 'tool',
        content: 'Search results here',
        tool_call_id: 'tc1',
      },
    ];
    const result = toAIMessages(messages);
    expect(result[1]).toEqual({
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'tc1',
        toolName: 'search',
        output: { type: 'text', value: 'Search results here' },
      }],
    });
  });

  it('resolves toolName from prior assistant tool_calls', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'id_alpha', type: 'function', function: { name: 'alpha_tool', arguments: '{}' } },
          { id: 'id_beta', type: 'function', function: { name: 'beta_tool', arguments: '{}' } },
        ],
      },
      { role: 'tool', content: 'result alpha', tool_call_id: 'id_alpha' },
      { role: 'tool', content: 'result beta', tool_call_id: 'id_beta' },
    ];
    const result = toAIMessages(messages);
    expect(result[1].content[0].toolName).toBe('alpha_tool');
    expect(result[2].content[0].toolName).toBe('beta_tool');
  });

  it('uses "unknown" for tool result without matching assistant call', () => {
    const messages: ChatMessage[] = [
      { role: 'tool', content: 'orphan result', tool_call_id: 'orphan' },
    ];
    const result = toAIMessages(messages);
    expect(result[0].content[0].toolName).toBe('unknown');
  });

  it('handles empty tool content', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'tc_empty',
          type: 'function',
          function: { name: 'noop', arguments: '{}' },
        }],
      },
      { role: 'tool', content: '', tool_call_id: 'tc_empty' },
    ];
    const result = toAIMessages(messages);
    expect(result[1].content[0].output).toEqual({ type: 'text', value: '' });
  });

  it('maps tool names correctly across multiple assistant messages', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'a', type: 'function', function: { name: 'tool-a', arguments: '{}' } }],
      },
      { role: 'tool', content: 'result-a', tool_call_id: 'a' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'b', type: 'function', function: { name: 'tool-b', arguments: '{}' } }],
      },
      { role: 'tool', content: 'result-b', tool_call_id: 'b' },
    ];
    const result = toAIMessages(messages);
    expect(result[1].content[0].toolName).toBe('tool-a');
    expect(result[3].content[0].toolName).toBe('tool-b');
  });
});

// ═══════════════════════════════════════════════════════════════
// Full conversation flows
// ═══════════════════════════════════════════════════════════════

describe('toAIMessages — full conversation', () => {
  it('converts a complete multi-turn conversation with tool use', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a helper' },
      { role: 'user', content: 'Search for cats' },
      {
        role: 'assistant',
        content: 'Searching...',
        tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'web-search', arguments: '{"query":"cats"}' } }],
      },
      { role: 'tool', content: 'Found 10 results about cats', tool_call_id: 'tc1' },
      { role: 'assistant', content: 'I found 10 results about cats.' },
    ];
    const result = toAIMessages(messages);
    expect(result).toHaveLength(5);
    expect(result[0].role).toBe('system');
    expect(result[1].role).toBe('user');
    expect(result[2].role).toBe('assistant');
    expect(result[2].content[0].type).toBe('text');
    expect(result[2].content[1].type).toBe('tool-call');
    expect(result[2].content[1].args).toEqual({ query: 'cats' });
    expect(result[3].role).toBe('tool');
    expect(result[3].content[0].toolName).toBe('web-search');
    expect(result[3].content[0].output.value).toBe('Found 10 results about cats');
    expect(result[4].role).toBe('assistant');
    expect(result[4].content).toBe('I found 10 results about cats.');
  });

  it('handles multiple tool call rounds in a conversation', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Do two things' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'r1_tc1', type: 'function', function: { name: 'step1', arguments: '{}' } }],
      },
      { role: 'tool', content: 'step 1 done', tool_call_id: 'r1_tc1' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'r2_tc1', type: 'function', function: { name: 'step2', arguments: '{}' } }],
      },
      { role: 'tool', content: 'step 2 done', tool_call_id: 'r2_tc1' },
      { role: 'assistant', content: 'Both steps complete.' },
    ];
    const result = toAIMessages(messages);
    expect(result).toHaveLength(6);
    expect(result[1].content[0].toolName).toBe('step1');
    expect(result[2].content[0].toolName).toBe('step1');
    expect(result[3].content[0].toolName).toBe('step2');
    expect(result[4].content[0].toolName).toBe('step2');
  });
});

// ═══════════════════════════════════════════════════════════════
// Edge cases & ID consistency
// ═══════════════════════════════════════════════════════════════

describe('toAIMessages — edge cases', () => {
  it('preserves toolCallId references correctly across messages', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'unique-id-123', type: 'function', function: { name: 'my_tool', arguments: '{}' } },
        ],
      },
      { role: 'tool', content: 'result', tool_call_id: 'unique-id-123' },
    ];
    const result = toAIMessages(messages);
    const toolCallId = result[0].content[0].toolCallId;
    const toolResultId = result[1].content[0].toolCallId;
    expect(toolCallId).toBe('unique-id-123');
    expect(toolResultId).toBe('unique-id-123');
    expect(toolCallId).toBe(toolResultId);
  });

  it('handles tool arguments with empty object', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'tc_empty_args',
          type: 'function',
          function: { name: 'no_args_tool', arguments: '{}' },
        }],
      },
    ];
    const result = toAIMessages(messages);
    expect(result[0].content[0].args).toEqual({});
  });

  it('handles user message with empty content', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '' },
    ];
    const result = toAIMessages(messages);
    expect(result[0]).toEqual({ role: 'user', content: '' });
  });

  it('handles long conversation with interleaved tool calls', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Start' },
      {
        role: 'assistant',
        content: 'Using tool A and B',
        tool_calls: [
          { id: 'a1', type: 'function', function: { name: 'toolA', arguments: '{"x":1}' } },
          { id: 'b1', type: 'function', function: { name: 'toolB', arguments: '{"y":2}' } },
        ],
      },
      { role: 'tool', content: 'A result', tool_call_id: 'a1' },
      { role: 'tool', content: 'B result', tool_call_id: 'b1' },
      { role: 'assistant', content: 'Got both results' },
      { role: 'user', content: 'Now do C' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'toolC', arguments: '{"z":3}' } },
        ],
      },
      { role: 'tool', content: 'C result', tool_call_id: 'c1' },
      { role: 'assistant', content: 'Done with C' },
    ];
    const result = toAIMessages(messages);
    expect(result).toHaveLength(9);
    // Verify tool name resolution across the whole conversation
    expect(result[2].content[0].toolName).toBe('toolA');
    expect(result[3].content[0].toolName).toBe('toolB');
    expect(result[7].content[0].toolName).toBe('toolC');
    // Verify the parallel tool call message has text + 2 tool calls
    expect(result[1].content).toHaveLength(3);
    expect(result[1].content[0].type).toBe('text');
    expect(result[1].content[1].type).toBe('tool-call');
    expect(result[1].content[2].type).toBe('tool-call');
  });
});
