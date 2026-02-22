// dev-panel.js — Dev Stats panel (extracted from dashboard.js)
import Settings from '/js/core/core-settings.js';
import { apiGet } from '/js/api.js';
import { escapeHtml } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { islandRemove, showAchievement } from '/js/core/core-ui.js';

// ── Dev Stats ──

export let _devFpsRaf = null;
export function clearDevFpsRaf() { if (_devFpsRaf) { cancelAnimationFrame(_devFpsRaf); _devFpsRaf = null; } }

export var _devChartId = 0;
export var _devChartRegistry = [];

// Dev panel navigation structure
export const DEV_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'function-registry', label: 'Function Registry' },
  { id: 'load-order', label: 'Load Order' },
  { id: 'dependency-graph', label: 'Dependency Graph' },
  { id: 'git-log', label: 'Git Log' },
  { id: 'feed-server', label: 'Feed Server' },
  { id: 'tools', label: 'Dev Tools' }
];

export var _devActiveSection = null;
export var _devD3Loaded = false;
export var _devGraphLevel = 'file'; // 'file' or 'function'
export var _devGraphData = null;

export function _devLineChart(hist, yKey, label, color, tooltipFn) {
  if (!hist || hist.length < 2) return `<div class="text-sm mt-4" style="color:var(--nr-text-quaternary)">Not enough data for ${label}</div>`;
  const id = '_dchart_' + (_devChartId++);
  const W = 400, H = 130, PAD = { t: 16, r: 12, b: 24, l: 42 };
  const cw = W - PAD.l - PAD.r, ch = H - PAD.t - PAD.b;
  const vals = hist.map(h => typeof yKey === 'function' ? yKey(h) : h[yKey]);
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const range = maxV - minV || 1;
  function xp(i) { return PAD.l + (i / (hist.length - 1)) * cw; }
  function yp(v) { return PAD.t + ch - ((v - minV) / range) * ch; }
  const gridColor = 'rgba(255,255,255,0.06)';
  const textColor = 'var(--nr-text-quaternary)';
  let svg = `<text x="${PAD.l}" y="11" fill="${textColor}" font-size="9" font-weight="600">${label}</text>`;
  const yTicks = 3;
  for (let i = 0; i <= yTicks; i++) {
    const val = minV + (range / yTicks) * i;
    const yy = yp(val);
    svg += `<line x1="${PAD.l}" y1="${yy}" x2="${W - PAD.r}" y2="${yy}" stroke="${gridColor}"/>`;
    svg += `<text x="${PAD.l - 4}" y="${yy + 3}" text-anchor="end" fill="${textColor}" font-size="8">${Math.round(val).toLocaleString()}</text>`;
  }
  // Area fill
  const pts = hist.map((h, i) => `${xp(i)},${yp(vals[i])}`);
  const areaPts = [`${xp(0)},${PAD.t + ch}`, ...pts, `${xp(hist.length - 1)},${PAD.t + ch}`].join(' ');
  svg += `<polygon points="${areaPts}" fill="${color}" opacity="0.07"/>`;
  // Line
  svg += `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>`;
  // Static dots
  hist.forEach((h, i) => {
    svg += `<circle cx="${xp(i)}" cy="${yp(vals[i])}" r="2" fill="${color}"/>`;
  });
  // Crosshair line + hover dot (hidden by default)
  svg += `<line id="${id}-vline" x1="0" y1="${PAD.t}" x2="0" y2="${PAD.t + ch}" stroke="${color}" stroke-width="1" stroke-dasharray="3,2" opacity="0.5" style="display:none"/>`;
  svg += `<circle id="${id}-hdot" cx="0" cy="0" r="4" fill="${color}" stroke="var(--nr-bg-body)" stroke-width="1.5" style="display:none"/>`;
  // Invisible hover rect
  svg += `<rect x="${PAD.l}" y="${PAD.t}" width="${cw}" height="${ch}" fill="transparent" style="cursor:crosshair" id="${id}-hover"/>`;
  // X labels
  const step = Math.max(1, Math.floor(hist.length / 5));
  for (let i = 0; i < hist.length; i += step) {
    svg += `<text x="${xp(i)}" y="${H - 3}" text-anchor="middle" fill="${textColor}" font-size="7">${hist[i].date.slice(5)}</text>`;
  }
  // Store chart data for binding
  _devChartRegistry.push({ id, hist, vals, color, tooltipFn, W, H, PAD, cw, ch, minV, range, xp, yp });
  return `<div class="dev-chart-wrap" style="position:relative"><svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px" id="${id}">${svg}</svg><div id="${id}-tip" class="dev-chart-tooltip"></div></div>`;
}

export function _devBindCharts() {
  _devChartRegistry.forEach(c => {
    const svg = document.getElementById(c.id);
    const tip = document.getElementById(c.id + '-tip');
    const vline = document.getElementById(c.id + '-vline');
    const hdot = document.getElementById(c.id + '-hdot');
    const hoverRect = document.getElementById(c.id + '-hover');
    if (!svg || !tip || !hoverRect) return;

    function nearest(mx) {
      const rect = svg.getBoundingClientRect();
      const svgX = (mx - rect.left) / rect.width * c.W;
      let best = 0, bestDist = Infinity;
      for (let i = 0; i < c.hist.length; i++) {
        const d = Math.abs(c.xp(i) - svgX);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      return best;
    }

    hoverRect.addEventListener('mousemove', e => {
      const i = nearest(e.clientX);
      const h = c.hist[i];
      const cx = c.xp(i), cy = c.yp(c.vals[i]);
      vline.setAttribute('x1', cx); vline.setAttribute('x2', cx);
      vline.style.display = '';
      hdot.setAttribute('cx', cx); hdot.setAttribute('cy', cy);
      hdot.style.display = '';
      const tipText = c.tooltipFn ? c.tooltipFn(h) : `${c.vals[i].toLocaleString()}`;
      const lines = tipText.split('\n');
      tip.innerHTML = `<div style="font-weight:600;margin-bottom:1px">${h.date.slice(5)}</div>` + lines.map(l => `<div>${l}</div>`).join('');
      tip.style.display = 'block';
      // Position tooltip relative to chart container
      const rect = svg.getBoundingClientRect();
      const pxX = (cx / c.W) * rect.width;
      const pxY = (cy / c.H) * rect.height;
      const tipW = tip.offsetWidth;
      const flip = pxX + tipW + 12 > rect.width;
      tip.style.left = flip ? (pxX - tipW - 8) + 'px' : (pxX + 10) + 'px';
      tip.style.top = Math.max(0, pxY - tip.offsetHeight / 2) + 'px';
    });
    hoverRect.addEventListener('mouseleave', () => {
      vline.style.display = 'none';
      hdot.style.display = 'none';
      tip.style.display = 'none';
    });
  });
}

export function _devRelativeTime(d) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return d.toLocaleDateString();
}

