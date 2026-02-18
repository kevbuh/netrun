import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getStorageItem,
  setStorageItem,
  removeStorageItem,
  getStorageSet,
  setStorageSet,
  addToStorageSet,
  removeFromStorageSet,
  hasInStorageSet,
  getStorageObject,
  mergeStorageObject,
  deleteFromStorageObject
} from './storage.js';

describe('Storage Utilities', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('getStorageItem / setStorageItem', () => {
    it('should store and retrieve a value', () => {
      setStorageItem('testKey', { foo: 'bar' });
      expect(getStorageItem('testKey')).toEqual({ foo: 'bar' });
    });

    it('should return default value if key does not exist', () => {
      expect(getStorageItem('nonexistent', 'default')).toBe('default');
    });

    it('should handle primitive values', () => {
      setStorageItem('string', 'hello');
      setStorageItem('number', 42);
      setStorageItem('boolean', true);

      expect(getStorageItem('string')).toBe('hello');
      expect(getStorageItem('number')).toBe(42);
      expect(getStorageItem('boolean')).toBe(true);
    });

    it('should handle arrays', () => {
      const arr = [1, 2, 3, 'four'];
      setStorageItem('array', arr);
      expect(getStorageItem('array')).toEqual(arr);
    });

    it('should handle nested objects', () => {
      const obj = { a: { b: { c: 123 } } };
      setStorageItem('nested', obj);
      expect(getStorageItem('nested')).toEqual(obj);
    });

    it('should return default value if JSON parsing fails', () => {
      // Manually insert invalid JSON
      localStorage.setItem('invalid', '{broken json}');
      const result = getStorageItem('invalid', 'fallback');
      expect(result).toBe('fallback');
    });
  });

  describe('removeStorageItem', () => {
    it('should remove an item', () => {
      setStorageItem('temp', 'value');
      expect(getStorageItem('temp')).toBe('value');

      removeStorageItem('temp');
      expect(getStorageItem('temp', null)).toBe(null);
    });
  });

  describe('Set operations', () => {
    it('should store and retrieve a Set', () => {
      const set = new Set(['a', 'b', 'c']);
      setStorageSet('testSet', set);

      const retrieved = getStorageSet('testSet');
      expect(retrieved).toBeInstanceOf(Set);
      expect(retrieved.size).toBe(3);
      expect(retrieved.has('a')).toBe(true);
      expect(retrieved.has('b')).toBe(true);
      expect(retrieved.has('c')).toBe(true);
    });

    it('should return empty Set if key does not exist', () => {
      const set = getStorageSet('nonexistent');
      expect(set).toBeInstanceOf(Set);
      expect(set.size).toBe(0);
    });

    it('should add to a Set', () => {
      addToStorageSet('testSet', 'item1');
      addToStorageSet('testSet', 'item2');
      addToStorageSet('testSet', 'item1'); // Duplicate

      const set = getStorageSet('testSet');
      expect(set.size).toBe(2);
      expect(set.has('item1')).toBe(true);
      expect(set.has('item2')).toBe(true);
    });

    it('should remove from a Set', () => {
      setStorageSet('testSet', new Set(['a', 'b', 'c']));

      removeFromStorageSet('testSet', 'b');

      const set = getStorageSet('testSet');
      expect(set.size).toBe(2);
      expect(set.has('a')).toBe(true);
      expect(set.has('b')).toBe(false);
      expect(set.has('c')).toBe(true);
    });

    it('should check if value exists in Set', () => {
      setStorageSet('testSet', new Set(['x', 'y']));

      expect(hasInStorageSet('testSet', 'x')).toBe(true);
      expect(hasInStorageSet('testSet', 'z')).toBe(false);
    });

    it('should handle corrupt Set data gracefully', () => {
      localStorage.setItem('badSet', JSON.stringify('not an array'));
      const set = getStorageSet('badSet');
      expect(set).toBeInstanceOf(Set);
      expect(set.size).toBe(0);
    });
  });

  describe('Object operations', () => {
    it('should store and retrieve an object', () => {
      const obj = { key1: 'value1', key2: 'value2' };
      setStorageItem('testObj', obj);

      const retrieved = getStorageObject('testObj');
      expect(retrieved).toEqual(obj);
    });

    it('should return default object if key does not exist', () => {
      expect(getStorageObject('nonexistent')).toEqual({});
      expect(getStorageObject('nonexistent', { default: true })).toEqual({ default: true });
    });

    it('should merge updates into an object', () => {
      setStorageItem('testObj', { a: 1, b: 2 });
      mergeStorageObject('testObj', { b: 3, c: 4 });

      expect(getStorageObject('testObj')).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('should merge into empty object if key does not exist', () => {
      mergeStorageObject('newObj', { foo: 'bar' });
      expect(getStorageObject('newObj')).toEqual({ foo: 'bar' });
    });

    it('should delete a key from an object', () => {
      setStorageItem('testObj', { a: 1, b: 2, c: 3 });
      deleteFromStorageObject('testObj', 'b');

      expect(getStorageObject('testObj')).toEqual({ a: 1, c: 3 });
    });

    it('should handle non-object values gracefully', () => {
      localStorage.setItem('notAnObject', JSON.stringify([1, 2, 3]));
      expect(getStorageObject('notAnObject')).toEqual({});
    });
  });

  describe('Error handling', () => {
    it('should handle localStorage quota errors', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Mock setItem to throw quota error
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = vi.fn(() => {
        throw new Error('QuotaExceededError');
      });

      setStorageItem('key', 'value');

      expect(consoleError).toHaveBeenCalled();

      // Restore
      localStorage.setItem = originalSetItem;
      consoleError.mockRestore();
    });

    it('should log warning on parse errors', () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      localStorage.setItem('badJson', 'not json at all');
      getStorageItem('badJson', 'default');

      expect(consoleWarn).toHaveBeenCalled();
      consoleWarn.mockRestore();
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle saved posts workflow', () => {
      // Add posts to saved set
      addToStorageSet('savedPosts', 'https://example.com/post1');
      addToStorageSet('savedPosts', 'https://example.com/post2');

      // Check if post is saved
      expect(hasInStorageSet('savedPosts', 'https://example.com/post1')).toBe(true);
      expect(hasInStorageSet('savedPosts', 'https://example.com/post3')).toBe(false);

      // Remove a post
      removeFromStorageSet('savedPosts', 'https://example.com/post1');
      expect(hasInStorageSet('savedPosts', 'https://example.com/post1')).toBe(false);

      // Get all saved posts
      const saved = getStorageSet('savedPosts');
      expect(Array.from(saved)).toEqual(['https://example.com/post2']);
    });

    it('should handle user preferences workflow', () => {
      // Set initial preferences
      setStorageItem('userPrefs', {
        theme: 'dark',
        notifications: true
      });

      // Update specific preferences
      mergeStorageObject('userPrefs', {
        notifications: false,
        fontSize: 16
      });

      // Check final state
      expect(getStorageObject('userPrefs')).toEqual({
        theme: 'dark',
        notifications: false,
        fontSize: 16
      });

      // Delete a preference
      deleteFromStorageObject('userPrefs', 'fontSize');
      expect(getStorageObject('userPrefs')).toEqual({
        theme: 'dark',
        notifications: false
      });
    });

  });
});
