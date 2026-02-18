import type { ToolCall } from '../providers/types.js';

/** Events streamed from the agent runtime to the UI */
export type AgentEvent =
  | { type: 'thinking'; content: string }
  | { type: 'token'; content: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: unknown }
  | { type: 'action'; action: AgentAction }
  | { type: 'web_sources'; results: Array<{ title: string; url: string; snippet: string }> }
  | { type: 'usage'; usage: AgentUsage }
  | { type: 'done' }
  | { type: 'error'; error: string };

/** An action the frontend should perform (navigate, click, etc.) */
export interface AgentAction {
  type: string;
  [key: string]: unknown;
}

/** Usage stats for a completed agent run */
export interface AgentUsage {
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
  model?: string;
}

/** Definition of a built-in agent */
export interface AgentDefinition {
  /** Unique agent identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Short description */
  description: string;
  /** Tool names this agent can use (empty = all) */
  tools: string[];
  /** Default LLM model to use */
  model?: string;
  /** Build the system prompt given context */
  buildSystemPrompt(context: AgentContext): string;
  /** Optional: load context files before building the system prompt */
  preloadContext?(context: AgentContext): Promise<void>;
}

/** Context passed when starting an agent session */
export interface AgentContext {
  /** Document/page text content */
  documentText?: string;
  /** Current page URL */
  pageUrl?: string;
  /** Current page title */
  pageTitle?: string;
  /** Browser DOM snapshot (already extracted) */
  browserDom?: string;
  /** User's Google ID */
  googleId?: string;
  /** Whether to enable thinking mode */
  thinkEnabled?: boolean;
  /** Whether to enable tool use */
  toolsEnabled?: boolean;
  /** Model override */
  model?: string;
  /** Living context document (injected from context files) */
  contextDocument?: string;
  /** User's current query (set by runtime for preloadContext) */
  _userQuery?: string;
}

/** A message in the agent conversation */
export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

/** Configuration for a running agent session */
export interface AgentSessionConfig {
  /** The agent definition to use */
  agent: AgentDefinition;
  /** Initial messages from the user */
  messages: AgentMessage[];
  /** Context for the session */
  context: AgentContext;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Callback for streaming actions to the frontend */
  onAction?: (action: AgentAction) => void;
}

/** Maximum number of tool call iterations before stopping */
export const MAX_TOOL_ITERATIONS = 25;

/** Number of repeated identical tool calls before stuck detection triggers */
export const STUCK_THRESHOLD = 3;
