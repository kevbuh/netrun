/**
 * Utility functions - testable, pure functions
 * These can be extracted from existing code and unit tested
 */

/**
 * Extract significant words from a title (filter stop words, min length)
 * @param {string} title - The title to process
 * @param {number} minLength - Minimum word length (default 3)
 * @returns {string[]} Array of significant words
 */
export function extractSignificantWords(title, minLength = 3) {
  const STOP_WORDS = new Set([
    'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
    'from','is','it','as','be','was','are','this','that','which','what','how',
    'has','had','have','not','no','do','does','did','will','would','can','could',
    'should','may','might','its','they','their','them','we','our','you','your',
    'he','she','his','her','i','my','me','new','than','more','most','also','just',
    'about','into','over','after','before','between','under','using','via','all',
    'been','being','each','few','some','such','only','other','so','if','then',
    'when','where','why','up','out','who'
  ]);

  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= minLength && !STOP_WORDS.has(w));

  return words;
}

/**
 * Calculate engagement score for a source
 * @param {Object} counts - Counts object with read, saved, rated, hidden, total
 * @returns {number} Affinity score between 0.1 and 1.0
 */
export function calculateSourceAffinity(counts) {
  if (!counts || counts.total < 3) {
    return 0.5; // Neutral for sources with little data
  }

  const engagement = (counts.read + counts.saved * 2 + counts.rated * 3) / counts.total;
  const penalty = (counts.hidden / counts.total) * 0.5;
  const affinity = engagement - penalty;

  return Math.max(0.1, Math.min(1.0, affinity));
}

/**
 * Check if an event indicates "open in new tab"
 * @param {MouseEvent|KeyboardEvent} event
 * @returns {boolean}
 */
export function isNewTabClick(event) {
  return !!(event && (event.metaKey || event.ctrlKey));
}

/**
 * Parse arXiv ID from URL or string
 * @param {string} input - URL or arXiv ID
 * @returns {string|null} Normalized arXiv ID or null
 */
export function parseArxivId(input) {
  if (!input) return null;

  // Direct ID format: 2301.12345 or 1234.5678
  const directMatch = input.match(/(\d{4}\.\d{4,5})/);
  if (directMatch) return directMatch[1];

  // URL format: arxiv.org/abs/2301.12345
  const urlMatch = input.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/);
  if (urlMatch) return urlMatch[1];

  return null;
}

/**
 * Format a timestamp as relative time
 * @param {number|string|Date} timestamp
 * @returns {string} Relative time string like "2h ago"
 */
export function formatRelativeTime(timestamp) {
  const now = Date.now();
  const then = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  const diff = now - then;

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;

  if (diff < minute) return 'just now';
  if (diff < hour) return Math.floor(diff / minute) + 'm ago';
  if (diff < day) return Math.floor(diff / hour) + 'h ago';
  if (diff < week) return Math.floor(diff / day) + 'd ago';
  return Math.floor(diff / week) + 'w ago';
}

/**
 * Truncate text to max length with ellipsis
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
export function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) return text || '';
  return text.slice(0, maxLength - 1) + '…';
}

/**
 * Debounce a function
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(fn, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}
