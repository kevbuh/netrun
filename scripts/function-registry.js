#!/usr/bin/env node

/**
 * Global Function Registry
 * Scans all vanilla JS files and maps out function definitions, call sites, and dependencies
 */

const fs = require('fs');
const path = require('path');

const JS_DIR = path.join(__dirname, '../src/js');
const OUTPUT_DIR = path.join(__dirname, '../coverage');
const INDEX_HTML = path.join(__dirname, '../src/index.html');
const VIEWS_DIR = path.join(__dirname, '../src/views');

// Patterns to match function definitions
const PATTERNS = {
  // function foo() {}
  functionDeclaration: /^\s*function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/gm,
  // const foo = function() {}
  functionExpression: /^\s*(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*function\s*\(/gm,
  // const foo = () => {}
  arrowFunction: /^\s*(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:\([^)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>/gm,
  // async function foo() {}
  asyncFunction: /^\s*async\s+function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/gm,
  // window.foo = function() {}
  windowAssignment: /window\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:function|async\s+function|\([^)]*\)\s*=>)/gm,
};

// Function call pattern (simple heuristic)
const CALL_PATTERN = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;

/**
 * Extract function references from HTML event handlers
 */
function extractHTMLReferences() {
  const references = new Set();

  // Parse index.html
  if (fs.existsSync(INDEX_HTML)) {
    const content = fs.readFileSync(INDEX_HTML, 'utf-8');
    extractFromHTML(content, references);
  }

  // Parse views/*.html
  if (fs.existsSync(VIEWS_DIR)) {
    const viewFiles = fs.readdirSync(VIEWS_DIR).filter(f => f.endsWith('.html'));
    viewFiles.forEach(filename => {
      const filepath = path.join(VIEWS_DIR, filename);
      const content = fs.readFileSync(filepath, 'utf-8');
      extractFromHTML(content, references);
    });
  }

  return references;
}

function extractFromHTML(content, references) {
  // Match event handlers: onclick="func()" onmouseenter="func()" etc.
  const eventHandlerPattern = /\bon\w+="([^"]+)"/g;
  let match;

  while ((match = eventHandlerPattern.exec(content)) !== null) {
    const handler = match[1];
    // Extract function calls from handler code
    const funcPattern = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
    let funcMatch;
    while ((funcMatch = funcPattern.exec(handler)) !== null) {
      references.add(funcMatch[1]);
    }
  }
}

function getJSFiles() {
  return fs.readdirSync(JS_DIR)
    .filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))
    .sort();
}

function extractFunctions(content, filename) {
  const functions = new Map();
  const lines = content.split('\n');

  // Track brace depth and parent functions for scope analysis
  const braceDepthAtLine = [];
  const functionStackAtLine = [];
  let braceDepth = 0;
  let functionStack = [];

  // First pass: calculate brace depth and function stack at each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for function definitions BEFORE updating depth
    // (so we capture the depth where the function is defined)
    let foundFunc = null;
    for (const [type, pattern] of Object.entries(PATTERNS)) {
      pattern.lastIndex = 0;
      const match = pattern.exec(line);
      if (match) {
        foundFunc = match[1];
        break;
      }
    }

    braceDepthAtLine[i] = braceDepth;
    functionStackAtLine[i] = [...functionStack];

    // If we found a function on this line, push it to stack
    if (foundFunc) {
      functionStack.push(foundFunc);
    }

    // Update brace depth based on braces in line
    for (const char of line) {
      if (char === '{') braceDepth++;
      if (char === '}') {
        braceDepth--;
        // Pop function stack when exiting a function scope
        if (braceDepth < braceDepthAtLine[i] && functionStack.length > 0) {
          functionStack.pop();
        }
      }
    }
  }

  // Second pass: extract functions with scope information
  Object.entries(PATTERNS).forEach(([type, pattern]) => {
    let match;
    pattern.lastIndex = 0;

    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      const position = match.index;

      // Find line number
      let lineNum = 1;
      let charCount = 0;
      for (let i = 0; i < lines.length; i++) {
        charCount += lines[i].length + 1;
        if (charCount > position) {
          lineNum = i + 1;
          break;
        }
      }

      const lineIdx = lineNum - 1;
      const nestLevel = braceDepthAtLine[lineIdx] || 0;
      const parentFunc = functionStackAtLine[lineIdx].length > 0
        ? functionStackAtLine[lineIdx][functionStackAtLine[lineIdx].length - 1]
        : null;

      if (!functions.has(name)) {
        functions.set(name, []);
      }

      functions.get(name).push({
        type,
        file: filename,
        line: lineNum,
        position,
        nestLevel,
        parentFunc,
        isGlobal: nestLevel === 0
      });
    }
  });

  return functions;
}

