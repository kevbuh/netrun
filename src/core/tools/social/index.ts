import { z } from 'zod';
import type { Tool, ToolResult } from '../types.js';

const userProfileParams = z.object({
  username: z.string().describe('Username to look up'),
});

export const socialUserProfile: Tool<z.infer<typeof userProfileParams>, any> = {
  name: 'social-user-profile',
  description: 'Get a user\'s public profile by username.',
  category: 'social',
  access: ['agent', 'mcp', 'ui'],
  parameters: userProfileParams,
  async execute(input): Promise<ToolResult> {
    try {
      const { getUserByUsername } = await import('../../db/queries/users.js');
      const user = getUserByUsername(input.username);
      if (!user) return { success: false, error: 'User not found' };
      if (user.profile_private) return { success: false, error: 'Profile is private' };
      return {
        success: true,
        data: {
          username: user.username,
          name: user.name,
          picture: user.picture,
          status_emoji: user.status_emoji,
          status_text: user.status_text,
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