export function renderDevPanel() {
  if (_devFpsRaf) { cancelAnimationFrame(_devFpsRaf); _devFpsRaf = null; }

  const sidebar = document.getElementById('dev-sidebar');
  const contentPane = document.getElementById('dev-content-pane');
  if (!sidebar || !contentPane) return;

  // Load active section from localStorage or default to 'overview'
  if (!_devActiveSection) {
    _devActiveSection = Settings.get('devPanelSection') || 'overview';
  }

  // Render sidebar navigation
  const sidebarView = window.VStack(DEV_SECTIONS.map(function(section) {
    const isActive = section.id === _devActiveSection;
    const item = window.Text(section.label)
      .styles({
        padding:'12px 16px',
        borderLeft:'3px solid ' + (isActive ? 'var(--nr-accent)' : 'transparent'),
        background: isActive ? 'var(--nr-bg-raised)' : 'transparent',
        color: isActive ? 'var(--nr-text-primary)' : 'var(--nr-text-secondary)',
        fontSize:'0.8rem',
        fontWeight: isActive ? '600' : '400',
        transition:'all var(--motion-fast) var(--motion-smooth)'
      }).cursor()
      .onTap(function() { _devNavigateTo(section.id); });
    if (!isActive) {
      item.onHover(
        function() { item.el.style.background = 'var(--nr-bg-raised)'; },
        function() { item.el.style.background = 'transparent'; }
      );
    }
    return item;
  }));
  AetherUI.mount(sidebarView, sidebar);

  // Render active section content
  renderDevSection(_devActiveSection);
}

export function _devNavigateTo(sectionId) {
  _devActiveSection = sectionId;
  Settings.set('devPanelSection', sectionId);
  renderDevPanel();
}

export function renderDevSection(sectionId) {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;
  // Clean up feed server polling when navigating away
  if (_feedServerPoll && sectionId !== 'feed-server') { clearInterval(_feedServerPoll); _feedServerPoll = null; }

  const renderers = {
    'overview': _renderDevOverview,
    'function-registry': _renderDevFunctionRegistry,
    'load-order': _renderDevLoadOrder,
    'dependency-graph': _renderDevDependencyGraph,
    'git-log': _renderDevGitLog,
    'feed-server': _renderDevFeedServer,
    'tools': _renderDevTools,
  };

  AetherUI.mount(window.Text('Loading\u2026').className('text-sm').foreground('quaternary'), contentPane);
  const render = renderers[sectionId];
  if (render) render();
  else AetherUI.mount(window.Text('Unknown section').className('text-sm').foreground('quaternary'), contentPane);
}

// ── Dev helpers ──

function _devStatCard(value, label, color) {
  return window.VStack(
    window.Text(String(value)).className('dev-stat-value').styles({ fontSize: '24px', color: color || 'var(--nr-text-primary)' }),
    window.Text(label).className('dev-stat-label').styles({ fontSize: '0.65rem' })
  ).className('dev-stat-card').styles({ padding: '12px' });
}

function _devStatGrid() {
  const items = Array.prototype.slice.call(arguments);
  return Grid(items)
    .styles({ gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: '12px', marginTop: '8px' });
}

// ── Overview Section ──
export async function _renderDevOverview() {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  const header = window.VStack(
    window.Text('Project Health').styles({color:'var(--nr-text-primary)', fontSize:'1.25rem', fontWeight:'700', margin:'0 0 4px 0'}),
    window.Text('Real-time metrics and performance monitoring').styles({color:'var(--nr-text-quaternary)', fontSize:'0.75rem', margin:'0'})
  ).styles({marginBottom:'24px'});
  const statsCards = new window.View('div');
  statsCards.className('dev-stats-cards').id('dev-stats-cards');
  const chartArea = new window.View('div');
  chartArea.id('dev-loc-chart');
  AetherUI.mount(window.VStack(header, statsCards, chartArea), contentPane);

  const cards = document.getElementById('dev-stats-cards');
  const chart = document.getElementById('dev-loc-chart');

  AetherUI.mount(window.Text('Loading\u2026').className('text-sm').foreground('quaternary'), cards);

  let data;
  try {
    data = await apiGet('/api/dev-stats');
    if (data.error) throw new Error(data.error);
  } catch (e) {
    AetherUI.mount(window.Text('Error: ' + e.message).className('text-sm').foreground('quaternary'), cards);
    return;
  }

  // Stat cards
  const stats = [
    { value: (data.project_age_days || 0) + 'd', label: 'Project Age' },
    { value: data.total_loc.toLocaleString(), label: 'Total Lines' },
    { value: data.files, label: 'Files' },
    { value: (data.total_commits || 0).toLocaleString(), label: 'Commits' },
    { value: '—', label: 'FPS', id: 'dev-fps-value' },
    { value: (data.ram_mb || 0) + ' MB', label: 'RAM' },
    { value: (data.project_mb || 0) + ' MB', label: 'Size' },
  ];
  const cardsView = window.HStack(stats.map(function(s) {
    const valView = window.Text(String(s.value)).className('dev-stat-value');
    if (s.id) valView.id(s.id);
    return window.VStack(valView, window.Text(s.label).className('dev-stat-label')).className('dev-stat-card');
  }));
  AetherUI.mount(cardsView, cards);

  // FPS counter
  const fpsEl = document.getElementById('dev-fps-value');
  if (fpsEl) {
    const frameTimes = [];
    let lastUpdate = performance.now();
    function fpsLoop(now) {
      frameTimes.push(now);
      while (frameTimes.length > 60) frameTimes.shift();
      if (now - lastUpdate > 500 && frameTimes.length > 1) {
        const elapsed = frameTimes[frameTimes.length - 1] - frameTimes[0];
        fpsEl.textContent = Math.round((frameTimes.length - 1) / (elapsed / 1000));
        lastUpdate = now;
      }
      _devFpsRaf = requestAnimationFrame(fpsLoop);
    }
    _devFpsRaf = requestAnimationFrame(fpsLoop);
  }

  _devChartId = 0;
  _devChartRegistry = [];

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b4451a';
  const hist = data.loc_history || [];

  // LOC chart
  const locChart = _devLineChart(hist, 'lines', 'Lines of Code', accent, h =>
    `${h.lines.toLocaleString()} lines\n<span style="color:#3fb950">+${(h.added || 0).toLocaleString()}</span> <span style="color:#f85149">-${(h.deleted || 0).toLocaleString()}</span>`
  );

  // Build usage history arrays from all available dates
  const usage = data.usage_history || {};
  const usageDates = Object.keys(usage).sort();
  const chartDates = usageDates.length >= 2 ? usageDates : hist.map(h => h.date);
  function usageSeries(eventName) {
    return chartDates.map(d => ({ date: d, count: (usage[d] && usage[d][eventName]) || 0 }));
  }
  const toolSeries = usageSeries('tool_call');
  const aetherSeries = usageSeries('aether_chat');

  const toolChart = _devLineChart(toolSeries, 'count', 'Tool Calls', '#6d9eeb', h => `${h.count} tool calls`);
  const aetherChart = _devLineChart(aetherSeries, 'count', 'Aether Chats', '#93c47d', h => `${h.count} aether chats`);

  const cpd = data.commits_per_day || [];
  const commitsChart = cpd.length >= 2 ? _devLineChart(cpd, 'count', 'Commits / Day', '#f6b26b', h => `${h.count} commits`) : '';

  AetherUI.mount(window.RawHTML('<div class="dev-charts-grid">' +
    '<div class="dev-loc-chart">' + locChart + '</div>' +
    '<div class="dev-loc-chart">' + commitsChart + '</div>' +
    '<div class="dev-loc-chart">' + toolChart + '</div>' +
    '<div class="dev-loc-chart">' + aetherChart + '</div>' +
  '</div>'), chart);
  _devBindCharts();
}

