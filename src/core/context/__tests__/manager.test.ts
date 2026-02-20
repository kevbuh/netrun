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
}));

// ── Mock DB ──
const mockRows = new Map<string, any>();
const mockDb = {
  prepare: (sql: string) => ({
    all: () => {
      if (sql.includes("file_type = 'topic'")) {
        return Array.from(mockRows.values())
          .filter((r: any) => r.file_type === 'topic')
          .map(r => ({ fileId: r.file_id, description: r.description ?? '', charCount: r.char_count, updatedAt: r.updated_at }));
      }
      if (sql.includes('FROM context_meta')) {
        return Array.from(mockRows.values()).map(r => ({
          file_id: r.file_id, file_path: r.file_path, created_at: r.created_at,
          updated_at: r.updated_at, compacted_at: r.compacted_at, char_count: r.char_count,
          file_type: r.file_type ?? 'topic', description: r.description ?? '',
        }));
      }
      return Array.from(mockRows.values());
    },
    get: (...args: any[]) => {
      if (sql.includes('SELECT 1')) return mockRows.has(args[0]) ? { 1: 1 } : undefined;
      if (sql.includes('SELECT file_type')) {
        const row = mockRows.get(args[0]);
        return row ? { file_type: row.file_type } : undefined;
      }
      return mockRows.get(args[0]);
    },
    run: (...args: any[]) => {
      if (sql.includes('INSERT') && sql.includes('file_type')) {
        mockRows.set(args[0], {
          file_id: args[0], file_path: args[1], created_at: args[2],
          updated_at: args[3], char_count: args[4], file_type: args[5] ?? 'topic',
          description: args[6] ?? '', compacted_at: null,
        });
      }
      if (sql.includes('UPDATE') && sql.includes('char_count')) {
        const row = mockRows.get(args[2]);
        if (row) { row.updated_at = args[0]; row.char_count = args[1]; }
      }
      if (sql.includes('UPDATE') && sql.includes('description') && !sql.includes('char_count')) {
        const row = mockRows.get(args[1]);
        if (row) row.description = args[0];
      }
      if (sql.includes('DELETE')) {
        mockRows.delete(args[0]);
      }
    },
  }),
};
vi.mock('../../db/connection', () => ({ getDb: () => mockDb }));

// ── Now import the module under test ──
import {
  getMainContext, getTaskContext, listContextFiles, appendContext,
  replaceSection, getContextSize, needsCompaction, archiveVersion,
  readContextFile, writeContextFile, deleteContextFile, getFileType,
  createTopicFile, listTopicIndex, getContextDir,
} from '../manager.js';

const CONTEXT_DIR = getContextDir();
import * as path from 'path';

beforeEach(() => {
  mockFiles.clear();
  mockRows.clear();
});

// ═══════════════════════════════════════════════════════════════
// getMainContext
// ═══════════════════════════════════════════════════════════════

describe('getMainContext', () => {
  it('returns empty string when main.md does not exist', () => {
    expect(getMainContext()).toBe('');
  });

  it('returns content when main.md exists', () => {
    mockFiles.set(path.join(CONTEXT_DIR, 'main.md'), '# Main Context\nHello world');
    expect(getMainContext()).toBe('# Main Context\nHello world');
  });
});

// ═══════════════════════════════════════════════════════════════
// getTaskContext
// ═══════════════════════════════════════════════════════════════

describe('getTaskContext', () => {
  it('returns empty string when task file does not exist', () => {
    expect(getTaskContext('abc')).toBe('');
  });

  it('returns content for existing task', () => {
    mockFiles.set(path.join(CONTEXT_DIR, 'task-abc.md'), '# Task ABC');
    expect(getTaskContext('abc')).toBe('# Task ABC');
  });
});

// ═══════════════════════════════════════════════════════════════
// listContextFiles
// ═══════════════════════════════════════════════════════════════

