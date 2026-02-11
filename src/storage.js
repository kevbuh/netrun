/**
 * Storage utilities - localStorage wrappers with type safety and defaults
 */

/**
 * Get an item from localStorage with a default value
 * @template T
 * @param {string} key
 * @param {T} defaultValue
 * @returns {T}
 */
export function getStorageItem(key, defaultValue) {
  try {
    const item = localStorage.getItem(key);
    return item !== null ? JSON.parse(item) : defaultValue;
  } catch (e) {
    console.warn(`Failed to parse localStorage key "${key}":`, e);
    return defaultValue;
  }
}

/**
 * Set an item in localStorage
 * @param {string} key
 * @param {any} value
 */
export function setStorageItem(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`Failed to set localStorage key "${key}":`, e);
  }
}

/**
 * Remove an item from localStorage
 * @param {string} key
 */
export function removeStorageItem(key) {
  localStorage.removeItem(key);
}

/**
 * Get a Set from localStorage
 * @param {string} key
 * @returns {Set<string>}
 */
export function getStorageSet(key) {
  const arr = getStorageItem(key, []);
  return new Set(Array.isArray(arr) ? arr : []);
}

/**
 * Save a Set to localStorage
 * @param {string} key
 * @param {Set<string>} set
 */
export function setStorageSet(key, set) {
  setStorageItem(key, Array.from(set));
}

/**
 * Add item to a Set in localStorage
 * @param {string} key
 * @param {string} value
 */
export function addToStorageSet(key, value) {
  const set = getStorageSet(key);
  set.add(value);
  setStorageSet(key, set);
}

/**
 * Remove item from a Set in localStorage
 * @param {string} key
 * @param {string} value
 */
export function removeFromStorageSet(key, value) {
  const set = getStorageSet(key);
  set.delete(value);
  setStorageSet(key, set);
}

/**
 * Check if a value exists in a storage Set
 * @param {string} key
 * @param {string} value
 * @returns {boolean}
 */
export function hasInStorageSet(key, value) {
  const set = getStorageSet(key);
  return set.has(value);
}

/**
 * Get an object/map from localStorage
 * @param {string} key
 * @param {Object} defaultValue
 * @returns {Object}
 */
export function getStorageObject(key, defaultValue = {}) {
  const val = getStorageItem(key, defaultValue);
  return typeof val === 'object' && val !== null && !Array.isArray(val) ? val : defaultValue;
}

/**
 * Merge values into a storage object
 * @param {string} key
 * @param {Object} updates
 */
export function mergeStorageObject(key, updates) {
  const current = getStorageObject(key);
  setStorageItem(key, { ...current, ...updates });
}

/**
 * Delete a key from a storage object
 * @param {string} key
 * @param {string} objectKey
 */
export function deleteFromStorageObject(key, objectKey) {
  const obj = getStorageObject(key);
  delete obj[objectKey];
  setStorageItem(key, obj);
}
