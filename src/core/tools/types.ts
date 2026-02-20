import { z } from 'zod';

/** Access levels for tools */
export type ToolAccess = 'agent' | 'mcp' | 'ui';

/** Tool execution context passed to every tool handler */
export interface ToolContext {
  /** Current user's Google ID (if authenticated) */
  googleId?: string;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Callback for streaming partial results */
  onProgress?: (data: unknown) => void;
  /** Emit an action to the frontend (navigate, click, etc.) */
  emitAction?: (action: { type: string; [key: string]: unknown }) => void;
  /** Wait for an async frontend result by request ID */
  waitForResult?: (requestId: string, timeoutMs?: number) => Promise<unknown>;
  /** Browser DOM snapshot */
  browserDom?: string;
  /** Document text content */
  documentText?: string;
}

/** Result of a tool execution */
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/** A tool definition: name, schema, handler */
export interface Tool<TInput = unknown, TOutput = unknown> {
  /** Unique tool name (e.g., 'web-search') */
  name: string;
  /** Human-readable description */
  description: string;
  /** Category for grouping (e.g., 'search', 'content') */
  category: string;
  /** Who can invoke this tool */
  access: ToolAccess[];
  /** Zod schema for input validation */
  parameters: z.ZodType<TInput>;
  /** If true, must not run in parallel with other sequential tools */
  sequential?: boolean;
  /** Execute the tool */
  execute(input: TInput, context: ToolContext): Promise<ToolResult<TOutput>>;
}

/** JSON Schema representation for LLM tool calling */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}