function findCallSites(content, filename, allFunctions) {
  const callSites = new Map();
  const lines = content.split('\n');

  let match;
  CALL_PATTERN.lastIndex = 0;

  while ((match = CALL_PATTERN.exec(content)) !== null) {
    const name = match[1];
    const position = match.index;

    // Skip if not a known function
    if (!allFunctions.has(name)) continue;

    // Skip if it's a definition in this file
    const defs = allFunctions.get(name);
    const isDefinitionHere = defs.some(d =>
      d.file === filename && Math.abs(d.position - position) < 20
    );
    if (isDefinitionHere) continue;

    // Find line number
    let lineNum = 1;
    let charCount = 0;
    for (let i = 0; i < lines.length; i++) {
      charCount += lines[i].length + 1;
      if (charCount > position) {
        lineNum = i + 1;
        break;
      }
    }

    if (!callSites.has(name)) {
      callSites.set(name, []);
    }

    callSites.get(name).push({
      file: filename,
      line: lineNum
    });
  }

  return callSites;
}

function analyzeCodebase() {
  // Only log if not in JSON output mode
  const jsonOutput = process.argv.includes('--json');
  if (!jsonOutput) {
    console.log('🔍 Scanning JavaScript files and HTML templates...\n');
  }

  const files = getJSFiles();
  const allFunctions = new Map();
  const allCallSites = new Map();
  const fileContents = new Map();

  // Extract HTML event handler references
  const htmlReferences = extractHTMLReferences();

  // First pass: extract all function definitions
  files.forEach(filename => {
    const filepath = path.join(JS_DIR, filename);
    const content = fs.readFileSync(filepath, 'utf-8');
    fileContents.set(filename, content);

    const functions = extractFunctions(content, filename);

    functions.forEach((defs, name) => {
      if (!allFunctions.has(name)) {
        allFunctions.set(name, []);
      }
      allFunctions.get(name).push(...defs);
    });
  });

  // Second pass: find call sites in JS files
  files.forEach(filename => {
    const content = fileContents.get(filename);
    const callSites = findCallSites(content, filename, allFunctions);

    callSites.forEach((sites, name) => {
      if (!allCallSites.has(name)) {
        allCallSites.set(name, []);
      }
      allCallSites.get(name).push(...sites);
    });
  });

  // Third pass: add HTML references as call sites
  htmlReferences.forEach(funcName => {
    if (allFunctions.has(funcName)) {
      if (!allCallSites.has(funcName)) {
        allCallSites.set(funcName, []);
      }
      // Add a synthetic call site from HTML
      allCallSites.get(funcName).push({
        file: 'HTML',
        line: 0
      });
    }
  });

  return { files, allFunctions, allCallSites, fileContents, htmlReferences };
}

/**
 * Classify duplicate functions by severity based on scope
 */
function classifyDuplicates(defs, name) {
  // ERROR: Multiple global definitions (real bug)
  const globalDefs = defs.filter(d => d.isGlobal);
  if (globalDefs.length > 1) {
    return {
      severity: 'ERROR',
      reason: `${globalDefs.length} global definitions - naming conflict`,
      defs: globalDefs
    };
  }

  // WARNING: Multiple definitions in same parent scope (actual conflict)
  const fileGroups = {};
  defs.forEach(d => {
    if (!fileGroups[d.file]) fileGroups[d.file] = [];
    fileGroups[d.file].push(d);
  });
  const sameScopeInFile = Object.values(fileGroups).find(group => {
    if (group.length <= 1) return false;
    // Check if any two are in the SAME parent function (actual conflict)
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        // Same parent means same parentFunc name AND same nest level
        // If both are top-level (parentFunc === null), that's a global conflict (already caught above)
        if (group[i].parentFunc === group[j].parentFunc &&
            group[i].parentFunc !== null &&
            group[i].nestLevel === group[j].nestLevel) {
          return true;
        }
      }
    }
    return false;
  });
  if (sameScopeInFile) {
    return {
      severity: 'WARNING',
      reason: 'Multiple definitions in same parent function (actual conflict)',
      defs: sameScopeInFile
    };
  }

  // INFO: Nested in different functions (intentional, common names)
  const nestedDefs = defs.filter(d => !d.isGlobal);
  if (nestedDefs.length === defs.length) {
    return {
      severity: 'INFO',
      reason: 'Nested in different parent functions (common helper name)',
      defs: nestedDefs
    };
  }

  // Default: INFO
  return {
    severity: 'INFO',
    reason: 'Multiple definitions in different scopes',
    defs
  };
}

