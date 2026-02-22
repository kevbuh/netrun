import { describe, it, expect } from 'vitest';
import { generateChatMemoryId, extractSummary, buildDocChatSystemPrompt } from '../chat.js';

describe('generateChatMemoryId', () => {
  it('returns a string with dash separator', () => {
    const id = generateChatMemoryId();
    expect(typeof id).toBe('string');
    expect(id).toContain('-');
  });

  it('has base-36 timestamp prefix', () => {
    const id = generateChatMemoryId();
    const [timestamp] = id.split('-');
    const parsed = parseInt(timestamp, 36);
    expect(parsed).toBeGreaterThan(0);
    // Should be roughly current time
    expect(parsed).toBeLessThanOrEqual(Date.now());
    expect(parsed).toBeGreaterThan(Date.now() - 10000);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateChatMemoryId()));
    expect(ids.size).toBe(20);
  });

  it('has random suffix after dash', () => {
    const id = generateChatMemoryId();
    const [, suffix] = id.split('-');
    expect(suffix.length).toBeGreaterThanOrEqual(2);
    expect(suffix.length).toBeLessThanOrEqual(8);
  });
});

describe('extractSummary', () => {
  it('extracts user message content', () => {
    const messages = [
      { role: 'user', content: 'Hello world' },
      { role: 'assistant', content: 'Hi there' },
    ];
    expect(extractSummary(messages)).toBe('Hello world');
  });

  it('joins multiple user messages with semicolons', () => {
    const messages = [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'Answer 1' },
      { role: 'user', content: 'Second question' },
    ];
    expect(extractSummary(messages)).toBe('First question; Second question');
  });

  it('truncates individual messages to 100 chars', () => {
    const longContent = 'a'.repeat(150);
    const messages = [{ role: 'user', content: longContent }];
    const result = extractSummary(messages);
    expect(result.length).toBe(100);
  });

  it('truncates total summary to 300 chars', () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: 'user',
      content: 'x'.repeat(80) + i,
    }));
    const result = extractSummary(messages);
    expect(result.length).toBe(300);
  });

  it('filters out non-user messages', () => {
    const messages = [
      { role: 'system', content: 'System prompt' },
      { role: 'assistant', content: 'Bot response' },
    ];
    expect(extractSummary(messages)).toBe('');
  });

  it('handles empty messages array', () => {
    expect(extractSummary([])).toBe('');
  });

  it('handles messages with empty content', () => {
    const messages = [{ role: 'user', content: '' }];
    expect(extractSummary(messages)).toBe('');
  });
});

describe('buildDocChatSystemPrompt', () => {
  it('includes date/time string', () => {
    const result = buildDocChatSystemPrompt({});
    expect(result).toContain('CURRENT DATE AND TIME:');
  });

  it('includes document context when provided', () => {
    const result = buildDocChatSystemPrompt({ context: 'Some document text' });
    expect(result).toContain('--- DOCUMENT TEXT ---');
    expect(result).toContain('Some document text');
    expect(result).toContain('--- END ---');
  });

  it('uses research assistant prompt without tools', () => {
    const result = buildDocChatSystemPrompt({ context: 'Doc text' });
    expect(result).toContain('helpful research assistant');
    expect(result).toContain('Answer based ONLY on the document text');
  });

  it('uses Netrun assistant prompt with tools', () => {
    const result = buildDocChatSystemPrompt({ context: 'Doc text', toolsEnabled: true });
    expect(result).toContain('AI assistant inside Netrun');
    expect(result).toContain('Answer based on the document text');
  });

  it('uses generic prompt without context and without tools', () => {
    const result = buildDocChatSystemPrompt({});
    expect(result).toContain('helpful assistant');
    expect(result).not.toContain('DOCUMENT TEXT');
  });

  it('uses Netrun prompt without context but with tools', () => {
    const result = buildDocChatSystemPrompt({ toolsEnabled: true });
    expect(result).toContain('AI assistant inside Netrun');
    expect(result).not.toContain('DOCUMENT TEXT');
  });

  it('appends /no_think when think is false', () => {
    const result = buildDocChatSystemPrompt({ think: false });
    expect(result).toContain('/no_think');
  });

  it('does not append /no_think when think is true', () => {
    const result = buildDocChatSystemPrompt({ think: true });
    expect(result).not.toContain('/no_think');
  });

  it('does not append /no_think by default', () => {
    const result = buildDocChatSystemPrompt({});
    expect(result).not.toContain('/no_think');
  });

  it('truncates context to 12000 chars', () => {
    const longContext = 'z'.repeat(15000);
    const result = buildDocChatSystemPrompt({ context: longContext });
    // The context in the prompt should be truncated
    expect(result).toContain('z'.repeat(12000));
    expect(result).not.toContain('z'.repeat(12001));
  });
});
