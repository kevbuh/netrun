export { runAgent } from './runtime.js';
export { researchAssistant } from './builtin/research-assistant.js';
export { chatAgent } from './builtin/chat.js';
export { browserAgent } from './builtin/browser.js';
export { AgentRegistry, agentRegistry } from './registry.js';
export { MODEL_CONTEXT_SIZES, getContextBudget, trimMessages } from './context.js';
export type {
  AgentEvent,
  AgentAction,
  AgentUsage,
  AgentDefinition,
  AgentContext,
  AgentMessage,
  AgentSessionConfig,
} from './types.js';
export { MAX_TOOL_ITERATIONS, STUCK_THRESHOLD } from './types.js';

import { agentRegistry } from './registry.js';
import { researchAssistant } from './builtin/research-assistant.js';
import { chatAgent } from './builtin/chat.js';
import { browserAgent } from './builtin/browser.js';

/** Register all built-in agents */
export function registerAllAgents(): void {
  agentRegistry.register(researchAssistant);
  agentRegistry.register(chatAgent);
  agentRegistry.register(browserAgent);
}
