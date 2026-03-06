import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock contextManager ──
const mockAppendContext = vi.fn();
const mockGetContextSize = vi.fn().mockReturnValue(0);
const mockCreateTopicFile = vi.fn();

vi.mock('../manager.js', () => ({
  contextManager: {
    appendContext: (...args: any[]) => mockAppendContext(...args),
    getContextSize: (...args: any[]) => mockGetContextSize(...args),
    createTopicFile: (...args: any[]) => mockCreateTopicFile(...args),
  },
}));

// ── Mock scheduleCompaction ──
const mockScheduleCompaction = vi.fn();
vi.mock('../compaction.js', () => ({
  scheduleCompaction: (...args: any[]) => mockScheduleCompaction(...args),
}));

// ── Import module under test (after mocks) ──
import type { IntakeEntry } from '../intake.js';

// We need a fresh ContextIntake for each test, so we reset modules and re-import.
let contextIntake: typeof import('../intake.js')['contextIntake'];

beforeEach(async () => {
  vi.useFakeTimers();
  mockAppendContext.mockClear();
  mockGetContextSize.mockClear().mockReturnValue(0);
  mockCreateTopicFile.mockClear();
  mockScheduleCompaction.mockClear();

  // Reset module to get a fresh ContextIntake instance each time
  vi.resetModules();

  const mod = await import('../intake.js');
  contextIntake = mod.contextIntake;
});

afterEach(() => {
  contextIntake.shutdown();
  vi.useRealTimers();
});

// ═══════════════════════════════════════════════════════════════
// routeToFile — explicit file
// ═══════════════════════════════════════════════════════════════

