import { createOpenAI } from '@ai-sdk/openai';
import { generateText, streamText, jsonSchema } from 'ai';
import type {
  LLMProvider,
  ChatOptions,
  ChatResponse,
  StreamEvent,
  ChatMessage,
  ToolCall,
} from './types.js';
import type { ToolDefinition } from '../tools/types.js';

/** Convert our messages to Vercel AI SDK format */
function toAIMessages(messages: ChatMessage[]): any[] {
  // Build a map of toolCallId -> toolName from assistant messages
  const toolNameMap = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        toolNameMap.set(tc.id, tc.function.name);
      }
    }
  }

  return messages.map(msg => {
    if (msg.role === 'tool') {
      return {
        role: 'tool' as const,
        content: [{
          type: 'tool-result',
          toolCallId: msg.tool_call_id!,
          toolName: toolNameMap.get(msg.tool_call_id!) ?? 'unknown',
          output: { type: 'text', value: msg.content },
        }],
      };
    }
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      return {
        role: 'assistant' as const,
        content: [
          ...(msg.content ? [{ type: 'text', text: msg.content }] : []),
          ...msg.tool_calls.map(tc => ({
            type: 'tool-call',
            toolCallId: tc.id,
            toolName: tc.function.name,
            args: JSON.parse(tc.function.arguments),
          })),
        ],
      };
    }
    return { role: msg.role, content: msg.content };
  });
}

export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  private baseURL: string;
  private defaultModel: string;
  private embeddingModel: string;

  constructor(options?: { baseURL?: string; model?: string; embeddingModel?: string }) {
    this.baseURL = options?.baseURL ?? 'http://127.0.0.1:11434';
    this.defaultModel = options?.model ?? 'qwen2.5:7b';
    this.embeddingModel = options?.embeddingModel ?? 'nomic-embed-text';
  }

  /** Create an OpenAI-compatible provider pointing at Ollama's /v1 endpoint */
  private getProvider() {
    return createOpenAI({
      baseURL: this.baseURL + '/v1',
      apiKey: 'ollama',
      compatibility: 'compatible',
    } as any);
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const provider = this.getProvider();
    const model = provider.chat(options.model ?? this.defaultModel);

    const aiMsgs = toAIMessages(options.messages);
    const convertedTools = options.tools ? this.convertTools(options.tools) : undefined;

    const result = await generateText({
      model,
      messages: aiMsgs,
      tools: convertedTools,
      temperature: options.temperature,
      maxOutputTokens: options.maxTokens,
      abortSignal: options.signal,
    });

    const toolCalls: ToolCall[] = (result.toolCalls ?? []).map((tc: any) => ({
      id: tc.toolCallId,
      type: 'function' as const,
      function: { name: tc.toolName, arguments: JSON.stringify(tc.args ?? tc.input) },
    }));

    const usage = result.usage as any;

    return {
      message: {
        role: 'assistant',
        content: result.text,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      usage: usage
        ? {
            promptTokens: usage.inputTokens ?? usage.promptTokens ?? 0,
            completionTokens: usage.outputTokens ?? usage.completionTokens ?? 0,
          }
        : undefined,
    };
  }

  async *chatStream(options: ChatOptions): AsyncIterable<StreamEvent> {
    const provider = this.getProvider();
    const model = provider.chat(options.model ?? this.defaultModel);

    const result = streamText({
      model,
      messages: toAIMessages(options.messages),
      tools: options.tools ? this.convertTools(options.tools) : undefined,
      temperature: options.temperature,
      maxOutputTokens: options.maxTokens,
      abortSignal: options.signal,
    });

    for await (const part of result.fullStream) {
      const p = part as any;
      if (p.type === 'text-delta') {
        yield { type: 'token', content: p.text ?? p.textDelta ?? '' };
      } else if (p.type === 'tool-call') {
        yield {
          type: 'tool_call',
          id: p.toolCallId,
          name: p.toolName,
          arguments: JSON.stringify(p.args ?? p.input),
        };
      } else if (p.type === 'finish') {
        const usage = p.totalUsage ?? p.usage;
        yield {
          type: 'done',
          usage: usage
            ? {
                promptTokens: usage.inputTokens ?? usage.promptTokens ?? 0,
                completionTokens: usage.outputTokens ?? usage.completionTokens ?? 0,
              }
            : undefined,
        };
      } else if (p.type === 'error') {
        yield { type: 'error', error: String(p.error) };
      }
    }
  }

  async embed(text: string, model?: string): Promise<number[]> {
    // Use Ollama's native embedding endpoint
    try {
      const resp = await fetch(`${this.baseURL}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model ?? this.embeddingModel, input: text }),
      });
      const data = await resp.json() as any;
      return data.embeddings?.[0] ?? [];
    } catch {
      return [];
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const resp = await fetch(`${this.baseURL}/api/tags`);
      const data = await resp.json() as any;
      return (data.models ?? []).map((m: any) => m.name);
    } catch {
      return [];
    }
  }

  /** Convert our ToolDefinition[] to Vercel AI SDK tools format */
  private convertTools(tools: ToolDefinition[]): any {
    const result: Record<string, any> = {};
    for (const tool of tools) {
      result[tool.function.name] = {
        description: tool.function.description,
        inputSchema: jsonSchema(tool.function.parameters as any),
      };
    }
    return result;
  }
}
