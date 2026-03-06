import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TopicIndexEntry } from '../manager.js';

// ── Mock listTopicIndex ──
let mockTopicIndex: TopicIndexEntry[] = [];
vi.mock('../manager.js', () => ({
  listTopicIndex: () => mockTopicIndex,
}));

// ── Mock providerRegistry ──
let mockProvider: any = null;
vi.mock('../../providers/registry.js', () => ({
  providerRegistry: {
    getDefault: () => mockProvider,
  },
}));

// Import the module under test after mocks
import { selectTopicFiles } from '../selector.js';

beforeEach(() => {
  mockTopicIndex = [];
  mockProvider = null;
});

// Helper to create a topic index entry
function entry(fileId: string, updatedAt: number, description = ''): TopicIndexEntry {
  return { fileId, description, charCount: 100, updatedAt };
}

// ═══════════════════════════════════════════════════════════════
// Empty index
// ═══════════════════════════════════════════════════════════════

describe('selectTopicFiles — empty index', () => {
  it('returns empty fileIds when no topic files exist', async () => {
    mockTopicIndex = [];
    const result = await selectTopicFiles('anything');
    expect(result).toEqual({ fileIds: [] });
  });

  it('returns an object with fileIds property', async () => {
    mockTopicIndex = [];
    const result = await selectTopicFiles('query');
    expect(result).toHaveProperty('fileIds');
    expect(Array.isArray(result.fileIds)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Few files shortcut (≤3 files — skips LLM)
// ═══════════════════════════════════════════════════════════════

describe('selectTopicFiles — few files shortcut', () => {
  it('returns single file when only 1 topic exists', async () => {
    mockTopicIndex = [entry('notes.md', 100)];
    const result = await selectTopicFiles('query');
    expect(result.fileIds).toEqual(['notes.md']);
  });

  it('returns all 2 files without calling LLM', async () => {
    mockTopicIndex = [entry('a.md', 100), entry('b.md', 200)];
    const result = await selectTopicFiles('query');
    expect(result.fileIds).toEqual(['a.md', 'b.md']);
  });

  it('returns all 3 files without calling LLM', async () => {
    mockTopicIndex = [
      entry('a.md', 100),
      entry('b.md', 200),
      entry('c.md', 300),
    ];
    const result = await selectTopicFiles('query');
    expect(result.fileIds).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('does not require a provider when ≤3 files', async () => {
    mockProvider = null;
    mockTopicIndex = [entry('solo.md', 50)];
    const result = await selectTopicFiles('query');
    expect(result.fileIds).toEqual(['solo.md']);
  });

  it('preserves original order of index entries', async () => {
    mockTopicIndex = [
      entry('z.md', 10),
      entry('a.md', 20),
      entry('m.md', 5),
    ];
    const result = await selectTopicFiles('query');
    expect(result.fileIds).toEqual(['z.md', 'a.md', 'm.md']);
  });
});

// ═══════════════════════════════════════════════════════════════
// Fallback: no provider available
// ═══════════════════════════════════════════════════════════════

describe('selectTopicFiles — fallback when no provider', () => {
  it('returns 3 most recently updated files when no provider', async () => {
    mockProvider = null;
    mockTopicIndex = [
      entry('old.md', 100),
      entry('mid.md', 300),
      entry('new.md', 500),
      entry('newest.md', 700),
    ];
    const result = await selectTopicFiles('query');
    expect(result.fileIds).toHaveLength(3);
    expect(result.fileIds).toEqual(['newest.md', 'new.md', 'mid.md']);
  });

  it('sorts by updatedAt descending in fallback', async () => {
    mockProvider = null;
    mockTopicIndex = [
      entry('d.md', 400),
      entry('a.md', 100),
      entry('c.md', 300),
      entry('b.md', 200),
    ];
    const result = await selectTopicFiles('query');
    expect(result.fileIds[0]).toBe('d.md');
    expect(result.fileIds[1]).toBe('c.md');
    expect(result.fileIds[2]).toBe('b.md');
  });

  it('returns exactly MAX_SELECTED (3) in fallback with many files', async () => {
    mockProvider = null;
    mockTopicIndex = [
      entry('a.md', 10),
      entry('b.md', 20),
      entry('c.md', 30),
      entry('d.md', 40),
      entry('e.md', 50),
      entry('f.md', 60),
    ];
    const result = await selectTopicFiles('query');
    expect(result.fileIds).toHaveLength(3);
    expect(result.fileIds).toEqual(['f.md', 'e.md', 'd.md']);
  });
});

// ═══════════════════════════════════════════════════════════════
// LLM success paths
// ═══════════════════════════════════════════════════════════════

describe('selectTopicFiles — LLM selection', () => {
  it('uses LLM response to select files', async () => {
    mockTopicIndex = [
      entry('a.md', 100),
      entry('b.md', 200),
      entry('c.md', 300),
      entry('d.md', 400),
    ];
    mockProvider = {
      chat: vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: '["a.md", "c.md"]' },
      }),
    };
    const result = await selectTopicFiles('test query');
    expect(result.fileIds).toEqual(['a.md', 'c.md']);
  });

  it('extracts JSON array from markdown-wrapped response', async () => {
    mockTopicIndex = [
      entry('x.md', 10),
      entry('y.md', 20),
      entry('z.md', 30),
      entry('w.md', 40),
    ];
    mockProvider = {
      chat: vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: '```json\n["x.md", "z.md"]\n```' },
      }),
    };
    const result = await selectTopicFiles('query');
    expect(result.fileIds).toEqual(['x.md', 'z.md']);
  });

  it('filters out invalid file IDs from LLM response', async () => {
    mockTopicIndex = [
      entry('a.md', 100),
      entry('b.md', 200),
      entry('c.md', 300),
      entry('d.md', 400),
    ];
    mockProvider = {
      chat: vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: '["a.md", "nonexistent.md", "c.md"]' },
      }),
    };
    const result = await selectTopicFiles('query');
    expect(result.fileIds).toEqual(['a.md', 'c.md']);
    expect(result.fileIds).not.toContain('nonexistent.md');
  });

  it('caps selection at 3 even if LLM returns more', async () => {
    mockTopicIndex = [
      entry('a.md', 100),
      entry('b.md', 200),
      entry('c.md', 300),
      entry('d.md', 400),
      entry('e.md', 500),
    ];
    mockProvider = {
      chat: vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: '["a.md", "b.md", "c.md", "d.md", "e.md"]' },
      }),
    };
    const result = await selectTopicFiles('query');
    expect(result.fileIds).toHaveLength(3);
    expect(result.fileIds).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('passes correct prompt structure to LLM', async () => {
    mockTopicIndex = [
      entry('notes.md', 100, 'Research notes'),
      entry('goals.md', 200, 'Project goals'),
      entry('ideas.md', 300),
      entry('refs.md', 400, 'Reference material'),
    ];
    const chatFn = vi.fn().mockResolvedValue({
      message: { role: 'assistant', content: '["notes.md"]' },
    });
    mockProvider = { chat: chatFn };

    await selectTopicFiles('find my research');

    expect(chatFn).toHaveBeenCalledTimes(1);
    const callArgs = chatFn.mock.calls[0][0];
    expect(callArgs.messages).toHaveLength(2);
    expect(callArgs.messages[0].role).toBe('system');
    expect(callArgs.messages[1].role).toBe('user');
    expect(callArgs.messages[1].content).toContain('find my research');
    expect(callArgs.messages[1].content).toContain('notes.md');
    expect(callArgs.messages[1].content).toContain('Research notes');
    expect(callArgs.messages[1].content).toContain('(no description)');
    expect(callArgs.temperature).toBe(0);
    expect(callArgs.maxTokens).toBe(100);
  });

  it('passes signal to provider.chat', async () => {
    mockTopicIndex = [
      entry('a.md', 100),
      entry('b.md', 200),
      entry('c.md', 300),
      entry('d.md', 400),
    ];
    const controller = new AbortController();
    const chatFn = vi.fn().mockResolvedValue({
      message: { role: 'assistant', content: '["a.md"]' },
    });
    mockProvider = { chat: chatFn };

    await selectTopicFiles('query', controller.signal);
    expect(chatFn.mock.calls[0][0].signal).toBe(controller.signal);
  });

  it('includes description and charCount in index string sent to LLM', async () => {
    mockTopicIndex = [
      entry('big.md', 100, 'A big file'),
      entry('small.md', 200, 'A small file'),
      entry('medium.md', 300, 'A medium file'),
      entry('extra.md', 400, 'Extra file'),
    ];
    const chatFn = vi.fn().mockResolvedValue({
      message: { role: 'assistant', content: '["big.md"]' },
    });
    mockProvider = { chat: chatFn };

    await selectTopicFiles('query');

    const userContent = chatFn.mock.calls[0][0].messages[1].content;
    expect(userContent).toContain('100 chars');
    expect(userContent).toContain('A big file');
  });
});

