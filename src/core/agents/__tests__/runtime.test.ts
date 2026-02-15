import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runAgent } from '../runtime';
import { ToolRegistry } from '../../tools/registry';
import { ProviderRegistry } from '../../providers/registry';
import type { LLMProvider, ChatResponse, StreamEvent } from '../../providers/types';
import type { AgentDefinition, AgentContext, AgentEvent, AgentSessionConfig } from '../types';
import { z } from 'zod';

// We need to mock the singletons. Use vi.mock to intercept imports.
vi.mock('../../tools/registry', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../tools/registry')>();
  const registry = new mod.ToolRegistry();
  return { ...mod, toolRegistry: registry };
});

vi.mock('../../providers/registry', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../providers/registry')>();
  const registry = new mod.ProviderRegistry();
  return { ...mod, providerRegistry: registry };
});

// Helper to collect all events from the agent
async function collectEvents(config: AgentSessionConfig): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of runAgent(config)) {
    events.push(event);
  }
  return events;
}

// A simple test agent
function makeAgent(overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    description: 'A test agent',
    tools: [],
    buildSystemPrompt: () => 'You are a test assistant.',
    ...overrides,
  };
}

// A mock provider that returns predetermined responses
function makeMockProvider(options: {
  chatResponses?: ChatResponse[];
  streamTokens?: string[];
}): LLMProvider {
  let chatCallCount = 0;
  const chatResponses = options.chatResponses ?? [];
  const streamTokens = options.streamTokens ?? ['Hello', ' world'];

  return {
    name: 'mock',
    chat: async () => {
      const response = chatResponses[chatCallCount] ?? {
        message: { role: 'assistant', content: 'No more responses' },
      };
      chatCallCount++;
      return response;
    },
    chatStream: async function* (): AsyncIterable<StreamEvent> {
      for (const token of streamTokens) {
        yield { type: 'token', content: token };
      }
      yield { type: 'done', usage: { promptTokens: 10, completionTokens: 5 } };
    },
    listModels: async () => ['test-model'],
  };
}

