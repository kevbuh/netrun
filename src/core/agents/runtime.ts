import type { ToolCall, ChatMessage, StreamEvent } from '../providers/types.js';
import type { ToolResult } from '../tools/types.js';
import { toolRegistry } from '../tools/registry.js';
import { providerRegistry } from '../providers/registry.js';
import type {
  AgentEvent,
  AgentSessionConfig,
  AgentMessage,
  AgentAction,
} from './types.js';
import { MAX_TOOL_ITERATIONS, STUCK_THRESHOLD } from './types.js';

/**
 * Try to extract a tool call from plain text content.
 * Some models emit tool calls as JSON text instead of structured tool_calls.
 * Ported from content.py fallback logic.
 */
function extractToolCallFromText(content: string): ToolCall[] | null {
  // Strip <think>...</think> tags
  let cleaned = content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
  // Strip markdown code fences
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim();
  }
  // Search for JSON tool call object
  const jsonMatch = cleaned.match(/\{(?:[^{}]|\{[^{}]*\})*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if ('name' in parsed) {
      return [{
        id: `tc_${Date.now()}`,
        type: 'function',
        function: {
          name: parsed.name,
          arguments: JSON.stringify(parsed.arguments ?? parsed.parameters ?? {}),
        },
      }];
    }
  } catch {
    // Not valid JSON, ignore
  }
  return null;
}

/**
 * Convert tool call/result message pairs into plain assistant/user text messages.
 * Some models (e.g. lfm2.5-thinking via Ollama) can't handle tool-role messages.
 */
function flattenToolMessages(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      // Convert tool calls to text description
      const callDescs = msg.tool_calls.map(tc => {
        const args = JSON.parse(tc.function.arguments);
        return `[Called ${tc.function.name}(${Object.entries(args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')})]`;
      }).join('\n');
      const text = (msg.content ? msg.content + '\n' : '') + callDescs;
      result.push({ role: 'assistant', content: text });
    } else if (msg.role === 'tool') {
      // Convert tool result to user message with the result
      try {
        const data = JSON.parse(msg.content);
        result.push({ role: 'user', content: `Tool result: ${data.message ?? msg.content}` });
      } catch {
        result.push({ role: 'user', content: `Tool result: ${msg.content}` });
      }
    } else {
      result.push(msg);
    }
  }
  return result;
}

/**
 * Execute a single tool and return the result along with any actions.
 */
async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: { googleId?: string; documentText?: string; browserDom?: string },
  onAction?: (action: AgentAction) => void,
): Promise<{ result: ToolResult; actions: AgentAction[] }> {
  const actions: AgentAction[] = [];

  // Handle action-type tools that signal the frontend
  const actionTools: Record<string, (args: Record<string, unknown>) => ToolResult> = {
    navigate: (a) => {
      const action: AgentAction = { type: 'navigate', view: a.view ?? 'home' };
      actions.push(action);
      return { success: true, data: { status: 'ok', message: `Navigated to ${a.view ?? 'home'}` } };
    },
    'open-tab': (a) => {
      const url = (a.url as string) ?? '';
      actions.push({ type: 'open_tab', url });
      return { success: true, data: { status: 'ok', message: url ? `Opened ${url}` : 'Opened a new tab' } };
    },
    'save-to-reading-list': (a) => {
      actions.push({ type: 'bookmark', url: a.url, title: a.title });
      return { success: true, data: { status: 'ok', message: 'Post bookmarked' } };
    },
    'browser-read-page': () => {
      actions.push({ type: 'agent_read_page' });
      if (context.browserDom) {
        return { success: true, data: { status: 'ok', dom: context.browserDom } };
      }
      return { success: true, data: { status: 'ok', message: 'DOM is included in your system context.' } };
    },
    'browser-click': (a) => {
      actions.push({ type: 'agent_click', element_id: a.element_id });
      return { success: true, data: { status: 'ok', message: `Clicked element ${a.element_id}` } };
    },
    'browser-type': (a) => {
      actions.push({ type: 'agent_type', element_id: a.element_id, text: a.text });
      return { success: true, data: { status: 'ok', message: `Typed into element ${a.element_id}` } };
    },
    'browser-scroll': (a) => {
      actions.push({ type: 'agent_scroll', direction: a.direction ?? 'down' });
      return { success: true, data: { status: 'ok', message: `Scrolled ${a.direction ?? 'down'}` } };
    },
    'browser-navigate': (a) => {
      actions.push({ type: 'agent_navigate', url: a.url });
      return { success: true, data: { status: 'ok', message: `Navigating to ${a.url}` } };
    },
    'browser-screenshot': () => {
      actions.push({ type: 'agent_screenshot' });
      return { success: true, data: { status: 'pending', message: 'Taking screenshot...' } };
    },
  };

  let result: ToolResult;
  const actionHandler = actionTools[name];
  if (actionHandler) {
    result = actionHandler(args);
  } else {
    // Execute via tool registry
    result = await toolRegistry.execute(name, args, { googleId: context.googleId });
  }

  // Emit actions to frontend
  if (onAction) {
    for (const action of actions) {
      onAction(action);
    }
  }

  return { result, actions };
}

/**
 * Run the agent loop: LLM inference -> tool calls -> results -> repeat.
 * Yields AgentEvents as an async generator for streaming to the UI.
 *
 * Ported from content.py:doc_chat generate() function.
 */
