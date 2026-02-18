import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock filesystem ──
const mockFiles = new Map<string, string>();
vi.mock('fs', () => ({
  existsSync: (p: string) => mockFiles.has(p),
  readFileSync: (p: string) => {
    if (!mockFiles.has(p)) throw new Error(`ENOENT: ${p}`);
    return mockFiles.get(p)!;
  },
  writeFileSync: (p: string, content: string) => { mockFiles.set(p, content); },
  mkdirSync: () => {},
  copyFileSync: (src: string, dst: string) => { mockFiles.set(dst, mockFiles.get(src) ?? ''); },
  unlinkSync: (p: string) => { mockFiles.delete(p); },
  statSync: () => ({ mtimeMs: Date.now() }),
}));

// ── Mock DB ──
const mockRows = new Map<string, any>();
const mockDb = {
  prepare: (sql: string) => ({
    all: () => {
      // listTopicIndex query — return aliased columns
      if (sql.includes('file_type = \'topic\'')) {
        return Array.from(mockRows.values())
          .filter((r: any) => r.file_type === 'topic')
          .map(r => ({ fileId: r.file_id, description: r.description ?? '', charCount: r.char_count, updatedAt: r.updated_at }));
      }
      // listContextFiles query — return with aliased columns
      if (sql.includes('FROM context_meta')) {
        return Array.from(mockRows.values()).map(r => ({
          file_id: r.file_id, file_path: r.file_path, created_at: r.created_at,
          updated_at: r.updated_at, compacted_at: r.compacted_at, char_count: r.char_count,
          file_type: r.file_type ?? 'topic', description: r.description ?? '',
        }));
      }
      return Array.from(mockRows.values());
    },
    get: (id: string) => mockRows.get(id),
    run: (...args: any[]) => {
      // Handle INSERT with file_type
      if (sql.includes('INSERT') && sql.includes('file_type')) {
        const fileId = args[0];
        mockRows.set(fileId, {
          file_id: args[0],
          file_path: args[1],
          created_at: args[2],
          updated_at: args[3],
          char_count: args[4],
          file_type: args[5] ?? 'topic',
          description: args[6] ?? '',
          compacted_at: null,
        });
      }
      // Handle INSERT without file_type (old-style from writeContextFile path when row exists)
      else if (sql.includes('INSERT') && !sql.includes('file_type')) {
        const fileId = args[0];
        if (!mockRows.has(fileId)) {
          mockRows.set(fileId, {
            file_id: args[0], file_path: args[1], created_at: args[2],
            updated_at: args[3], char_count: args[4],
            file_type: 'topic', description: '', compacted_at: null,
          });
        }
      }
      // Handle UPDATE char_count
      if (sql.includes('UPDATE') && sql.includes('char_count')) {
        const row = mockRows.get(args[2]);
        if (row) {
          row.updated_at = args[0];
          row.char_count = args[1];
        }
      }
      // Handle UPDATE description
      if (sql.includes('UPDATE') && sql.includes('description') && !sql.includes('char_count')) {
        const row = mockRows.get(args[1]);
        if (row) row.description = args[0];
      }
    },
  }),
};
vi.mock('../../db/connection', () => ({
  getDb: () => mockDb,
}));

// ── Mock provider registry (for selector tests) ──
const mockProviderChat = vi.fn();
vi.mock('../../providers/registry', () => ({
  providerRegistry: {
    getDefault: () => ({
      name: 'mock',
      chat: mockProviderChat,
      chatStream: async function* () { yield { type: 'done' }; },
      listModels: async () => ['test'],
    }),
  },
}));

// Now import the modules under test
import {
  contextManager,
  listTopicIndex,
  createTopicFile,
  updateFileDescription,
  getFileType,
} from '../manager';
import type { TopicIndexEntry } from '../manager';
import { selectTopicFiles } from '../selector';
import { contextIntake } from '../intake';

const CONTEXT_DIR = contextManager.getContextDir();

beforeEach(() => {
  mockFiles.clear();
  mockRows.clear();
  mockProviderChat.mockReset();
});

// ═══════════════════════════════════════════════
// Context Manager — Topic Files
// ═══════════════════════════════════════════════