// ── Function Registry Section ──
export function _renderDevFunctionRegistry() {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  const header = window.VStack(
    window.Text('Function Registry').styles({color:'var(--nr-text-primary)', fontSize:'1.25rem', fontWeight:'700', margin:'0 0 4px 0'}),
    window.Text('Analyze global functions, duplicates, and unused code across all vanilla JS files.').styles({color:'var(--nr-text-quaternary)', fontSize:'0.75rem', margin:'0'})
  ).styles({marginBottom:'24px'});

  const analyzeBtn = window.Button('Analyze Functions').className('dev-btn-primary').id('dev-fn-reg-btn').onTap(function() { _devRunFunctionRegistry(); });
  const reportBtn = window.Button('Open HTML Report').className('dev-btn-secondary').onTap(function() { _devOpenFunctionRegistryReport(); });
  const statusEl = window.Text('').id('dev-fn-reg-status').styles({color:'var(--nr-text-quaternary)', fontSize:'0.7rem'});
  const controls = window.HStack(analyzeBtn, reportBtn, statusEl).gap('8px').wrap().styles({marginBottom:'16px'});
  const results = new window.View('div');
  results.id('dev-fn-reg-results');

  AetherUI.mount(window.VStack(header, controls, results), contentPane);
}

// ── Load Order Section ──
export function _renderDevLoadOrder() {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  const header = window.VStack(
    window.Text('Script Load Order').styles({color:'var(--nr-text-primary)', fontSize:'1.25rem', fontWeight:'700', margin:'0 0 4px 0'}),
    window.Text('Analyze script dependencies and detect forward references or circular dependencies.').styles({color:'var(--nr-text-quaternary)', fontSize:'0.75rem', margin:'0'})
  ).styles({marginBottom:'24px'});

  const runBtn = window.Button('Run Analysis').className('dev-btn-primary').id('dev-load-ord-btn').onTap(function() { _devRunLoadOrderAnalysis(); });
  const statusEl = window.Text('').id('dev-load-ord-status').styles({color:'var(--nr-text-quaternary)', fontSize:'0.7rem'});
  const controls = window.HStack(runBtn, statusEl).gap('8px').styles({marginBottom:'16px'});
  const results = new window.View('div');
  results.id('dev-load-ord-results');

  AetherUI.mount(window.VStack(header, controls, results), contentPane);
}

// ── Dependency Graph Section ──
export function _renderDevDependencyGraph() {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  const header = window.VStack(
    window.Text('Dependency Graph').styles({color:'var(--nr-text-primary)', fontSize:'1.25rem', fontWeight:'700', margin:'0 0 4px 0'}),
    window.Text('Interactive dependency visualization. Switch between file-level and function-level views.').styles({color:'var(--nr-text-quaternary)', fontSize:'0.75rem', margin:'0'})
  ).styles({marginBottom:'24px'});

  // Controls Row 1
  const loadBtn = window.Button('Load Graph').className('dev-btn-primary').id('dev-dep-graph-btn').onTap(function() { _devLoadDependencyGraph(); });
  const fileToggle = window.Button('Files').id('dev-graph-level-file')
    .styles({background:'var(--nr-accent)', color:'#fff', border:'none', padding:'6px 14px', fontSize:'0.75rem', fontWeight:'600', transition:'all var(--motion-fast) var(--motion-smooth)'})
    .cursor().onTap(function() { _devSetGraphLevel('file'); });
  const funcToggle = window.Button('Functions').id('dev-graph-level-function')
    .styles({background:'transparent', color:'var(--nr-text-primary)', border:'none', padding:'6px 14px', fontSize:'0.75rem', transition:'all var(--motion-fast) var(--motion-smooth)'})
    .cursor().onTap(function() { _devSetGraphLevel('function'); });
  const toggleGroup = window.HStack(fileToggle, funcToggle)
    .styles({background:'var(--nr-bg-surface)', border:'1px solid var(--nr-border-default)', borderRadius:'6px', overflow:'hidden'});
  const resetBtn = window.Button('Reset Zoom').className('dev-btn-secondary').id('dev-graph-reset-btn').visible(false)
    .onTap(function() { _devResetGraphZoom(); });
  const statusEl = window.Text('').id('dev-dep-graph-status').styles({color:'var(--nr-text-quaternary)', fontSize:'0.7rem'});
  const controlsRow1 = window.HStack(loadBtn, toggleGroup, resetBtn, statusEl)
    .gap('8px').styles({marginBottom:'12px'}).wrap();

  // Controls Row 2 (function view)
  const searchInput = new window.View('input').id('dev-graph-search').className('dev-input')
    .attr('type', 'text').attr('placeholder', 'Search functions...')
    .on('input', function() { _devGraphSearch(searchInput.el.value); });
  const fileFilter = new window.View('select').id('dev-graph-file-filter').className('dev-input')
    .add(window.RawHTML('<option value="">All Files</option>'));
  fileFilter.onChange(function() { _devGraphFilterByFile(fileFilter.el.value); });
  const unusedCb = new window.View('input').attr('type', 'checkbox').id('dev-graph-show-unused');
  unusedCb.onChange(function() { _devGraphToggleUnused(unusedCb.el.checked); });
  const unusedLabel = new window.View('label')
    .styles({display:'flex', alignItems:'center', gap:'4px', fontSize:'0.75rem', color:'var(--nr-text-quaternary)'})
    .add(unusedCb, window.Text('Show unused'));
  const controlsRow2 = window.HStack(searchInput, fileFilter, unusedLabel)
    .id('dev-graph-function-controls')
    .styles({display:'none', marginBottom:'12px'}).gap('8px').wrap();

  // Legend
  function _legendItem(color, radius, text) {
    return window.RawHTML('<div style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:8px;height:8px;border-radius:' + radius + ';background:' + color + '"></span>' + text + '</div>');
  }
  const legend = window.HStack(
    _legendItem('#ef4444', '50%', 'Cross-file dependency'),
    _legendItem('var(--nr-text-quaternary)', '50%', 'Same-file dependency'),
    _legendItem('var(--nr-accent)', '2px', 'File group'),
    window.RawHTML('<div style="margin-left:8px">Click to expand/collapse</div>')
  ).gap('16px').styles({marginBottom:'12px', fontSize:'0.65rem', color:'var(--nr-text-quaternary)'}).wrap();

  // Graph container
  const graphContainer = new window.View('div');
  graphContainer.id('dev-dep-graph-container')
    .styles({background:'var(--nr-bg-surface)', border:'1px solid var(--nr-border-default)', borderRadius:'6px', padding:'16px', maxHeight:'600px', overflowY:'auto', fontFamily:'monospace', fontSize:'12px', lineHeight:'1.6'});
  AetherUI.mount(window.Text('Click "Load Graph" to start...').foreground('quaternary'), graphContainer.el);

  AetherUI.mount(window.VStack(header, controlsRow1, controlsRow2, legend, graphContainer), contentPane);
}

export function _devSetGraphLevel(level) {
  _devGraphLevel = level;

  // Update button styles
  const fileBtn = document.getElementById('dev-graph-level-file');
  const funcBtn = document.getElementById('dev-graph-level-function');
  const funcControls = document.getElementById('dev-graph-function-controls');

  if (level === 'file') {
    fileBtn.style.background = 'var(--nr-accent)';
    fileBtn.style.color = '#fff';
    funcBtn.style.background = 'transparent';
    funcBtn.style.color = 'var(--nr-text-primary)';
    funcControls.style.display = 'none';
  } else {
    fileBtn.style.background = 'transparent';
    fileBtn.style.color = 'var(--nr-text-primary)';
    funcBtn.style.background = 'var(--nr-accent)';
    funcBtn.style.color = '#fff';
    funcControls.style.display = 'flex';
  }

  // Reload if data already loaded
  if (_devGraphData) {
    _devLoadDependencyGraph();
  }
}

