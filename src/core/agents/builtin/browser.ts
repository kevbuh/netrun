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
 * Browser automation agent — browser tools only.
 */
export const browserAgent: AgentDefinition = {
  id: 'browser',
  name: 'Browser',
  description: 'Browser automation specialist — navigate, click, scroll, and interact with pages',

  tools: [
    'browser-read-page',
    'browser-click',
    'browser-type',
    'browser-scroll',
    'browser-navigate',
    'browser-screenshot',
    'browser-query-selector',
    'browser-wait-for',
    'browser-get-url',
    'browser-get-tabs',
    'browser-switch-tab',
    'browser-back',
    'browser-forward',
  ],

  model: 'qwen3:8b',

  buildSystemPrompt(context: AgentContext): string {
    const now = new Date();
    const dateStr = `CURRENT DATE AND TIME: ${now.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })} (local time).\n\n`;

    const hasDom = !!context.browserDom;
    const livingCtx = buildLivingContext(2000);

    let pageCtx = '';
    if (context.pageUrl) {
      pageCtx = `\n\nThe user is currently viewing: "${context.pageTitle ?? ''}" (${context.pageUrl}).`;
    }

    let browserDesc: string;
    if (hasDom) {
      browserDesc =
        'You have browser automation tools: ' +
        'browser-click(element_id), browser-type(element_id, text), browser-scroll(direction), ' +
        'browser-navigate(url), browser-query-selector(selector), browser-wait-for(selector, timeout_ms), ' +
        'browser-get-url(), browser-get-tabs(), browser-switch-tab(tab_id), ' +
        'browser-back(), browser-forward(). ' +
        'The BROWSER TAB DOM section below shows the viewport-scoped page elements with [N] IDs. ' +
        'Use these IDs directly with browser-click/browser-type. ' +
        'When the user says "scroll down" or "scroll up", call browser-scroll. ' +
        'Do NOT call browser-read-page — the DOM is already provided.';
    } else {
      browserDesc =
        'You have browser automation tools: browser-read-page (read current page DOM), ' +
        'browser-click(element_id), browser-type(element_id, text), browser-scroll(direction), ' +
        'browser-navigate(url), browser-query-selector(selector), browser-wait-for(selector, timeout_ms), ' +
        'browser-get-url(), browser-get-tabs(), browser-switch-tab(tab_id), ' +
        'browser-back(), browser-forward(). ' +
        'Each page element has a numeric ID like [1], [2]. ' +
        'When the user says "scroll down" or "scroll up", call browser-scroll.';
    }

    return (
      dateStr +
      'You are a browser automation specialist inside Netrun, a desktop research app. ' +
      'You control the browser using tools. IMPORTANT: You MUST actually call the tools to ' +
      'perform actions — never pretend you performed an action. ' +
      browserDesc + pageCtx + livingCtx
    );
  },
};
