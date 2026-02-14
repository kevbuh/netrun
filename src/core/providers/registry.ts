import type { LLMProvider } from './types.js';

/**
 * Provider registry. Manages available LLM providers.
 */
export class ProviderRegistry {
  private providers = new Map<string, LLMProvider>();
  private defaultName: string | null = null;

  /** Register a provider */
  register(provider: LLMProvider): void {
    this.providers.set(provider.name, provider);
    if (!this.defaultName) {
      this.defaultName = provider.name;
    }
  }

  /** Get a provider by name */
  get(name: string): LLMProvider | undefined {
    return this.providers.get(name);
  }

  /** Get the default provider */
  getDefault(): LLMProvider | undefined {
    if (!this.defaultName) return undefined;
    return this.providers.get(this.defaultName);
  }

  /** Set the default provider */
  setDefault(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`Provider "${name}" is not registered`);
    }
    this.defaultName = name;
  }

  /** List all provider names */
  names(): string[] {
    return [...this.providers.keys()];
  }
}

/** Singleton provider registry */
export const providerRegistry = new ProviderRegistry();
