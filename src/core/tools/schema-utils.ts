import type { z } from 'zod';

/**
 * Convert a Zod schema to a JSON Schema object suitable for LLM tool definitions.
 * Handles the common cases: objects with string/number/boolean/array/enum fields.
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // Use zod's built-in JSON schema generation if available
  if ('_def' in schema) {
    const def = (schema as any)._def;

    if (def.typeName === 'ZodObject') {
      const shape = def.shape();
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        const fieldSchema = value as z.ZodType;
        properties[key] = zodToJsonSchema(fieldSchema);
        // Check if field is required (not optional)
        if (!isOptional(fieldSchema)) {
          required.push(key);
        }
      }

      const result: Record<string, unknown> = { type: 'object', properties };
      if (required.length > 0) {
        result.required = required;
      }
      return result;
    }

    if (def.typeName === 'ZodString') {
      const result: Record<string, unknown> = { type: 'string' };
      if (def.description) result.description = def.description;
      return result;
    }

    if (def.typeName === 'ZodNumber') {
      const result: Record<string, unknown> = { type: 'number' };
      if (def.description) result.description = def.description;
      return result;
    }

    if (def.typeName === 'ZodBoolean') {
      return { type: 'boolean' };
    }

    if (def.typeName === 'ZodArray') {
      return { type: 'array', items: zodToJsonSchema(def.type) };
    }

    if (def.typeName === 'ZodEnum') {
      return { type: 'string', enum: def.values };
    }

    if (def.typeName === 'ZodOptional') {
      return zodToJsonSchema(def.innerType);
    }

    if (def.typeName === 'ZodDefault') {
      const inner = zodToJsonSchema(def.innerType);
      return { ...inner, default: def.defaultValue() };
    }

    // ZodEffects (transforms, refinements) - unwrap
    if (def.typeName === 'ZodEffects') {
      return zodToJsonSchema(def.schema);
    }
  }

  // Fallback
  return { type: 'string' };
}

function isOptional(schema: z.ZodType): boolean {
  const def = (schema as any)._def;
  return def?.typeName === 'ZodOptional' || def?.typeName === 'ZodDefault';
}