function generateReport(data) {
  const { files, allFunctions, allCallSites, htmlReferences } = data;

  const report = {
    summary: {
      totalFiles: files.length,
      totalFunctions: allFunctions.size,
      duplicateFunctions: 0,
      duplicatesError: 0,
      duplicatesWarning: 0,
      duplicatesInfo: 0,
      unusedFunctions: 0,
      htmlReferences: htmlReferences ? htmlReferences.size : 0,
      timestamp: new Date().toISOString()
    },
    files: {},
    functions: {},
    issues: {
      duplicates: [],
      unused: [],
      crossFile: []
    }
  };

  // Build file-level view
  files.forEach(filename => {
    report.files[filename] = {
      defines: [],
      calls: [],
      size: data.fileContents.get(filename).length
    };
  });

  // Build function-level view and detect issues
  allFunctions.forEach((defs, name) => {
    const callSites = allCallSites.get(name) || [];

    report.functions[name] = {
      definitions: defs,
      callCount: callSites.length,
      callSites: callSites.slice(0, 100) // Limit to first 100 calls
    };

    // Add to file view
    defs.forEach(def => {
      report.files[def.file].defines.push(name);
    });

    callSites.forEach(site => {
      // Skip HTML references (not a real file)
      if (site.file === 'HTML') return;

      if (!report.files[site.file].calls.includes(name)) {
        report.files[site.file].calls.push(name);
      }
    });

    // Detect duplicates with severity classification
    if (defs.length > 1) {
      report.summary.duplicateFunctions++;
      const classification = classifyDuplicates(defs, name);

      // Count by severity
      if (classification.severity === 'ERROR') report.summary.duplicatesError++;
      else if (classification.severity === 'WARNING') report.summary.duplicatesWarning++;
      else report.summary.duplicatesInfo++;

      report.issues.duplicates.push({
        name,
        definitions: defs,
        severity: classification.severity,
        reason: classification.reason
      });
    }

    // Detect unused
    if (callSites.length === 0) {
      report.summary.unusedFunctions++;
      report.issues.unused.push({
        name,
        definedIn: defs[0].file,
        line: defs[0].line
      });
    }
  });

  // Detect cross-file dependencies
  files.forEach(filename => {
    const fileData = report.files[filename];
    const externalCalls = fileData.calls.filter(funcName => {
      const defs = allFunctions.get(funcName);
      return defs && !defs.some(d => d.file === filename);
    });

    if (externalCalls.length > 0) {
      report.issues.crossFile.push({
        file: filename,
        dependencies: externalCalls.length,
        functions: externalCalls
      });
    }
  });

  return report;
}

