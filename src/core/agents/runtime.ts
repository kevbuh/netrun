import type { ToolCall, ChatMessage, StreamEvent } from '../providers/types.js';
import type { ToolResult, ToolContext } from '../tools/types.js';
import { toolRegistry } from '../tools/registry.js';
import { providerRegistry } from '../providers/registry.js';
import type {
  AgentEvent,
  AgentSessionConfig,
  AgentMessage,
  AgentAction,
} from './types.js';
import { MAX_TOOL_ITERATIONS, STUCK_THRESHOLD } from './types.js';
import { getContextBudget, trimMessages } from './context.js';

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

/** Pending async action results, keyed by requestId */
const pendingActionResults = new Map<string, {
  resolve: (result: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

/** Called by IPC when the frontend sends back an action result */
export function resolveActionResult(requestId: string, result: unknown): void {
  const pending = pendingActionResults.get(requestId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingActionResults.delete(requestId);
    pending.resolve(result);
  }
}

/** Wait for a frontend action result with timeout */
function waitForActionResult(requestId: string, timeoutMs = 15000): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingActionResults.delete(requestId);
      resolve({ error: 'timeout', message: 'Action timed out' });
    }, timeoutMs);
    pendingActionResults.set(requestId, { resolve, timer });
  });
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

  // Extract user query for context preloading
  for (let i = config.messages.length - 1; i >= 0; i--) {
    if (config.messages[i].role === 'user' && config.messages[i].content) {
      context._userQuery = config.messages[i].content;
      break;
    }
  }

  // Preload context files if the agent supports it
  if (agent.preloadContext) {
    try {
      await agent.preloadContext(context);
    } catch (err: any) {
      console.debug('[agent] preloadContext failed:', err?.message ?? err);
    }
  }

  // Build system prompt
  const systemPrompt = agent.buildSystemPrompt(context);
  const model = context.model ?? agent.model;

  // Emit system prompt for transparency
  yield { type: 'system_prompt', content: systemPrompt };

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
  const contextBudget = getContextBudget(model ?? 'default');

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
    let hasResearchContent = false;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      if (signal?.aborted) {
        yield { type: 'error', error: 'Cancelled' };
        return;
      }

      // Non-streaming call for tool resolution
      const trimmedMessages = trimMessages(messages, contextBudget);
      let response;
      try {
        response = await provider.chat({
          messages: trimmedMessages,
          tools: filteredDefs,
          toolChoice: 'auto',
          model,
          signal,
        });
      } catch (toolErr: any) {
        // Some models (e.g. lfm2.5-thinking) can't handle tool results + tool defs together.
        // Flatten tool messages to plain text and retry without tools.
        console.warn('[agent] tool-call chat failed, falling back to flattened messages:', toolErr.message);
        response = await provider.chat({ messages: flattenToolMessages(messages), model, signal });
      }

      let toolCalls: ToolCall[] | undefined = response.message.tool_calls;

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

      // Parse all tool calls upfront
      type ParsedToolCall = { tc: ToolCall; toolName: string; toolArgs: Record<string, unknown> };
      const parsed: ParsedToolCall[] = toolCalls.map(tc => {
        let toolArgs: Record<string, unknown>;
        try { toolArgs = JSON.parse(tc.function.arguments); } catch { toolArgs = {}; }
        return { tc, toolName: tc.function.name, toolArgs };
      });

      // Emit all tool_call events immediately so the UI shows them
      for (const { toolName, toolArgs } of parsed) {
        yield { type: 'tool_call', name: toolName, args: toolArgs };
      }

      // Split into parallel-safe tools and sequential tools using registry metadata
      const parallelBatch: ParsedToolCall[] = [];
      const sequentialBatch: ParsedToolCall[] = [];
      for (const entry of parsed) {
        const tool = toolRegistry.get(entry.toolName);
        if (tool?.sequential) {
          sequentialBatch.push(entry);
        } else {
          parallelBatch.push(entry);
        }
      }

      // Build a per-tool context with emitAction and waitForResult injected
      const makeToolCtx = (): ToolContext => {
        const actions: AgentAction[] = [];
        return {
          googleId: context.googleId,
          documentText: context.documentText,
          browserDom: context.browserDom,
          emitAction: (action) => {
            actions.push(action);
            config.onAction?.(action);
          },
          waitForResult: waitForActionResult,
          _actions: actions,
        } as ToolContext & { _actions: AgentAction[] };
      };

      // Execute parallel-safe tools concurrently
      const parallelCtxs = parallelBatch.map(() => makeToolCtx());
      const parallelResults = await Promise.all(
        parallelBatch.map(({ toolName, toolArgs }, idx) =>
          toolRegistry.execute(toolName, toolArgs, parallelCtxs[idx])
        )
      );

      // Emit events and add results to messages for parallel tools
      for (let j = 0; j < parallelBatch.length; j++) {
        const { tc, toolName } = parallelBatch[j];
        const result = parallelResults[j];
        const actions = (parallelCtxs[j] as any)._actions as AgentAction[];

        for (const action of actions) {
          yield { type: 'action', action };
        }

        if ((toolName === 'web-search' || toolName === 'web-research') && result.success && result.data) {
          const data = result.data as any;
          if (data.results?.length) {
            yield { type: 'web_sources', results: data.results };
            if (toolName === 'web-research') {
              hasResearchContent = true;
            }
          }
        }

        yield { type: 'tool_result', name: toolName, result: result.data ?? result.error };

        messages.push({
          role: 'tool',
          content: JSON.stringify(result.data ?? { error: result.error }),
          tool_call_id: tc.id,
        });
      }

      // Execute sequential tools one at a time
      for (const { tc, toolName, toolArgs } of sequentialBatch) {
        const perToolCtx = makeToolCtx();
        const result = await toolRegistry.execute(toolName, toolArgs, perToolCtx);
        const actions = (perToolCtx as any)._actions as AgentAction[];

        for (const action of actions) {
          yield { type: 'action', action };
        }

        yield { type: 'tool_result', name: toolName, result: result.data ?? result.error };

        messages.push({
          role: 'tool',
          content: JSON.stringify(result.data ?? { error: result.error }),
          tool_call_id: tc.id,
        });
      }

      // Early exit: web-research already fetched + extracted — go straight to streaming
      if (hasResearchContent) {
        break;
      }
    }
  }

  // Final streaming call (no tools)
  if (signal?.aborted) {
    yield { type: 'error', error: 'Cancelled' };
    return;
  }

  // Flatten tool call/result messages into plain text for models that don't support them
  const streamMessages = trimMessages(flattenToolMessages(messages), contextBudget);

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
