import { z } from 'zod';
import { readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join, basename, extname } from 'path';
import { randomUUID } from 'crypto';
import type { Tool, ToolResult } from '../types.js';

// Vault path resolution will use DB in full integration; for now use home dir
function getVaultPath(googleId?: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';
  const base = join(home, 'Desktop', 'aether');
  if (googleId) return join(base, googleId);
  return base;
}

/** Parse YAML-like frontmatter from a markdown file */
function readVaultMd(filepath: string): { meta: Record<string, string>; content: string } | null {
  try {
    const text = readFileSync(filepath, 'utf-8');
    if (!text.startsWith('---')) return { meta: {}, content: text };
    const endIdx = text.indexOf('---', 3);
    if (endIdx === -1) return { meta: {}, content: text };
    const frontmatter = text.slice(3, endIdx).trim();
    const meta: Record<string, string> = {};
    for (const line of frontmatter.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        meta[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
      }
    }
    const content = text.slice(endIdx + 3).trim();
    return { meta, content };
  } catch { return null; }
}

const listNotesParams = z.object({});

export const vaultListNotes: Tool<z.infer<typeof listNotesParams>, any> = {
  name: 'vault-list-notes',
  description: 'List all notes in the vault.',
  category: 'vault',
  access: ['agent', 'mcp', 'ui'],
  parameters: listNotesParams,
  async execute(_input, context): Promise<ToolResult> {
    const vaultDir = getVaultPath(context.googleId);
    if (!existsSync(vaultDir)) return { success: true, data: { notes: [] } };

    const notes: any[] = [];
    try {
      const files = readdirSync(vaultDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const filepath = join(vaultDir, file);
        const parsed = readVaultMd(filepath);
        if (parsed) {
          const stat = statSync(filepath);
          notes.push({
            id: parsed.meta.id ?? file.replace('.md', ''),
            title: parsed.meta.title ?? file.replace('.md', ''),
            folder: parsed.meta.folder ?? '',
            updated: stat.mtimeMs / 1000,
            ...parsed.meta,
          });
        }
      }
    } catch { /* empty vault */ }

    notes.sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
    return { success: true, data: { notes } };
  },
};

const getNoteParms = z.object({
  id: z.string().describe('Note ID'),
});

export const vaultGetNote: Tool<z.infer<typeof getNoteParms>, any> = {
  name: 'vault-get-note',
  description: 'Get a note by ID from the vault.',
  category: 'vault',
  access: ['agent', 'mcp', 'ui'],
  parameters: getNoteParms,
  async execute(input, context): Promise<ToolResult> {
    const vaultDir = getVaultPath(context.googleId);
    // Search for note by ID in frontmatter
    try {
      const files = readdirSync(vaultDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const filepath = join(vaultDir, file);
        const parsed = readVaultMd(filepath);
        if (parsed && (parsed.meta.id === input.id || file.replace('.md', '') === input.id)) {
          return { success: true, data: { ...parsed.meta, content: parsed.content } };
        }
      }
    } catch { /* not found */ }
    return { success: false, error: 'Note not found' };
  },
};

const createNoteParams = z.object({
  title: z.string().describe('Note title'),
  content: z.string().optional().describe('Markdown content'),
  folder: z.string().optional().describe('Folder name'),
});

export const vaultCreateNote: Tool<z.infer<typeof createNoteParams>, any> = {
  name: 'vault-create-note',
  description: 'Create a new note in the vault.',
  category: 'vault',
  access: ['agent', 'mcp', 'ui'],
  parameters: createNoteParams,
  async execute(input, context): Promise<ToolResult> {
    if (!context.googleId) return { success: false, error: 'Not authenticated' };
    const vaultDir = getVaultPath(context.googleId);
    mkdirSync(vaultDir, { recursive: true });

    const id = randomUUID();
    const now = new Date().toISOString();
    const safeName = input.title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 100);
    const filename = `${safeName}.md`;

    const frontmatter = [
      '---',
      `id: ${id}`,
      `title: ${input.title}`,
      `folder: ${input.folder ?? ''}`,
      `created: ${now}`,
      `updated: ${now}`,
      '---',
    ].join('\n');

    writeFileSync(join(vaultDir, filename), frontmatter + '\n\n' + (input.content ?? ''));
    return { success: true, data: { id, title: input.title, filename } };
  },
};