export async function* runAgent(config: AgentSessionConfig): AsyncGenerator<AgentEvent> {
  const { agent, context, signal } = config;

  const provider = providerRegistry.getDefault();
  if (!provider) {
    yield { type: 'error', error: 'No LLM provider configured' };
    return;
  }

  // Build system prompt
  const systemPrompt = agent.buildSystemPrompt(context);
  const model = context.model ?? agent.model;

  // Build message list (filter out empty messages that break Vercel AI SDK validation)
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...config.messages
      .filter(m => m.content || m.tool_calls?.length || m.tool_call_id)
      .map(m => ({
        role: m.role as ChatMessage['role'],
        content: m.content ?? '',
        tool_call_id: m.tool_call_id,
        tool_calls: m.tool_calls,
      })),
  ];

  const toolsEnabled = context.toolsEnabled !== false;

  if (toolsEnabled) {
    // Get tool definitions filtered to this agent's whitelist
    const allDefs = toolRegistry.toToolDefinitions('agent');
    const toolDefs = agent.tools.length > 0
      ? allDefs.filter(d => agent.tools.includes(d.function.name))
      : allDefs;

    // If DOM is already in context, exclude browser-read-page
    const hasDom = !!context.browserDom;
    const filteredDefs = hasDom
      ? toolDefs.filter(d => d.function.name !== 'browser-read-page')
      : toolDefs;

    // Tool call loop
    let lastToolCallSig: string | null = null;
    let repeatCount = 0;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      if (signal?.aborted) {
        yield { type: 'error', error: 'Cancelled' };
        return;
      }

      // Non-streaming call for tool resolution
      let response;
      try {
        response = await provider.chat({
          messages,
          tools: filteredDefs,
          model,
          signal,
        });
      } catch (toolErr: any) {
        // Some models (e.g. lfm2.5-thinking) can't handle tool results + tool defs together.
        // Flatten tool messages to plain text and retry without tools.
        console.warn('[agent] tool-call chat failed, falling back to flattened messages:', toolErr.message);
        response = await provider.chat({ messages: flattenToolMessages(messages), model, signal });
      }

      let toolCalls = response.message.tool_calls;

      // Fallback: try extracting tool calls from text content
      if (!toolCalls?.length && response.message.content) {
        toolCalls = extractToolCallFromText(response.message.content) ?? undefined;
      }

      if (!toolCalls?.length) {
        // No tool calls: model produced final text, break to streaming
        break;
      }

      // Stuck detection
      const callSig = JSON.stringify(
        toolCalls.map(tc => [tc.function.name, tc.function.arguments]).sort()
      );
      if (callSig === lastToolCallSig) {
        repeatCount++;
        if (repeatCount >= STUCK_THRESHOLD) {
          yield {
            type: 'tool_call',
            name: '_stopped',
            args: { reason: 'repeated tool call detected' },
          };
          break;
        }
      } else {
        repeatCount = 0;
      }
      lastToolCallSig = callSig;

      // Add assistant message with tool calls to history
      messages.push(response.message);

      // Execute each tool call
      for (const tc of toolCalls) {
        const toolName = tc.function.name;
        let toolArgs: Record<string, unknown>;
        try {
          toolArgs = JSON.parse(tc.function.arguments);
        } catch {
          toolArgs = {};
        }

        // Emit tool_call event
        yield { type: 'tool_call', name: toolName, args: toolArgs };

        // Execute the tool
        const { result, actions } = await executeTool(
          toolName,
          toolArgs,
          {
            googleId: context.googleId,
            documentText: context.documentText,
            browserDom: context.browserDom,
          },
          config.onAction,
        );

        // Emit actions
        for (const action of actions) {
          yield { type: 'action', action };
        }

        // Emit web sources for search results
        if (toolName === 'web-search' && result.success && result.data) {
          const data = result.data as any;
          if (data.results?.length) {
            yield { type: 'web_sources', results: data.results };
          }
        }

        // Emit tool result
        yield { type: 'tool_result', name: toolName, result: result.data ?? result.error };

        // Add tool result to messages
        messages.push({
          role: 'tool',
          content: JSON.stringify(result.data ?? { error: result.error }),
          tool_call_id: tc.id,
        });
      }
    }
  }

  // Final streaming call (no tools)
  if (signal?.aborted) {
    yield { type: 'error', error: 'Cancelled' };
    return;
  }

  // Flatten tool call/result messages into plain text for models that don't support them
  const streamMessages = flattenToolMessages(messages);

  try {
    for await (const event of provider.chatStream({ messages: streamMessages, model, signal })) {
      if (signal?.aborted) {
        yield { type: 'error', error: 'Cancelled' };
        return;
      }

      switch (event.type) {
        case 'token':
          yield { type: 'token', content: event.content };
          break;
        case 'done':
          if (event.usage) {
            yield {
              type: 'usage',
              usage: {
                promptTokens: event.usage.promptTokens,
                completionTokens: event.usage.completionTokens,
                model: model,
              },
            };
          }
          break;
        case 'error':
          yield { type: 'error', error: event.error };
          return;
      }
    }
  } catch (err) {
    if (signal?.aborted) {
      yield { type: 'error', error: 'Cancelled' };
      return;
    }
    yield { type: 'error', error: err instanceof Error ? err.message : String(err) };
    return;
  }

  yield { type: 'done' };
}
