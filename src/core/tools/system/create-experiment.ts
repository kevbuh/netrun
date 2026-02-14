import { z } from 'zod';
import type { Tool, ToolResult } from '../types.js';

const parameters = z.object({
  title: z.string().describe('Title for the experiment'),
  description: z.string().optional().describe('Description of the experiment'),
});

export const createExperiment: Tool<z.infer<typeof parameters>, { id: string; title: string; message: string }> = {
  name: 'create-experiment',
  description: 'Create a new experiment/project.',
  category: 'system',
  access: ['agent', 'ui'],
  parameters,
  async execute(input, context): Promise<ToolResult<{ id: string; title: string; message: string }>> {
    if (!input.title) {
      return { success: false, error: 'Title required' };
    }
    if (!context.googleId) {
      return { success: false, error: 'Not authenticated' };
    }
    // Vault creation will be handled by the vault tool module in Phase 3
    // For now, return a placeholder
    const slug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      success: true,
      data: { id: slug, title: input.title, message: `Project '${input.title}' created` },
    };
  },
};
