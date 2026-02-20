import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../types.js';

// Browser tools are action tools — they emit actions to the frontend via context.emitAction.
// Async tools also use context.waitForResult to get results back from the renderer.

function makeRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const emptyParams = z.object({});

// ── Fire-and-forget tools ──

export const browserReadPage: Tool<z.infer<typeof emptyParams>, { status: string; message?: string; dom?: string }> = {
  name: 'browser-read-page',
  description: 'Re-read the current page DOM. Returns elements with numeric IDs for browser-click/browser-type.',
  category: 'browser',
  access: ['agent'],
  sequential: true,
  parameters: emptyParams,
  async execute(_input: z.infer<typeof emptyParams>, context: ToolContext): Promise<ToolResult<{ status: string; message?: string; dom?: string }>> {
    context.emitAction?.({ type: 'agent_read_page' });
    if (context.browserDom) {
      return { success: true, data: { status: 'ok', dom: context.browserDom } };
    }
    return { success: true, data: { status: 'ok', message: 'DOM is included in your system context.' } };
  },
};

const clickParams = z.object({
  element_id: z.coerce.number().describe('The numeric element ID from the DOM tree'),
});

export const browserClick: Tool<z.infer<typeof clickParams>, { status: string; message: string }> = {
  name: 'browser-click',
  description: 'Click an element on the current page by its numeric ID from browser-read-page.',
  category: 'browser',
  access: ['agent'],
  sequential: true,
  parameters: clickParams,
  async execute(input, context): Promise<ToolResult<{ status: string; message: string }>> {
    context.emitAction?.({ type: 'agent_click', element_id: input.element_id });
    return { success: true, data: { status: 'ok', message: `Clicked element ${input.element_id}` } };
  },
};

const typeParams = z.object({
  element_id: z.coerce.number().describe('The numeric element ID from the DOM tree'),
  text: z.string().describe('The text to type into the field'),
});

export const browserType: Tool<z.infer<typeof typeParams>, { status: string; message: string }> = {
  name: 'browser-type',
  description: 'Type text into an input/textarea element by its numeric ID.',
  category: 'browser',
  access: ['agent'],
  sequential: true,
  parameters: typeParams,
  async execute(input, context): Promise<ToolResult<{ status: string; message: string }>> {
    context.emitAction?.({ type: 'agent_type', element_id: input.element_id, text: input.text });
    return { success: true, data: { status: 'ok', message: `Typed into element ${input.element_id}` } };
  },
};

const scrollParams = z.object({
  direction: z.enum(['up', 'down']).describe('Scroll direction'),
});

export const browserScroll: Tool<z.infer<typeof scrollParams>, { status: string; message: string }> = {
  name: 'browser-scroll',
  description: 'Scroll the current page up or down.',
  category: 'browser',
  access: ['agent'],
  sequential: true,
  parameters: scrollParams,
  async execute(input, context): Promise<ToolResult<{ status: string; message: string }>> {
    context.emitAction?.({ type: 'agent_scroll', direction: input.direction });
    return { success: true, data: { status: 'ok', message: `Scrolled ${input.direction}` } };
  },
};

const navigateParams = z.object({
  url: z.string().describe('The URL to navigate to'),
});

export const browserNavigate: Tool<z.infer<typeof navigateParams>, { status: string; message: string }> = {
  name: 'browser-navigate',
  description: 'Navigate the current browser tab to a specific URL.',
  category: 'browser',
  access: ['agent'],
  sequential: true,
  parameters: navigateParams,
  async execute(input, context): Promise<ToolResult<{ status: string; message: string }>> {
    context.emitAction?.({ type: 'agent_navigate', url: input.url });
    return { success: true, data: { status: 'ok', message: `Navigating to ${input.url}` } };
  },
};

export const browserScreenshot: Tool<z.infer<typeof emptyParams>, { status: string; message: string }> = {
  name: 'browser-screenshot',
  description: 'Take a screenshot of the current browser tab.',
  category: 'browser',
  access: ['agent'],
  sequential: true,
  parameters: emptyParams,
  async execute(_input: z.infer<typeof emptyParams>, context: ToolContext): Promise<ToolResult<{ status: string; message: string }>> {
    context.emitAction?.({ type: 'agent_screenshot' });
    return { success: true, data: { status: 'pending', message: 'Taking screenshot...' } };
  },
};

