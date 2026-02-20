import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runAgent, resolveActionResult } from '../runtime';
import { ToolRegistry } from '../../tools/registry';
import { ProviderRegistry } from '../../providers/registry';
import type { LLMProvider, ChatResponse, StreamEvent } from '../../providers/types';
import type { AgentDefinition, AgentContext, AgentEvent, AgentSessionConfig } from '../types';
import { z } from 'zod';
import {
  browserClick, browserPressKey, browserQuerySelector, browserReadPage,
  browserType, browserScroll, browserNavigate,
} from '../../tools/browser/index';
import { navigate, openTab } from '../../tools/system/index';

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
    // Register the navigate tool so the registry can find it
    try { toolRegistryMod.toolRegistry.register(navigate); } catch { /* already registered */ }

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
    // Register browser-click so the registry can find it
    try { toolRegistryMod.toolRegistry.register(browserClick); } catch { /* already registered */ }

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

  it('emits action events for browser-press-key', async () => {
    // Register browser-press-key so the registry can find it
    try { toolRegistryMod.toolRegistry.register(browserPressKey); } catch { /* already registered */ }

    const provider = makeMockProvider({
      chatResponses: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'tc1',
              type: 'function',
              function: { name: 'browser-press-key', arguments: '{"key":"Enter"}' },
            }],
          },
        },
        { message: { role: 'assistant', content: 'Pressed' } },
      ],
      streamTokens: ['Done'],
    });
    providerRegistryMod.providerRegistry.register(provider);

    const actions: any[] = [];
    const events = await collectEvents({
      agent: makeAgent({ tools: ['browser-press-key'] }),
      messages: [{ role: 'user', content: 'press enter' }],
      context: { toolsEnabled: true },
      onAction: (action) => actions.push(action),
    });

    const actionEvent = events.find(
      e => e.type === 'action' && (e as any).action.type === 'agent_press_key'
    );
    expect(actionEvent).toBeDefined();
    expect((actionEvent as any).action.key).toBe('Enter');
  });

  it('falls back to text-based tool call parsing', async () => {
    // Register navigate so the registry can find it
    try { toolRegistryMod.toolRegistry.register(navigate); } catch { /* already registered */ }

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

describe('Unified pipeline integration', () => {
  let toolRegistryMod: typeof import('../../tools/registry');
  let providerRegistryMod: typeof import('../../providers/registry');

  beforeEach(async () => {
    toolRegistryMod = await import('../../tools/registry');
    providerRegistryMod = await import('../../providers/registry');
  });

  it('async tool round-trip: emitAction → resolveActionResult → tool gets data', async () => {
    try { toolRegistryMod.toolRegistry.register(browserQuerySelector); } catch { /* already registered */ }

    // When the tool emits an action, grab the requestId and resolve it
    const onAction = (action: any) => {
      if (action.type === 'agent_query_selector' && action.requestId) {
        // Simulate the frontend responding after a short delay
        setTimeout(() => {
          resolveActionResult(action.requestId, {
            elements: [{ id: 42, tag: 'button', text: 'Submit' }],
          });
        }, 10);
      }
    };

    const provider = makeMockProvider({
      chatResponses: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'tc1',
              type: 'function',
              function: { name: 'browser-query-selector', arguments: '{"selector":".submit-btn"}' },
            }],
          },
        },
        { message: { role: 'assistant', content: 'Found it' } },
      ],
      streamTokens: ['Done'],
    });
    providerRegistryMod.providerRegistry.register(provider);

    const events = await collectEvents({
      agent: makeAgent({ tools: ['browser-query-selector'] }),
      messages: [{ role: 'user', content: 'find submit button' }],
      context: { toolsEnabled: true },
      onAction,
    });

    // The tool result should contain the resolved data, not "pending"
    const resultEvent = events.find(e => e.type === 'tool_result' && (e as any).name === 'browser-query-selector');
    expect(resultEvent).toBeDefined();
    const resultData = (resultEvent as any).result;
    expect(resultData.elements).toBeDefined();
    expect(resultData.elements[0].id).toBe(42);
    expect(resultData.elements[0].text).toBe('Submit');
  });

  it('onAction callback receives actions emitted by tools', async () => {
    try { toolRegistryMod.toolRegistry.register(browserClick); } catch { /* already registered */ }
    try { toolRegistryMod.toolRegistry.register(browserNavigate); } catch { /* already registered */ }

    const provider = makeMockProvider({
      chatResponses: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'tc1',
                type: 'function',
                function: { name: 'browser-navigate', arguments: '{"url":"https://example.com"}' },
              },
              {
                id: 'tc2',
                type: 'function',
                function: { name: 'browser-click', arguments: '{"element_id":7}' },
              },
            ],
          },
        },
        { message: { role: 'assistant', content: 'Done' } },
      ],
      streamTokens: ['ok'],
    });
    providerRegistryMod.providerRegistry.register(provider);

    const receivedActions: any[] = [];
    await collectEvents({
      agent: makeAgent({ tools: ['browser-navigate', 'browser-click'] }),
      messages: [{ role: 'user', content: 'go to example.com and click 7' }],
      context: { toolsEnabled: true },
      onAction: (action) => receivedActions.push(action),
    });

    // Both actions should have been delivered via onAction
    expect(receivedActions.some(a => a.type === 'agent_navigate' && a.url === 'https://example.com')).toBe(true);
    expect(receivedActions.some(a => a.type === 'agent_click' && a.element_id === 7)).toBe(true);
  });

  it('sequential tools run one-at-a-time, parallel tools run concurrently', async () => {
    // Register a non-sequential tool that tracks execution order
    const executionLog: string[] = [];
    try {
      toolRegistryMod.toolRegistry.register({
        name: 'parallel-tool',
        description: 'test',
        category: 'test',
        access: ['agent'],
        parameters: z.object({ id: z.string() }),
        execute: async (input: any) => {
          executionLog.push(`parallel-start-${input.id}`);
          await new Promise(r => setTimeout(r, 20));
          executionLog.push(`parallel-end-${input.id}`);
          return { success: true, data: { id: input.id } };
        },
      });
    } catch { /* already registered */ }

    try { toolRegistryMod.toolRegistry.register(browserClick); } catch { /* already registered */ }
    try { toolRegistryMod.toolRegistry.register(browserScroll); } catch { /* already registered */ }

    const provider = makeMockProvider({
      chatResponses: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              // Two parallel tools + two sequential tools in the same batch
              { id: 'tc1', type: 'function', function: { name: 'parallel-tool', arguments: '{"id":"a"}' } },
              { id: 'tc2', type: 'function', function: { name: 'parallel-tool', arguments: '{"id":"b"}' } },
              { id: 'tc3', type: 'function', function: { name: 'browser-click', arguments: '{"element_id":1}' } },
              { id: 'tc4', type: 'function', function: { name: 'browser-scroll', arguments: '{"direction":"down"}' } },
            ],
          },
        },
        { message: { role: 'assistant', content: 'Done' } },
      ],
      streamTokens: ['ok'],
    });
    providerRegistryMod.providerRegistry.register(provider);

    const events = await collectEvents({
      agent: makeAgent({ tools: ['parallel-tool', 'browser-click', 'browser-scroll'] }),
      messages: [{ role: 'user', content: 'do stuff' }],
      context: { toolsEnabled: true },
    });

    // Parallel tools should overlap: a-start, b-start appear before both ends
    const aStart = executionLog.indexOf('parallel-start-a');
    const bStart = executionLog.indexOf('parallel-start-b');
    const aEnd = executionLog.indexOf('parallel-end-a');
    const bEnd = executionLog.indexOf('parallel-end-b');
    expect(aStart).toBeLessThan(aEnd);
    expect(bStart).toBeLessThan(bEnd);
    // Both start before either ends (proves concurrency)
    expect(Math.max(aStart, bStart)).toBeLessThan(Math.min(aEnd, bEnd));

    // All four tool results should be present
    const results = events.filter(e => e.type === 'tool_result');
    expect(results).toHaveLength(4);
  });

  it('browserDom flows through context to browser-read-page', async () => {
    try { toolRegistryMod.toolRegistry.register(browserReadPage); } catch { /* already registered */ }

    const provider = makeMockProvider({
      chatResponses: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'tc1',
              type: 'function',
              function: { name: 'browser-read-page', arguments: '{}' },
            }],
          },
        },
        { message: { role: 'assistant', content: 'Read' } },
      ],
      streamTokens: ['ok'],
    });
    providerRegistryMod.providerRegistry.register(provider);

    const events = await collectEvents({
      agent: makeAgent({ tools: ['browser-read-page'] }),
      messages: [{ role: 'user', content: 'read page' }],
      context: { toolsEnabled: true, browserDom: '<div id="1">Hello</div>' },
    });

    const resultEvent = events.find(e => e.type === 'tool_result' && (e as any).name === 'browser-read-page');
    expect(resultEvent).toBeDefined();
    expect((resultEvent as any).result.dom).toBe('<div id="1">Hello</div>');
  });

  it('navigate tool emits action with correct view through the runtime', async () => {
    try { toolRegistryMod.toolRegistry.register(navigate); } catch { /* already registered */ }

    const provider = makeMockProvider({
      chatResponses: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'tc1',
              type: 'function',
              function: { name: 'navigate', arguments: '{"view":"settings"}' },
            }],
          },
        },
        { message: { role: 'assistant', content: 'Done' } },
      ],
      streamTokens: ['ok'],
    });
    providerRegistryMod.providerRegistry.register(provider);

    const receivedActions: any[] = [];
    const events = await collectEvents({
      agent: makeAgent({ tools: ['navigate'] }),
      messages: [{ role: 'user', content: 'go to settings' }],
      context: { toolsEnabled: true },
      onAction: (action) => receivedActions.push(action),
    });

    // onAction should receive the navigate action
    expect(receivedActions).toHaveLength(1);
    expect(receivedActions[0].type).toBe('navigate');
    expect(receivedActions[0].view).toBe('settings');

    // And it should also appear as a yielded action event
    const actionEvent = events.find(e => e.type === 'action');
    expect(actionEvent).toBeDefined();
    expect((actionEvent as any).action.type).toBe('navigate');
    expect((actionEvent as any).action.view).toBe('settings');

    // Tool result should be successful
    const resultEvent = events.find(e => e.type === 'tool_result' && (e as any).name === 'navigate');
    expect(resultEvent).toBeDefined();
    expect((resultEvent as any).result.status).toBe('ok');
  });

  it('middleware runs when tools execute through the runtime', async () => {
    try { toolRegistryMod.toolRegistry.register(browserClick); } catch { /* already registered */ }

    // Register a test middleware on the mock registry
    let middlewareToolName: string | undefined;
    toolRegistryMod.toolRegistry.use(async (tool, _input, _ctx, next) => {
      middlewareToolName = tool.name;
      return next();
    });

    const provider = makeMockProvider({
      chatResponses: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'tc1',
              type: 'function',
              function: { name: 'browser-click', arguments: '{"element_id":1}' },
            }],
          },
        },
        { message: { role: 'assistant', content: 'Done' } },
      ],
      streamTokens: ['ok'],
    });
    providerRegistryMod.providerRegistry.register(provider);

    await collectEvents({
      agent: makeAgent({ tools: ['browser-click'] }),
      messages: [{ role: 'user', content: 'click 1' }],
      context: { toolsEnabled: true },
    });

    expect(middlewareToolName).toBe('browser-click');
  });

  it('browser-type emits action with element_id and text through runtime', async () => {
    try { toolRegistryMod.toolRegistry.register(browserType); } catch { /* already registered */ }

    const provider = makeMockProvider({
      chatResponses: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'tc1',
              type: 'function',
              function: { name: 'browser-type', arguments: '{"element_id":3,"text":"hello world"}' },
            }],
          },
        },
        { message: { role: 'assistant', content: 'Typed' } },
      ],
      streamTokens: ['ok'],
    });
    providerRegistryMod.providerRegistry.register(provider);

    const receivedActions: any[] = [];
    await collectEvents({
      agent: makeAgent({ tools: ['browser-type'] }),
      messages: [{ role: 'user', content: 'type hello' }],
      context: { toolsEnabled: true },
      onAction: (action) => receivedActions.push(action),
    });

    expect(receivedActions).toHaveLength(1);
    expect(receivedActions[0]).toEqual({
      type: 'agent_type',
      element_id: 3,
      text: 'hello world',
    });
  });
});