describe('listContextFiles', () => {
  it('returns empty array when no files', () => {
    expect(listContextFiles()).toEqual([]);
  });

  it('returns files from DB', () => {
    mockRows.set('main.md', {
      file_id: 'main.md', file_path: '/test/main.md', created_at: 100,
      updated_at: 200, compacted_at: null, char_count: 500,
      file_type: 'identity', description: 'Main context',
    });
    const files = listContextFiles();
    expect(files.length).toBe(1);
    // SQL returns snake_case columns; the ContextFile interface uses camelCase
    // but the `as` cast doesn't transform the data at runtime
    expect((files[0] as any).file_id).toBe('main.md');
    expect((files[0] as any).file_type).toBe('identity');
  });
});

// ═══════════════════════════════════════════════════════════════
// appendContext
// ═══════════════════════════════════════════════════════════════

describe('appendContext', () => {
  it('creates file with section if it does not exist', () => {
    appendContext('test.md', '## Notes', 'First note');
    const content = mockFiles.get(path.join(CONTEXT_DIR, 'test.md'))!;
    expect(content).toContain('## Notes');
    expect(content).toContain('First note');
  });

  it('appends to existing section', () => {
    const filePath = path.join(CONTEXT_DIR, 'notes.md');
    mockFiles.set(filePath, '## Notes\nExisting content\n');
    appendContext('notes.md', '## Notes', 'New content');
    const content = mockFiles.get(filePath)!;
    expect(content).toContain('Existing content');
    expect(content).toContain('New content');
  });

  it('inserts before next section', () => {
    const filePath = path.join(CONTEXT_DIR, 'multi.md');
    mockFiles.set(filePath, '## Section A\nContent A\n\n## Section B\nContent B\n');
    appendContext('multi.md', '## Section A', 'Added to A');
    const content = mockFiles.get(filePath)!;
    expect(content).toContain('Added to A');
    // Section B should still be present
    expect(content).toContain('## Section B');
    expect(content).toContain('Content B');
  });
});

// ═══════════════════════════════════════════════════════════════
// replaceSection
// ═══════════════════════════════════════════════════════════════

describe('replaceSection', () => {
  it('replaces content of existing section', () => {
    const filePath = path.join(CONTEXT_DIR, 'replace.md');
    mockFiles.set(filePath, '## Goals\nOld goals\n\n## Tasks\nTasks here\n');
    replaceSection('replace.md', '## Goals', 'New goals');
    const content = mockFiles.get(filePath)!;
    expect(content).toContain('New goals');
    expect(content).not.toContain('Old goals');
    expect(content).toContain('## Tasks');
  });

  it('creates section if it does not exist', () => {
    const filePath = path.join(CONTEXT_DIR, 'new.md');
    mockFiles.set(filePath, '# Document\n');
    replaceSection('new.md', '## New Section', 'Fresh content');
    const content = mockFiles.get(filePath)!;
    expect(content).toContain('## New Section');
    expect(content).toContain('Fresh content');
  });
});

// ═══════════════════════════════════════════════════════════════
// getContextSize / needsCompaction
// ═══════════════════════════════════════════════════════════════

describe('getContextSize', () => {
  it('returns 0 for missing file', () => {
    expect(getContextSize('nonexistent.md')).toBe(0);
  });

  it('returns character count', () => {
    mockFiles.set(path.join(CONTEXT_DIR, 'sized.md'), 'Hello World');
    expect(getContextSize('sized.md')).toBe(11);
  });
});

