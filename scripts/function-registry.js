#!/usr/bin/env node

/**
 * Global Function Registry
 * Scans all vanilla JS files and maps out function definitions, call sites, and dependencies
 */

const fs = require('fs');
const path = require('path');

const JS_DIR = path.join(__dirname, '../src/js');
const OUTPUT_DIR = path.join(__dirname, '../coverage');

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

function getJSFiles() {
  return fs.readdirSync(JS_DIR)
    .filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))
    .sort();
}

function extractFunctions(content, filename) {
  const functions = new Map();

  // Track line numbers
  const lines = content.split('\n');

  Object.entries(PATTERNS).forEach(([type, pattern]) => {
    let match;
    pattern.lastIndex = 0; // Reset regex

    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      const position = match.index;

      // Find line number
      let lineNum = 1;
      let charCount = 0;
      for (let i = 0; i < lines.length; i++) {
        charCount += lines[i].length + 1; // +1 for newline
        if (charCount > position) {
          lineNum = i + 1;
          break;
        }
      }

      if (!functions.has(name)) {
        functions.set(name, []);
      }

      functions.get(name).push({
        type,
        file: filename,
        line: lineNum,
        position
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
  console.log('🔍 Scanning JavaScript files...\n');

  const files = getJSFiles();
  const allFunctions = new Map();
  const allCallSites = new Map();
  const fileContents = new Map();

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

  // Second pass: find call sites
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

  return { files, allFunctions, allCallSites, fileContents };
}

function generateReport(data) {
  const { files, allFunctions, allCallSites } = data;

  const report = {
    summary: {
      totalFiles: files.length,
      totalFunctions: allFunctions.size,
      duplicateFunctions: 0,
      unusedFunctions: 0,
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
      if (!report.files[site.file].calls.includes(name)) {
        report.files[site.file].calls.push(name);
      }
    });

    // Detect duplicates
    if (defs.length > 1) {
      report.summary.duplicateFunctions++;
      report.issues.duplicates.push({
        name,
        definitions: defs
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
    console.log('⚠️  Duplicate Function Definitions:');
    report.issues.duplicates.slice(0, 10).forEach(dup => {
      console.log(`  ${dup.name}():`);
      dup.definitions.forEach(def => {
        console.log(`    - ${def.file}:${def.line} (${def.type})`);
      });
    });
    console.log();
  }

  // Unused (limit to 20)
  if (report.issues.unused.length > 0) {
    console.log(`🗑️  Unused Functions (${report.issues.unused.length} total, showing first 20):`);
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
              return `
                <tr data-search="${name} ${def.file}">
                  <td>
                    <span class="func-name">${name}()</span>
                    ${isDuplicate ? '<span class="badge badge-warning">Duplicate</span>' : ''}
                    ${isUnused ? '<span class="badge badge-error">Unused</span>' : ''}
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
        <table>
          <thead>
            <tr>
              <th>Function</th>
              <th>Definitions</th>
            </tr>
          </thead>
          <tbody>
            ${report.issues.duplicates.map(dup => `
              <tr>
                <td><span class="func-name">${dup.name}()</span></td>
                <td>
                  ${dup.definitions.map(def =>
                    `<a href="#" class="file-link">${def.file}:${def.line}</a>`
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

function main() {
  console.time('Analysis time');

  const data = analyzeCodebase();
  const report = generateReport(data);

  console.timeEnd('Analysis time');
  console.log();

  // Print console report
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
