import type { AgentDefinition } from './types.js';

/**
 * Central agent registry. All agents register here on startup.
 * Mirrors the ToolRegistry pattern.
 */
export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();

  /** Register an agent. Throws if id is already taken. */
  register(agent: AgentDefinition): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent "${agent.id}" is already registered`);
    }
    this.agents.set(agent.id, agent);
  }

  /** Get an agent by id */
  get(id: string): AgentDefinition | undefined {
    return this.agents.get(id);
  }

  /** Get all registered agents */
  all(): AgentDefinition[] {
    return [...this.agents.values()];
  }

  /** Get all registered agent ids */
  names(): string[] {
    return [...this.agents.keys()];
  }

  /** Lightweight list for IPC (no functions) */
  list(): Array<{ id: string; name: string; description: string }> {
    return this.all().map(a => ({
      id: a.id,
      name: a.name,
      description: a.description,
    }));
  }
}

/** Singleton registry */
export const agentRegistry = new AgentRegistry();
