# Function Registry Improvements

## Summary

Enhanced the function registry tool (`scripts/function-registry.js`) to dramatically reduce false positives and improve accuracy.

## Changes Made

### 1. HTML Event Handler Detection ✅
**Added:** Automatic scanning of HTML files for event handler references

**Implementation:**
- Scans `src/index.html` and all `src/views/*.html` files
- Extracts function calls from all HTML event attributes:
  - `onclick`, `onmouseenter`, `onmouseleave`, `onkeydown`, `onfocus`, `onblur`, etc.
- Adds synthetic "HTML" call sites for these functions
- Displays HTML reference count in reports

**Impact:**
- **55 functions** previously marked as "unused" are now correctly detected as used from HTML
- Examples: `toggleBrowseDownloads()`, `_browseGoBack()`, `toggleBrowseMoreMenu()`, `_showHistoryDropdown()`, `_pillUrlKeydown()`

### 2. Smarter Duplicate Detection ✅
**Improved:** Scope-aware duplicate classification

**Before:**
- Flagged functions with same name at same nest level as WARNING
- Resulted in 12 false positive warnings

**After:**
- Only flags functions in **same parent function** as actual conflicts
- Checks: same `parentFunc` name AND same `nestLevel`
- Correctly classifies all nested helpers as INFO

**Impact:**
- **12 WARNING-level duplicates → 0 WARNING** (all reclassified to INFO)
- All 19 "duplicates" are now correctly identified as harmless nested helpers
- Examples correctly classified: `handler`, `onMove`, `onUp`, `tick`, `collect`, `finish`

### 3. Better Reporting ✅
**Added:** Clarity and context for users

**Console Report:**
- Shows HTML reference count in summary
- Updated "Unused Functions" → "Potentially Unused Functions"
- Added note: "May include functions used via addEventListener, setTimeout, or injected scripts"

**HTML Report:**
- New stat card showing HTML reference count
- Blue "HTML" badge on functions called from HTML event handlers
- Functions called from HTML are no longer shown as unused

## Results

### Metrics Comparison

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| **Total Functions** | 1,549 | 1,549 | - |
| **HTML References Detected** | 0 | **114** | +114 |
| **Duplicate Warnings** | 12 | **0** | -12 ✅ |
| **Duplicate Errors** | 0 | 0 | - |
| **Duplicate Info** | 7 | 19 | +12 |
| **Unused Functions** | 167 | **112** | -55 ✅ |
| **False Positives Eliminated** | - | **67** | ✅ |

### Validation

Verified the following previously "unused" functions are now correctly marked as used:
- `toggleBrowseDownloads()` → callCount: 1 (HTML)
- `_browseGoBack()` → callCount: 1 (HTML)
- `toggleBrowseMoreMenu()` → callCount: 1 (HTML)
- `_showHistoryDropdown()` → callCount: 1 (HTML)
- `_pillUrlKeydown()` → callCount: 1 (HTML)

## Remaining Limitations

The tool still cannot detect:
1. **addEventListener** with function references (e.g., `el.addEventListener('click', myFunc)`)
2. **setTimeout/setInterval** callbacks (e.g., `setTimeout(myFunc, 100)`)
3. **Functions in injected script strings** (e.g., strings passed to `webview.executeJavaScript()`)
4. **Dynamic function calls** (e.g., `window[funcName]()`)

These account for the remaining 112 "potentially unused" functions. Most are actually used via these patterns.

## How to Use

```bash
# Run full analysis
npm run function-registry

# Check feed catalog sync
npm run validate-feeds

# Check script load order
npm run validate-load-order

# View reports
open coverage/function-registry.html
open coverage/function-registry.json
```

## Code Changes

**Files Modified:**
- `scripts/function-registry.js` (+60 lines)

**Key Functions Added:**
- `extractHTMLReferences()` - Scans HTML files for event handlers
- `extractFromHTML(content, references)` - Parses HTML for function calls

**Key Functions Modified:**
- `classifyDuplicates()` - Improved to check same parent scope
- `analyzeCodebase()` - Added HTML reference extraction pass
- `generateReport()` - Tracks HTML reference count
- `printConsoleReport()` - Shows HTML references, updated messaging

## Future Enhancements

Potential improvements for further false positive reduction:
1. Parse `addEventListener` calls to detect event listener references
2. Parse `setTimeout`/`setInterval` to detect callback references
3. Parse template strings for injected script detection
4. Add command to auto-remove genuinely unused functions (with confirmation)
