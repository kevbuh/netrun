import { createOpenAI } from '@ai-sdk/openai';
import { generateText, streamText, jsonSchema } from 'ai';
import type {
  LLMProvider,
  ChatOptions,
  ChatResponse,
  StreamEvent,
  ToolCall,
} from './types.js';
import type { ToolDefinition } from '../tools/types.js';
import { toAIMessages } from './utils.js';

export class OpenRouterProvider implements LLMProvider {
  name = 'openrouter';
  private baseURL = 'https://openrouter.ai/api/v1';
  private defaultModel = 'google/gemini-2.0-flash-001';
  private _apiKey: string | null = null;

  setApiKey(key: string | null): void {
    this._apiKey = key;
  }

  getApiKey(): string | null {
    return this._apiKey;
  }

  private getProvider() {
    if (!this._apiKey) {
      throw new Error('OpenRouter API key not set. Configure it in Settings > AI.');
    }
    return createOpenAI({
      baseURL: this.baseURL,
      apiKey: this._apiKey,
    } as any);
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const provider = this.getProvider();
    const modelName = options.model || this.defaultModel;
    const model = provider.chat(modelName);

    const aiMsgs = toAIMessages(options.messages);
    const convertedTools = options.tools ? this.convertTools(options.tools) : undefined;

    const result = await generateText({
      model,
      messages: aiMsgs,
      tools: convertedTools,
      toolChoice: convertedTools ? (options.toolChoice ?? 'auto') : undefined,
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
    const modelName = options.model || this.defaultModel;
    const model = provider.chat(modelName);

    const convertedTools = options.tools ? this.convertTools(options.tools) : undefined;
    const result = streamText({
      model,
      messages: toAIMessages(options.messages),
      tools: convertedTools,
      toolChoice: convertedTools ? (options.toolChoice ?? 'auto') : undefined,
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

  async listModels(): Promise<string[]> {
    if (!this._apiKey) return [];
    try {
      const resp = await fetch(`${this.baseURL}/models`, {
        headers: { Authorization: `Bearer ${this._apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      const data = await resp.json() as any;
      return (data.data ?? []).map((m: any) => m.id).sort();
    } catch {
      return [];
    }
  }

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
