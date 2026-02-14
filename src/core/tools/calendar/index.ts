import { z } from 'zod';
import type { Tool, ToolResult } from '../types.js';

const listEventsParams = z.object({});

export const calendarList: Tool<z.infer<typeof listEventsParams>, any> = {
  name: 'calendar-list',
  description: 'List all calendar events for the current user.',
  category: 'calendar',
  access: ['agent', 'mcp', 'ui'],
  parameters: listEventsParams,
  async execute(_input, context): Promise<ToolResult> {
    if (!context.googleId) return { success: false, error: 'Not authenticated' };
    try {
      const { getCalendarEvents } = await import('../../db/queries/calendar.js');
      const events = getCalendarEvents(context.googleId);
      return { success: true, data: { events } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

const createEventParams = z.object({
  title: z.string().describe('Event title'),
  date: z.string().describe('Event date in YYYY-MM-DD format'),
  time: z.string().optional().describe('Event time in HH:MM format'),
  description: z.string().optional().describe('Event description'),
  color: z.string().optional().describe('Event color hex'),
});

export const calendarCreate: Tool<z.infer<typeof createEventParams>, any> = {
  name: 'calendar-create',
  description: 'Create a new calendar event.',
  category: 'calendar',
  access: ['agent', 'mcp', 'ui'],
  parameters: createEventParams,
  async execute(input, context): Promise<ToolResult> {
    if (!context.googleId) return { success: false, error: 'Not authenticated' };
    if (!input.title || !input.date) return { success: false, error: 'Title and date required' };
    try {
      const { createCalendarEvent } = await import('../../db/queries/calendar.js');
      let desc = input.description ?? '';
      if (input.time) {
        desc = `Time: ${input.time}${desc ? '\n' + desc : ''}`;
      }
      const event = createCalendarEvent(context.googleId, {
        title: input.title,
        date: input.date,
        description: desc,
        color: input.color,
      });
      return { success: true, data: event };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

const updateEventParams = z.object({
  id: z.string().describe('Event ID'),
  title: z.string().optional(),
  date: z.string().optional(),
  description: z.string().optional(),
  color: z.string().optional(),
});

export const calendarUpdate: Tool<z.infer<typeof updateEventParams>, any> = {
  name: 'calendar-update',
  description: 'Update a calendar event.',
  category: 'calendar',
  access: ['agent', 'mcp', 'ui'],
  parameters: updateEventParams,
  async execute(input, context): Promise<ToolResult> {
    if (!context.googleId) return { success: false, error: 'Not authenticated' };
    try {
      const { updateCalendarEvent } = await import('../../db/queries/calendar.js');
      const updated = updateCalendarEvent(context.googleId, input.id, {
        title: input.title,
        date: input.date,
        description: input.description,
        color: input.color,
      });
      if (!updated) return { success: false, error: 'Event not found' };
      return { success: true, data: updated };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

const deleteEventParams = z.object({
  id: z.string().describe('Event ID to delete'),
});

export const calendarDelete: Tool<z.infer<typeof deleteEventParams>, any> = {
  name: 'calendar-delete',
  description: 'Delete a calendar event.',
  category: 'calendar',
  access: ['agent', 'mcp', 'ui'],
  parameters: deleteEventParams,
  async execute(input, context): Promise<ToolResult> {
    if (!context.googleId) return { success: false, error: 'Not authenticated' };
    try {
      const { deleteCalendarEvent } = await import('../../db/queries/calendar.js');
      const deleted = deleteCalendarEvent(context.googleId, input.id);
      if (!deleted) return { success: false, error: 'Event not found' };
      return { success: true, data: { deleted: input.id } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
