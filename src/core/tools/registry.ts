import { zodToJsonSchema } from './schema-utils.js';
import type { Tool, ToolAccess, ToolDefinition, ToolContext, ToolResult } from './types.js';

/** Middleware function that wraps tool execution */
export type ToolMiddleware = (
  tool: Tool,
  input: unknown,
  context: ToolContext,
  next: () => Promise<ToolResult>,
) => Promise<ToolResult>;

/**
 * Central tool registry. All tools register here on startup.
 * Supports lookup by name, category, and access level.
 * Supports middleware pipeline for cross-cutting concerns.
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private middlewares: ToolMiddleware[] = [];

  /** Register a tool. Throws if name is already taken. */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /** Register a middleware. Middleware run in registration order (first registered = outermost). */
  use(mw: ToolMiddleware): void {
    this.middlewares.push(mw);
  }

  /** Get a tool by name */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** Get all tools in a category */
  getByCategory(category: string): Tool[] {
    return [...this.tools.values()].filter(t => t.category === category);
  }

  /** Get all tools accessible at a given level */
  getByAccess(access: ToolAccess): Tool[] {
    return [...this.tools.values()].filter(t => t.access.includes(access));
  }

  /** Get all registered tool names */
  names(): string[] {
    return [...this.tools.keys()];
  }

  /** Get all registered tools */
  all(): Tool[] {
    return [...this.tools.values()];
  }

  /** Get unique categories */
  categories(): string[] {
    const cats = new Set<string>();
    for (const tool of this.tools.values()) {
      cats.add(tool.category);
    }
    return [...cats];
  }

  /** Execute a tool by name, running it through the middleware chain */
  async execute(name: string, input: unknown, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Unknown tool: ${name}` };
    }
    const parsed = tool.parameters.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: `Invalid input: ${parsed.error.message}` };
    }

    // Build middleware chain: outermost middleware is called first
    const coreExecute = () => tool.execute(parsed.data, context);
    const chain = this.middlewares.reduceRight<() => Promise<ToolResult>>(
      (next, mw) => () => mw(tool, parsed.data, context, next),
      coreExecute,
    );

    try {
      return await chain();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /** Convert all agent-accessible tools to LLM tool definitions */
  toToolDefinitions(access: ToolAccess = 'agent'): ToolDefinition[] {
    return this.getByAccess(access).map(tool => {
      const schema = zodToJsonSchema(tool.parameters);
      return {
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'object' as const,
            properties: (schema.properties ?? {}) as Record<string, unknown>,
            required: schema.required as string[] | undefined,
          },
        },
      };
    });
  }
}

/** Singleton registry */
export const toolRegistry = new ToolRegistry();