const pressKeyParams = z.object({
  key: z.string().describe('Key to press: "Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "Backspace", "Space", or any single character'),
  modifiers: z.array(z.enum(['ctrl', 'shift', 'alt', 'meta'])).optional().describe('Optional modifier keys to hold'),
  element_id: z.coerce.number().optional().describe('Optional element ID to target (defaults to active element)'),
});

export const browserPressKey: Tool<z.infer<typeof pressKeyParams>, { status: string; message: string }> = {
  name: 'browser-press-key',
  description: 'Press a keyboard key on the current page. Useful for Enter to submit forms, Tab to move focus, Escape to close dialogs, arrow keys for navigation, or modifier combos like Ctrl+A.',
  category: 'browser',
  access: ['agent'],
  sequential: true,
  parameters: pressKeyParams,
  async execute(input, context): Promise<ToolResult<{ status: string; message: string }>> {
    context.emitAction?.({ type: 'agent_press_key', key: input.key, modifiers: input.modifiers, element_id: input.element_id });
    const mods = input.modifiers?.length ? ` with ${input.modifiers.join('+')}` : '';
    return { success: true, data: { status: 'ok', message: `Pressed ${input.key}${mods}` } };
  },
};

// ── Async tools (wait for frontend result) ──

const querySelectorParams = z.object({
  selector: z.string().describe('CSS selector to query for elements'),
  max_results: z.coerce.number().optional().describe('Maximum elements to return (default 20)'),
});

export const browserQuerySelector: Tool<z.infer<typeof querySelectorParams>, unknown> = {
  name: 'browser-query-selector',
  description: 'Query the current page with a CSS selector and get matching elements with numeric IDs for browser-click/browser-type.',
  category: 'browser',
  access: ['agent'],
  sequential: true,
  parameters: querySelectorParams,
  async execute(input, context): Promise<ToolResult> {
    const requestId = makeRequestId();
    context.emitAction?.({ type: 'agent_query_selector', selector: input.selector, max_results: input.max_results, requestId });
    if (context.waitForResult) {
      const result = await context.waitForResult(requestId, 15000);
      return { success: true, data: result };
    }
    return { success: true, data: { status: 'pending', message: `Querying selector: ${input.selector}` } };
  },
};

const waitForParams = z.object({
  selector: z.string().describe('CSS selector to wait for'),
  timeout_ms: z.coerce.number().optional().describe('Timeout in milliseconds (default 5000)'),
});

export const browserWaitFor: Tool<z.infer<typeof waitForParams>, unknown> = {
  name: 'browser-wait-for',
  description: 'Wait for a CSS selector to appear on the page. Returns when the element is found or timeout expires.',
  category: 'browser',
  access: ['agent'],
  sequential: true,
  parameters: waitForParams,
  async execute(input, context): Promise<ToolResult> {
    const requestId = makeRequestId();
    context.emitAction?.({ type: 'agent_wait_for', selector: input.selector, timeout_ms: input.timeout_ms, requestId });
    if (context.waitForResult) {
      const timeoutMs = (input.timeout_ms || 5000) + 5000;
      const result = await context.waitForResult(requestId, timeoutMs);
      return { success: true, data: result };
    }
    return { success: true, data: { status: 'pending', message: `Waiting for ${input.selector}...` } };
  },
};

export const browserGetUrl: Tool<z.infer<typeof emptyParams>, unknown> = {
  name: 'browser-get-url',
  description: 'Get the current page URL and title without reading the full DOM.',
  category: 'browser',
  access: ['agent'],
  sequential: true,
  parameters: emptyParams,
  async execute(_input: z.infer<typeof emptyParams>, context: ToolContext): Promise<ToolResult> {
    const requestId = makeRequestId();
    context.emitAction?.({ type: 'agent_get_url', requestId });
    if (context.waitForResult) {
      const result = await context.waitForResult(requestId, 15000);
      return { success: true, data: result };
    }
    return { success: true, data: { status: 'pending', message: 'Getting URL...' } };
  },
};

