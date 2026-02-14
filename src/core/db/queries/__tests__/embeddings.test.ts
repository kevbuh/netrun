import { describe, it, expect } from 'vitest';
import {
  embeddingHash,
  packEmbedding,
  unpackEmbedding,
  cosineSimilarity,
} from '../embeddings';

describe('embedding utilities', () => {
  it('generates consistent hashes', () => {
    expect(embeddingHash('hello')).toBe(embeddingHash('hello'));
    expect(embeddingHash('hello')).not.toBe(embeddingHash('world'));
    expect(embeddingHash('hello').length).toBe(20);
  });

  it('packs and unpacks embeddings', () => {
    const vec = [0.1, 0.2, 0.3, -0.5, 1.0];
    const packed = packEmbedding(vec);
    expect(packed.length).toBe(vec.length * 4);
    const unpacked = unpackEmbedding(packed, vec.length);
    for (let i = 0; i < vec.length; i++) {
      expect(unpacked[i]).toBeCloseTo(vec[i], 5);
    }
  });

  it('computes cosine similarity correctly', () => {
    // Same vector → 1.0
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1.0);

    // Orthogonal → 0.0
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);

    // Opposite → -1.0
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);

    // Angled
    expect(cosineSimilarity([1, 1], [1, 0])).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('handles zero vectors', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });
});
