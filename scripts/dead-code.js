#!/usr/bin/env node
// Dead code detector for vanilla JS codebase
// Usage: node scripts/dead-code.js [--all] [--verbose]
//   (default)  Show only zero-reference functions (high confidence dead code)
//   --all      Also show functions with only 1 internal reference (lower confidence)
//   --verbose  Show all referenced functions too

const fs = require('fs');
const path = require('path');

const JS_DIR = path.join(__dirname, '..', 'src', 'js');
const HTML_DIR = path.join(__dirname, '..', 'src');
const SHOW_ALL = process.argv.includes('--all');
const VERBOSE = process.argv.includes('--verbose');

// Collect all JS and HTML files
const jsFiles = fs.readdirSync(JS_DIR)
  .filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))
  .map(f => ({ name: f, path: path.join(JS_DIR, f) }));

const htmlFiles = [];
function collectHtml(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectHtml(full);
    else if (entry.name.endsWith('.html')) htmlFiles.push(full);
  }
}
collectHtml(HTML_DIR);

// Also check electron files
const electronDir = path.join(__dirname, '..', 'electron');
if (fs.existsSync(electronDir)) {
  for (const f of fs.readdirSync(electronDir)) {
    if (f.endsWith('.js')) jsFiles.push({ name: `electron/${f}`, path: path.join(electronDir, f) });
  }
}

// Also check python files for cross-language references
const pyFiles = [];
function collectPy(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') collectPy(full);
    else if (entry.name.endsWith('.py')) pyFiles.push(full);
  }
}
collectPy(path.join(__dirname, '..', 'src'));

// Read all source content
const fileContents = new Map();
for (const f of jsFiles) {
  fileContents.set(f.name, fs.readFileSync(f.path, 'utf8'));
}
const allHtmlContent = htmlFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');
const allPyContent = pyFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');

// Extract function definitions
const definitions = []; // { name, file, line }

for (const [file, content] of fileContents) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const funcMatch = line.match(/^\s*(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/);
    if (funcMatch) {
      definitions.push({ name: funcMatch[1], file, line: i + 1 });
    }
  }
}

// Build combined content for searching
const allJsContent = Array.from(fileContents.values()).join('\n');
const allContent = allJsContent + '\n' + allHtmlContent + '\n' + allPyContent;

// Common names to skip (too generic, likely false positives)
const SKIP_NAMES = new Set([
  'tick', 'render', 'init', 'update', 'start', 'stop', 'reset',
  'open', 'close', 'show', 'hide', 'toggle', 'get', 'set',
  'save', 'load', 'create', 'remove', 'delete', 'add',
  'on', 'off', 'emit', 'fire', 'trigger',
]);

// Check each definition
const dead = [];      // 0 references (high confidence)
const suspect = [];   // 1 internal ref only (lower confidence)
const alive = [];

for (const def of definitions) {
  const name = def.name;
  if (name.length <= 2) continue;
  if (SKIP_NAMES.has(name)) continue;

  const regex = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');

  const totalCount = (allContent.match(regex) || []).length;
  const fileContent = fileContents.get(def.file) || '';
  const fileCount = (fileContent.match(regex) || []).length;
  const externalRefs = totalCount - fileCount;

  if (totalCount <= 1) {
    dead.push(def);
  } else if (externalRefs === 0 && fileCount === 2) {
    // definition + 1 call in same file, no external refs
    suspect.push(def);
  } else {
    alive.push({ ...def, refs: totalCount - 1 });
  }
}

dead.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
suspect.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

// Output
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

console.log(`\n${BOLD}Dead Code Report${RESET}`);
console.log('─'.repeat(60));
console.log(`Scanned: ${jsFiles.length} JS, ${htmlFiles.length} HTML, ${pyFiles.length} Python files`);
console.log(`Functions found: ${definitions.length}`);
console.log(`${RED}Dead (0 refs):${RESET} ${dead.length}`);
console.log(`${YELLOW}Suspect (1 internal ref):${RESET} ${suspect.length}`);
console.log();

// Print dead code grouped by file
function printGroup(items, color) {
  const byFile = new Map();
  for (const u of items) {
    if (!byFile.has(u.file)) byFile.set(u.file, []);
    byFile.get(u.file).push(u);
  }
  for (const [file, funcs] of byFile) {
    console.log(`${BOLD}${file}${RESET}`);
    for (const f of funcs) {
      console.log(`  ${color}L${String(f.line).padStart(5)}${RESET}  ${f.name}`);
    }
  }
  if (items.length) console.log();
}

if (dead.length) {
  console.log(`${BOLD}${RED}Unreferenced functions (safe to remove):${RESET}`);
  console.log();
  printGroup(dead, RED);
}

if (SHOW_ALL && suspect.length) {
  console.log(`${BOLD}${YELLOW}Single internal reference (review before removing):${RESET}`);
  console.log();
  printGroup(suspect, YELLOW);
}

if (!dead.length && !suspect.length) {
  console.log('No dead code detected!\n');
}

console.log(`${DIM}─${RESET}`.repeat(60));
if (!SHOW_ALL) {
  console.log(`${DIM}Run with --all to also see ${suspect.length} functions with only 1 internal ref.${RESET}`);
}
console.log(`${DIM}Tip: Some functions may be called via onclick="..." in template literals.${RESET}`);
console.log(`${DIM}Run with --verbose to see all ${alive.length} referenced functions.${RESET}\n`);

if (VERBOSE) {
  console.log(`\n${BOLD}Referenced Functions${RESET}`);
  alive.sort((a, b) => a.refs - b.refs);
  for (const r of alive) {
    console.log(`  ${DIM}${r.file}:${r.line}${RESET}  ${r.name}  ${DIM}(${r.refs} refs)${RESET}`);
  }
}