function printConsoleReport(report) {
  console.log('📊 Global Function Registry\n');
  console.log('═'.repeat(60));
  console.log(`Total Files:      ${report.summary.totalFiles}`);
  console.log(`Total Functions:  ${report.summary.totalFunctions}`);
  console.log(`HTML References:  ${report.summary.htmlReferences}`);
  console.log(`Duplicates:       ${report.summary.duplicateFunctions}`);
  console.log(`Unused:           ${report.summary.unusedFunctions}`);
  console.log('═'.repeat(60));
  console.log();

  // Top 10 most-called functions
  const sortedByUse = Object.entries(report.functions)
    .sort((a, b) => b[1].callCount - a[1].callCount)
    .slice(0, 10);

  console.log('🔥 Top 10 Most-Called Functions:');
  sortedByUse.forEach(([name, data], i) => {
    const def = data.definitions[0];
    console.log(`  ${i + 1}. ${name}() - ${data.callCount} calls (${def.file}:${def.line})`);
  });
  console.log();

  // Duplicates
  if (report.issues.duplicates.length > 0) {
    const errorDups = report.issues.duplicates.filter(d => d.severity === 'ERROR');
    const warningDups = report.issues.duplicates.filter(d => d.severity === 'WARNING');
    const infoDups = report.issues.duplicates.filter(d => d.severity === 'INFO');

    console.log(`⚠️  Duplicate Function Definitions (${report.issues.duplicates.length} total):`);
    console.log(`   ${errorDups.length} ERROR, ${warningDups.length} WARNING, ${infoDups.length} INFO\n`);

    // Show ERROR duplicates first
    if (errorDups.length > 0) {
      console.log('  [ERROR] Global naming conflicts:');
      errorDups.slice(0, 5).forEach(dup => {
        console.log(`    ${dup.name}() - ${dup.reason}`);
        dup.definitions.forEach(def => {
          console.log(`      ${def.file}:${def.line} (${def.isGlobal ? 'global' : 'nested'})`);
        });
      });
      console.log();
    }

    // Show WARNING duplicates
    if (warningDups.length > 0) {
      console.log('  [WARNING] Same scope conflicts:');
      warningDups.slice(0, 3).forEach(dup => {
        console.log(`    ${dup.name}() - ${dup.reason}`);
        dup.definitions.slice(0, 3).forEach(def => {
          console.log(`      ${def.file}:${def.line} (nest level ${def.nestLevel})`);
        });
      });
      console.log();
    }

    // Show INFO duplicates (less verbose)
    if (infoDups.length > 0) {
      console.log(`  [INFO] Nested helpers (${infoDups.length} functions):`);
      console.log(`    Common names: ${infoDups.slice(0, 10).map(d => d.name).join(', ')}${infoDups.length > 10 ? '...' : ''}`);
      console.log();
    }
  }

  // Unused (limit to 20)
  if (report.issues.unused.length > 0) {
    console.log(`🗑️  Potentially Unused Functions (${report.issues.unused.length} total, showing first 20):`);
    console.log(`   Note: May include functions used via addEventListener, setTimeout, or injected scripts\n`);
    report.issues.unused.slice(0, 20).forEach(unused => {
      console.log(`  ${unused.name}() - ${unused.definedIn}:${unused.line}`);
    });
    console.log();
  }

  // Cross-file dependencies (top 5 most dependent files)
  const topDeps = report.issues.crossFile
    .sort((a, b) => b.dependencies - a.dependencies)
    .slice(0, 5);

  if (topDeps.length > 0) {
    console.log('🔗 Files With Most External Dependencies:');
    topDeps.forEach(dep => {
      console.log(`  ${dep.file} - ${dep.dependencies} external functions`);
    });
    console.log();
  }
}