describe('needsCompaction', () => {
  it('returns false for small file', () => {
    mockFiles.set(path.join(CONTEXT_DIR, 'small.md'), 'Short');
    expect(needsCompaction('small.md')).toBe(false);
  });

  it('returns true for large file (> 8000 chars)', () => {
    mockFiles.set(path.join(CONTEXT_DIR, 'big.md'), 'x'.repeat(9000));
    expect(needsCompaction('big.md')).toBe(true);
  });

  it('respects custom threshold', () => {
    mockFiles.set(path.join(CONTEXT_DIR, 'medium.md'), 'x'.repeat(500));
    expect(needsCompaction('medium.md', 100)).toBe(true);
    expect(needsCompaction('medium.md', 1000)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// archiveVersion
// ═══════════════════════════════════════════════════════════════

describe('archiveVersion', () => {
  it('copies file to archive directory', () => {
    const filePath = path.join(CONTEXT_DIR, 'main.md');
    mockFiles.set(filePath, '# Archived content');
    archiveVersion('main.md');
    // Should have created a file in archive/
    const archiveFiles = Array.from(mockFiles.keys()).filter(k => k.includes('archive'));
    expect(archiveFiles.length).toBe(1);
    expect(mockFiles.get(archiveFiles[0])).toBe('# Archived content');
  });

  it('does nothing for non-existent file', () => {
    const before = mockFiles.size;
    archiveVersion('nope.md');
    expect(mockFiles.size).toBe(before);
  });
});

// ═══════════════════════════════════════════════════════════════
// readContextFile / writeContextFile
// ═══════════════════════════════════════════════════════════════

describe('readContextFile', () => {
  it('returns empty string for missing file', () => {
    expect(readContextFile('missing.md')).toBe('');
  });

  it('returns file content', () => {
    mockFiles.set(path.join(CONTEXT_DIR, 'test.md'), 'Content here');
    expect(readContextFile('test.md')).toBe('Content here');
  });
});

describe('writeContextFile', () => {
  it('writes content to file', () => {
    writeContextFile('written.md', '# Written');
    expect(mockFiles.get(path.join(CONTEXT_DIR, 'written.md'))).toBe('# Written');
  });
});

// ═══════════════════════════════════════════════════════════════
// deleteContextFile
// ═══════════════════════════════════════════════════════════════

describe('deleteContextFile', () => {
  it('removes file and DB entry', () => {
    const filePath = path.join(CONTEXT_DIR, 'delete-me.md');
    mockFiles.set(filePath, 'temp');
    mockRows.set('delete-me.md', { file_id: 'delete-me.md' });
    deleteContextFile('delete-me.md');
    expect(mockFiles.has(filePath)).toBe(false);
    expect(mockRows.has('delete-me.md')).toBe(false);
  });

  it('handles non-existent file gracefully', () => {
    expect(() => deleteContextFile('nonexistent.md')).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// getFileType
// ═══════════════════════════════════════════════════════════════

describe('getFileType', () => {
  it('returns identity for main.md', () => {
    expect(getFileType('main.md')).toBe('identity');
  });

  it('returns task for task-*.md', () => {
    expect(getFileType('task-abc.md')).toBe('task');
  });

  it('returns topic for other files', () => {
    expect(getFileType('notes.md')).toBe('topic');
  });

  it('returns file_type from DB when available', () => {
    mockRows.set('custom.md', { file_id: 'custom.md', file_type: 'topic' });
    expect(getFileType('custom.md')).toBe('topic');
  });
});

// ═══════════════════════════════════════════════════════════════
// createTopicFile
// ═══════════════════════════════════════════════════════════════

describe('createTopicFile', () => {
  it('creates file with slugified name', () => {
    const fileId = createTopicFile('My Research Notes', 'Notes about research');
    expect(fileId).toBe('my-research-notes.md');
    const content = mockFiles.get(path.join(CONTEXT_DIR, fileId))!;
    expect(content).toContain('# My Research Notes');
  });

  it('does not overwrite existing file', () => {
    const filePath = path.join(CONTEXT_DIR, 'existing.md');
    mockFiles.set(filePath, '# Original');
    createTopicFile('Existing', 'desc');
    expect(mockFiles.get(filePath)).toBe('# Original');
  });

  it('strips special characters from slug', () => {
    const fileId = createTopicFile('Hello World! @#$%', 'test');
    expect(fileId).toBe('hello-world.md');
  });
});

// ═══════════════════════════════════════════════════════════════
// listTopicIndex
// ═══════════════════════════════════════════════════════════════

describe('listTopicIndex', () => {
  it('returns empty array when no topics', () => {
    expect(listTopicIndex()).toEqual([]);
  });

  it('returns only topic files', () => {
    mockRows.set('main.md', { file_id: 'main.md', file_type: 'identity', description: '', char_count: 100, updated_at: 1 });
    mockRows.set('notes.md', { file_id: 'notes.md', file_type: 'topic', description: 'My notes', char_count: 200, updated_at: 2 });
    const topics = listTopicIndex();
    expect(topics.length).toBe(1);
    expect(topics[0].fileId).toBe('notes.md');
    expect(topics[0].description).toBe('My notes');
  });
});
