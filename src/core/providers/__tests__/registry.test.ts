import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from '../registry';
import type { LLMProvider } from '../types';

function makeProvider(name: string): LLMProvider {
  return {
    name,
    chat: async () => ({ message: { role: 'assistant', content: 'hi' } }),
    chatStream: async function* () { yield { type: 'done' as const }; },
    listModels: async () => ['model-1'],
  };
}

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it('registers and retrieves a provider', () => {
    const p = makeProvider('ollama');
    registry.register(p);
    expect(registry.get('ollama')).toBe(p);
  });

  it('sets first registered as default', () => {
    registry.register(makeProvider('ollama'));
    registry.register(makeProvider('openai'));
    expect(registry.getDefault()?.name).toBe('ollama');
  });

  it('allows changing default', () => {
    registry.register(makeProvider('ollama'));
    registry.register(makeProvider('openai'));
    registry.setDefault('openai');
    expect(registry.getDefault()?.name).toBe('openai');
  });

  it('throws when setting unknown default', () => {
    expect(() => registry.setDefault('nonexistent')).toThrow('not registered');
  });

  it('lists all provider names', () => {
    registry.register(makeProvider('a'));
    registry.register(makeProvider('b'));
    expect(registry.names()).toEqual(['a', 'b']);
  });

  it('returns undefined for no default', () => {
    expect(registry.getDefault()).toBeUndefined();
  });
});