function generateHTMLReport(report) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Function Registry - ${new Date().toLocaleDateString()}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      padding: 20px;
      line-height: 1.6;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 { font-size: 32px; margin-bottom: 10px; color: #fff; }
    h2 { font-size: 24px; margin: 40px 0 20px; color: #fff; border-bottom: 2px solid #b4451a; padding-bottom: 10px; }
    h3 { font-size: 18px; margin: 30px 0 15px; color: #fff; }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin: 30px 0;
    }
    .stat-card {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 20px;
    }
    .stat-card h3 { margin: 0 0 10px; font-size: 14px; color: #999; text-transform: uppercase; }
    .stat-card .value { font-size: 36px; color: #b4451a; font-weight: bold; }
    table {
      width: 100%;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      border-collapse: collapse;
      overflow: hidden;
      margin-bottom: 30px;
    }
    th {
      background: #2a2a2a;
      padding: 12px;
      text-align: left;
      font-weight: 600;
      border-bottom: 2px solid #b4451a;
    }
    td {
      padding: 10px 12px;
      border-bottom: 1px solid #2a2a2a;
    }
    tr:hover { background: #222; }
    .file-link { color: #b4451a; text-decoration: none; font-family: 'Monaco', monospace; font-size: 13px; }
    .file-link:hover { text-decoration: underline; }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      margin-right: 5px;
    }
    .badge-warning { background: #f59e0b; color: #000; }
    .badge-error { background: #ef4444; color: #fff; }
    .badge-success { background: #10b981; color: #fff; }
    .badge-info { background: #3b82f6; color: #fff; }
    .func-name { font-family: 'Monaco', monospace; color: #60a5fa; font-weight: 600; }
    .search-box {
      width: 100%;
      padding: 12px;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      color: #e0e0e0;
      font-size: 16px;
      margin-bottom: 20px;
    }
    .tabs {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
      border-bottom: 2px solid #333;
    }
    .tab {
      padding: 10px 20px;
      background: transparent;
      border: none;
      color: #999;
      cursor: pointer;
      font-size: 16px;
      border-bottom: 3px solid transparent;
      transition: all 0.2s;
    }
    .tab:hover { color: #e0e0e0; }
    .tab.active { color: #b4451a; border-bottom-color: #b4451a; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .deps-list {
      font-size: 12px;
      color: #999;
      max-width: 400px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    code {
      background: #2a2a2a;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Monaco', monospace;
      font-size: 13px;
      color: #60a5fa;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 Global Function Registry</h1>
    <p style="color: #999; margin-bottom: 20px;">Generated: ${new Date().toLocaleString()}</p>

    <div class="summary">
      <div class="stat-card">
        <h3>Total Files</h3>
        <div class="value">${report.summary.totalFiles}</div>
      </div>
      <div class="stat-card">
        <h3>Total Functions</h3>
        <div class="value">${report.summary.totalFunctions}</div>
      </div>
      <div class="stat-card">
        <h3>Duplicates</h3>
        <div class="value">${report.summary.duplicateFunctions}</div>
      </div>
      <div class="stat-card">
        <h3>Unused</h3>
        <div class="value">${report.summary.unusedFunctions}</div>
      </div>
      <div class="stat-card">
        <h3>HTML References</h3>
        <div class="value">${report.summary.htmlReferences}</div>
      </div>
    </div>

    <input type="text" class="search-box" id="searchBox" placeholder="Search functions, files, or dependencies...">

    <div class="tabs">
      <button class="tab active" onclick="showTab('all')">All Functions</button>
      <button class="tab" onclick="showTab('files')">By File</button>
      <button class="tab" onclick="showTab('issues')">Issues</button>
      <button class="tab" onclick="showTab('popular')">Most Used</button>
    </div>

    <div id="allTab" class="tab-content active">
      <h2>All Functions (${report.summary.totalFunctions})</h2>
      <table id="functionsTable">
        <thead>
          <tr>
            <th>Function</th>
            <th>Defined In</th>
            <th>Calls</th>
            <th>Type</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(report.functions)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([name, data]) => {
              const def = data.definitions[0];
              const isDuplicate = data.definitions.length > 1;
              const isUnused = data.callCount === 0;
              const isHTMLCalled = data.callSites.some(site => site.file === 'HTML');
              return `
                <tr data-search="${name} ${def.file}">
                  <td>
                    <span class="func-name">${name}()</span>
                    ${isDuplicate ? '<span class="badge badge-warning">Duplicate</span>' : ''}
                    ${isUnused ? '<span class="badge badge-error">Unused</span>' : ''}
                    ${isHTMLCalled ? '<span class="badge badge-info">HTML</span>' : ''}
                  </td>
                  <td><a href="#" class="file-link">${def.file}:${def.line}</a></td>
                  <td>${data.callCount}</td>
                  <td><code>${def.type}</code></td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    </div>

    <div id="filesTab" class="tab-content">
      <h2>Functions by File</h2>
      ${Object.entries(report.files)
        .sort((a, b) => b[1].defines.length - a[1].defines.length)
        .map(([filename, data]) => `
          <div style="margin-bottom: 30px;">
            <h3>${filename}</h3>
            <p style="color: #999; margin-bottom: 10px;">
              Defines ${data.defines.length} functions,
              calls ${data.calls.length} external functions,
              ${(data.size / 1024).toFixed(1)}KB
            </p>
            <table>
              <thead>
                <tr>
                  <th>Defines</th>
                  <th>External Dependencies</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    ${data.defines.slice(0, 50).map(f => `<code>${f}()</code>`).join(', ')}
                    ${data.defines.length > 50 ? `<span style="color: #999;"> ...and ${data.defines.length - 50} more</span>` : ''}
                  </td>
                  <td class="deps-list">
                    ${data.calls.slice(0, 30).map(f => `<code>${f}()</code>`).join(', ')}
                    ${data.calls.length > 30 ? `<span style="color: #999;"> ...and ${data.calls.length - 30} more</span>` : ''}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        `).join('')}
    </div>

    <div id="issuesTab" class="tab-content">
      <h2>⚠️ Issues</h2>

      ${report.issues.duplicates.length > 0 ? `
        <h3>Duplicate Functions (${report.issues.duplicates.length})</h3>
        <p style="color: #999; margin-bottom: 15px;">
          <span class="badge badge-error">${report.summary.duplicatesError} ERROR</span>
          <span class="badge badge-warning">${report.summary.duplicatesWarning} WARNING</span>
          <span class="badge badge-info">${report.summary.duplicatesInfo} INFO</span>
        </p>
        <table>
          <thead>
            <tr>
              <th>Severity</th>
              <th>Function</th>
              <th>Reason</th>
              <th>Definitions</th>
            </tr>
          </thead>
          <tbody>
            ${report.issues.duplicates
              .sort((a, b) => {
                const order = { ERROR: 0, WARNING: 1, INFO: 2 };
                return order[a.severity] - order[b.severity];
              })
              .map(dup => `
              <tr>
                <td>
                  <span class="badge ${
                    dup.severity === 'ERROR' ? 'badge-error' :
                    dup.severity === 'WARNING' ? 'badge-warning' :
                    'badge-info'
                  }">${dup.severity}</span>
                </td>
                <td><span class="func-name">${dup.name}()</span></td>
                <td style="font-size: 12px; color: #999;">${dup.reason}</td>
                <td>
                  ${dup.definitions.map(def =>
                    `<a href="#" class="file-link">${def.file}:${def.line}</a>${def.isGlobal ? ' <span style="color: #ef4444;">(global)</span>' : ` (nest ${def.nestLevel})`}`
                  ).join('<br>')}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<p style="color: #10b981;">✓ No duplicate functions found</p>'}

      ${report.issues.unused.length > 0 ? `
        <h3 style="margin-top: 40px;">Unused Functions (${report.issues.unused.length})</h3>
        <table>
          <thead>
            <tr>
              <th>Function</th>
              <th>Defined In</th>
            </tr>
          </thead>
          <tbody>
            ${report.issues.unused.slice(0, 100).map(unused => `
              <tr>
                <td><span class="func-name">${unused.name}()</span></td>
                <td><a href="#" class="file-link">${unused.definedIn}:${unused.line}</a></td>
              </tr>
            `).join('')}
            ${report.issues.unused.length > 100 ?
              `<tr><td colspan="2" style="text-align: center; color: #999;">...and ${report.issues.unused.length - 100} more</td></tr>`
              : ''}
          </tbody>
        </table>
      ` : '<p style="color: #10b981;">✓ No unused functions found</p>'}
    </div>

    <div id="popularTab" class="tab-content">
      <h2>🔥 Most-Called Functions</h2>
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Function</th>
            <th>Defined In</th>
            <th>Call Count</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(report.functions)
            .sort((a, b) => b[1].callCount - a[1].callCount)
            .slice(0, 50)
            .map(([name, data], i) => {
              const def = data.definitions[0];
              return `
                <tr>
                  <td style="color: #b4451a; font-weight: bold;">#${i + 1}</td>
                  <td><span class="func-name">${name}()</span></td>
                  <td><a href="#" class="file-link">${def.file}:${def.line}</a></td>
                  <td><span class="badge badge-info">${data.callCount}</span></td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    </div>
  </div>

  <script>
    function showTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      const tabMap = {
        'all': 'allTab',
        'files': 'filesTab',
        'issues': 'issuesTab',
        'popular': 'popularTab'
      };

      document.getElementById(tabMap[tab]).classList.add('active');
      event.target.classList.add('active');
    }

    // Search functionality
    const searchBox = document.getElementById('searchBox');
    searchBox.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      const table = document.getElementById('functionsTable');
      const rows = table.querySelectorAll('tbody tr');

      rows.forEach(row => {
        const searchText = row.getAttribute('data-search').toLowerCase();
        row.style.display = searchText.includes(query) ? '' : 'none';
      });
    });
  </script>
</body>
</html>`;

  return html;
}

/**
 * Parse script load order from index.html
 */
function parseScriptOrder() {
  const content = fs.readFileSync(INDEX_HTML, 'utf8');
  const scripts = [];
  const scriptRegex = /<script\s+defer\s+src="\/js\/([^"]+)"><\/script>/g;

  let match;
  while ((match = scriptRegex.exec(content)) !== null) {
    scripts.push(match[1]);
  }

  return scripts;
}

/**
 * Build dependency graph showing which files call functions from other files
 */
function buildDependencyGraph(allFunctions, allCallSites, files) {
  const graph = {};

  files.forEach(filename => {
    graph[filename] = new Set();
  });

  // For each function, find which files call it
  allFunctions.forEach((defs, funcName) => {
    const callSites = allCallSites.get(funcName) || [];

    callSites.forEach(site => {
      // Find where this function is defined
      const definedIn = defs.map(d => d.file);

      // If called from different file, it's a dependency
      if (!definedIn.includes(site.file)) {
        definedIn.forEach(defFile => {
          graph[site.file].add(defFile);
        });
      }
    });
  });

  // Convert Sets to Arrays
  Object.keys(graph).forEach(file => {
    graph[file] = Array.from(graph[file]);
  });

  return graph;
}

/**
 * Detect forward references in script load order
 */
function detectForwardReferences(scriptOrder, allFunctions, allCallSites) {
  const forwardRefs = [];
  const scriptIndex = {};

  scriptOrder.forEach((script, idx) => {
    scriptIndex[script] = idx;
  });

  // For each function, check if it's called before it's defined
  allFunctions.forEach((defs, funcName) => {
    const callSites = allCallSites.get(funcName) || [];

    callSites.forEach(site => {
      defs.forEach(def => {
        // Skip if call is in same file as definition
        if (site.file === def.file) return;

        const callIdx = scriptIndex[site.file];
        const defIdx = scriptIndex[def.file];

        // Forward reference: call happens in file loaded BEFORE definition
        if (callIdx < defIdx) {
          forwardRefs.push({
            funcName,
            callFile: site.file,
            callLine: site.line,
            callOrder: callIdx,
            defFile: def.file,
            defLine: def.line,
            defOrder: defIdx
          });
        }
      });
    });
  });

  return forwardRefs;
}

/**
 * Classify forward reference as safe or risky
 */
function classifyForwardRef(ref, fileContents) {
  // Get the line of code where the call happens
  const content = fileContents.get(ref.callFile);
  if (!content) return 'INFO';

  const lines = content.split('\n');
  const callLine = lines[ref.callLine - 1] || '';

  // Check context: is this call inside a function?
  // Count brace depth up to this line
  let braceDepth = 0;
  for (let i = 0; i < ref.callLine - 1; i++) {
    const line = lines[i];
    for (const char of line) {
      if (char === '{') braceDepth++;
      if (char === '}') braceDepth--;
    }
  }

  // If we're inside braces (inside a function), it's deferred execution
  if (braceDepth > 0) {
    return 'INFO';
  }

  // Top-level code - check for safe patterns
  const safePatterns = [
    /VIEW_REGISTRY\[/,              // VIEW_REGISTRY['feed'] = { load: ... }
    /\.addEventListener\(/,          // element.addEventListener('click', ...)
    /setTimeout/,                    // setTimeout(() => ...)
    /setInterval/,                   // setInterval(() => ...)
    /requestAnimationFrame/,         // requestAnimationFrame(...)
    /\.then\(/,                      // promise.then(...)
    /\.catch\(/,                     // promise.catch(...)
  ];

  if (safePatterns.some(pattern => pattern.test(callLine))) {
    return 'INFO';
  }

  // Top-level risky patterns (immediate execution)
  const riskyPatterns = [
    /^\s*(?:const|let|var)\s+\w+\s*=\s*\w+\(/,  // const x = func()
    /^\s*\w+\(/,                                  // func() at top level
    /\(\s*function\s*\(/,                         // IIFE
  ];

  if (riskyPatterns.some(pattern => pattern.test(callLine))) {
    return 'WARNING';
  }

  return 'INFO';
}

/**
 * Detect circular dependencies
 */
function detectCycles(graph) {
  const cycles = [];
  const visited = new Set();
  const recStack = new Set();

  function dfs(node, path) {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    const neighbors = graph[node] || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor, path)) {
          return true;
        }
      } else if (recStack.has(neighbor)) {
        // Found cycle
        const cycleStart = path.indexOf(neighbor);
        const cycle = path.slice(cycleStart);
        cycles.push([...cycle, neighbor]);
        return false; // Continue searching for more cycles
      }
    }

    recStack.delete(node);
    path.pop();
    return false;
  }

  Object.keys(graph).forEach(node => {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  });

  return cycles;
}

/**
 * Analyze script load order
 */
function analyzeLoadOrder(data) {
  const { files, allFunctions, allCallSites, fileContents } = data;

  const scriptOrder = parseScriptOrder();
  const graph = buildDependencyGraph(allFunctions, allCallSites, files);
  const forwardRefs = detectForwardReferences(scriptOrder, allFunctions, allCallSites);
  const cycles = detectCycles(graph);

  // Classify forward references
  const classified = forwardRefs.map(ref => ({
    ...ref,
    severity: classifyForwardRef(ref, fileContents)
  }));

  const warnings = classified.filter(r => r.severity === 'WARNING');
  const infos = classified.filter(r => r.severity === 'INFO');

  return {
    scriptOrder,
    graph,
    forwardRefs: classified,
    warnings,
    infos,
    cycles
  };
}

/**
 * Print load order report
 */
function printLoadOrderReport(loadOrderData) {
  const { scriptOrder, forwardRefs, warnings, infos, cycles } = loadOrderData;

  console.log('🔗 Script Load Order Analysis\n');
  console.log('═'.repeat(60));
  console.log(`Script Count:     ${scriptOrder.length}`);
  console.log(`Forward Refs:     ${forwardRefs.length} (${warnings.length} WARNING, ${infos.length} INFO)`);
  console.log(`Circular Deps:    ${cycles.length}`);
  console.log('═'.repeat(60));
  console.log();

  console.log('📜 Current Load Order:');
  scriptOrder.forEach((script, idx) => {
    console.log(`  ${idx + 1}. ${script}`);
  });
  console.log();

  if (warnings.length > 0) {
    console.log('⚠️  Forward References (WARNING - may cause issues):');
    warnings.slice(0, 10).forEach(ref => {
      console.log(`  ${ref.callFile} (order ${ref.callOrder}) calls ${ref.funcName}()`);
      console.log(`    Defined in ${ref.defFile} (order ${ref.defOrder}) ❌ Forward reference`);
      console.log(`    Line ${ref.callLine} in ${ref.callFile}`);
    });
    console.log();
  }

  if (infos.length > 0) {
    console.log(`ℹ️  Forward References (INFO - safe, ${infos.length} total):`);
    const grouped = {};
    infos.forEach(ref => {
      const key = `${ref.callFile} → ${ref.defFile}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(ref.funcName);
    });

    Object.entries(grouped).slice(0, 5).forEach(([key, funcs]) => {
      console.log(`  ${key}: ${funcs.slice(0, 3).join(', ')}${funcs.length > 3 ? '...' : ''}`);
    });
    console.log();
  }

  if (cycles.length > 0) {
    console.log('🔄 Circular Dependencies (OK with defer):');
    cycles.slice(0, 5).forEach(cycle => {
      console.log(`  ${cycle.join(' → ')}`);
    });
    console.log();
  }

  if (warnings.length === 0 && cycles.length === 0) {
    console.log('✅ Current load order is optimal!\n');
  }
}

function main() {
  // Parse CLI args
  const args = process.argv.slice(2);
  const checkLoadOrder = args.includes('--check-load-order');
  const suggestReorder = args.includes('--suggest-reorder');
  const jsonOutput = args.includes('--json');

  if (!jsonOutput) {
    console.time('Analysis time');
  }

  const data = analyzeCodebase();
  const report = generateReport(data);

  if (!jsonOutput) {
    console.timeEnd('Analysis time');
    console.log();
  }

  if (checkLoadOrder || suggestReorder) {
    // Load order analysis only
    const loadOrderData = analyzeLoadOrder(data);

    if (jsonOutput) {
      // JSON output for API consumption
      const output = {
        status: 'ok',
        scriptCount: loadOrderData.scriptOrder.length,
        scriptOrder: loadOrderData.scriptOrder,
        forwardRefs: loadOrderData.forwardRefs,
        warnings: loadOrderData.warnings,
        infos: loadOrderData.infos,
        cycles: loadOrderData.cycles
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      // Console output
      printLoadOrderReport(loadOrderData);

      if (suggestReorder && loadOrderData.warnings.length > 0) {
        console.log('💡 Suggestion: Review forward references above.');
        console.log('   Most are safe (deferred via VIEW_REGISTRY, event handlers).');
        console.log('   Current order works due to script defer attribute.\n');
      }
    }

    return;
  }

  // Standard function registry report
  printConsoleReport(report);

  // Save JSON report
  const jsonPath = path.join(OUTPUT_DIR, 'function-registry.json');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`💾 Saved JSON report: ${jsonPath}`);

  // Save HTML report
  const htmlPath = path.join(OUTPUT_DIR, 'function-registry.html');
  const html = generateHTMLReport(report);
  fs.writeFileSync(htmlPath, html);
  console.log(`📄 Saved HTML report: ${htmlPath}`);
  console.log(`   Open: file://${htmlPath}`);
}

main();
