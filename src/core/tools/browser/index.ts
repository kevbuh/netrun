import { z } from 'zod';
import type { Tool, ToolResult } from '../types.js';

// Browser tools are action tools — actual execution happens in the renderer.
// The agent runtime emits actions to the frontend, these tools just return status.

const emptyParams = z.object({});

export const browserReadPage: Tool<z.infer<typeof emptyParams>, { status: string; message?: string; dom?: string }> = {
  name: 'browser-read-page',
  description: 'Re-read the current page DOM. Returns elements with numeric IDs for browser-click/browser-type.',
  category: 'browser',
  access: ['agent'],
  parameters: emptyParams,
  async execute(): Promise<ToolResult<{ status: string; message?: string }>> {
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
  parameters: clickParams,
  async execute(input): Promise<ToolResult<{ status: string; message: string }>> {
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
  parameters: typeParams,
  async execute(input): Promise<ToolResult<{ status: string; message: string }>> {
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
  parameters: scrollParams,
  async execute(input): Promise<ToolResult<{ status: string; message: string }>> {
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
  parameters: navigateParams,
  async execute(input): Promise<ToolResult<{ status: string; message: string }>> {
    return { success: true, data: { status: 'ok', message: `Navigating to ${input.url}` } };
  },
};

export const browserScreenshot: Tool<z.infer<typeof emptyParams>, { status: string; message: string }> = {
  name: 'browser-screenshot',
  description: 'Take a screenshot of the current browser tab.',
  category: 'browser',
  access: ['agent'],
  parameters: emptyParams,
  async execute(): Promise<ToolResult<{ status: string; message: string }>> {
    return { success: true, data: { status: 'pending', message: 'Taking screenshot...' } };
  },
};

// ── New tools: query selector, wait, observe, tabs ──

const querySelectorParams = z.object({
  selector: z.string().describe('CSS selector to query for elements'),
  max_results: z.coerce.number().optional().describe('Maximum elements to return (default 20)'),
});

export const browserQuerySelector: Tool<z.infer<typeof querySelectorParams>, { status: string; message: string }> = {
  name: 'browser-query-selector',
  description: 'Query the current page with a CSS selector and get matching elements with numeric IDs for browser-click/browser-type.',
  category: 'browser',
  access: ['agent'],
  parameters: querySelectorParams,
  async execute(input): Promise<ToolResult<{ status: string; message: string }>> {
    return { success: true, data: { status: 'ok', message: `Queried selector: ${input.selector}` } };
  },
};

const waitForParams = z.object({
  selector: z.string().describe('CSS selector to wait for'),
  timeout_ms: z.coerce.number().optional().describe('Timeout in milliseconds (default 5000)'),
});

export const browserWaitFor: Tool<z.infer<typeof waitForParams>, { status: string; message: string }> = {
  name: 'browser-wait-for',
  description: 'Wait for a CSS selector to appear on the page. Returns when the element is found or timeout expires.',
  category: 'browser',
  access: ['agent'],
  parameters: waitForParams,
  async execute(input): Promise<ToolResult<{ status: string; message: string }>> {
    return { success: true, data: { status: 'pending', message: `Waiting for ${input.selector}...` } };
  },
};

export const browserGetUrl: Tool<z.infer<typeof emptyParams>, { status: string; message: string }> = {
  name: 'browser-get-url',
  description: 'Get the current page URL and title without reading the full DOM.',
  category: 'browser',
  access: ['agent'],
  parameters: emptyParams,
  async execute(): Promise<ToolResult<{ status: string; message: string }>> {
    return { success: true, data: { status: 'ok', message: 'URL retrieved' } };
  },
};

export const browserGetTabs: Tool<z.infer<typeof emptyParams>, { status: string; message: string }> = {
  name: 'browser-get-tabs',
  description: 'List all open browser tabs with their URL, title, and active status.',
  category: 'browser',
  access: ['agent'],
  parameters: emptyParams,
  async execute(): Promise<ToolResult<{ status: string; message: string }>> {
    return { success: true, data: { status: 'ok', message: 'Tabs listed' } };
  },
};

const switchTabParams = z.object({
  tab_id: z.coerce.number().describe('The tab ID to switch to (from browser-get-tabs)'),
});

export const browserSwitchTab: Tool<z.infer<typeof switchTabParams>, { status: string; message: string }> = {
  name: 'browser-switch-tab',
  description: 'Switch to a different browser tab by its ID.',
  category: 'browser',
  access: ['agent'],
  parameters: switchTabParams,
  async execute(input): Promise<ToolResult<{ status: string; message: string }>> {
    return { success: true, data: { status: 'ok', message: `Switched to tab ${input.tab_id}` } };
  },
};

export const browserBack: Tool<z.infer<typeof emptyParams>, { status: string; message: string }> = {
  name: 'browser-back',
  description: 'Navigate back in the current tab\'s history.',
  category: 'browser',
  access: ['agent'],
  parameters: emptyParams,
  async execute(): Promise<ToolResult<{ status: string; message: string }>> {
    return { success: true, data: { status: 'ok', message: 'Navigated back' } };
  },
};

export const browserForward: Tool<z.infer<typeof emptyParams>, { status: string; message: string }> = {
  name: 'browser-forward',
  description: 'Navigate forward in the current tab\'s history.',
  category: 'browser',
  access: ['agent'],
  parameters: emptyParams,
  async execute(): Promise<ToolResult<{ status: string; message: string }>> {
    return { success: true, data: { status: 'ok', message: 'Navigated forward' } };
  },
};

// ── Keyboard support ──

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
  parameters: pressKeyParams,
  async execute(input): Promise<ToolResult<{ status: string; message: string }>> {
    const mods = input.modifiers?.length ? ` with ${input.modifiers.join('+')}` : '';
    return { success: true, data: { status: 'ok', message: `Pressed ${input.key}${mods}` } };
  },
};

// ── Storage inspection ──

const getStorageParams = z.object({
  type: z.enum(['cookies', 'localStorage', 'sessionStorage']).describe('Which storage to read'),
  key_filter: z.string().optional().describe('Optional substring filter for key names'),
});

export const browserGetStorage: Tool<z.infer<typeof getStorageParams>, { status: string; message: string }> = {
  name: 'browser-get-storage',
  description: 'Read cookies, localStorage, or sessionStorage from the current page. Useful for debugging auth state and inspecting page data.',
  category: 'browser',
  access: ['agent'],
  parameters: getStorageParams,
  async execute(input): Promise<ToolResult<{ status: string; message: string }>> {
    return { success: true, data: { status: 'pending', message: `Reading ${input.type}...` } };
  },
};