const updateNoteParams = z.object({
  id: z.string().describe('Note ID'),
  content: z.string().optional().describe('New content'),
  title: z.string().optional().describe('New title'),
});

export const vaultUpdateNote: Tool<z.infer<typeof updateNoteParams>, any> = {
  name: 'vault-update-note',
  description: 'Update a note in the vault.',
  category: 'vault',
  access: ['agent', 'mcp', 'ui'],
  parameters: updateNoteParams,
  async execute(input, context): Promise<ToolResult> {
    if (!context.googleId) return { success: false, error: 'Not authenticated' };
    const vaultDir = getVaultPath(context.googleId);
    try {
      const files = readdirSync(vaultDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const filepath = join(vaultDir, file);
        const parsed = readVaultMd(filepath);
        if (parsed && (parsed.meta.id === input.id || file.replace('.md', '') === input.id)) {
          const now = new Date().toISOString();
          const meta: Record<string, string> = { ...parsed.meta, updated: now };
          if (input.title) meta.title = input.title;
          const frontmatter = ['---', ...Object.entries(meta).map(([k, v]) => `${k}: ${v}`), '---'].join('\n');
          const content = input.content ?? parsed.content;
          writeFileSync(filepath, frontmatter + '\n\n' + content);
          return { success: true, data: { id: input.id, updated: now } };
        }
      }
    } catch { /* not found */ }
    return { success: false, error: 'Note not found' };
  },
};

const deleteNoteParams = z.object({
  id: z.string().describe('Note ID to delete'),
});

export const vaultDeleteNote: Tool<z.infer<typeof deleteNoteParams>, any> = {
  name: 'vault-delete-note',
  description: 'Delete a note from the vault.',
  category: 'vault',
  access: ['agent', 'mcp', 'ui'],
  parameters: deleteNoteParams,
  async execute(input, context): Promise<ToolResult> {
    if (!context.googleId) return { success: false, error: 'Not authenticated' };
    const vaultDir = getVaultPath(context.googleId);
    try {
      const files = readdirSync(vaultDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const filepath = join(vaultDir, file);
        const parsed = readVaultMd(filepath);
        if (parsed && (parsed.meta.id === input.id || file.replace('.md', '') === input.id)) {
          unlinkSync(filepath);
          return { success: true, data: { deleted: input.id } };
        }
      }
    } catch { /* not found */ }
    return { success: false, error: 'Note not found' };
  },
};

const vaultSearchParams = z.object({
  query: z.string().describe('Search query for vault notes'),
});

export const vaultSearch: Tool<z.infer<typeof vaultSearchParams>, any> = {
  name: 'vault-search',
  description: 'Search notes in the vault by content or title.',
  category: 'vault',
  access: ['agent', 'mcp', 'ui'],
  parameters: vaultSearchParams,
  async execute(input, context): Promise<ToolResult> {
    const vaultDir = getVaultPath(context.googleId);
    if (!existsSync(vaultDir)) return { success: true, data: { results: [] } };

    const query = input.query.toLowerCase();
    const results: any[] = [];
    try {
      const files = readdirSync(vaultDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const filepath = join(vaultDir, file);
        const parsed = readVaultMd(filepath);
        if (!parsed) continue;
        const titleMatch = (parsed.meta.title ?? file).toLowerCase().includes(query);
        const contentMatch = parsed.content.toLowerCase().includes(query);
        if (titleMatch || contentMatch) {
          results.push({
            id: parsed.meta.id ?? file.replace('.md', ''),
            title: parsed.meta.title ?? file.replace('.md', ''),
            snippet: parsed.content.slice(0, 200),
            match: titleMatch ? 'title' : 'content',
          });
        }
      }
    } catch { /* empty vault */ }
    return { success: true, data: { results } };
  },
};
