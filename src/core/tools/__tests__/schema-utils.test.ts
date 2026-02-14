import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from '../schema-utils';

describe('zodToJsonSchema', () => {
  it('converts a simple object schema', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const result = zodToJsonSchema(schema);
    expect(result).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name', 'age'],
    });
  });

  it('handles optional fields', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    });
    const result = zodToJsonSchema(schema);
    expect(result.required).toEqual(['required']);
  });

  it('handles boolean fields', () => {
    const schema = z.object({ flag: z.boolean() });
    const result = zodToJsonSchema(schema);
    expect(result.properties).toEqual({ flag: { type: 'boolean' } });
  });

  it('handles enum fields', () => {
    const schema = z.object({ color: z.enum(['red', 'green', 'blue']) });
    const result = zodToJsonSchema(schema);
    expect((result.properties as any).color).toEqual({
      type: 'string',
      enum: ['red', 'green', 'blue'],
    });
  });

  it('handles array fields', () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const result = zodToJsonSchema(schema);
    expect((result.properties as any).tags).toEqual({
      type: 'array',
      items: { type: 'string' },
    });
  });
});