export async function _devLoadDependencyGraph() {
  const btn = document.getElementById('dev-dep-graph-btn');
  const status = document.getElementById('dev-dep-graph-status');
  const container = document.getElementById('dev-dep-graph-container');

  if (!btn || !status || !container) return;

  btn.disabled = true;
  btn.textContent = 'Loading...';
  status.textContent = 'Generating graph data...';

  try {
    const data = await apiGet(`/api/dependency-graph?level=${_devGraphLevel}`);

    if (data.status === 'error') {
      status.textContent = 'Error: ' + data.message;
      status.style.color = 'var(--nr-text-error, #ef4444)';
      return;
    }

    _devGraphData = data;

    // Update file filter dropdown for function view
    if (_devGraphLevel === 'function') {
      const fileFilter = document.getElementById('dev-graph-file-filter');
      const files = [...new Set(data.nodes.map(n => n.file))].sort();
      fileFilter.innerHTML = '<option value="">All Files</option>' +
        files.map(f => `<option value="${f}">${f}</option>`).join('');
    }

    const nodeLabel = _devGraphLevel === 'file' ? 'files' : 'functions';
    status.textContent = `${data.nodes.length} ${nodeLabel}, ${data.edges.length} dependencies`;
    status.style.color = 'var(--nr-text-success, #22c55e)';

    // Render the tree
    if (_devGraphLevel === 'file') {
      _devRenderFileTree(data.nodes, data.edges);
    } else {
      _devRenderFunctionTree(data.nodes, data.edges);
    }

  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.style.color = 'var(--nr-text-error, #ef4444)';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Reload Graph';
  }
}

export var _devCollapsedFiles = new Set();

export function _devRenderFileTree(nodes, edges) {
  const container = document.getElementById('dev-dep-graph-container');
  if (!container) return;

  nodes.sort((a, b) => a.order - b.order);

  const deps = new Map();
  edges.forEach(e => {
    const src = e.source.id || e.source;
    const tgt = e.target.id || e.target;
    if (!deps.has(src)) deps.set(src, []);
    deps.get(src).push({ target: tgt, calls: e.calls });
  });

  const wrapper = new window.View('div');
  wrapper.cssText('color:var(--nr-text-primary)');

  const btnRow = new window.View('div');
  btnRow.cssText('margin-bottom:12px;display:flex;gap:8px');
  const expandBtn = new window.View('button').text('Expand All')
    .cssText('background:var(--nr-bg-raised);color:var(--nr-text-primary);border:1px solid var(--nr-border-default);border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer')
    .onTap(function() { _devExpandAllFiles(); });
  const collapseBtn = new window.View('button').text('Collapse All')
    .cssText('background:var(--nr-bg-raised);color:var(--nr-text-primary);border:1px solid var(--nr-border-default);border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer')
    .onTap(function() { _devCollapseAllFiles(); });
  btnRow.add(expandBtn, collapseBtn);
  wrapper.add(btnRow);

  nodes.forEach(function(node, i) {
    const isLast = i === nodes.length - 1;
    const isCollapsed = _devCollapsedFiles.has(node.id);
    const nodeDeps = deps.get(node.id) || [];

    const toggleDiv = new window.View('div').cssText('cursor:pointer').add(
      window.Text(isCollapsed ? '▶' : '▼').cssText('color:var(--nr-accent)'),
      window.Text(' ' + node.id).cssText('color:var(--nr-text-primary);font-weight:600'),
      window.Text(node.functions + ' funcs, ' + node.loc + ' LOC').cssText('color:var(--nr-text-quaternary);margin-left:12px;font-size:11px')
    );
    (function(nodeId) { toggleDiv.onTap(function() { _devToggleFileInFileView(nodeId); }); })(node.id);

    const nodeDiv = new window.View('div').cssText('margin-bottom:4px').add(toggleDiv);

    if (!isCollapsed && nodeDeps.length > 0) {
      const depRows = nodeDeps.slice(0, 5).map(function(dep) {
        return new window.View('div').add(
          window.Text('→ ' + dep.target + ' '),
          window.Text('(' + dep.calls + '× calls)').cssText('opacity:0.7')
        );
      });
      if (nodeDeps.length > 5) {
        depRows.push(window.Text('→ +' + (nodeDeps.length - 5) + ' more dependencies...'));
      }
      const depsDiv = new window.View('div')
        .cssText('margin-left:24px;color:var(--nr-text-quaternary);font-size:11px;margin-top:2px');
      depRows.forEach(function(r) { depsDiv.add(r); });
      nodeDiv.add(depsDiv);
    }
    wrapper.add(nodeDiv);

    if (!isLast) {
      wrapper.add(window.Text('│').cssText('color:var(--nr-border-default);margin-left:5px'));
    }
  });

  AetherUI.mount(wrapper, container);
}

export function _devToggleFileInFileView(file) {
  if (_devCollapsedFiles.has(file)) {
    _devCollapsedFiles.delete(file);
  } else {
    _devCollapsedFiles.add(file);
  }
  if (_devGraphData && _devGraphLevel === 'file') {
    _devRenderFileTree(_devGraphData.nodes, _devGraphData.edges);
  }
}

export function _devExpandAllFiles() {
  _devCollapsedFiles.clear();
  if (_devGraphData) {
    if (_devGraphLevel === 'file') {
      _devRenderFileTree(_devGraphData.nodes, _devGraphData.edges);
    } else {
      _devRenderFunctionTree(_devGraphData.nodes, _devGraphData.edges);
    }
  }
}

export function _devCollapseAllFiles() {
  if (_devGraphData) {
    if (_devGraphLevel === 'file') {
      _devGraphData.nodes.forEach(n => _devCollapsedFiles.add(n.id));
      _devRenderFileTree(_devGraphData.nodes, _devGraphData.edges);
    } else {
      _devGraphData.nodes.forEach(n => _devCollapsedFiles.add(n.file));
      _devRenderFunctionTree(_devGraphData.nodes, _devGraphData.edges);
    }
  }
}