describe('routeToFile: explicit file', () => {
  it('uses explicit file when provided, ignoring source route', () => {
    contextIntake.ingest({ source: 'search', section: '## Results', content: 'data', file: 'custom.md' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledWith('custom.md', '## Results', expect.any(String));
  });

  it('uses explicit file even for identity sections', () => {
    contextIntake.ingest({ source: 'chat', section: '## Preferences', content: 'prefs', file: 'override.md' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledWith('override.md', '## Preferences', expect.any(String));
  });
});

// ═══════════════════════════════════════════════════════════════
// routeToFile — identity sections
// ═══════════════════════════════════════════════════════════════

describe('routeToFile: identity sections', () => {
  it('routes ## Preferences to main.md', () => {
    contextIntake.ingest({ source: 'browse', section: '## Preferences', content: 'likes dark mode' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledWith('main.md', '## Preferences', expect.any(String));
  });

  it('routes ## Goals to main.md', () => {
    contextIntake.ingest({ source: 'feed', section: '## Goals', content: 'learn Rust' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledWith('main.md', '## Goals', expect.any(String));
  });

  it('routes ## About Me to main.md', () => {
    contextIntake.ingest({ source: 'search', section: '## About Me', content: 'info' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledWith('main.md', '## About Me', expect.any(String));
  });

  it('routes ## Identity to main.md', () => {
    contextIntake.ingest({ source: 'browse', section: '## Identity', content: 'who I am' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledWith('main.md', '## Identity', expect.any(String));
  });

  it('matches sections that start with identity prefix', () => {
    contextIntake.ingest({ source: 'feed', section: '## Preferences - Theme', content: 'dark' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledWith('main.md', '## Preferences - Theme', expect.any(String));
  });
});

// ═══════════════════════════════════════════════════════════════
// routeToFile — chat and agent sources
// ═══════════════════════════════════════════════════════════════

describe('routeToFile: chat and agent sources', () => {
  it('routes chat source to main.md', () => {
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'chat note' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledWith('main.md', '## Notes', expect.any(String));
  });

  it('routes agent source to main.md', () => {
    contextIntake.ingest({ source: 'agent', section: '## Findings', content: 'agent finding' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledWith('main.md', '## Findings', expect.any(String));
  });

  it('agent with explicit file uses that file instead', () => {
    contextIntake.ingest({ source: 'agent', section: '## Report', content: 'report', file: 'report.md' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledWith('report.md', '## Report', expect.any(String));
  });
});

// ═══════════════════════════════════════════════════════════════
// routeToFile — source-based routing
// ═══════════════════════════════════════════════════════════════

describe('routeToFile: source-based routing', () => {
  it('routes search source to research.md', () => {
    contextIntake.ingest({ source: 'search', section: '## Queries', content: 'searched for X' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledWith('research.md', '## Queries', expect.any(String));
  });

  it('routes browse source to browsing.md', () => {
    contextIntake.ingest({ source: 'browse', section: '## Pages', content: 'visited Y' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledWith('browsing.md', '## Pages', expect.any(String));
  });

  it('routes feed source to reading.md', () => {
    contextIntake.ingest({ source: 'feed', section: '## Articles', content: 'read article Z' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledWith('reading.md', '## Articles', expect.any(String));
  });

  it('auto-creates topic file when context size is 0', () => {
    mockGetContextSize.mockReturnValue(0);
    contextIntake.ingest({ source: 'search', section: '## Data', content: 'stuff' });
    contextIntake.flush();
    expect(mockCreateTopicFile).toHaveBeenCalledWith('research', 'Web search results and research findings');
  });

  it('does not auto-create topic file when file already has content', () => {
    mockGetContextSize.mockReturnValue(500);
    contextIntake.ingest({ source: 'browse', section: '## Notes', content: 'page note' });
    contextIntake.flush();
    expect(mockCreateTopicFile).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// Deduplication
// ═══════════════════════════════════════════════════════════════

describe('deduplication', () => {
  it('drops duplicate entry with same dedupeKey within 5-minute window', () => {
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'first', dedupeKey: 'key-1' });
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'duplicate', dedupeKey: 'key-1' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledTimes(1);
    const written = mockAppendContext.mock.calls[0][2] as string;
    expect(written).toContain('first');
    expect(written).not.toContain('duplicate');
  });

  it('allows same dedupeKey after 5-minute window expires', () => {
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'first', dedupeKey: 'key-2' });
    contextIntake.flush();
    mockAppendContext.mockClear();

    // Advance past the 5-minute dedupe window
    vi.advanceTimersByTime(5 * 60_000 + 1);

    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'second', dedupeKey: 'key-2' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledTimes(1);
    const written = mockAppendContext.mock.calls[0][2] as string;
    expect(written).toContain('second');
  });

  it('does not deduplicate entries without dedupeKey', () => {
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'a' });
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'b' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledTimes(1);
    const written = mockAppendContext.mock.calls[0][2] as string;
    expect(written).toContain('a');
    expect(written).toContain('b');
  });

  it('deduplicates independently per key', () => {
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'alpha', dedupeKey: 'key-a' });
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'beta', dedupeKey: 'key-b' });
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'alpha-dup', dedupeKey: 'key-a' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledTimes(1);
    const written = mockAppendContext.mock.calls[0][2] as string;
    expect(written).toContain('alpha');
    expect(written).toContain('beta');
    expect(written).not.toContain('alpha-dup');
  });

  it('still within window at exactly 5 minutes, entry is dropped', () => {
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'first', dedupeKey: 'key-edge' });
    contextIntake.flush();
    mockAppendContext.mockClear();

    // Advance to just under 5 minutes (still within window)
    vi.advanceTimersByTime(5 * 60_000 - 1);

    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'still-deduped', dedupeKey: 'key-edge' });
    contextIntake.flush();
    expect(mockAppendContext).not.toHaveBeenCalled();
  });

  it('prunes old dedupe entries on flush', () => {
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'old', dedupeKey: 'prune-me' });
    contextIntake.flush();
    mockAppendContext.mockClear();

    // Advance well past the dedupe window
    vi.advanceTimersByTime(6 * 60_000);

    // Re-ingest same key — should succeed since old entry was pruned
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'new', dedupeKey: 'prune-me' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// Queue batching and grouping
// ═══════════════════════════════════════════════════════════════

describe('queue batching', () => {
  it('groups entries by file + section into single appendContext call', () => {
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'line 1' });
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'line 2' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledTimes(1);
    const written = mockAppendContext.mock.calls[0][2] as string;
    expect(written).toContain('line 1');
    expect(written).toContain('line 2');
  });

  it('creates separate groups for different sections', () => {
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'note' });
    contextIntake.ingest({ source: 'chat', section: '## Tasks', content: 'task' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledTimes(2);
    const calls = mockAppendContext.mock.calls;
    const sections = calls.map((c: any[]) => c[1]);
    expect(sections).toContain('## Notes');
    expect(sections).toContain('## Tasks');
  });

  it('creates separate groups for different files', () => {
    mockGetContextSize.mockReturnValue(100); // prevent auto-create
    contextIntake.ingest({ source: 'search', section: '## Data', content: 'search data' });
    contextIntake.ingest({ source: 'browse', section: '## Data', content: 'browse data' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledTimes(2);
    const files = mockAppendContext.mock.calls.map((c: any[]) => c[0]);
    expect(files).toContain('research.md');
    expect(files).toContain('browsing.md');
  });

  it('appends ctx source tag to each content line', () => {
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'tagged line' });
    contextIntake.flush();
    const written = mockAppendContext.mock.calls[0][2] as string;
    expect(written).toMatch(/tagged line <!-- ctx:chat t:\d+ -->/);
  });

  it('calls scheduleCompaction for each group after writing', () => {
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'a' });
    contextIntake.ingest({ source: 'chat', section: '## Tasks', content: 'b' });
    contextIntake.flush();
    expect(mockScheduleCompaction).toHaveBeenCalledTimes(2);
    expect(mockScheduleCompaction).toHaveBeenCalledWith('main.md');
  });
});

// ═══════════════════════════════════════════════════════════════
// flush()
// ═══════════════════════════════════════════════════════════════

describe('flush', () => {
  it('clears the queue after flushing', () => {
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'data' });
    contextIntake.flush();
    mockAppendContext.mockClear();
    // Second flush should be a no-op
    contextIntake.flush();
    expect(mockAppendContext).not.toHaveBeenCalled();
  });

  it('is a no-op when queue is empty', () => {
    contextIntake.flush();
    expect(mockAppendContext).not.toHaveBeenCalled();
    expect(mockScheduleCompaction).not.toHaveBeenCalled();
  });

  it('handles appendContext errors gracefully', () => {
    mockAppendContext.mockImplementationOnce(() => { throw new Error('write failed'); });
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'will fail' });
    // Should not throw
    expect(() => contextIntake.flush()).not.toThrow();
  });

  it('continues writing other groups when one fails', () => {
    mockAppendContext
      .mockImplementationOnce(() => { throw new Error('fail'); })
      .mockImplementationOnce(() => {});
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'fails' });
    contextIntake.ingest({ source: 'chat', section: '## Tasks', content: 'succeeds' });
    contextIntake.flush();
    expect(mockAppendContext).toHaveBeenCalledTimes(2);
  });

  it('is triggered automatically by the interval timer', () => {
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'auto-flushed' });
    // Advance past the 10s flush interval
    vi.advanceTimersByTime(10_000);
    expect(mockAppendContext).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// shutdown()
// ═══════════════════════════════════════════════════════════════

describe('shutdown', () => {
  it('flushes remaining entries on shutdown', () => {
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'last entry' });
    contextIntake.shutdown();
    expect(mockAppendContext).toHaveBeenCalledTimes(1);
    const written = mockAppendContext.mock.calls[0][2] as string;
    expect(written).toContain('last entry');
  });

  it('clears the interval timer', () => {
    contextIntake.shutdown();
    mockAppendContext.mockClear();
    // Advancing timer should not cause a flush since timer was cleared
    vi.advanceTimersByTime(20_000);
    expect(mockAppendContext).not.toHaveBeenCalled();
  });

  it('is safe to call multiple times', () => {
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'data' });
    contextIntake.shutdown();
    contextIntake.shutdown();
    // Should only flush once since queue is cleared after first shutdown
    expect(mockAppendContext).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// Content tagging format
// ═══════════════════════════════════════════════════════════════

describe('content tagging', () => {
  it('includes source in the ctx tag', () => {
    contextIntake.ingest({ source: 'browse', section: '## Pages', content: 'visited page' });
    contextIntake.flush();
    const written = mockAppendContext.mock.calls[0][2] as string;
    expect(written).toContain('ctx:browse');
  });

  it('includes timestamp in seconds in the tag', () => {
    const now = Date.now();
    const expectedTs = Math.floor(now / 1000);
    contextIntake.ingest({ source: 'feed', section: '## Articles', content: 'article' });
    contextIntake.flush();
    const written = mockAppendContext.mock.calls[0][2] as string;
    expect(written).toContain(`t:${expectedTs}`);
  });

  it('joins multiple lines with newline and ends with newline', () => {
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'line A' });
    contextIntake.ingest({ source: 'chat', section: '## Notes', content: 'line B' });
    contextIntake.flush();
    const written = mockAppendContext.mock.calls[0][2] as string;
    const lines = written.split('\n');
    // Should have line A tag, line B tag, trailing empty from final \n
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('line A');
    expect(lines[1]).toContain('line B');
    expect(lines[2]).toBe('');
  });
});
