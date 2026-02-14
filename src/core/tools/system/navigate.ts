import { z } from 'zod';
import type { Tool, ToolResult } from '../types.js';

const parameters = z.object({
  view: z.string().describe('View to navigate to: home, browse, experiments, saved, calendar, settings, quality'),
});

/**
 * Switch to a different app section.
 * This is an action tool — the actual navigation happens in the frontend.
 */
export const navigate: Tool<z.infer<typeof parameters>, { status: string; message: string }> = {
  name: 'navigate',
  description: 'Switch to a different app section (home, browse, experiments, etc.). This ONLY switches the app panel — it does NOT open websites or URLs.',
  category: 'system',
  access: ['agent', 'ui'],
  parameters,
  async execute(input): Promise<ToolResult<{ status: string; message: string }>> {
    // Action is emitted by the agent runtime
    return { success: true, data: { status: 'ok', message: `Navigated to ${input.view}` } };
  },
};
