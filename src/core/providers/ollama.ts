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
import { toAIMessages } from './utils.js';
import { trackLLMCall } from './llm-activity.js';

export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  private baseURL: string;
  private preferredModel: string;
  private resolvedDefault: string | null = null;
  private resolving: Promise<string> | null = null;

  /** Preferred chat models in order of preference */
  private static readonly MODEL_PREFERENCE = [
    'qwen2.5:7b', 'qwen2.5:3b', 'qwen3:8b', 'qwen2.5:1.5b', 'qwen3:0.6b',
  ];

  constructor(options?: { baseURL?: string; model?: string }) {
    this.baseURL = options?.baseURL ?? 'http://127.0.0.1:11434';
    this.preferredModel = options?.model ?? 'qwen2.5:7b';
  }

  /** Resolve the default model: use preferred if available, otherwise pick best installed */
  private async resolveDefaultModel(): Promise<string> {
    if (this.resolvedDefault) return this.resolvedDefault;
    if (this.resolving) return this.resolving;
    this.resolving = (async () => {
      try {
        const models = await this.listModels();
        const installed = new Set(models.map(m => m.replace(/:latest$/, '')));
        // Check preferred first
        if (installed.has(this.preferredModel) || installed.has(this.preferredModel.replace(/:latest$/, ''))) {
          this.resolvedDefault = this.preferredModel;
          return this.preferredModel;
        }
        // Fall back to preference list
        for (const candidate of OllamaProvider.MODEL_PREFERENCE) {
          const base = candidate.replace(/:latest$/, '');
          if (installed.has(candidate) || installed.has(base)) {
            console.debug(`[ollama] Preferred model ${this.preferredModel} not found, using ${candidate}`);
            this.resolvedDefault = candidate;
            return candidate;
          }
        }
      } catch {}
      // Last resort: use preferred and let it fail visibly
      this.resolvedDefault = this.preferredModel;
      return this.preferredModel;
    })();
    const result = await this.resolving;
    this.resolving = null;
    return result;
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
    const modelName = options.model ?? await this.resolveDefaultModel();
    const model = provider.chat(modelName);

    const aiMsgs = toAIMessages(options.messages);
    const convertedTools = options.tools ? this.convertTools(options.tools) : undefined;

    const tracker = trackLLMCall(modelName, options.messages);
    try {
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
      tracker.done();

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
    } catch (err) {
      tracker.error();
      throw err;
    }
  }

  async *chatStream(options: ChatOptions): AsyncIterable<StreamEvent> {
    const provider = this.getProvider();
    const modelName = options.model ?? await this.resolveDefaultModel();
    const model = provider.chat(modelName);

    const convertedTools = options.tools ? this.convertTools(options.tools) : undefined;
    const tracker = trackLLMCall(modelName, options.messages);
    const result = streamText({
      model,
      messages: toAIMessages(options.messages),
      tools: convertedTools,
      toolChoice: convertedTools ? (options.toolChoice ?? 'auto') : undefined,
      temperature: options.temperature,
      maxOutputTokens: options.maxTokens,
      abortSignal: options.signal,
    });

    try {
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
      tracker.done();
    } catch (err) {
      tracker.error();
      throw err;
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