export function _devRenderFunctionTree(allNodes, allEdges) {
  const container = document.getElementById('dev-dep-graph-container');
  if (!container) return;

  const showUnused = document.getElementById('dev-graph-show-unused')?.checked || false;
  const fileFilter = document.getElementById('dev-graph-file-filter')?.value || '';

  const nodes = allNodes.filter(n => {
    if (fileFilter && n.file !== fileFilter) return false;
    if (!showUnused && n.callCount === 0) return false;
    return true;
  });

  const fileGroups = {};
  nodes.forEach(node => {
    if (!fileGroups[node.file]) fileGroups[node.file] = [];
    fileGroups[node.file].push(node);
  });

  // Default all files to collapsed on first render
  if (_devCollapsedFiles.size === 0) {
    Object.keys(fileGroups).forEach(file => _devCollapsedFiles.add(file));
  }

  const edges = allEdges.filter(e => {
    const src = nodes.find(n => n.id === e.source);
    const tgt = nodes.find(n => n.id === e.target);
    return src && tgt;
  });

  const deps = new Map();
  edges.forEach(e => {
    if (!deps.has(e.source)) deps.set(e.source, []);
    deps.get(e.source).push({ target: e.target, calls: e.calls });
  });

  const wrapper = new window.View('div');
  wrapper.cssText('color:var(--nr-text-primary)');

  const btnRow = new window.View('div');
  btnRow.cssText('margin-bottom:12px;display:flex;gap:8px');
  const expandBtn = new window.View('button').text('Expand All')
    .cssText('background:var(--nr-bg-raised);color:var(--nr-text-primary);border:1px solid var(--nr-border-default);border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer')
    .onTap(function() { _devExpandAllFiles(); });
  const collapseBtn = new window.View('button').text('Collapse All')
    .cssText('background:var(--nr-bg-raised);color:var(--nr-text-primary);border:1px solid var(--nr-border-default);border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer')
    .onTap(function() { _devCollapseAllFiles(); });
  btnRow.add(expandBtn, collapseBtn);
  wrapper.add(btnRow);

  Object.keys(fileGroups).sort().forEach(function(file) {
    const isCollapsed = _devCollapsedFiles.has(file);
    const funcs = fileGroups[file];

    const fileHeader = new window.View('div')
      .cssText('cursor:pointer;color:var(--nr-accent);font-weight:600;margin-bottom:4px')
      .add(
        window.Text((isCollapsed ? '▶' : '▼') + ' \uD83D\uDCC1 ' + file + ' '),
        window.Text('(' + funcs.length + ' functions)').cssText('font-weight:normal;color:var(--nr-text-quaternary);font-size:11px')
      );
    (function(f) { fileHeader.onTap(function() { _devToggleFile(f); }); })(file);

    const fileDiv = new window.View('div').cssText('margin-bottom:8px').add(fileHeader);

    if (!isCollapsed) {
      funcs.forEach(function(func, i) {
        const isLast = i === funcs.length - 1;
        const prefix = isLast ? '└─' : '├─';
        const funcDeps = deps.get(func.id) || [];
        const crossFileDeps = funcDeps.filter(function(d) {
          const target = allNodes.find(function(n) { return n.id === d.target; });
          return target && target.file !== func.file;
        });

        const funcRow = new window.View('div').cssText('margin-left:16px;margin-bottom:2px').add(
          window.Text(prefix).cssText('color:var(--nr-border-default)'),
          window.Text(' '),
          window.Text(func.id).cssText('color:' + (func.callCount > 10 ? 'var(--nr-accent)' : 'var(--nr-text-primary)')),
          window.Text(func.callCount + '\u00d7 called' + (crossFileDeps.length > 0 ? ' \u2022 ' + crossFileDeps.length + ' cross-file' : ''))
            .cssText('color:var(--nr-text-quaternary);margin-left:8px;font-size:10px')
        );

        if (crossFileDeps.length > 0) {
          const crossDiv = new window.View('div').cssText('margin-left:32px;color:var(--nr-text-quaternary);font-size:10px');
          crossFileDeps.slice(0, 2).forEach(function(dep) {
            const target = allNodes.find(function(n) { return n.id === dep.target; });
            crossDiv.add(
              window.Text('\u2192').cssText('color:#ef4444'),
              window.Text(' ' + dep.target + ' '),
              window.Text('(' + (target ? target.file : '') + ') ').cssText('opacity:0.7')
            );
          });
          if (crossFileDeps.length > 2) {
            crossDiv.add(window.Text('+' + (crossFileDeps.length - 2) + ' more'));
          }
          funcRow.add(crossDiv);
        }
        fileDiv.add(funcRow);

        if (!isLast) {
          fileDiv.add(window.Text('│').cssText('margin-left:16px;color:var(--nr-border-default)'));
        }
      });
    }
    wrapper.add(fileDiv);
  });

  AetherUI.mount(wrapper, container);
}

export function _devToggleFile(file) {
  if (_devCollapsedFiles.has(file)) {
    _devCollapsedFiles.delete(file);
  } else {
    _devCollapsedFiles.add(file);
  }
  if (_devGraphData && _devGraphLevel === 'function') {
    _devRenderFunctionTree(_devGraphData.nodes, _devGraphData.edges);
  }
}

export function _devGraphSearch(query) {
  if (!_devGraphData || _devGraphLevel !== 'function') return;

  query = query.toLowerCase().trim();
  if (!query) {
    _devRenderFunctionGraph(_devGraphData.nodes, _devGraphData.edges);
    return;
  }

  const filtered = _devGraphData.nodes.filter(n =>
    n.id.toLowerCase().includes(query)
  );

  const filteredIds = new Set(filtered.map(n => n.id));
  const edges = _devGraphData.edges.filter(e =>
    filteredIds.has(e.source) && filteredIds.has(e.target)
  );

  _devRenderFunctionGraph(filtered, edges);
}

export function _devGraphFilterByFile(file) {
  if (!_devGraphData || _devGraphLevel !== 'function') return;
  _devRenderFunctionGraph(_devGraphData.nodes, _devGraphData.edges);
}

export function _devGraphToggleUnused(show) {
  if (!_devGraphData || _devGraphLevel !== 'function') return;
  _devRenderFunctionGraph(_devGraphData.nodes, _devGraphData.edges);
}

// ── Git Log Section ──
export async function _renderDevGitLog() {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  const header = window.VStack(
    window.Text('Git History').styles({color:'var(--nr-text-primary)', fontSize:'1.25rem', fontWeight:'700', margin:'0 0 4px 0'}),
    window.Text('Recent commit activity').styles({color:'var(--nr-text-quaternary)', fontSize:'0.75rem', margin:'0'})
  ).styles({marginBottom:'24px'});
  const logContainer = new window.View('div');
  logContainer.id('dev-git-log-container');
  AetherUI.mount(window.VStack(header, logContainer), contentPane);

  const container = document.getElementById('dev-git-log-container');
  AetherUI.mount(window.Text('Loading\u2026').className('text-sm').foreground('quaternary'), container);

  try {
    const data = await apiGet('/api/dev-stats');
    const log = data.git_log || [];

    AetherUI.mount(window.Show(log.length,
      function() {
        _devGitLogState = window.State(log);
        _devGitLogOffset = log.length;
        const logList = new window.View('div').id('dev-git-log-list').className('dev-git-log-list');
        logList.add(window.ForEach(_devGitLogState, function(c) { return c.sha; }, _devCommitRow));
        return logList;
      },
      function() { return window.Text('No commits found').className('text-sm').foreground('quaternary'); }
    ), container);
    if (log.length >= 20) _devAppendLoadMoreBtn();
  } catch (e) {
    AetherUI.mount(window.Text('Error: ' + e.message).className('text-sm').foreground('quaternary'), container);
  }
}

