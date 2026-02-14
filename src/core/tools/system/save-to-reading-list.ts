import { z } from 'zod';
import type { Tool, ToolResult } from '../types.js';

const parameters = z.object({
  url: z.string().describe('URL of the post to bookmark'),
  title: z.string().describe('Title of the post'),
});

export const saveToReadingList: Tool<z.infer<typeof parameters>, { status: string; message: string }> = {
  name: 'save-to-reading-list',
  description: 'Bookmark a post or paper to the user\'s reading list.',
  category: 'system',
  access: ['agent', 'ui'],
  parameters,
  async execute(): Promise<ToolResult<{ status: string; message: string }>> {
    return { success: true, data: { status: 'ok', message: 'Post bookmarked' } };
  },
};
