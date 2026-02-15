import type { ChatMessage } from '../providers/types.js';

/** Context window sizes (in tokens) for known Ollama models */
export const MODEL_CONTEXT_SIZES: Record<string, number> = {
  'qwen2.5:1.5b': 32000,
  'qwen2.5:3b': 32000,
  'qwen2.5:7b': 32000,
  'qwen3:8b': 32000,
  'qwen3-vl:8b': 32000,
  'llama3:8b': 8000,
  'gemma2:9b': 8000,
  'mistral:7b': 32000,
  'deepseek-r1:8b': 64000,
};

const DEFAULT_CONTEXT_SIZE = 32000;

/** Get the context budget (in tokens) for a model */
export function getContextBudget(model: string): number {
  return MODEL_CONTEXT_SIZES[model] ?? DEFAULT_CONTEXT_SIZE;
}

/** Rough token estimate: ~0.3 tokens per character */
function estimateTokens(text: string): number {
  return Math.ceil(text.length * 0.3);
}

/**
 * Trim messages to fit within the model's context budget.
 * Always keeps the system message (first) and the last user message.
 * Removes oldest non-system messages first.
 */
export function trimMessages(messages: ChatMessage[], budgetTokens: number): ChatMessage[] {
  let total = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  if (total <= budgetTokens) return messages;

  // Separate system message, middle messages, and last user message
  const system = messages[0]?.role === 'system' ? messages[0] : null;
  const rest = system ? messages.slice(1) : [...messages];

  // Find last user message index
  let lastUserIdx = -1;
  for (let i = rest.length - 1; i >= 0; i--) {
    if (rest[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  // Remove oldest non-protected messages until we're under budget
  const trimmed = [...rest];
  let i = 0;
  while (total > budgetTokens && i < trimmed.length) {
    if (i === lastUserIdx) {
      i++;
      continue;
    }
    total -= estimateTokens(trimmed[i].content);
    trimmed.splice(i, 1);
    if (lastUserIdx > i) lastUserIdx--;
    // Don't increment i since we spliced
  }

  return system ? [system, ...trimmed] : trimmed;
}