// ═══════════════════════════════════════════════════════════════
// LLM error / fallback paths
// ═══════════════════════════════════════════════════════════════

describe('selectTopicFiles — error fallback', () => {
  it('falls back when LLM throws an error', async () => {
    mockTopicIndex = [
      entry('a.md', 100),
      entry('b.md', 400),
      entry('c.md', 200),
      entry('d.md', 300),
    ];
    mockProvider = {
      chat: vi.fn().mockRejectedValue(new Error('Network error')),
    };
    const result = await selectTopicFiles('query');
    expect(result.fileIds).toEqual(['b.md', 'd.md', 'c.md']);
  });

  it('falls back when LLM returns no JSON array', async () => {
    mockTopicIndex = [
      entry('a.md', 100),
      entry('b.md', 400),
      entry('c.md', 200),
      entry('d.md', 300),
    ];
    mockProvider = {
      chat: vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: 'I think a.md is relevant' },
      }),
    };
    const result = await selectTopicFiles('query');
    expect(result.fileIds).toEqual(['b.md', 'd.md', 'c.md']);
  });

  it('falls back when LLM returns empty JSON array', async () => {
    mockTopicIndex = [
      entry('a.md', 100),
      entry('b.md', 400),
      entry('c.md', 200),
      entry('d.md', 300),
    ];
    mockProvider = {
      chat: vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: '[]' },
      }),
    };
    const result = await selectTopicFiles('query');
    expect(result.fileIds).toEqual(['b.md', 'd.md', 'c.md']);
  });

  it('falls back when LLM returns all invalid IDs', async () => {
    mockTopicIndex = [
      entry('a.md', 100),
      entry('b.md', 400),
      entry('c.md', 200),
      entry('d.md', 300),
    ];
    mockProvider = {
      chat: vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: '["nonexistent1.md", "nonexistent2.md"]' },
      }),
    };
    const result = await selectTopicFiles('query');
    expect(result.fileIds).toEqual(['b.md', 'd.md', 'c.md']);
  });

  it('falls back when LLM returns null content', async () => {
    mockTopicIndex = [
      entry('a.md', 100),
      entry('b.md', 400),
      entry('c.md', 200),
      entry('d.md', 300),
    ];
    mockProvider = {
      chat: vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: null },
      }),
    };
    const result = await selectTopicFiles('query');
    expect(result.fileIds).toEqual(['b.md', 'd.md', 'c.md']);
  });

  it('falls back when LLM returns malformed JSON', async () => {
    mockTopicIndex = [
      entry('a.md', 100),
      entry('b.md', 400),
      entry('c.md', 200),
      entry('d.md', 300),
    ];
    mockProvider = {
      chat: vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: '[broken json' },
      }),
    };
    const result = await selectTopicFiles('query');
    expect(result.fileIds).toEqual(['b.md', 'd.md', 'c.md']);
  });

  it('does not throw — always resolves', async () => {
    mockTopicIndex = [
      entry('a.md', 100),
      entry('b.md', 200),
      entry('c.md', 300),
      entry('d.md', 400),
    ];
    mockProvider = {
      chat: vi.fn().mockRejectedValue(new TypeError('Cannot read properties')),
    };
    await expect(selectTopicFiles('query')).resolves.toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════

describe('selectTopicFiles — edge cases', () => {
  it('handles exactly 4 files (just above shortcut threshold)', async () => {
    mockTopicIndex = [
      entry('a.md', 100),
      entry('b.md', 200),
      entry('c.md', 300),
      entry('d.md', 400),
    ];
    mockProvider = null;
    const result = await selectTopicFiles('query');
    expect(result.fileIds).toHaveLength(3);
    expect(result.fileIds).toEqual(['d.md', 'c.md', 'b.md']);
  });

  it('handles LLM returning a single valid ID in array', async () => {
    mockTopicIndex = [
      entry('a.md', 100),
      entry('b.md', 200),
      entry('c.md', 300),
      entry('d.md', 400),
    ];
    mockProvider = {
      chat: vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: '["c.md"]' },
      }),
    };
    const result = await selectTopicFiles('query');
    expect(result.fileIds).toEqual(['c.md']);
  });

  it('extracts JSON array with surrounding text', async () => {
    mockTopicIndex = [
      entry('a.md', 100),
      entry('b.md', 200),
      entry('c.md', 300),
      entry('d.md', 400),
    ];
    mockProvider = {
      chat: vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: 'Here are the relevant files: ["a.md", "d.md"] based on your query.' },
      }),
    };
    const result = await selectTopicFiles('query');
    expect(result.fileIds).toEqual(['a.md', 'd.md']);
  });
});
