import type { ToolDefinition } from '../tools/types.js';

/** A message in a conversation */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Tool call ID (for tool result messages) */
  tool_call_id?: string;
  /** Tool calls made by the assistant */
  tool_calls?: ToolCall[];
}

/** A tool call from the LLM */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** Streaming events from the LLM */
export type StreamEvent =
  | { type: 'token'; content: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'done'; usage?: { promptTokens: number; completionTokens: number } }
  | { type: 'error'; error: string };

/** Options for a chat completion request */
export interface ChatOptions {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  model?: string;
  signal?: AbortSignal;
  /** Hint to the model about tool usage */
  toolChoice?: 'auto' | 'none' | 'required';
}

/** Non-streaming chat response */
export interface ChatResponse {
  message: ChatMessage;
  usage?: { promptTokens: number; completionTokens: number };
}

/** Provider interface - what every LLM backend must implement */
export interface LLMProvider {
  /** Provider name (e.g., 'ollama', 'openai') */
  name: string;

  /** Chat completion (non-streaming) */
  chat(options: ChatOptions): Promise<ChatResponse>;

  /** Streaming chat completion */
  chatStream(options: ChatOptions): AsyncIterable<StreamEvent>;

  /** Generate embeddings for text */
  embed(text: string, model?: string): Promise<number[]>;

  /** List available models */
  listModels(): Promise<string[]>;
}
