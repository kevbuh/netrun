#!/usr/bin/env node

/**
 * Feed Catalog Sync Validator
 *
 * Validates that FEED_CATALOG in src/js/core.js and src/feed_catalog.py
 * are in sync. The catalogs must match on critical fields: key, url, special.
 *
 * Usage:
 *   node scripts/validate-feeds.js           # Console output
 *   node scripts/validate-feeds.js --json    # JSON output
 *   npm run validate-feeds                   # Via npm
 *
 * Exit codes:
 *   0 - Catalogs are in sync
 *   1 - Mismatches found
 */

const fs = require('fs');
const path = require('path');

// Parse command line args
const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');

// File paths
const JS_FILE = path.join(__dirname, '../src/js/core.js');
const PY_FILE = path.join(__dirname, '../src/feed_catalog.py');

/**
 * Extract FEED_CATALOG from JavaScript file
 * Returns array of { key, url, special } objects
 */
function parseJsCatalog(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');

  // Find the FEED_CATALOG array
  const startMatch = content.match(/const FEED_CATALOG = \[/);
  if (!startMatch) {
    throw new Error('Could not find FEED_CATALOG in JS file');
  }

  const startIndex = startMatch.index + startMatch[0].length;

  // Find matching closing bracket
  let braceDepth = 1;
  let endIndex = startIndex;
  for (let i = startIndex; i < content.length; i++) {
    if (content[i] === '[' || content[i] === '{') braceDepth++;
    if (content[i] === ']' || content[i] === '}') braceDepth--;
    if (braceDepth === 0) {
      endIndex = i;
      break;
    }
  }

  const arrayText = content.substring(startIndex, endIndex);

  // Extract objects using regex
  // Match objects like: { key: 'foo', ... }
  const objectRegex = /\{\s*key:\s*'([^']+)'[^}]*\}/g;
  const entries = [];
  let match;

  while ((match = objectRegex.exec(arrayText)) !== null) {
    const objText = match[0];
    const key = match[1];

    // Extract url field (may be undefined)
    const urlMatch = objText.match(/url:\s*'([^']+)'/);
    const url = urlMatch ? urlMatch[1] : null;

    // Extract special field (may be undefined)
    const specialMatch = objText.match(/special:\s*'([^']+)'/);
    const special = specialMatch ? specialMatch[1] : null;

    entries.push({ key, url, special });
  }

  return entries;
}

/**
 * Extract FEED_CATALOG from Python file
 * Returns array of { key, url, special } objects
 */
function parsePyCatalog(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  const entries = [];
  let inCatalog = false;

  for (const line of lines) {
    // Start of catalog
    if (line.includes('FEED_CATALOG = [')) {
      inCatalog = true;
      continue;
    }

    // End of catalog
    if (inCatalog && line.trim() === ']') {
      break;
    }

    // Skip comments and empty lines
    if (!inCatalog || line.trim().startsWith('#') || line.trim() === '') {
      continue;
    }

    // Parse dictionary entries: {'key': 'value', ...}
    const dictMatch = line.match(/\{[^}]+\}/);
    if (dictMatch) {
      const dictText = dictMatch[0];

      // Extract key
      const keyMatch = dictText.match(/'key':\s*'([^']+)'/);
      if (!keyMatch) continue;
      const key = keyMatch[1];

      // Extract url (may be None)
      const urlMatch = dictText.match(/'url':\s*'([^']+)'/);
      const url = urlMatch ? urlMatch[1] : null;

      // Check for None explicitly
      if (dictText.includes("'url': None")) {
        // url is already null
      }

      // Extract special (may not exist)
      const specialMatch = dictText.match(/'special':\s*'([^']+)'/);
      const special = specialMatch ? specialMatch[1] : null;

      entries.push({ key, url, special });
    }
  }

  if (entries.length === 0) {
    throw new Error('No entries found in Python catalog');
  }

  return entries;
}

/**
 * Compare two catalogs and return differences
 */