export const browserGetTabs: Tool<z.infer<typeof emptyParams>, unknown> = {
  name: 'browser-get-tabs',
  description: 'List all open browser tabs with their URL, title, and active status.',
  category: 'browser',
  access: ['agent'],
  sequential: true,
  parameters: emptyParams,
  async execute(_input: z.infer<typeof emptyParams>, context: ToolContext): Promise<ToolResult> {
    const requestId = makeRequestId();
    context.emitAction?.({ type: 'agent_get_tabs', requestId });
    if (context.waitForResult) {
      const result = await context.waitForResult(requestId, 15000);
      return { success: true, data: result };
    }
    return { success: true, data: { status: 'pending', message: 'Listing tabs...' } };
  },
};

const switchTabParams = z.object({
  tab_id: z.coerce.number().describe('The tab ID to switch to (from browser-get-tabs)'),
});

export const browserSwitchTab: Tool<z.infer<typeof switchTabParams>, unknown> = {
  name: 'browser-switch-tab',
  description: 'Switch to a different browser tab by its ID.',
  category: 'browser',
  access: ['agent'],
  sequential: true,
  parameters: switchTabParams,
  async execute(input, context): Promise<ToolResult> {
    const requestId = makeRequestId();
    context.emitAction?.({ type: 'agent_switch_tab', tab_id: input.tab_id, requestId });
    if (context.waitForResult) {
      const result = await context.waitForResult(requestId, 15000);
      return { success: true, data: result };
    }
    return { success: true, data: { status: 'pending', message: `Switching to tab ${input.tab_id}...` } };
  },
};

export const browserBack: Tool<z.infer<typeof emptyParams>, unknown> = {
  name: 'browser-back',
  description: 'Navigate back in the current tab\'s history.',
  category: 'browser',
  access: ['agent'],
  sequential: true,
  parameters: emptyParams,
  async execute(_input: z.infer<typeof emptyParams>, context: ToolContext): Promise<ToolResult> {
    const requestId = makeRequestId();
    context.emitAction?.({ type: 'agent_back', requestId });
    if (context.waitForResult) {
      const result = await context.waitForResult(requestId, 15000);
      return { success: true, data: result };
    }
    return { success: true, data: { status: 'pending', message: 'Going back...' } };
  },
};

export const browserForward: Tool<z.infer<typeof emptyParams>, unknown> = {
  name: 'browser-forward',
  description: 'Navigate forward in the current tab\'s history.',
  category: 'browser',
  access: ['agent'],
  sequential: true,
  parameters: emptyParams,
  async execute(_input: z.infer<typeof emptyParams>, context: ToolContext): Promise<ToolResult> {
    const requestId = makeRequestId();
    context.emitAction?.({ type: 'agent_forward', requestId });
    if (context.waitForResult) {
      const result = await context.waitForResult(requestId, 15000);
      return { success: true, data: result };
    }
    return { success: true, data: { status: 'pending', message: 'Going forward...' } };
  },
};

// ── Storage inspection ──

const getStorageParams = z.object({
  type: z.enum(['cookies', 'localStorage', 'sessionStorage']).describe('Which storage to read'),
  key_filter: z.string().optional().describe('Optional substring filter for key names'),
});

export const browserGetStorage: Tool<z.infer<typeof getStorageParams>, unknown> = {
  name: 'browser-get-storage',
  description: 'Read cookies, localStorage, or sessionStorage from the current page. Useful for debugging auth state and inspecting page data.',
  category: 'browser',
  access: ['agent'],
  sequential: true,
  parameters: getStorageParams,
  async execute(input, context): Promise<ToolResult> {
    const requestId = makeRequestId();
    context.emitAction?.({ type: 'agent_get_storage', storage_type: input.type, key_filter: input.key_filter, requestId });
    if (context.waitForResult) {
      const result = await context.waitForResult(requestId, 15000);
      return { success: true, data: result };
    }
    return { success: true, data: { status: 'pending', message: `Reading ${input.type}...` } };
  },
};
