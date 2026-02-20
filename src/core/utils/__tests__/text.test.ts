import { describe, it, expect } from 'vitest';
import { snapQuoteToText } from '../text.js';

describe('snapQuoteToText', () => {
  // ── Null / empty inputs ──

  it('returns null for empty quote', () => {
    expect(snapQuoteToText('', 'some text')).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(snapQuoteToText('hello world', '')).toBeNull();
  });

  it('returns null for both empty', () => {
    expect(snapQuoteToText('', '')).toBeNull();
  });

  it('returns null for null-ish inputs', () => {
    expect(snapQuoteToText(null as any, 'text')).toBeNull();
    expect(snapQuoteToText('quote', null as any)).toBeNull();
  });

  // ── Exact match ──

  it('finds exact match (same case)', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    const quote = 'quick brown fox';
    expect(snapQuoteToText(quote, text)).toBe('quick brown fox');
  });

  it('finds exact match (case-insensitive)', () => {
    const text = 'The Quick Brown Fox jumps over the lazy dog.';
    const quote = 'quick brown fox';
    expect(snapQuoteToText(quote, text)).toBe('Quick Brown Fox');
  });

  it('preserves original casing from text', () => {
    const text = 'This is a Test Sentence with Mixed Case.';
    const quote = 'test sentence with mixed';
    expect(snapQuoteToText(quote, text)).toBe('Test Sentence with Mixed');
  });

  // ── Whitespace-normalized match ──

  it('matches when quote has extra spaces', () => {
    const text = 'The quick brown fox jumps over the lazy dog in the park.';
    const quote = 'quick  brown   fox  jumps  over';
    const result = snapQuoteToText(quote, text);
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toContain('quick');
    expect(result!.toLowerCase()).toContain('brown');
  });

  it('matches when text has extra whitespace', () => {
    const text = 'The  quick\n  brown  fox\njumps over the lazy dog in the park today.';
    const quote = 'quick brown fox jumps over';
    const result = snapQuoteToText(quote, text);
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toContain('quick');
  });

  // ── Progressive prefix trimming ──

  it('matches with trailing words changed', () => {
    const text = 'Machine learning models have shown remarkable progress in natural language processing tasks.';
    const quote = 'machine learning models have shown remarkable progress in natural';
    const result = snapQuoteToText(quote, text);
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toContain('machine learning');
  });

  // ── Word-level contiguous subsequence ──

  it('matches with some words missing', () => {
    const text = 'The neural network architecture consists of multiple transformer layers with attention mechanisms.';
    const quote = 'neural network consists of multiple transformer layers with attention';
    const result = snapQuoteToText(quote, text);
    expect(result).not.toBeNull();
  });

  // ── No match cases ──

  it('returns null for completely different text', () => {
    const text = 'The weather is sunny today with clear skies and warm temperatures.';
    const quote = 'quantum computing advances in molecular simulation';
    expect(snapQuoteToText(quote, text)).toBeNull();
  });

  it('returns null for too-short potential matches', () => {
    // If the match candidate would be < 15 chars, it returns null
    const text = 'Short text here.';
    const quote = 'hi there';
    expect(snapQuoteToText(quote, text)).toBeNull();
  });

  // ── Bigram fuzzy match ──

  it('handles fuzzy matching with similar content', () => {
    const text = 'Deep reinforcement learning has been successfully applied to game playing and robotics control tasks with impressive results.';
    const quote = 'Deep reinforcement learning has been applied to game playing and robotics control tasks with results';
    const result = snapQuoteToText(quote, text);
    // The algorithm should find a match somewhere in the text
    expect(result).not.toBeNull();
    // The matched region should overlap with the quote content
    expect(result!.toLowerCase()).toMatch(/game playing|reinforcement|robotics/);
  });

  // ── Edge cases ──

  it('handles very long text', () => {
    const longText = Array(100).fill('Lorem ipsum dolor sit amet, consectetur adipiscing elit.').join(' ');
    const quote = 'consectetur adipiscing elit';
    const result = snapQuoteToText(quote, longText);
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toContain('consectetur');
  });

  it('handles quote that is entire text', () => {
    const text = 'This is the complete text content.';
    expect(snapQuoteToText(text, text)).toBe(text);
  });

  it('handles single-word quotes (< 3 words returns null in prefix trim)', () => {
    const text = 'Hello world this is a test sentence with some content inside.';
    const quote = 'hello';
    // Exact match should still work for single word
    const result = snapQuoteToText(quote, text);
    expect(result).toBe('Hello');
  });

  it('handles quote at start of text', () => {
    const text = 'Machine learning is transforming the world of technology and science.';
    const quote = 'Machine learning is transforming';
    expect(snapQuoteToText(quote, text)).toBe('Machine learning is transforming');
  });

  it('handles quote at end of text', () => {
    const text = 'The field of machine learning is transforming technology and science.';
    const quote = 'technology and science.';
    expect(snapQuoteToText(quote, text)).toBe('technology and science.');
  });
});