// ── Dev Tools Section ──
// ── Feed Server Section ──
var _feedServerPoll = null;
export function _renderDevFeedServer() {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;
  if (_feedServerPoll) { clearInterval(_feedServerPoll); _feedServerPoll = null; }

  const SERVER = 'http://localhost:8400';

  const header = window.VStack(
    window.Text('Feed Server').styles({color:'var(--nr-text-primary)', fontSize:'1.25rem', fontWeight:'700', margin:'0 0 4px 0'}),
    window.Text('Go feed server status and controls').styles({color:'var(--nr-text-quaternary)', fontSize:'0.75rem', margin:'0'})
  ).styles({marginBottom:'24px'});

  var statusDot = window.Text('\u25CF').styles({fontSize:'10px', transition:'color 0.3s'});
  var statusLabel = window.Text('Checking\u2026').styles({color:'var(--nr-text-quaternary)', fontSize:'0.75rem'});
  var statusRow = window.HStack(statusDot, statusLabel).gap('6px').styles({alignItems:'center'});

  var statsContainer = new window.View('div');
  var sourcesContainer = new window.View('div');

  var refreshBtn = window.Button('Trigger Refresh').className('dev-btn-primary').onTap(function() {
    refreshBtn.el.disabled = true;
    refreshBtn.el.textContent = 'Refreshing\u2026';
    fetch(SERVER + '/api/refresh', { method: 'POST', signal: AbortSignal.timeout(30000) })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        refreshBtn.el.textContent = 'Fetched ' + (d.fetched || 0) + ' items';
        setTimeout(function() {
          refreshBtn.el.textContent = 'Trigger Refresh';
          refreshBtn.el.disabled = false;
          pollStatus();
        }, 2000);
      })
      .catch(function() {
        refreshBtn.el.textContent = 'Trigger Refresh';
        refreshBtn.el.disabled = false;
      });
  });

  AetherUI.mount(window.VStack(header, statusRow, statsContainer, refreshBtn, sourcesContainer).gap('16px'), contentPane);

  function pollStatus() {
    fetch(SERVER + '/api/timeline?sort=latest&limit=1', { signal: AbortSignal.timeout(3000) })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        statusDot.el.style.color = '#22c55e';
        statusLabel.el.textContent = 'Online \u2014 localhost:8400';
        statusLabel.el.style.color = '#22c55e';
        AetherUI.mount(_devStatGrid(
          _devStatCard(data.total || 0, 'Total Items', 'var(--nr-accent)'),
          _devStatCard((data.items || []).length > 0 ? '1' : '0', 'Responded', null)
        ), statsContainer.el);
        // Fetch source count
        fetch(SERVER + '/api/sources', { signal: AbortSignal.timeout(3000) })
          .then(function(r) { return r.json(); })
          .then(function(sources) {
            if (!Array.isArray(sources)) return;
            var rows = sources.map(function(s) {
              return window.HStack(
                window.Text(s.name || s.key).styles({fontSize:'0.75rem', color:'var(--nr-text-primary)', flex:'1'}),
                window.Text(s.cat || '').styles({fontSize:'0.65rem', color:'var(--nr-text-quaternary)'}),
                window.Text(s.special || s.url ? '\u2713' : '').styles({fontSize:'0.7rem', color:'#22c55e'})
              ).styles({padding:'4px 0', borderBottom:'1px solid var(--nr-border-default)'});
            });
            var srcHeader = window.Text(sources.length + ' Sources Registered').styles({color:'var(--nr-text-primary)', fontSize:'0.85rem', fontWeight:'600', marginBottom:'8px'});
            var srcList = window.VStack.apply(null, rows).styles({maxHeight:'300px', overflowY:'auto'});
            AetherUI.mount(window.VStack(srcHeader, srcList).styles({background:'var(--nr-bg-surface)', border:'1px solid var(--nr-border-default)', borderRadius:'8px', padding:'12px'}), sourcesContainer.el);
          }).catch(function() {});
      })
      .catch(function() {
        statusDot.el.style.color = '#ef4444';
        statusLabel.el.textContent = 'Offline \u2014 server not running';
        statusLabel.el.style.color = '#ef4444';
        AetherUI.mount(window.VStack(
          window.Text('Feed server is not running.').styles({color:'var(--nr-text-quaternary)', fontSize:'0.75rem'}),
          window.Text('Start with: cd feedserver && go run .').styles({color:'var(--nr-text-quaternary)', fontSize:'0.7rem', fontFamily:'monospace', marginTop:'4px'})
        ), statsContainer.el);
        AetherUI.mount(window.Text(''), sourcesContainer.el);
      });
  }

  pollStatus();
  _feedServerPoll = setInterval(pollStatus, 10000);
}

export function _renderDevTools() {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  const header = window.VStack(
    window.Text('Dev Tools').styles({color:'var(--nr-text-primary)', fontSize:'1.25rem', fontWeight:'700', margin:'0 0 4px 0'}),
    window.Text('Testing utilities and debugging tools').styles({color:'var(--nr-text-quaternary)', fontSize:'0.75rem', margin:'0'})
  ).styles({marginBottom:'24px'});

  const achSelect = new window.View('select').id('dev-ach-select').className('dev-input').styles({minWidth:'180px'})
    .add(window.RawHTML('<option value="bookworm">Bookworm</option><option value="curator">Curator</option><option value="critic">Critic</option><option value="explorer">Explorer</option><option value="model_switch">Model Swapper</option><option value="pixel_parent">Pixel Parent</option>'));

  const showBtn = window.Button('Show').onTap(function() { _devTestAchievement(); })
    .styles({background:'linear-gradient(135deg,#b8860b,#ffd700)', color:'#1a1400', border:'none', borderRadius:'6px', padding:'6px 14px', fontSize:'0.75rem', fontWeight:'600'}).cursor();
  const dismissBtn = window.Button('Dismiss').className('dev-btn-secondary').onTap(function() { islandRemove('achievement'); });
  const resetBtn = window.Button('Reset All').className('dev-btn-secondary').onTap(function() { _devResetAchievements(); });

  const tester = window.VStack(
    window.Text('Achievement Tester').styles({color:'var(--nr-text-primary)', fontSize:'0.85rem', fontWeight:'600', marginBottom:'12px'}),
    window.HStack(achSelect, showBtn, dismissBtn, resetBtn).id('dev-ach-tester').gap('8px').wrap()
  ).styles({background:'var(--nr-bg-surface)', border:'1px solid var(--nr-border-default)', borderRadius:'8px', padding:'16px'});

  AetherUI.mount(window.VStack(header, tester), contentPane);
}

export var _devAchievements = {
  bookworm:     { name: 'Bookworm',      desc: 'Saved your first post' },
  curator:      { name: 'Curator',       desc: 'Curated your feed by hiding a post' },
  critic:       { name: 'Critic',        desc: 'Rated your first paper' },
  explorer:     { name: 'Explorer',      desc: 'Enabled a new feed source' },
  model_switch: { name: 'Model Swapper', desc: 'Switched your AI model for the first time' },
  pixel_parent: { name: 'Pixel Parent',  desc: 'Adopted your pixel pet' },
  gaze_master:  { name: 'Gaze Master',  desc: 'Trained your eye-tracking model 5 times' }
};

export function _devTestAchievement() {
  const sel = document.getElementById('dev-ach-select');
  if (!sel) return;
  const ach = _devAchievements[sel.value];
  if (!ach) return;
  islandRemove('achievement');
  setTimeout(function() { showAchievement(ach.name, ach.desc); }, 50);
}

export function _devResetAchievements() {
  const keys = ['ach_bookworm', 'ach_curator', 'ach_critic', 'ach_explorer', 'ach_model_switch', 'ach_pixel_parent', 'ach_gaze_master'];
  keys.forEach(function(k) { Settings.remove(k); });
  islandRemove('achievement');
}

