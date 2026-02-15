import { z } from 'zod';
import type { Tool, ToolResult } from '../types.js';
import { contextManager } from '../../context/manager.js';
import { scheduleCompaction } from '../../context/compaction.js';

const contextUpdateParams = z.object({
  action: z.enum(['append', 'replace', 'create-task', 'complete-task']).describe(
    'Action to perform: append to a section, replace a section, create a task context file, or mark a task complete'
  ),
  section: z.string().describe('Markdown heading to target (e.g., "## Research")'),
  content: z.string().describe('Markdown content to write'),
  taskId: z.string().optional().describe('Task ID for task-specific context files'),
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
          const file = input.taskId ? `task-${input.taskId}.md` : 'main.md';
          contextManager.appendContext(file, input.section, input.content);
          scheduleCompaction(file);
          return { success: true, data: { file, action: 'appended', charCount: contextManager.getContextSize(file) } };
        }
        case 'replace': {
          const file = input.taskId ? `task-${input.taskId}.md` : 'main.md';
          contextManager.replaceSection(file, input.section, input.content);
          scheduleCompaction(file);
          return { success: true, data: { file, action: 'replaced', charCount: contextManager.getContextSize(file) } };
        }
        case 'create-task': {
          if (!input.taskId) return { success: false, error: 'taskId required for create-task' };
          const file = `task-${input.taskId}.md`;
          const header = `# Task: ${input.taskId}\n\n`;
          contextManager.writeContextFile(file, header + input.section + '\n' + input.content + '\n');
          return { success: true, data: { file, action: 'created', charCount: contextManager.getContextSize(file) } };
        }
        case 'complete-task': {
          if (!input.taskId) return { success: false, error: 'taskId required for complete-task' };
          const file = `task-${input.taskId}.md`;
          // Archive and delete
          contextManager.archiveVersion(file);
          // Append summary to main.md
          contextManager.appendContext('main.md', '## Completed Tasks', `- ${input.taskId}: ${input.content}\n`);
          contextManager.deleteContextFile(file);
          scheduleCompaction('main.md');
          return { success: true, data: { file, action: 'completed' } };
        }
        default:
          return { success: false, error: `Unknown action: ${input.action}` };
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
