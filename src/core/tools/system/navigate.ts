import { z } from 'zod';
import type { Tool, ToolResult } from '../types.js';

const parameters = z.object({
  view: z.string().describe('View to navigate to: home, browse, saved, calendar, settings'),
});

/**
 * Switch to a different app section.
 * This is an action tool — the actual navigation happens in the frontend.
 */
export const navigate: Tool<z.infer<typeof parameters>, { status: string; message: string }> = {
  name: 'navigate',
  description: 'Switch to a different app section (home, browse, saved, etc.). This ONLY switches the app panel — it does NOT open websites or URLs.',
  category: 'system',
  access: ['agent', 'ui'],
  sequential: true,
  parameters,
  async execute(input, context): Promise<ToolResult<{ status: string; message: string }>> {
    context.emitAction?.({ type: 'navigate', view: input.view });
    return { success: true, data: { status: 'ok', message: `Navigated to ${input.view}` } };
  },
};
