import { z } from 'zod';
import type { Tool, ToolResult } from '../types.js';
import { contextManager } from '../../context/manager.js';
import { scheduleCompaction } from '../../context/compaction.js';

const contextUpdateParams = z.object({
  action: z.enum(['append', 'replace', 'create-task', 'complete-task', 'create-topic', 'list-topics', 'update-description']).describe(
    'Action: append/replace content in a section, create-task/complete-task for task files, create-topic to create a topic file, list-topics to see topic index, update-description to set a file description'
  ),
  section: z.string().optional().describe('Markdown heading to target (e.g., "## Research")'),
  content: z.string().optional().describe('Markdown content to write'),
  taskId: z.string().optional().describe('Task ID for task-specific context files'),
  file: z.string().optional().describe('Target file (e.g., "research.md"). Defaults to main.md for append/replace'),
  topicName: z.string().optional().describe('Name for new topic file (for create-topic)'),
  topicDescription: z.string().optional().describe('Description for topic file (for create-topic or update-description)'),
});

export const contextUpdate: Tool<z.infer<typeof contextUpdateParams>, any> = {
  name: 'context-update',
  description: 'Update the living context files. Use this to remember information, track research, manage tasks, and store notes across conversations.',
  category: 'context',
  access: ['agent', 'mcp', 'ui'],
  parameters: contextUpdateParams,
  async execute(input): Promise<ToolResult> {
    try {
      switch (input.action) {
        case 'append': {
          if (!input.section || !input.content) return { success: false, error: 'section and content required for append' };
          const file = input.file || (input.taskId ? `task-${input.taskId}.md` : 'main.md');
          contextManager.appendContext(file, input.section, input.content);
          scheduleCompaction(file);
          return { success: true, data: { file, action: 'appended', charCount: contextManager.getContextSize(file) } };
        }
        case 'replace': {
          if (!input.section || !input.content) return { success: false, error: 'section and content required for replace' };
          const file = input.file || (input.taskId ? `task-${input.taskId}.md` : 'main.md');
          contextManager.replaceSection(file, input.section, input.content);
          scheduleCompaction(file);
          return { success: true, data: { file, action: 'replaced', charCount: contextManager.getContextSize(file) } };
        }
        case 'create-task': {
          if (!input.taskId) return { success: false, error: 'taskId required for create-task' };
          const file = `task-${input.taskId}.md`;
          const header = `# Task: ${input.taskId}\n\n`;
          contextManager.writeContextFile(file, header + (input.section ?? '') + '\n' + (input.content ?? '') + '\n');
          return { success: true, data: { file, action: 'created', charCount: contextManager.getContextSize(file) } };
        }
        case 'complete-task': {
          if (!input.taskId) return { success: false, error: 'taskId required for complete-task' };
          const file = `task-${input.taskId}.md`;
          contextManager.archiveVersion(file);
          contextManager.appendContext('main.md', '## Completed Tasks', `- ${input.taskId}: ${input.content ?? ''}\n`);
          contextManager.deleteContextFile(file);
          scheduleCompaction('main.md');
          return { success: true, data: { file, action: 'completed' } };
        }
        case 'create-topic': {
          if (!input.topicName) return { success: false, error: 'topicName required for create-topic' };
          const fileId = contextManager.createTopicFile(input.topicName, input.topicDescription ?? '');
          return { success: true, data: { file: fileId, action: 'topic-created' } };
        }
        case 'list-topics': {
          const topics = contextManager.listTopicIndex();
          return { success: true, data: { topics } };
        }
        case 'update-description': {
          if (!input.file) return { success: false, error: 'file required for update-description' };
          if (!input.topicDescription) return { success: false, error: 'topicDescription required for update-description' };
          contextManager.updateFileDescription(input.file, input.topicDescription);
          return { success: true, data: { file: input.file, action: 'description-updated' } };
        }
        default:
          return { success: false, error: `Unknown action: ${input.action}` };
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