describe('contextManager topic methods', () => {
  it('createTopicFile creates file and inserts meta row', () => {
    const fileId = createTopicFile('Research', 'Web search results and research findings');
    expect(fileId).toBe('research.md');
    expect(mockFiles.has(`${CONTEXT_DIR}/research.md`)).toBe(true);
    expect(mockFiles.get(`${CONTEXT_DIR}/research.md`)).toContain('# Research');

    const row = mockRows.get('research.md');
    expect(row).toBeDefined();
    expect(row.file_type).toBe('topic');
    expect(row.description).toBe('Web search results and research findings');
  });

  it('createTopicFile slugifies name correctly', () => {
    const fileId = createTopicFile('My Cool Project!', 'A cool project');
    expect(fileId).toBe('my-cool-project.md');
  });

  it('createTopicFile does not overwrite existing file', () => {
    const path = `${CONTEXT_DIR}/existing.md`;
    mockFiles.set(path, '# Existing Content\nDo not overwrite');
    const fileId = createTopicFile('existing', 'test');
    expect(fileId).toBe('existing.md');
    expect(mockFiles.get(path)).toContain('Do not overwrite');
  });

  it('updateFileDescription updates the description', () => {
    createTopicFile('Notes', 'Old description');
    updateFileDescription('notes.md', 'New description');
    const row = mockRows.get('notes.md');
    expect(row.description).toBe('New description');
  });

  it('listTopicIndex returns only topic files', () => {
    // Create an identity file row
    mockRows.set('main.md', {
      file_id: 'main.md', file_path: '', created_at: 0, updated_at: 100,
      char_count: 500, file_type: 'identity', description: '',
    });
    // Create a topic file
    createTopicFile('Research', 'Search results');

    const index = listTopicIndex();
    expect(index.length).toBe(1);
    expect(index[0].fileId).toBe('research.md');
    expect(index[0].description).toBe('Search results');
  });

  it('getFileType detects types correctly', () => {
    // No DB row — falls back to filename detection
    expect(getFileType('main.md')).toBe('identity');
    expect(getFileType('task-abc.md')).toBe('task');
    expect(getFileType('research.md')).toBe('topic');
  });
});

// ═══════════════════════════════════════════════
// _updateMeta — file type auto-detection
// ═══════════════════════════════════════════════

describe('_updateMeta file type detection', () => {
  it('sets identity type for main.md', () => {
    contextManager.writeContextFile('main.md', '# Identity');
    const row = mockRows.get('main.md');
    expect(row).toBeDefined();
    expect(row.file_type).toBe('identity');
  });

  it('sets task type for task-* files', () => {
    contextManager.writeContextFile('task-123.md', '# Task 123');
    const row = mockRows.get('task-123.md');
    expect(row).toBeDefined();
    expect(row.file_type).toBe('task');
  });

  it('sets topic type for other files', () => {
    contextManager.writeContextFile('research.md', '# Research');
    const row = mockRows.get('research.md');
    expect(row).toBeDefined();
    expect(row.file_type).toBe('topic');
  });
});

// ═══════════════════════════════════════════════
// Topic File Selector
// ═══════════════════════════════════════════════

describe('selectTopicFiles', () => {
  it('returns empty array when no topic files exist', async () => {
    const result = await selectTopicFiles('hello');
    expect(result.fileIds).toEqual([]);
  });

  it('returns all files when ≤3 topic files exist (skips LLM)', async () => {
    createTopicFile('Research', 'Search results');
    createTopicFile('Browsing', 'Browse history');

    const result = await selectTopicFiles('find papers on AI');
    expect(result.fileIds).toHaveLength(2);
    expect(result.fileIds).toContain('research.md');
    expect(result.fileIds).toContain('browsing.md');
    // LLM should NOT have been called
    expect(mockProviderChat).not.toHaveBeenCalled();
  });

  it('calls LLM when >3 topic files exist', async () => {
    createTopicFile('Research', 'Search results');
    createTopicFile('Browsing', 'Browse history');
    createTopicFile('Reading', 'Feed articles');
    createTopicFile('Notes', 'Personal notes');

    mockProviderChat.mockResolvedValue({
      message: { role: 'assistant', content: '["research.md", "notes.md"]' },
    });

    const result = await selectTopicFiles('find my research notes');
    expect(mockProviderChat).toHaveBeenCalled();
    expect(result.fileIds).toEqual(['research.md', 'notes.md']);
  });

  it('falls back to recent files on LLM error', async () => {
    createTopicFile('A', 'a');
    createTopicFile('B', 'b');
    createTopicFile('C', 'c');
    createTopicFile('D', 'd');

    mockProviderChat.mockRejectedValue(new Error('Connection refused'));

    const result = await selectTopicFiles('test');
    expect(result.fileIds.length).toBeLessThanOrEqual(3);
    expect(result.fileIds.length).toBeGreaterThan(0);
  });

  it('filters out invalid file IDs from LLM response', async () => {
    createTopicFile('Research', 'Search results');
    createTopicFile('Browsing', 'Browse history');
    createTopicFile('Reading', 'Feed articles');
    createTopicFile('Notes', 'Personal notes');

    mockProviderChat.mockResolvedValue({
      message: { role: 'assistant', content: '["research.md", "nonexistent.md", "notes.md"]' },
    });

    const result = await selectTopicFiles('test');
    expect(result.fileIds).toContain('research.md');
    expect(result.fileIds).toContain('notes.md');
    expect(result.fileIds).not.toContain('nonexistent.md');
  });
});