function compareCatalogs(jsCatalog, pyCatalog) {
  const errors = [];

  // Create maps for quick lookup
  const jsMap = new Map(jsCatalog.map(e => [e.key, e]));
  const pyMap = new Map(pyCatalog.map(e => [e.key, e]));

  // Check for entries missing in Python
  for (const [key, jsEntry] of jsMap) {
    if (!pyMap.has(key)) {
      errors.push({
        type: 'MISSING_IN_PY',
        key,
        jsEntry,
        pyEntry: null
      });
    }
  }

  // Check for entries missing in JS
  for (const [key, pyEntry] of pyMap) {
    if (!jsMap.has(key)) {
      errors.push({
        type: 'MISSING_IN_JS',
        key,
        jsEntry: null,
        pyEntry
      });
    }
  }

  // Check for mismatches in common entries
  for (const [key, jsEntry] of jsMap) {
    const pyEntry = pyMap.get(key);
    if (!pyEntry) continue; // Already handled above

    // Compare url
    if (jsEntry.url !== pyEntry.url) {
      errors.push({
        type: 'URL_MISMATCH',
        key,
        jsEntry,
        pyEntry
      });
    }

    // Compare special
    if (jsEntry.special !== pyEntry.special) {
      errors.push({
        type: 'SPECIAL_MISMATCH',
        key,
        jsEntry,
        pyEntry
      });
    }
  }

  return errors;
}

/**
 * Format errors for console output
 */
function formatConsoleOutput(jsCatalog, pyCatalog, errors) {
  const lines = [];

  lines.push('🔍 Feed Catalog Sync Validator\n');
  lines.push('Comparing:');
  lines.push(`  JS: src/js/core.js (${jsCatalog.length} entries)`);
  lines.push(`  PY: src/feed_catalog.py (${pyCatalog.length} entries)\n`);

  if (errors.length === 0) {
    lines.push('✅ Catalogs are in sync!\n');
  } else {
    lines.push(`❌ ${errors.length} mismatch${errors.length === 1 ? '' : 'es'} found:\n`);

    for (const error of errors) {
      lines.push(`[${error.type}] ${error.key}`);

      switch (error.type) {
        case 'MISSING_IN_PY':
          lines.push('  Present in JS but missing in Python');
          lines.push(`  JS url: ${error.jsEntry.url || '(none)'}`);
          lines.push(`  JS special: ${error.jsEntry.special || '(none)'}`);
          break;

        case 'MISSING_IN_JS':
          lines.push('  Present in Python but missing in JS');
          lines.push(`  PY url: ${error.pyEntry.url || '(none)'}`);
          lines.push(`  PY special: ${error.pyEntry.special || '(none)'}`);
          break;

        case 'URL_MISMATCH':
          lines.push('  URL field mismatch:');
          lines.push(`  JS: ${error.jsEntry.url || '(none)'}`);
          lines.push(`  PY: ${error.pyEntry.url || '(none)'}`);
          break;

        case 'SPECIAL_MISMATCH':
          lines.push('  Special field mismatch:');
          lines.push(`  JS: ${error.jsEntry.special || '(none)'}`);
          lines.push(`  PY: ${error.pyEntry.special || '(none)'}`);
          break;
      }

      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Format errors for JSON output
 */
function formatJsonOutput(jsCatalog, pyCatalog, errors) {
  return JSON.stringify({
    status: errors.length === 0 ? 'ok' : 'error',
    jsCatalogSize: jsCatalog.length,
    pyCatalogSize: pyCatalog.length,
    errorCount: errors.length,
    errors: errors.map(e => ({
      type: e.type,
      key: e.key,
      js: e.jsEntry,
      py: e.pyEntry
    }))
  }, null, 2);
}

/**
 * Main function
 */
function main() {
  try {
    // Parse catalogs
    const jsCatalog = parseJsCatalog(JS_FILE);
    const pyCatalog = parsePyCatalog(PY_FILE);

    // Compare
    const errors = compareCatalogs(jsCatalog, pyCatalog);

    // Output
    if (jsonOutput) {
      console.log(formatJsonOutput(jsCatalog, pyCatalog, errors));
    } else {
      console.log(formatConsoleOutput(jsCatalog, pyCatalog, errors));
    }

    // Exit with appropriate code
    process.exit(errors.length === 0 ? 0 : 1);

  } catch (err) {
    if (jsonOutput) {
      console.error(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    } else {
      console.error(`❌ Error: ${err.message}`);
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { parseJsCatalog, parsePyCatalog, compareCatalogs };
