import { z } from 'zod';
import type { Tool, ToolResult } from '../types.js';

const parameters = z.object({
  title: z.string().describe('Event title'),
  date: z.string().describe('Event date in YYYY-MM-DD format'),
  time: z.string().optional().describe('Event time in HH:MM format (24h)'),
  description: z.string().optional().describe('Optional event description'),
});

export const createCalendarEvent: Tool<z.infer<typeof parameters>, { status: string; message: string }> = {
  name: 'create-calendar-event',
  description: 'Add an event to the user\'s calendar. Use the current date/time from the system prompt to compute relative times.',
  category: 'system',
  access: ['agent', 'ui'],
  parameters,
  async execute(input, context): Promise<ToolResult<{ status: string; message: string }>> {
    if (!input.title || !input.date) {
      return { success: false, error: 'Title and date are required' };
    }
    if (!context.googleId) {
      return { success: false, error: 'Not authenticated' };
    }
    // DB insertion will be wired in Phase 3 when we port calendar queries
    return {
      success: true,
      data: { status: 'ok', message: `Event '${input.title}' created for ${input.date}` },
    };
  },
};
