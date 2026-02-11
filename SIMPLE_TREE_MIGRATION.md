# Migration to Simple Git-Style Tree (No D3.js)

## Summary

Replacing D3.js interactive graph with simple HTML tree visualization that looks like `git log --graph`.

## Changes Needed

### 1. Remove D3.js dependency
- Remove D3.js script loading code
- Remove zoom/pan functionality
- Remove SVG rendering

### 2. Update HTML container
Change from SVG to simple scrollable div:
```html
<div id="dev-dep-graph-container"
     style="background:var(--bg-card);
            border:1px solid var(--border-card);
            border-radius:6px;
            padding:16px;
            max-height:600px;
            overflow-y:auto;
            font-family:monospace;
            font-size:12px;
            line-height:1.6">
</div>
```

### 3. Replace render functions

Replace `_devRenderFileGraph()` with `_devRenderFileTree()`:
- Simple HTML output
- Unicode box-drawing characters (●, ├─, └─, │)
- Shows files in load order
- Lists top 3 dependencies per file
- No interactivity beyond scrolling

Replace `_devRenderFunctionGraph()` with `_devRenderFunctionTree()`:
- Collapsible file groups (click to expand/collapse)
- Functions listed under each file
- Git tree-style with ├─, └─, │ characters
- Shows cross-file dependencies with 🔴 marker
- Hot functions (>10 calls) highlighted in accent color

### 4. Update load function

Remove D3.js loading, call simple tree renderers instead:
```javascript
// Render the tree
if (_devGraphLevel === 'file') {
  _devRenderFileTree(data.nodes, data.edges);
} else {
  _devRenderFunctionTree(data.nodes, data.edges);
}
```

### 5. Add collapse/expand for function view

```javascript
var _devCollapsedFiles = new Set();

function _devToggleFile(file) {
  if (_devCollapsedFiles.has(file)) {
    _devCollapsedFiles.delete(file);
  } else {
    _devCollapsedFiles.add(file);
  }
  _devRenderFunctionTree(_devGraphData.nodes, _devGraphData.edges);
}
```

## Visual Examples

### File View:
```
● core.js                         150 funcs, 6000 LOC
  → feed.js (45×), quality.js (23×), settings.js (12×)
│
● pixel-pet.js                    12 funcs, 300 LOC
│
● feed.js                         80 funcs, 3000 LOC
  → core.js (18×), quality.js (9×)
│
● quality.js                      45 funcs, 2000 LOC
...
```

### Function View:
```
▼ 📁 core.js (150 functions)
  ├─ renderDevPanel             25× called
  ├─ openDevStats               15× called • 1 cross-file
  │  🔴 → renderDevPanel (core.js)
  ├─ wmOpen                     45× called • 3 cross-file
  │  🔴 → renderPapers (feed.js) → openSettings (settings.js)
  └─ _devNavigateTo             8× called

▼ 📁 feed.js (80 functions)
  ├─ renderPapers               12× called • 2 cross-file
  │  🔴 → qualityFilterPapers (quality.js)
  ├─ _renderPaperCard           120× called
  └─ qualityFilterPapers        5× called
```

## Benefits

✅ **No external dependencies** - No D3.js (saves 200KB)
✅ **Instant loading** - No script loading delay
✅ **Simple & clean** - Text-based, easy to read
✅ **Familiar** - Looks like `git log --graph`
✅ **Fast** - Plain HTML rendering
✅ **Accessible** - Works everywhere, screen reader friendly
✅ **Collapsible** - File groups can expand/collapse
✅ **Filterable** - Search and file filter still work

## Implementation

See `/tmp/dev-tree-renders.js` for complete implementation of:
- `_devRenderFileTree(nodes, edges)`
- `_devRenderFunctionTree(allNodes, allEdges)`
- `_devToggleFile(file)`

These replace the old D3-based functions entirely.