export async function _devRunFunctionRegistry() {
  const btn = document.getElementById('dev-fn-reg-btn');
  const status = document.getElementById('dev-fn-reg-status');
  const results = document.getElementById('dev-fn-reg-results');
  if (!btn || !status || !results) return;

  btn.disabled = true;
  btn.textContent = 'Analyzing...';
  status.textContent = 'Running analysis...';
  AetherUI.mount(window.Text(''), results);

  try {
    const data = await apiGet('/api/function-registry');

    if (data.error) {
      status.textContent = 'Error: ' + data.error;
      status.style.color = 'var(--nr-text-error, #ef4444)';
      return;
    }

    status.textContent = 'Analysis complete';
    status.style.color = 'var(--nr-text-success, #22c55e)';

    const summary = data.summary;

    // Group duplicates by severity
    const dupsBySeverity = { ERROR: [], WARNING: [], INFO: [] };
    data.issues.duplicates.forEach(dup => {
      const severity = dup.severity || 'WARNING';
      if (!dupsBySeverity[severity]) dupsBySeverity[severity] = [];
      dupsBySeverity[severity].push(dup);
    });

    const errorCount = dupsBySeverity.ERROR.length;
    const warningCount = dupsBySeverity.WARNING.length;
    const infoCount = dupsBySeverity.INFO.length;

    const parts = [
      _devStatGrid(
        _devStatCard(summary.totalFunctions, 'Functions', 'var(--nr-accent)'),
        _devStatCard(summary.duplicateFunctions, 'Duplicates', summary.duplicateFunctions > 0 ? '#f59e0b' : null),
        _devStatCard(summary.unusedFunctions, 'Unused', summary.unusedFunctions > 0 ? '#ef4444' : null),
        _devStatCard(summary.totalFiles, 'Files', null)
      )
    ];

    // Severity breakdown + error/warning/info panels kept as window.RawHTML(complex structure)
    let detailsHtml = '';
    if (data.issues.duplicates.length > 0) {
      detailsHtml += `<div style="margin-top:16px;padding:8px 12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px"><div style="color:var(--nr-text-primary);font-size:0.7rem;font-weight:600">Severity Breakdown: <span style="color:#ef4444;margin-left:12px">${errorCount} ERROR</span><span style="color:#f59e0b;margin-left:8px">${warningCount} WARNING</span><span style="color:#60a5fa;margin-left:8px">${infoCount} INFO</span></div></div>`;
    }
    if (errorCount > 0) {
      detailsHtml += `<div style="margin-top:12px;padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:8px;border-left:3px solid #ef4444"><div style="color:#ef4444;font-size:0.75rem;font-weight:600;margin-bottom:8px">ERROR: Global Naming Conflicts (${errorCount})</div>${dupsBySeverity.ERROR.slice(0, 5).map(dup => `<div style="margin-bottom:8px;font-size:0.65rem"><code style="color:#60a5fa;background:var(--nr-bg-raised);padding:2px 6px;border-radius:3px">${escapeHtml(dup.name)}()</code><div style="color:var(--nr-text-quaternary);margin-top:4px;margin-left:8px">${dup.definitions.map(def => `${def.file}:${def.line}`).join(', ')}</div></div>`).join('')}${errorCount > 5 ? `<div style="color:var(--nr-text-quaternary);font-size:0.65rem;margin-top:8px">...and ${errorCount - 5} more</div>` : ''}</div>`;
    }
    if (warningCount > 0) {
      detailsHtml += `<div style="margin-top:12px;padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:8px;border-left:3px solid #f59e0b"><div style="color:#f59e0b;font-size:0.75rem;font-weight:600;margin-bottom:8px">WARNING: Same-Scope Duplicates (${warningCount})</div>${dupsBySeverity.WARNING.slice(0, 5).map(dup => `<div style="margin-bottom:8px;font-size:0.65rem"><code style="color:#60a5fa;background:var(--nr-bg-raised);padding:2px 6px;border-radius:3px">${escapeHtml(dup.name)}()</code><div style="color:var(--nr-text-quaternary);margin-top:4px;margin-left:8px">${dup.definitions.map(def => `${def.file}:${def.line}`).join(', ')}</div></div>`).join('')}${warningCount > 5 ? `<div style="color:var(--nr-text-quaternary);font-size:0.65rem;margin-top:8px">...and ${warningCount - 5} more</div>` : ''}</div>`;
    }
    if (infoCount > 0) {
      detailsHtml += `<details style="margin-top:12px"><summary style="padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px;border-left:3px solid #60a5fa;cursor:pointer;color:#60a5fa;font-size:0.7rem;font-weight:600">&#8505;&#65039; INFO: Nested Duplicates (${infoCount}) - Safe, intentional</summary><div style="padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-top:none;border-radius:0 0 6px 6px">${dupsBySeverity.INFO.slice(0, 10).map(dup => `<div style="margin-bottom:8px;font-size:0.65rem"><code style="color:#60a5fa;background:var(--nr-bg-raised);padding:2px 6px;border-radius:3px">${escapeHtml(dup.name)}()</code><span style="color:var(--nr-text-quaternary);margin-left:8px">(${dup.definitions.length} definitions)</span></div>`).join('')}${infoCount > 10 ? `<div style="color:var(--nr-text-quaternary);font-size:0.65rem;margin-top:8px">...and ${infoCount - 10} more</div>` : ''}</div></details>`;
    }
    if (data.issues.unused.length > 0) {
      detailsHtml += `<div style="margin-top:12px;padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px"><div style="color:var(--nr-text-primary);font-size:0.7rem;font-weight:600;margin-bottom:8px">Unused Functions (${data.issues.unused.length})</div><div style="color:var(--nr-text-quaternary);font-size:0.65rem;max-height:150px;overflow-y:auto">${data.issues.unused.slice(0, 10).map(u => `<code style="color:#60a5fa;background:var(--nr-bg-raised);padding:2px 6px;border-radius:3px;margin-right:8px;margin-bottom:4px;display:inline-block">${escapeHtml(u.name)}()</code>`).join('')}${data.issues.unused.length > 10 ? `<div style="margin-top:8px">...and ${data.issues.unused.length - 10} more</div>` : ''}</div></div>`;
    }
    const topFuncs = Object.entries(data.functions).sort((a, b) => b[1].callCount - a[1].callCount).slice(0, 5);
    if (topFuncs.length > 0) {
      detailsHtml += `<div style="margin-top:12px;padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px"><div style="color:var(--nr-text-primary);font-size:0.7rem;font-weight:600;margin-bottom:8px">Most Called Functions</div>${topFuncs.map(([name, info], i) => `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:0.65rem"><span><span style="color:var(--nr-accent);font-weight:600">#${i + 1}</span><code style="color:#60a5fa;background:var(--nr-bg-raised);padding:2px 6px;border-radius:3px;margin-left:8px">${escapeHtml(name)}()</code></span><span style="color:var(--nr-text-quaternary)">${info.callCount} calls</span></div>`).join('')}</div>`;
    }
    if (detailsHtml) parts.push(window.RawHTML(detailsHtml));
    AetherUI.mount(VStack(parts), results);
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.style.color = 'var(--nr-text-error, #ef4444)';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Analyze Functions';
  }
}

