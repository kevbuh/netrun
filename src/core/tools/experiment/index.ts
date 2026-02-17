import { z } from 'zod';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, unlinkSync, rmSync } from 'fs';
import { join, extname } from 'path';
import type { Tool, ToolResult } from '../types.js';

function getVaultPath(googleId?: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';
  const base = join(home, 'Desktop', 'netrun');
  return googleId ? join(base, googleId) : base;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

const SKIP_DIRS = new Set(['venv', '.kernels', '__pycache__', 'node_modules', '.git', '.venv']);

const listParams = z.object({});

export const experimentList: Tool<z.infer<typeof listParams>, any> = {
  name: 'experiment-list',
  description: 'List all experiment projects in the vault.',
  category: 'experiment',
  access: ['agent', 'mcp', 'ui'],
  parameters: listParams,
  async execute(_input, context): Promise<ToolResult> {
    if (!context.googleId) return { success: false, error: 'Not authenticated' };
    const vaultDir = getVaultPath(context.googleId);
    if (!existsSync(vaultDir)) return { success: true, data: { projects: [] } };

    const projects: any[] = [];
    try {
      for (const entry of readdirSync(vaultDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        const dirPath = join(vaultDir, entry.name);
        const stat = statSync(dirPath);
        projects.push({
          id: entry.name,
          title: entry.name.replace(/-/g, ' '),
          modified: stat.mtimeMs / 1000,
        });
      }
    } catch { /* empty */ }

    projects.sort((a, b) => b.modified - a.modified);
    return { success: true, data: { projects } };
  },
};

const createParams = z.object({
  title: z.string().describe('Project title'),
  description: z.string().optional(),
});

export const experimentCreate: Tool<z.infer<typeof createParams>, any> = {
  name: 'experiment-create',
  description: 'Create a new experiment project.',
  category: 'experiment',
  access: ['agent', 'mcp', 'ui'],
  parameters: createParams,
  async execute(input, context): Promise<ToolResult> {
    if (!context.googleId) return { success: false, error: 'Not authenticated' };
    if (!input.title) return { success: false, error: 'Title required' };

    const vaultDir = getVaultPath(context.googleId);
    let slug = slugify(input.title);
    const expDir = join(vaultDir, slug);

    // Ensure unique slug
    if (existsSync(expDir)) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    mkdirSync(join(vaultDir, slug), { recursive: true });
    return { success: true, data: { id: slug, title: input.title, message: `Project '${input.title}' created` } };
  },
};

const listFilesParams = z.object({
  project_id: z.string().describe('Project directory name'),
});

export const experimentListFiles: Tool<z.infer<typeof listFilesParams>, any> = {
  name: 'experiment-list-files',
  description: 'List files in an experiment project.',
  category: 'experiment',
  access: ['agent', 'mcp', 'ui'],
  parameters: listFilesParams,
  async execute(input, context): Promise<ToolResult> {
    if (!context.googleId) return { success: false, error: 'Not authenticated' };
    const projDir = join(getVaultPath(context.googleId), input.project_id);
    if (!existsSync(projDir)) return { success: false, error: 'Project not found' };

    function listRecursive(dir: string, prefix = ''): any[] {
      const files: any[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          files.push({ path: relPath, type: 'directory' });
          files.push(...listRecursive(join(dir, entry.name), relPath));
        } else {
          const stat = statSync(join(dir, entry.name));
          files.push({ path: relPath, type: 'file', size: stat.size, modified: stat.mtimeMs / 1000 });
        }
      }
      return files;
    }

    return { success: true, data: { files: listRecursive(projDir) } };
  },
};

const getFileParams = z.object({
  project_id: z.string().describe('Project directory name'),
  path: z.string().describe('File path within the project'),
});

export const experimentGetFile: Tool<z.infer<typeof getFileParams>, any> = {
  name: 'experiment-get-file',
  description: 'Read a file from an experiment project.',
  category: 'experiment',
  access: ['agent', 'mcp', 'ui'],
  parameters: getFileParams,
  async execute(input, context): Promise<ToolResult> {
    if (!context.googleId) return { success: false, error: 'Not authenticated' };
    const filePath = join(getVaultPath(context.googleId), input.project_id, input.path);
    if (!existsSync(filePath)) return { success: false, error: 'File not found' };

    const ext = extname(filePath).toLowerCase();
    const binaryExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.mp3', '.wav', '.zip']);

    if (binaryExts.has(ext)) {
      const content = readFileSync(filePath).toString('base64');
      return { success: true, data: { content, encoding: 'base64', path: input.path } };
    }

    const content = readFileSync(filePath, 'utf-8');
    return { success: true, data: { content, encoding: 'utf-8', path: input.path } };
  },
};

const writeFileParams = z.object({
  project_id: z.string().describe('Project directory name'),
  path: z.string().describe('File path within the project'),
  content: z.string().describe('File content'),
});

export const experimentWriteFile: Tool<z.infer<typeof writeFileParams>, any> = {
  name: 'experiment-write-file',
  description: 'Create or update a file in an experiment project.',
  category: 'experiment',
  access: ['agent', 'mcp', 'ui'],
  parameters: writeFileParams,
  async execute(input, context): Promise<ToolResult> {
    if (!context.googleId) return { success: false, error: 'Not authenticated' };
    const projDir = join(getVaultPath(context.googleId), input.project_id);
    if (!existsSync(projDir)) return { success: false, error: 'Project not found' };

    const filePath = join(projDir, input.path);
    // Ensure parent directory exists
    const parentDir = join(filePath, '..');
    mkdirSync(parentDir, { recursive: true });

    writeFileSync(filePath, input.content);
    return { success: true, data: { path: input.path, message: 'File saved' } };
  },
};

const deleteParams = z.object({
  project_id: z.string().describe('Project directory name'),
});

export const experimentDelete: Tool<z.infer<typeof deleteParams>, any> = {
  name: 'experiment-delete',
  description: 'Delete an experiment project.',
  category: 'experiment',
  access: ['agent', 'ui'],
  parameters: deleteParams,
  async execute(input, context): Promise<ToolResult> {
    if (!context.googleId) return { success: false, error: 'Not authenticated' };
    const projDir = join(getVaultPath(context.googleId), input.project_id);
    if (!existsSync(projDir)) return { success: false, error: 'Project not found' };

    rmSync(projDir, { recursive: true, force: true });
    return { success: true, data: { deleted: input.project_id } };
  },
};

const executeCodeParams = z.object({
  project_id: z.string().describe('Project directory name'),
  code: z.string().describe('Python code to execute'),
});

export const experimentExecuteCode: Tool<z.infer<typeof executeCodeParams>, any> = {
  name: 'experiment-execute-code',
  description: 'Execute Python code in a project\'s Jupyter kernel.',
  category: 'experiment',
  access: ['agent', 'ui'],
  parameters: executeCodeParams,
  async execute(input, context): Promise<ToolResult> {
    if (!context.googleId) return { success: false, error: 'Not authenticated' };

    const code = input.code;
    if (!code || !code.trim()) return { success: false, error: 'No code provided' };
    if (code.length > 100_000) return { success: false, error: 'Code too long (max 100KB)' };

    // Validate project exists to prevent path traversal
    const projDir = join(getVaultPath(context.googleId), input.project_id);
    if (!existsSync(projDir)) return { success: false, error: 'Project not found' };

    try {
      const { pythonManager } = await import('../../python/process-manager.js');
      const result = await pythonManager.runCode(`
import sys, json
code = json.loads(sys.stdin.read())["code"]
try:
    import io
    from contextlib import redirect_stdout, redirect_stderr
    out = io.StringIO()
    err = io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        exec(code)
    print(json.dumps({"stdout": out.getvalue(), "stderr": err.getvalue()}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
