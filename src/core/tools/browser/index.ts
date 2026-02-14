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
  element_id: z.number().describe('The numeric element ID from the DOM tree'),
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
  element_id: z.number().describe('The numeric element ID from the DOM tree'),
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