describe('Agent Runtime', () => {
  let toolRegistryMod: typeof import('../../tools/registry');
  let providerRegistryMod: typeof import('../../providers/registry');

  beforeEach(async () => {
    toolRegistryMod = await import('../../tools/registry');
    providerRegistryMod = await import('../../providers/registry');
  });

  it('yields error when no provider is configured', async () => {
    const events = await collectEvents({
      agent: makeAgent(),
      messages: [{ role: 'user', content: 'hi' }],
      context: {},
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect((events[0] as any).error).toContain('No LLM provider');
  });

  it('streams tokens in no-tools mode', async () => {
    const provider = makeMockProvider({ streamTokens: ['Hi', ' there'] });
    providerRegistryMod.providerRegistry.register(provider);

    const events = await collectEvents({
      agent: makeAgent(),
      messages: [{ role: 'user', content: 'hello' }],
      context: { toolsEnabled: false },
    });

    const tokens = events.filter(e => e.type === 'token').map(e => (e as any).content);
    expect(tokens).toEqual(['Hi', ' there']);
    expect(events.some(e => e.type === 'usage')).toBe(true);
    expect(events[events.length - 1].type).toBe('done');
  });

  it('executes tool calls and streams results', async () => {
    // Register a test tool
    toolRegistryMod.toolRegistry.register({
      name: 'test-tool',
      description: 'A test tool',
      category: 'test',
      access: ['agent'],
      parameters: z.object({ q: z.string() }),
      execute: async (input: any) => ({
        success: true,
        data: { answer: `result for ${input.q}` },
      }),
    });

    const provider = makeMockProvider({
      chatResponses: [
        // First call: model makes a tool call
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'tc1',
              type: 'function',
              function: { name: 'test-tool', arguments: '{"q":"test"}' },
            }],
          },
        },
        // Second call: model returns text (no more tools)
        {
          message: { role: 'assistant', content: 'Done' },
        },
      ],
      streamTokens: ['Final ', 'answer'],
    });
    providerRegistryMod.providerRegistry.register(provider);

    const events = await collectEvents({
      agent: makeAgent({ tools: ['test-tool'] }),
      messages: [{ role: 'user', content: 'test' }],
      context: { toolsEnabled: true },
    });

    // Should have: tool_call, tool_result, tokens, usage, done
    const toolCallEvent = events.find(e => e.type === 'tool_call' && (e as any).name === 'test-tool');
    expect(toolCallEvent).toBeDefined();

    const toolResultEvent = events.find(e => e.type === 'tool_result');
    expect(toolResultEvent).toBeDefined();
    expect((toolResultEvent as any).result).toEqual({ answer: 'result for test' });

    const tokens = events.filter(e => e.type === 'token').map(e => (e as any).content);
    expect(tokens).toEqual(['Final ', 'answer']);

    expect(events[events.length - 1].type).toBe('done');
  });

  it('detects stuck loops (repeated tool calls)', async () => {
    const repeatedResponse: ChatResponse = {
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'tc1',
          type: 'function',
          function: { name: 'navigate', arguments: '{"view":"home"}' },
        }],
      },
    };

    const provider = makeMockProvider({
      // Return the same tool call every time
      chatResponses: Array(5).fill(repeatedResponse),
      streamTokens: ['ok'],
    });
    providerRegistryMod.providerRegistry.register(provider);

    const events = await collectEvents({
      agent: makeAgent({ tools: ['navigate'] }),
      messages: [{ role: 'user', content: 'go home' }],
      context: { toolsEnabled: true },
    });

    // Should emit _stopped event
    const stoppedEvent = events.find(
      e => e.type === 'tool_call' && (e as any).name === '_stopped'
    );
    expect(stoppedEvent).toBeDefined();
    expect((stoppedEvent as any).args.reason).toContain('repeated');
  });

  it('respects abort signal', async () => {
    const abortController = new AbortController();
    // Abort immediately
    abortController.abort();

    const provider = makeMockProvider({ streamTokens: ['should', 'not', 'appear'] });
    providerRegistryMod.providerRegistry.register(provider);

    const events = await collectEvents({
      agent: makeAgent(),
      messages: [{ role: 'user', content: 'hi' }],
      context: { toolsEnabled: true },
      signal: abortController.signal,
    });

    expect(events.some(e => e.type === 'error' && (e as any).error === 'Cancelled')).toBe(true);
  });

  it('emits action events for browser tools', async () => {
    const provider = makeMockProvider({
      chatResponses: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'tc1',
              type: 'function',
              function: { name: 'browser-click', arguments: '{"element_id":5}' },
            }],
          },
        },
        { message: { role: 'assistant', content: 'Clicked' } },
      ],
      streamTokens: ['Done'],
    });
    providerRegistryMod.providerRegistry.register(provider);

    const actions: any[] = [];
    const events = await collectEvents({
      agent: makeAgent({ tools: ['browser-click'] }),
      messages: [{ role: 'user', content: 'click 5' }],
      context: { toolsEnabled: true },
      onAction: (action) => actions.push(action),
    });

    // Should have an action event for browser-click
    const actionEvent = events.find(
      e => e.type === 'action' && (e as any).action.type === 'agent_click'
    );
    expect(actionEvent).toBeDefined();
    expect((actionEvent as any).action.element_id).toBe(5);
  });

  it('falls back to text-based tool call parsing', async () => {
    const provider = makeMockProvider({
      chatResponses: [
        // Model emits tool call as JSON text instead of structured tool_calls
        {
          message: {
            role: 'assistant',
            content: '<think>Let me search</think>\n{"name": "navigate", "arguments": {"view": "settings"}}',
          },
        },
        { message: { role: 'assistant', content: 'Navigated' } },
      ],
      streamTokens: ['Navigated to settings'],
    });
    providerRegistryMod.providerRegistry.register(provider);

    const events = await collectEvents({
      agent: makeAgent({ tools: ['navigate'] }),
      messages: [{ role: 'user', content: 'go to settings' }],
      context: { toolsEnabled: true },
    });

    const navEvent = events.find(
      e => e.type === 'tool_call' && (e as any).name === 'navigate'
    );
    expect(navEvent).toBeDefined();
  });
});
