/**
 * Test setup file for Vitest
 * Mocks common browser APIs and global dependencies
 */

import { beforeEach, vi } from 'vitest';

// Mock localStorage
const createLocalStorageMock = () => {
  let store = {};
  return {
    getItem: vi.fn((key) => store[key] || null),
    setItem: vi.fn((key, value) => { store[key] = String(value); }),
    removeItem: vi.fn((key) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    get length() { return Object.keys(store).length; },
    key: vi.fn((index) => Object.keys(store)[index] || null),
    _store: store  // For test inspection
  };
};

// Reset mocks before each test
beforeEach(() => {
  // Clear all mocks
  vi.clearAllMocks();

  // Reset global.localStorage
  global.localStorage = createLocalStorageMock();

  // Mock fetch if needed
  global.fetch = vi.fn();

  // Mock requestAnimationFrame
  global.requestAnimationFrame = vi.fn((cb) => setTimeout(cb, 16));
  global.cancelAnimationFrame = vi.fn((id) => clearTimeout(id));
});

// Export helpers for tests
export { createLocalStorageMock };
