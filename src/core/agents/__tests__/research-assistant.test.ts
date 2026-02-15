import { describe, it, expect } from 'vitest';
import { researchAssistant } from '../builtin/research-assistant';

describe('research-assistant agent', () => {
  it('has correct metadata', () => {
    expect(researchAssistant.id).toBe('research-assistant');
    expect(researchAssistant.tools).toContain('web-search');
    expect(researchAssistant.tools).toContain('browser-click');
    expect(researchAssistant.tools).toContain('navigate');
  });

  it('builds system prompt with document + tools', () => {
    const prompt = researchAssistant.buildSystemPrompt({
      documentText: 'Some paper content here',
      pageUrl: 'https://arxiv.org/abs/1234',
      pageTitle: 'Test Paper',
      toolsEnabled: true,
    });

    expect(prompt).toContain('CURRENT DATE AND TIME');
    expect(prompt).toContain('AI assistant inside Aether');
    expect(prompt).toContain('MUST actually call the tools');
    expect(prompt).toContain('--- DOCUMENT TEXT ---');
    expect(prompt).toContain('Some paper content here');
    expect(prompt).toContain('Test Paper');
    expect(prompt).toContain('arxiv.org');
    expect(prompt).toContain('browser automation tools');
  });

  it('builds system prompt without document + with tools', () => {
    const prompt = researchAssistant.buildSystemPrompt({
      toolsEnabled: true,
    });

    expect(prompt).toContain('CURRENT DATE AND TIME');
    expect(prompt).toContain('AI assistant inside Aether');
    expect(prompt).toContain('web-search');
    expect(prompt).not.toContain('--- DOCUMENT TEXT ---');
  });

  it('builds system prompt with document + no tools', () => {
    const prompt = researchAssistant.buildSystemPrompt({
      documentText: 'Paper content',
      toolsEnabled: false,
    });

    expect(prompt).toContain('helpful research assistant');
    expect(prompt).toContain('based ONLY on the document text');
    expect(prompt).toContain('Paper content');
    expect(prompt).not.toContain('browser');
  });

  it('builds minimal system prompt without document or tools', () => {
    const prompt = researchAssistant.buildSystemPrompt({
      toolsEnabled: false,
    });

    expect(prompt).toContain('helpful assistant');
    expect(prompt).not.toContain('DOCUMENT TEXT');
    expect(prompt).not.toContain('browser');
  });

  it('adjusts browser tools description when DOM is present', () => {
    const prompt = researchAssistant.buildSystemPrompt({
      documentText: 'text',
      browserDom: '[1] button Submit\n[2] input text',
      toolsEnabled: true,
    });

    expect(prompt).toContain('Do NOT call browser-read-page');
    expect(prompt).not.toContain('browser-read-page (read current page DOM)');
  });

  it('includes browser-read-page when no DOM in context', () => {
    const prompt = researchAssistant.buildSystemPrompt({
      documentText: 'text',
      toolsEnabled: true,
    });

    expect(prompt).toContain('browser-read-page (read current page DOM)');
  });

  it('truncates long document text', () => {
    // Use a small-context model to test truncation
    const longDoc = 'x'.repeat(20000);
    const prompt = researchAssistant.buildSystemPrompt({
      documentText: longDoc,
      toolsEnabled: true,
      model: 'llama3:8b', // 8000 token context → ~10666 char doc limit
    });

    // Should be truncated based on model context budget (~40% of 8000 tokens / 0.3 ≈ 10666 chars)
    const docSection = prompt.split('--- DOCUMENT TEXT ---')[1]?.split('--- END ---')[0] ?? '';
    const trimmed = docSection.trim();
    expect(trimmed.length).toBeLessThanOrEqual(11000);
    expect(trimmed.length).toBeLessThan(20000);
  });
});
