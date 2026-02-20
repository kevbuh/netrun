import { z } from 'zod';
import type { Tool, ToolResult } from '../types.js';

const parameters = z.object({
  url: z.string().optional().describe('A specific URL to open. Omit for a blank new tab.'),
});

export const openTab: Tool<z.infer<typeof parameters>, { status: string; message: string }> = {
  name: 'open-tab',
  description: 'Open a website or URL in a new browser tab. If the user says "open a new tab" without a URL, call with no url parameter.',
  category: 'system',
  access: ['agent', 'ui'],
  sequential: true,
  parameters,
  async execute(input, context): Promise<ToolResult<{ status: string; message: string }>> {
    const url = input.url ?? '';
    context.emitAction?.({ type: 'open_tab', url });
    return {
      success: true,
      data: { status: 'ok', message: url ? `Opened ${url} in a new tab` : 'Opened a new tab' },
    };
  },
};
