import type { ChatMessage } from './types.js';

/** Convert our messages to Vercel AI SDK format */
export function toAIMessages(messages: ChatMessage[]): any[] {
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
