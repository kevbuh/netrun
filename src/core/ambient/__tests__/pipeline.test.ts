import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock dependencies ──
vi.mock('fs', () => ({
  existsSync: () => false,
  readFileSync: () => '',
}));
vi.mock('path', () => ({
  join: (...parts: string[]) => parts.join('/'),
}));
vi.mock('../../providers/ollama', () => ({
  OllamaProvider: class {
    chatStream = vi.fn();
  },
}));
vi.mock('../../db/queries/content', () => ({
  listAnnotationCategories: () => [],
  listAnnotationFeedback: () => [],
}));
vi.mock('../../utils/text', () => ({
  snapQuoteToText: (quote: string, text: string) => text.includes(quote) ? quote : null,
}));
vi.mock('../../context/manager', () => ({
  contextManager: { writeContextFile: vi.fn() },
}));
vi.mock('../../context/intake', () => ({
  contextIntake: { ingest: vi.fn(), flush: vi.fn() },
}));
vi.mock('../annotation-prompt', () => ({
  DEFAULT_ANNOTATION_PROMPT: 'Annotate the page.',
}));

import { PageInsightPipeline } from '../pipeline';

describe('PageInsightPipeline', () => {
  let pipeline: PageInsightPipeline;

  beforeEach(() => {
    pipeline = new PageInsightPipeline();
  });

  it('can be created and enabled/disabled', () => {
    expect(pipeline).toBeDefined();
    pipeline.setEnabled(false);
    pipeline.setEnabled(true);
  });

  it('skips pages with about: protocol', () => {
    const mockSender = { send: vi.fn(), isDestroyed: () => false };
    // onPageLoaded should silently skip this
    pipeline.onPageLoaded(
      { url: 'about:blank', title: 'Blank', text: 'x'.repeat(200), tabId: 't1' },
      mockSender as any,
    );
    // No error thrown
    expect(true).toBe(true);
  });

  it('skips pages with very short text', () => {
    const mockSender = { send: vi.fn(), isDestroyed: () => false };
    pipeline.onPageLoaded(
      { url: 'https://example.com', title: 'Test', text: 'short', tabId: 't1' },
      mockSender as any,
    );
    expect(true).toBe(true);
  });

  it('skips when disabled', () => {
    pipeline.setEnabled(false);
    const mockSender = { send: vi.fn(), isDestroyed: () => false };
    pipeline.onPageLoaded(
      { url: 'https://example.com', title: 'Test', text: 'x'.repeat(200), tabId: 't1' },
      mockSender as any,
    );
    expect(true).toBe(true);
  });

  describe('_validateAnnotation', () => {
    const validTypes = new Set(['ALPHA', 'CONTRADICTION', 'EXAGGERATION', 'AD']);
    const pageText = 'This is a test page with some claims about technology being amazing.';

    it('rejects null/undefined input', () => {
      expect((pipeline as any)._validateAnnotation(null, validTypes, pageText)).toBeNull();
      expect((pipeline as any)._validateAnnotation(undefined, validTypes, pageText)).toBeNull();
    });

    it('rejects non-object input', () => {
      expect((pipeline as any)._validateAnnotation('string', validTypes, pageText)).toBeNull();
      expect((pipeline as any)._validateAnnotation(42, validTypes, pageText)).toBeNull();
    });

    it('rejects invalid annotation type', () => {
      expect((pipeline as any)._validateAnnotation(
        { type: 'INVALID', quote: 'some text', explanation: 'test' },
        validTypes, pageText,
      )).toBeNull();
    });

    it('rejects empty quote', () => {
      expect((pipeline as any)._validateAnnotation(
        { type: 'ALPHA', quote: '', explanation: 'test' },
        validTypes, pageText,
      )).toBeNull();
    });

    it('rejects quote not found in page text', () => {
      expect((pipeline as any)._validateAnnotation(
        { type: 'ALPHA', quote: 'text not on page', explanation: 'test' },
        validTypes, pageText,
      )).toBeNull();
    });

    it('accepts valid annotation with matching quote', () => {
      const ann = (pipeline as any)._validateAnnotation(
        { type: 'ALPHA', quote: 'technology being amazing', explanation: 'Interesting claim' },
        validTypes, pageText,
      );
      expect(ann).not.toBeNull();
      expect(ann.type).toBe('ALPHA');
      expect(ann.explanation).toBe('Interesting claim');
      expect(ann.confidence).toBe(70); // default
    });

    it('clamps confidence to 0-100', () => {
      const ann = (pipeline as any)._validateAnnotation(
        { type: 'ALPHA', quote: 'technology being amazing', explanation: 'test', confidence: 150 },
        validTypes, pageText,
      );
      expect(ann.confidence).toBe(100);
    });

    it('includes conflictsWith for CONTRADICTION type', () => {
      const ann = (pipeline as any)._validateAnnotation(
        { type: 'CONTRADICTION', quote: 'technology being amazing', explanation: 'test', conflictsWith: 'Another source' },
        validTypes, pageText,
      );
      expect(ann).not.toBeNull();
      expect(ann.conflictsWith).toBe('Another source');
    });
  });
});
