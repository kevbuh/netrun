import { z } from 'zod';
import type { Tool, ToolResult } from '../types.js';

const listTeamsParams = z.object({});

export const socialListTeams: Tool<z.infer<typeof listTeamsParams>, any> = {
  name: 'social-list-teams',
  description: 'List teams the current user belongs to.',
  category: 'social',
  access: ['agent', 'mcp', 'ui'],
  parameters: listTeamsParams,
  async execute(_input, context): Promise<ToolResult> {
    if (!context.googleId) return { success: false, error: 'Not authenticated' };
    // DB query deferred to runtime - returns via getDb()
    try {
      const { getUserTeams } = await import('../../db/queries/social.js');
      const teams = getUserTeams(context.googleId);
      return { success: true, data: { teams } };
    } catch {
      return { success: true, data: { teams: [] } };
    }
  },
};

const sendMessageParams = z.object({
  team_id: z.number().describe('Team ID to send message to'),
  content: z.string().describe('Message content'),
});

export const socialSendMessage: Tool<z.infer<typeof sendMessageParams>, any> = {
  name: 'social-send-message',
  description: 'Send a message to a team chat.',
  category: 'social',
  access: ['agent', 'ui'],
  parameters: sendMessageParams,
  async execute(input, context): Promise<ToolResult> {
    if (!context.googleId) return { success: false, error: 'Not authenticated' };
    try {
      const { isTeamMember, sendTeamMessage } = await import('../../db/queries/social.js');
      if (!isTeamMember(input.team_id, context.googleId)) {
        return { success: false, error: 'Not a team member' };
      }
      const message = sendTeamMessage(input.team_id, context.googleId, input.content);
      return { success: true, data: message };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

const getMessagesParams = z.object({
  team_id: z.number().describe('Team ID'),
  limit: z.number().optional().describe('Max messages to return'),
});

export const socialGetMessages: Tool<z.infer<typeof getMessagesParams>, any> = {
  name: 'social-get-messages',
  description: 'Get messages from a team chat.',
  category: 'social',
  access: ['agent', 'mcp', 'ui'],
  parameters: getMessagesParams,
  async execute(input, context): Promise<ToolResult> {
    if (!context.googleId) return { success: false, error: 'Not authenticated' };
    try {
      const { isTeamMember, getTeamMessages } = await import('../../db/queries/social.js');
      if (!isTeamMember(input.team_id, context.googleId)) {
        return { success: false, error: 'Not a team member' };
      }
      const messages = getTeamMessages(input.team_id, input.limit);
      return { success: true, data: { messages } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

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
