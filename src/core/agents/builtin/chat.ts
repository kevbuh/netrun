import type { AgentDefinition, AgentContext } from '../types.js';
import { contextManager } from '../../context/manager.js';

function buildLivingContext(budgetChars: number): string {
  try {
    let ctx = contextManager.getMainContext();
    if (!ctx) return '';
    if (ctx.length > budgetChars) ctx = ctx.slice(0, budgetChars);
    return '\n\n--- USER CONTEXT ---\n' + ctx + '\n--- END USER CONTEXT ---';
  } catch {
    return '';
  }
}

/**
 * Lightweight chat agent — no tools, fast responses.
 */
export const chatAgent: AgentDefinition = {
  id: 'chat',
  name: 'Chat',
  description: 'Simple chat with no tools — fast, lightweight responses',

  tools: [],

  model: 'qwen3:8b',

  buildSystemPrompt(context: AgentContext): string {
    const now = new Date();
    const dateStr = `CURRENT DATE AND TIME: ${now.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })} (local time).\n\n`;

    const livingCtx = buildLivingContext(4000);

    if (context.documentText) {
      const truncatedDoc = context.documentText.slice(0, 8000);
      return (
        dateStr +
        'You are a helpful assistant. The user is reading a document. ' +
        'Answer their questions based on the document text below.' + livingCtx + '\n\n' +
        '--- DOCUMENT TEXT ---\n' + truncatedDoc + '\n--- END ---'
      );
    }

    return dateStr + 'You are a helpful assistant. Be concise and clear.' + livingCtx;
  },
};