// ═══════════════════════════════════════════════
// Intake Routing
// ═══════════════════════════════════════════════

describe('intake routing', () => {
  it('routes search source to research.md', () => {
    contextIntake.ingest({
      source: 'search',
      section: '## Search Results',
      content: 'Found a paper on transformers',
    });
    contextIntake.flush();
    expect(mockFiles.has(`${CONTEXT_DIR}/research.md`)).toBe(true);
  });

  it('routes browse source to browsing.md', () => {
    contextIntake.ingest({
      source: 'browse',
      section: '## Visited Pages',
      content: 'Visited example.com',
    });
    contextIntake.flush();
    expect(mockFiles.has(`${CONTEXT_DIR}/browsing.md`)).toBe(true);
  });

  it('routes feed source to reading.md', () => {
    contextIntake.ingest({
      source: 'feed',
      section: '## Feed',
      content: 'Read article about AI safety',
    });
    contextIntake.flush();
    expect(mockFiles.has(`${CONTEXT_DIR}/reading.md`)).toBe(true);
  });

  it('routes chat source to main.md', () => {
    contextIntake.ingest({
      source: 'chat',
      section: '## Chat',
      content: 'User said they prefer dark mode',
    });
    contextIntake.flush();
    expect(mockFiles.has(`${CONTEXT_DIR}/main.md`)).toBe(true);
    expect(mockFiles.get(`${CONTEXT_DIR}/main.md`)).toContain('dark mode');
  });

  it('explicit file param overrides routing', () => {
    contextIntake.ingest({
      source: 'search',
      section: '## Notes',
      content: 'Custom note',
      file: 'custom.md',
    });
    contextIntake.flush();
    expect(mockFiles.has(`${CONTEXT_DIR}/custom.md`)).toBe(true);
  });

  it('identity sections stay in main.md regardless of source', () => {
    contextIntake.ingest({
      source: 'search',
      section: '## Preferences',
      content: 'User prefers light mode',
    });
    contextIntake.flush();
    expect(mockFiles.has(`${CONTEXT_DIR}/main.md`)).toBe(true);
    expect(mockFiles.get(`${CONTEXT_DIR}/main.md`)).toContain('light mode');
  });
});

// ═══════════════════════════════════════════════
// Research Assistant — preloadContext
// ═══════════════════════════════════════════════

describe('research assistant preloadContext', () => {
  // We need to import it fresh to use the mocked deps
  it('loads identity from main.md into contextDocument', async () => {
    const { researchAssistant } = await import('../../agents/builtin/research-assistant');

    mockFiles.set(`${CONTEXT_DIR}/main.md`, '# Identity\nI am Kevin, I like AI research');
    mockRows.set('main.md', {
      file_id: 'main.md', file_path: '', created_at: 0, updated_at: 100,
      char_count: 50, file_type: 'identity', description: '',
    });

    const context = { _userQuery: 'hello' } as any;
    await researchAssistant.preloadContext!(context);
    expect(context.contextDocument).toContain('Identity');
    expect(context.contextDocument).toContain('Kevin');
  });

  it('injects contextDocument into system prompt', async () => {
    const { researchAssistant } = await import('../../agents/builtin/research-assistant');

    const context = {
      toolsEnabled: true,
      contextDocument: '## Identity\nI am Kevin\n\n## Topic: research.md\nAI papers',
    } as any;

    const prompt = researchAssistant.buildSystemPrompt(context);
    expect(prompt).toContain('--- USER CONTEXT ---');
    expect(prompt).toContain('I am Kevin');
    expect(prompt).toContain('AI papers');
    expect(prompt).toContain('--- END USER CONTEXT ---');
  });

  it('produces no context section when no files exist', async () => {
    const { researchAssistant } = await import('../../agents/builtin/research-assistant');

    const context = { toolsEnabled: false } as any;
    const prompt = researchAssistant.buildSystemPrompt(context);
    expect(prompt).not.toContain('USER CONTEXT');
  });
});