export function _devOpenFunctionRegistryReport() {
  if (window.electronAPI && window.electronAPI.openExternal) {
    const path = require('path');
    const reportPath = path.join(process.cwd(), 'coverage', 'function-registry.html');
    window.electronAPI.openExternal('file://' + reportPath);
  } else {
    window.open('../coverage/function-registry.html', '_blank');
  }
}

export async function _devRunLoadOrderAnalysis() {
  const btn = document.getElementById('dev-load-ord-btn');
  const status = document.getElementById('dev-load-ord-status');
  const results = document.getElementById('dev-load-ord-results');
  if (!btn || !status || !results) return;

  btn.disabled = true;
  btn.textContent = 'Analyzing...';
  status.textContent = 'Running analysis...';
  AetherUI.mount(window.Text(''), results);

  try {
    const data = await apiGet('/api/validate-load-order');

    if (data.status === 'error' && data.message) {
      status.textContent = 'Error: ' + data.message;
      status.style.color = 'var(--nr-text-error, #ef4444)';
      return;
    }

    const isOptimal = data.warnings.length === 0;
    status.textContent = isOptimal ? 'Load order optimal' : `${data.warnings.length} warning${data.warnings.length === 1 ? '' : 's'} found`;
    status.style.color = isOptimal ? '#34d399' : '#f59e0b';

    const loadOrderParts = [
      _devStatGrid(
        _devStatCard(data.scriptCount, 'Scripts', 'var(--nr-accent)'),
        _devStatCard(data.warnings.length, 'Warnings', data.warnings.length > 0 ? '#f59e0b' : null),
        _devStatCard(data.infos.length, 'Info', 'var(--nr-text-quaternary)'),
        _devStatCard(data.cycles.length, 'Circular Deps', null)
      )
    ];
    // Complex panels use window.RawHTML(details/summary, tables)
    let loadOrderHtml = `<details open style="margin-bottom:12px"><summary style="padding:10px 14px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px;cursor:pointer;color:var(--nr-text-primary);font-size:0.75rem;font-weight:600">Script Load Order (${data.scriptCount} files)</summary><div style="padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-top:none;border-radius:0 0 6px 6px;max-height:300px;overflow-y:auto">${data.scriptOrder.map((script, i) => `<div style="font-size:0.65rem;color:var(--nr-text-quaternary);margin-bottom:2px;font-family:monospace"><span style="color:var(--nr-accent);font-weight:600">${i + 1}.</span><span style="margin-left:8px">${escapeHtml(script)}</span></div>`).join('')}</div></details>`;
    if (data.warnings.length > 0) {
      loadOrderHtml += `<div style="margin-bottom:12px;padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:8px;border-left:3px solid #f59e0b"><div style="color:#f59e0b;font-size:0.75rem;font-weight:600;margin-bottom:8px">WARNING: Forward References (may cause issues)</div><div style="color:var(--nr-text-quaternary);font-size:0.65rem;max-height:200px;overflow-y:auto">${data.warnings.slice(0, 10).map(ref => `<div style="margin-bottom:8px;padding:8px;background:var(--nr-bg-raised);border-radius:4px"><div><strong>${ref.callFile}</strong> (order ${ref.callOrder}) calls <code style="color:#60a5fa">${escapeHtml(ref.funcName)}()</code></div><div style="margin-top:4px;color:var(--nr-text-quaternary)">\u2192 Defined in <strong>${ref.defFile}</strong> (order ${ref.defOrder})</div></div>`).join('')}${data.warnings.length > 10 ? `<div style="margin-top:8px">...and ${data.warnings.length - 10} more</div>` : ''}</div></div>`;
    }
    if (data.infos.length > 0) {
      loadOrderHtml += `<details style="margin-bottom:12px"><summary style="padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px;cursor:pointer;color:#60a5fa;font-size:0.7rem;font-weight:600;border-left:3px solid #60a5fa">Forward References (INFO - ${data.infos.length}) - Safe with defer</summary><div style="padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-top:none;border-radius:0 0 6px 6px"><div style="color:var(--nr-text-quaternary);font-size:0.65rem;margin-bottom:8px">These forward references are safe because scripts use defer and functions are called inside other functions or event handlers.</div><div style="color:var(--nr-text-quaternary);font-size:0.65rem">${data.infos.slice(0, 5).map(ref => `<div style="margin-bottom:4px">${ref.callFile} \u2192 <code style="color:#60a5fa">${escapeHtml(ref.funcName)}()</code> \u2192 ${ref.defFile}</div>`).join('')}${data.infos.length > 5 ? `<div style="margin-top:8px">...and ${data.infos.length - 5} more</div>` : ''}</div></div></details>`;
    }
    if (data.cycles.length > 0) {
      loadOrderHtml += `<details style="margin-bottom:12px"><summary style="padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px;cursor:pointer;color:var(--nr-text-primary);font-size:0.7rem;font-weight:600">Circular Dependencies (${data.cycles.length})</summary><div style="padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-top:none;border-radius:0 0 6px 6px"><div style="color:var(--nr-text-quaternary);font-size:0.65rem">${data.cycles.slice(0, 10).map(cycle => `<div style="margin-bottom:4px">${cycle.join(' \u2192 ')}</div>`).join('')}${data.cycles.length > 10 ? `<div style="margin-top:8px">...and ${data.cycles.length - 10} more</div>` : ''}</div></div></details>`;
    }
    loadOrderParts.push(window.RawHTML(loadOrderHtml));
    AetherUI.mount(VStack(loadOrderParts), results);
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.style.color = 'var(--nr-text-error, #ef4444)';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Analysis';
  }
}

export var _devGitLogOffset = 0;
export var _devGitLogState = null;

function _devCommitRow(c) {
  const d = new Date(c.date);
  const relative = _devRelativeTime(d);
  const diffView = (c.ins || c.del)
    ? window.RawHTML('<span class="dev-git-log-diff"><span style="color:#3fb950">+' + c.ins + '</span> <span style="color:#f85149">-' + c.del + '</span></span>')
    : null;
  return window.HStack(
    window.Text(c.sha).className('dev-git-log-sha'),
    window.Text(escapeHtml(c.message)).className('dev-git-log-msg'),
    diffView,
    window.Text(relative).className('dev-git-log-meta')
  ).className('dev-git-log-item');
}

export function _devRenderCommitRows(log) {
  return window.ForEach(log, function(c) { return c.sha; }, _devCommitRow);
}

export function _devAppendLoadMoreBtn() {
  const container = document.getElementById('dev-git-log-container');
  if (!container) return;
  const old = document.getElementById('dev-git-load-more');
  if (old) old.remove();
  const btnView = window.Button('Load more commits').className('dev-git-load-more-btn').attr('id', 'dev-git-load-more');
  btnView.onTap(function() { _devLoadMoreCommits(btnView.el); });
  container.appendChild(btnView.build());
}

export async function _devLoadMoreCommits(btn) {
  btn.textContent = 'Loading\u2026';
  btn.disabled = true;
  try {
    const data = await apiGet(`/api/dev-git-log?offset=${_devGitLogOffset}&limit=20`);
    const log = data.git_log || [];
    if (log.length && _devGitLogState) {
      _devGitLogState.value = _devGitLogState.value.concat(log);
      _devGitLogOffset += log.length;
    }
    if (!data.has_more || !log.length) {
      btn.remove();
    } else {
      btn.textContent = 'Load more commits';
      btn.disabled = false;
    }
  } catch {
    btn.textContent = 'Load more commits';
    btn.disabled = false;
  }
}

