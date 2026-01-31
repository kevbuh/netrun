// ── Spinner system ──
let _spinnerData = null;
let _spinnerNames = [];
let _spinnerInterval = null;

function getSelectedSpinner() {
  return localStorage.getItem('spinner') || 'squareCorners';
}

function setSelectedSpinner(name) {
  localStorage.setItem('spinner', name);
  restartSpinners();
}

function loadSpinners() {
  return fetch('/spinners.json').then(r => r.json()).then(data => {
    _spinnerData = data;
    _spinnerNames = Object.keys(data);
    restartSpinners();
    return data;
  });
}

function restartSpinners() {
  if (_spinnerInterval) { clearInterval(_spinnerInterval); _spinnerInterval = null; }
  if (!_spinnerData) return;
  const name = getSelectedSpinner();
  const spinner = _spinnerData[name];
  if (!spinner) return;
  const frames = spinner.frames;
  const interval = spinner.interval;
  let i = 0;
  function tick() {
    const els = document.querySelectorAll('.spinner');
    if (!els.length) return;
    els.forEach(el => { el.textContent = frames[i]; });
    i = (i + 1) % frames.length;
  }
  tick();
  _spinnerInterval = setInterval(tick, interval);
}

// Observe DOM for new .spinner elements
const _spinnerMO = new MutationObserver(() => {
  const els = document.querySelectorAll('.spinner');
  if (els.length && !_spinnerInterval && _spinnerData) restartSpinners();
});
_spinnerMO.observe(document.documentElement, { childList: true, subtree: true });

loadSpinners();

// ── View management ──
const BACK_ARROW = '<svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>';
const ARXIV_LOGO = '<img class="absolute top-2.5 right-2.5 h-4 w-auto opacity-30" src="/arxiv-logomark-small@2x.png" alt="arXiv" />';
const ARXIV_LOGO_INLINE = '<img class="h-3.5 w-auto opacity-50 inline-block" src="/arxiv-logomark-small@2x.png" alt="arXiv" />';
const HN_LOGO = '<svg class="absolute top-2.5 right-2.5 h-4 w-auto opacity-40" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect fill="#f60" width="256" height="256" rx="24"/><text x="128" y="180" text-anchor="middle" fill="#fff" font-size="160" font-weight="bold" font-family="Verdana,sans-serif">Y</text></svg>';
const HN_LOGO_INLINE = '<svg class="h-3.5 w-auto opacity-50 inline-block" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect fill="#f60" width="256" height="256" rx="24"/><text x="128" y="180" text-anchor="middle" fill="#fff" font-size="160" font-weight="bold" font-family="Verdana,sans-serif">Y</text></svg>';
const VERGE_LOGO = '<svg class="absolute top-2.5 right-2.5 h-4 w-auto opacity-40" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect fill="#000" width="256" height="256" rx="24"/><text x="128" y="185" text-anchor="middle" fill="#fa4b2a" font-size="180" font-weight="bold" font-family="Georgia,serif">V</text></svg>';
const VERGE_LOGO_INLINE = '<svg class="h-3.5 w-auto opacity-50 inline-block" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect fill="#000" stroke="#333" width="256" height="256" rx="24"/><text x="128" y="185" text-anchor="middle" fill="#fa4b2a" font-size="180" font-weight="bold" font-family="Georgia,serif">V</text></svg>';
const NATURE_LOGO = '<svg class="absolute top-2.5 right-2.5 h-4 w-auto opacity-40" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect fill="#c00" width="256" height="256" rx="24"/><text x="128" y="185" text-anchor="middle" fill="#fff" font-size="170" font-weight="bold" font-family="Georgia,serif">N</text></svg>';
const NATURE_LOGO_INLINE = '<svg class="h-3.5 w-auto opacity-50 inline-block" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect fill="#c00" width="256" height="256" rx="24"/><text x="128" y="185" text-anchor="middle" fill="#fff" font-size="170" font-weight="bold" font-family="Georgia,serif">N</text></svg>';
const RSS_LOGO_INLINE = '<svg class="h-3.5 w-auto opacity-50 inline-block" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect fill="#f90" width="256" height="256" rx="24"/><circle cx="68" cy="189" r="28" fill="#fff"/><path d="M40 120a108 108 0 01108 108h-36a72 72 0 00-72-72v-36z" fill="#fff"/><path d="M40 56a172 172 0 01172 172h-36A136 136 0 0076 92V56h-36z" fill="#fff"/></svg>';
const SUBSTACK_LOGO_INLINE = '<svg class="h-3.5 w-auto inline-block" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.54 6.42H1.46V4.2h21.08v2.22zM1.46 9.26h21.08V7.04H1.46v2.22zM22.54 12.1H1.46v9.52l10.54-5.87 10.54 5.87V12.1z" fill="#FF6719"/></svg>';

// ── Feed catalog ──
const FEED_CATALOG = [
  // Research & Science
  { key: 'arxiv', name: 'arXiv', desc: 'Latest CS research papers', cat: 'Research & Science', special: 'arxiv', img: '/arxiv-logomark-small@2x.png', favicon: 'arxiv.org' },
  { key: 'nature', name: 'Nature', desc: 'Scientific research and discoveries', cat: 'Research & Science', url: 'https://www.nature.com/nature.rss', letter: 'N', bg: '#c00', fg: '#fff', favicon: 'nature.com' },
  { key: 'science', name: 'Science', desc: 'Peer-reviewed research from AAAS', cat: 'Research & Science', url: 'https://www.science.org/rss/news_current.xml', letter: 'S', bg: '#1a5276', fg: '#fff', favicon: 'science.org' },
  { key: 'quanta', name: 'Quanta Magazine', desc: 'In-depth math and science journalism', cat: 'Research & Science', url: 'https://www.quantamagazine.org/feed/', letter: 'Q', bg: '#000', fg: '#f5c518', favicon: 'quantamagazine.org' },
  // Tech & News
  { key: 'hn', name: 'Hacker News', desc: 'Top stories from the tech community', cat: 'Tech & News', special: 'hn', letter: 'Y', bg: '#f60', fg: '#fff', font: 'Verdana,sans-serif', favicon: 'news.ycombinator.com' },
  { key: 'verge', name: 'The Verge', desc: 'Technology news and culture', cat: 'Tech & News', url: 'https://www.theverge.com/rss/index.xml', letter: 'V', bg: '#000', fg: '#fa4b2a', stroke: '#333', favicon: 'theverge.com' },
  { key: 'arstechnica', name: 'Ars Technica', desc: 'In-depth technology reporting', cat: 'Tech & News', url: 'https://feeds.arstechnica.com/arstechnica/index', letter: 'a', bg: '#ff4e00', fg: '#fff', favicon: 'arstechnica.com' },
  { key: 'techcrunch', name: 'TechCrunch', desc: 'Startup and technology news', cat: 'Tech & News', url: 'https://techcrunch.com/feed/', letter: 'T', bg: '#0a9e01', fg: '#fff', favicon: 'techcrunch.com' },
  { key: 'wired', name: 'Wired', desc: 'Future trends in tech and culture', cat: 'Tech & News', url: 'https://www.wired.com/feed/rss', letter: 'W', bg: '#000', fg: '#fff', favicon: 'wired.com' },
  { key: 'mittr', name: 'MIT Tech Review', desc: 'Emerging technology analysis', cat: 'Tech & News', url: 'https://www.technologyreview.com/feed/', letter: 'M', bg: '#a31c44', fg: '#fff', favicon: 'technologyreview.com' },
  // Programming
  { key: 'lobsters', name: 'Lobsters', desc: 'Community-curated programming links', cat: 'Programming', url: 'https://lobste.rs/rss', letter: 'L', bg: '#ac130d', fg: '#fff', favicon: 'lobste.rs' },
  // AI & Machine Learning
  { key: 'gradient', name: 'The Gradient', desc: 'AI research perspectives', cat: 'AI & Machine Learning', url: 'https://thegradient.pub/rss/', letter: 'G', bg: '#6b21a8', fg: '#fff', favicon: 'thegradient.pub' },
  // Security
  { key: 'krebs', name: 'Krebs on Security', desc: 'Cybersecurity news and investigations', cat: 'Security', url: 'https://krebsonsecurity.com/feed/', letter: 'K', bg: '#2d3436', fg: '#00b894', favicon: 'krebsonsecurity.com' },
  // Ideas & Culture
  { key: 'aeon', name: 'Aeon', desc: 'Essays on science, philosophy, society', cat: 'Ideas & Culture', url: 'https://aeon.co/feed', letter: 'Æ', bg: '#1a1a2e', fg: '#e7d4b5', favicon: 'aeon.co' },
  { key: 'nautilus', name: 'Nautilus', desc: 'Science meets philosophy and culture', cat: 'Ideas & Culture', url: 'https://nautil.us/feed/', letter: 'N', bg: '#0891b2', fg: '#fff', favicon: 'nautil.us' },
  // Sports
  { key: 'espn', name: 'ESPN', desc: 'Top sports news and scores', cat: 'Sports', url: 'https://www.espn.com/espn/rss/news', letter: 'E', bg: '#d00', fg: '#fff', favicon: 'espn.com' },
  { key: 'theathletic', name: 'The Athletic', desc: 'In-depth sports journalism', cat: 'Sports', url: 'https://theathletic.com/feed/', letter: 'A', bg: '#000', fg: '#d4a853', favicon: 'theathletic.com' },
  { key: 'bleacherreport', name: 'Bleacher Report', desc: 'Sports highlights and analysis', cat: 'Sports', url: 'https://bleacherreport.com/articles/feed', letter: 'B', bg: '#000', fg: '#ff0', favicon: 'bleacherreport.com' },
  // Prediction Markets
  { key: 'polymarket', name: 'Polymarket', desc: 'Top 5 breaking prediction markets', cat: 'Prediction Markets', special: 'polymarket', letter: 'P', bg: '#0052ff', fg: '#fff', favicon: 'polymarket.com' },
  // Programming (additional)
  { key: 'devto', name: 'DEV Community', desc: 'Developer articles and tutorials', cat: 'Programming', url: 'https://dev.to/feed', letter: 'D', bg: '#0a0a0a', fg: '#fff', favicon: 'dev.to' },
  { key: 'hackernoon', name: 'Hacker Noon', desc: 'Tech industry stories and takes', cat: 'Programming', url: 'https://hackernoon.com/feed', letter: 'H', bg: '#00ff00', fg: '#000', favicon: 'hackernoon.com' },
  { key: 'smashing', name: 'Smashing Magazine', desc: 'Web design and development', cat: 'Programming', url: 'https://www.smashingmagazine.com/feed/', letter: 'S', bg: '#e53b2c', fg: '#fff', favicon: 'smashingmagazine.com' },
  // AI & Machine Learning (additional)
  { key: 'aiweirdness', name: 'AI Weirdness', desc: 'Humor and oddities in AI', cat: 'AI & Machine Learning', url: 'https://www.aiweirdness.com/rss/', letter: 'A', bg: '#7c3aed', fg: '#fff', favicon: 'aiweirdness.com' },
  { key: 'mlmastery', name: 'ML Mastery', desc: 'Machine learning tutorials and guides', cat: 'AI & Machine Learning', url: 'https://machinelearningmastery.com/feed/', letter: 'M', bg: '#1e40af', fg: '#fff', favicon: 'machinelearningmastery.com' },
  // News & World
  { key: 'reuters', name: 'Reuters', desc: 'Breaking world news', cat: 'News & World', url: 'https://feeds.reuters.com/reuters/topNews', letter: 'R', bg: '#ff8000', fg: '#fff', favicon: 'reuters.com' },
  { key: 'bbc', name: 'BBC News', desc: 'Global news coverage', cat: 'News & World', url: 'https://feeds.bbci.co.uk/news/rss.xml', letter: 'B', bg: '#bb1919', fg: '#fff', favicon: 'bbc.com' },
  { key: 'npr', name: 'NPR', desc: 'National and international news', cat: 'News & World', url: 'https://feeds.npr.org/1001/rss.xml', letter: 'N', bg: '#1a1a1a', fg: '#5a82a1', favicon: 'npr.org' },
  { key: 'apnews', name: 'AP News', desc: 'Breaking news from the Associated Press', cat: 'News & World', url: 'https://rsshub.app/apnews/topics/apf-topnews', letter: 'AP', bg: '#e00', fg: '#fff', favicon: 'apnews.com' },
  // Ideas & Culture (additional)
  { key: 'atlantic', name: 'The Atlantic', desc: 'Politics, culture, and ideas', cat: 'Ideas & Culture', url: 'https://www.theatlantic.com/feed/all/', letter: 'A', bg: '#000', fg: '#e4c9a8', favicon: 'theatlantic.com' },
  { key: 'newyorker', name: 'The New Yorker', desc: 'Reporting, commentary, and essays', cat: 'Ideas & Culture', url: 'https://www.newyorker.com/feed/everything', letter: 'NY', bg: '#000', fg: '#fff', favicon: 'newyorker.com' },
  { key: 'brainpickings', name: 'The Marginalian', desc: 'Literature, science, and philosophy', cat: 'Ideas & Culture', url: 'https://www.themarginalian.org/feed/', letter: 'M', bg: '#4a2c6e', fg: '#f0d78c', favicon: 'themarginalian.org' },
  // Science (additional)
  { key: 'sciamerican', name: 'Scientific American', desc: 'Science news and features', cat: 'Research & Science', url: 'http://rss.sciam.com/ScientificAmerican-Global', letter: 'SA', bg: '#000', fg: '#fff', favicon: 'scientificamerican.com' },
  { key: 'newscientist', name: 'New Scientist', desc: 'Science and technology news', cat: 'Research & Science', url: 'https://www.newscientist.com/section/news/feed/', letter: 'NS', bg: '#d32f2f', fg: '#fff', favicon: 'newscientist.com' },
  { key: 'phys', name: 'Phys.org', desc: 'Physics, space, and earth science', cat: 'Research & Science', url: 'https://phys.org/rss-feed/', letter: 'P', bg: '#005a87', fg: '#fff', favicon: 'phys.org' },
  // Design
  { key: 'designernews', name: 'Designer News', desc: 'Design community links', cat: 'Design', url: 'https://www.designernews.co/?format=rss', letter: 'DN', bg: '#2d72d9', fg: '#fff', favicon: 'designernews.co' },
  { key: 'sidebar', name: 'Sidebar', desc: 'Five curated design links daily', cat: 'Design', url: 'https://sidebar.io/feed.xml', letter: 'S', bg: '#f8f0e3', fg: '#333', favicon: 'sidebar.io' },
  // Finance & Economics
  { key: 'ft', name: 'Financial Times', desc: 'Global business and finance', cat: 'Finance & Economics', url: 'https://www.ft.com/rss/home', letter: 'FT', bg: '#fff1e5', fg: '#000', favicon: 'ft.com' },
  { key: 'economist', name: 'The Economist', desc: 'Global economics and policy', cat: 'Finance & Economics', url: 'https://www.economist.com/latest/rss.xml', letter: 'E', bg: '#e3120b', fg: '#fff', favicon: 'economist.com' },
  { key: 'mattstoller', name: 'BIG by Matt Stoller', desc: 'Monopoly power and political economy', cat: 'Finance & Economics', url: 'https://www.thebignewsletter.com/feed', letter: 'B', bg: '#1a1a1a', fg: '#e8d44d', favicon: 'thebignewsletter.com' },
  // Space
  { key: 'nasabreaking', name: 'NASA', desc: 'Space news and mission updates', cat: 'Space', url: 'https://www.nasa.gov/news-release/feed/', letter: 'N', bg: '#0b3d91', fg: '#fff', favicon: 'nasa.gov' },
  { key: 'spacenews', name: 'SpaceNews', desc: 'Space industry coverage', cat: 'Space', url: 'https://spacenews.com/feed/', letter: 'S', bg: '#0c1445', fg: '#4fc3f7', favicon: 'spacenews.com' },
  // Blogs & Newsletters
  { key: 'acx', name: 'Astral Codex Ten', desc: 'Scott Alexander on science, philosophy, and rationality', cat: 'Blogs & Newsletters', url: 'https://www.astralcodexten.com/feed', letter: 'A', bg: '#1a1a2e', fg: '#6ee7b7', favicon: 'astralcodexten.com' },
  { key: 'dwarkesh', name: 'Dwarkesh Patel', desc: 'Deep-dive interviews on progress and ideas', cat: 'Blogs & Newsletters', url: 'https://www.dwarkesh.com/feed', letter: 'D', bg: '#18181b', fg: '#f59e0b', favicon: 'dwarkesh.com' },
];

function catalogLogo(entry, size) {
  // For inline (card chips), prefer favicon
  if (size === 'inline' && entry.favicon) {
    return `<img class="h-3.5 w-3.5 rounded-sm inline-block" src="https://www.google.com/s2/favicons?domain=${entry.favicon}&sz=32" alt="${entry.name}" onerror="this.style.display='none'" />`;
  }
  if (entry.img) {
    const cls = size === 'onboard' ? 'h-7 w-auto opacity-70'
      : size === 'inline' ? 'h-3.5 w-auto opacity-50 inline-block'
      : 'absolute top-2.5 right-2.5 h-4 w-auto opacity-30';
    return `<img class="${cls}" src="${entry.img}" alt="${entry.name}" />`;
  }
  const cls = size === 'onboard' ? 'h-7 w-auto opacity-70'
    : size === 'inline' ? 'h-3.5 w-auto opacity-50 inline-block'
    : 'absolute top-2.5 right-2.5 h-4 w-auto opacity-40';
  const stroke = entry.stroke ? ` stroke="${entry.stroke}"` : '';
  const font = entry.font || 'Georgia,serif';
  const fs = (entry.letter || '').length > 1 ? 140 : 170;
  return `<svg class="${cls}" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect fill="${entry.bg}"${stroke} width="256" height="256" rx="24"/><text x="128" y="185" text-anchor="middle" fill="${entry.fg}" font-size="${fs}" font-weight="bold" font-family="${font}">${entry.letter}</text></svg>`;
}

const SOURCE_LOGO_INLINE = {};
const SOURCE_NAMES = {};
FEED_CATALOG.forEach(f => {
  SOURCE_LOGO_INLINE[f.key] = catalogLogo(f, 'inline');
  SOURCE_NAMES[f.key] = f.name;
});

function _isSubstackSource(source) {
  if (!source?.startsWith('custom:')) return false;
  const feeds = typeof getCustomFeeds === 'function' ? getCustomFeeds() : [];
  const name = source.slice(7);
  return feeds.some(f => f.name === name && /substack\.com/i.test(f.url));
}

function getSourceChip(source, arxivId) {
  const isSubstack = _isSubstackSource(source);
  const logo = SOURCE_LOGO_INLINE[source]
    || (isSubstack ? SUBSTACK_LOGO_INLINE : '')
    || (source?.startsWith('custom:') ? RSS_LOGO_INLINE : '')
    || (arxivId ? ARXIV_LOGO_INLINE : '');
  if (!logo) return '';
  const name = SOURCE_NAMES[source]
    || (source?.startsWith('custom:') ? source.slice(7) : '')
    || (arxivId ? 'arXiv' : '');
  return `<span class="inline-flex items-center gap-1">${logo}<span class="text-[0.68rem] text-dim">${name}</span></span>`;
}

function setSidebarActive(id) {
  document.querySelectorAll('.sidebar-icon').forEach(b => b.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function hideAllViews() {
  document.getElementById('home-main').style.display = 'none';
  document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.style.display = ''; });
  // Stop feed refresh timer and any in-flight loading when leaving home
  if (typeof _refreshTimer !== 'undefined' && _refreshTimer) {
    clearInterval(_refreshTimer);
    _refreshTimer = null;
  }
  if (typeof stopFeedLoading === 'function') stopFeedLoading();
  if (typeof _stopScrollTracker === 'function') _stopScrollTracker();
  if (typeof _spinnerPreviewInterval !== 'undefined' && _spinnerPreviewInterval) { clearInterval(_spinnerPreviewInterval); _spinnerPreviewInterval = null; }
}

function goHome() {
  document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.style.display = ''; });
  document.getElementById('home-main').style.display = '';
  window.location.hash = 'feed';
  setSidebarActive('sb-home');
  if (!allPapers.length) loadAllFeeds();
}

function openSearch() {
  hideAllViews();
  const view = document.getElementById('search-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'search';
  setSidebarActive('sb-search');
  // Reset to default state
  const input = document.getElementById('search-query');
  if (input) input.value = '';
  const hints = document.getElementById('search-hints');
  if (hints) hints.style.display = '';
  const feedR = document.getElementById('search-feed-results');
  if (feedR) feedR.innerHTML = '';
  const arxivR = document.getElementById('search-arxiv-results');
  if (arxivR) arxivR.innerHTML = '';
  const oaR = document.getElementById('search-openalex-results');
  if (oaR) oaR.innerHTML = '';
  setTimeout(() => { if (input) input.focus(); }, 50);
}

function openDashboard() {
  hideAllViews();
  const view = document.getElementById('dashboard-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = '';
  setSidebarActive('sb-dashboard');
  renderDashboard();
}

function openExperiments() {
  hideAllViews();
  const view = document.getElementById('experiments-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'experiments';
  setSidebarActive('sb-experiments');
  fetchExperiments();
}

function openExperimentDetail(id) {
  hideAllViews();
  const view = document.getElementById('exp-detail-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'experiment/' + id;
  setSidebarActive('sb-experiments');
  currentExpId = id;
  fetchExperimentDetail(id);
}

function routeFromHash() {
  const hash = window.location.hash;
  if (hash === '#experiments') openExperiments();
  else if (hash === '#settings' || hash === '#quality') openSettings();
  else if (hash === '#calendar') openCalendar();
  else if (hash === '#todos') openTodos();
  else if (hash === '#saved') openDashboard();
  else if (hash === '#search') openSearch();
  else if (hash === '#feed') goHome();
  else if (hash.startsWith('#experiment/')) openExperimentDetail(hash.slice('#experiment/'.length));
  else if (hash.startsWith('#paper/')) openPaper(parseInt(hash.slice('#paper/'.length), 10));
  else if (hash.startsWith('#view/')) openPaperByUrl(decodeURIComponent(hash.slice('#view/'.length)));
  else openDashboard();
}

window.addEventListener('hashchange', routeFromHash);
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', routeFromHash);
} else {
  setTimeout(routeFromHash, 0);
}

// ── Greeting system ──
function getGreeting() {
  const name = localStorage.getItem('userName') || '';
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=Sun
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  const n = (s) => name ? `${s}, ${name}` : s;
  const nQ = (s) => name ? `${s}, ${name}?` : `${s}?`;

  const timeGreetings = hour < 5
    ? [n('Hello, night owl')]
    : hour < 12
    ? [n('Good morning')]
    : hour < 17
    ? [n('Good afternoon')]
    : hour < 21
    ? [n('Good evening')]
    : [n('Evening')];

  const dayGreetings = [];
  if (day === 0) { dayGreetings.push(n('Happy Sunday')); dayGreetings.push(name ? `Sunday session, ${name}?` : 'Sunday session'); }
  if (day === 1) dayGreetings.push(n('Happy Monday'));
  if (day === 2) dayGreetings.push(n('Happy Tuesday'));
  if (day === 3) dayGreetings.push(n('Happy Wednesday'));
  if (day === 4) dayGreetings.push(n('Happy Thursday'));
  if (day === 5) { dayGreetings.push(n('Happy Friday')); dayGreetings.push(n('That Friday feeling')); }
  if (day === 6) { dayGreetings.push(n('Happy Saturday')); dayGreetings.push(n('Welcome to the weekend')); }

  const casual = [
    n('Hey there'), nQ("How's it going"), n('Back at it'),
    nQ("What's new"), n('Welcome'),
  ];
  if (name) casual.push(`${name} returns!`);

  const all = [...timeGreetings, ...dayGreetings, ...casual];
  return all[Math.floor(Math.random() * all.length)];
}

// ── Utilities ──
function formatDate(d) {
  if (!d) return '';
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (d.toDateString() === now.toDateString()) return `${diffHrs}h ago`;
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function decodeHtml(str) {
  const el = document.createElement('textarea');
  el.innerHTML = str;
  return el.value;
}

function renderTitle(rawTitle) {
  const decoded = decodeHtml(rawTitle);
  let html = escapeHtml(decoded);
  if (typeof katex !== 'undefined') {
    html = html.replace(/\$\$([^$]+?)\$\$/g, (_, tex) => {
      try { return katex.renderToString(tex, { displayMode: true, throwOnError: false }); } catch { return _; }
    });
    html = html.replace(/\$([^$]+?)\$/g, (_, tex) => {
      try { return katex.renderToString(tex, { displayMode: false, throwOnError: false }); } catch { return _; }
    });
  }
  return html;
}

function escapeAttr(str) {
  return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function truncate(str, max) {
  if (!str || str.length <= max) return str || '';
  return str.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function renderLatexIn(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (typeof katex === 'undefined') {
    setTimeout(() => renderLatexIn(elementId), 200);
    return;
  }
  function decodeTex(t) { return t.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"'); }
  let html = el.innerHTML;
  html = html.replace(/\$\$([^$]+?)\$\$/g, (_, tex) => {
    try { return katex.renderToString(decodeTex(tex), { displayMode: true, throwOnError: false }); }
    catch (e) { return _; }
  });
  html = html.replace(/\$([^$]+?)\$/g, (_, tex) => {
    try { return katex.renderToString(decodeTex(tex), { displayMode: false, throwOnError: false }); }
    catch (e) { return _; }
  });
  el.innerHTML = html;
}

function formatFirstAuthor(authors) {
  const parts = authors.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length <= 1) return authors;
  return parts[0] + ' et al.';
}

// Close settings on Escape
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('settings-view').style.display === 'block') goHome();
  }
});

// ── Sidebar drag-to-reorder ──
(function() {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;

  function getDraggables() {
    return Array.from(nav.querySelectorAll('.sidebar-draggable'));
  }

  function getSpacer() {
    return nav.querySelector('.mt-auto');
  }

  // Restore saved order from localStorage
  function restoreOrder() {
    const saved = localStorage.getItem('sidebarOrder');
    if (!saved) return;
    try {
      const order = JSON.parse(saved); // array of ids e.g. ['sb-home','sb-experiments',...]
      const spacer = getSpacer();
      const btns = getDraggables();
      const btnMap = {};
      btns.forEach(b => { btnMap[b.id] = b; });
      order.forEach(id => {
        if (btnMap[id]) nav.insertBefore(btnMap[id], spacer);
      });
      // Append any buttons not in saved order (new buttons)
      btns.forEach(b => {
        if (!order.includes(b.id)) nav.insertBefore(b, spacer);
      });
    } catch {}
  }

  function saveOrder() {
    const ids = getDraggables().map(b => b.id);
    localStorage.setItem('sidebarOrder', JSON.stringify(ids));
  }

  restoreOrder();

  let dragEl = null;
  let dragGhost = null;
  let startY = 0;
  let dragStarted = false;

  nav.addEventListener('pointerdown', e => {
    const btn = e.target.closest('.sidebar-draggable');
    if (!btn) return;
    dragEl = btn;
    startY = e.clientY;
    dragStarted = false;
    dragEl.setPointerCapture(e.pointerId);
  });

  nav.addEventListener('pointermove', e => {
    if (!dragEl) return;
    if (!dragStarted && Math.abs(e.clientY - startY) < 5) return;
    if (!dragStarted) {
      dragStarted = true;
      dragEl.style.opacity = '0.3';
      dragGhost = dragEl.cloneNode(true);
      dragGhost.classList.add('sidebar-drag-ghost');
      dragGhost.style.cssText = `position:fixed;left:${nav.getBoundingClientRect().left}px;pointer-events:none;z-index:999;opacity:0.9;`;
      document.body.appendChild(dragGhost);
    }
    const rect = nav.getBoundingClientRect();
    dragGhost.style.top = (e.clientY - 22) + 'px';
    dragGhost.style.left = rect.left + 'px';

    // Find drop target
    const btns = getDraggables();
    for (const b of btns) {
      if (b === dragEl) continue;
      const r = b.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (e.clientY < mid) {
        nav.insertBefore(dragEl, b);
        return;
      }
    }
    // Past all — insert before spacer
    const spacer = getSpacer();
    if (spacer) nav.insertBefore(dragEl, spacer);
  });

  function endDrag() {
    if (!dragEl) return;
    dragEl.style.opacity = '';
    if (dragGhost) { dragGhost.remove(); dragGhost = null; }
    if (dragStarted) {
      saveOrder();
      // Suppress the click that would follow the drag
      const suppress = e => { e.stopPropagation(); e.preventDefault(); };
      dragEl.addEventListener('click', suppress, { capture: true, once: true });
    }
    dragEl = null;
    dragStarted = false;
  }

  nav.addEventListener('pointerup', endDrag);
  nav.addEventListener('pointercancel', endDrag);
})();

// ── Pixel Pet System ──
(function() {
  const PET_FPS = 20;
  const G = 16; // pixel grid size
  const CPX = 32; // canvas element pixels
  const S = CPX / G; // scale factor (2)

  // ── Pet type definitions ──
  const PET_TYPES = {
    cat: {
      outline: '#2a2a2a', body: '#e8a87c', dark: '#c4855c', inner: '#d4846a', eye: '#2a2a2a',
      draw(px, o) {
        const B = this.body, D = this.dark, I = this.inner, O = this.outline, E = this.eye;
        // Ears
        px(4,3,O); px(5,2,O); px(6,3,O); px(5,3,I);
        px(9,3,O); px(10,2,O); px(11,3,O); px(10,3,I);
        // Head
        for(let x=4;x<=11;x++) px(x,4,O);
        px(3,5,O); px(12,5,O); px(3,6,O); px(12,6,O); px(3,7,O); px(12,7,O);
        for(let x=4;x<=11;x++) px(x,8,O);
        for(let y=5;y<=7;y++) for(let x=4;x<=11;x++) px(x,y,B);
        // Eyes + nose
        if(o.blink){px(6,6,D);px(10,6,D)} else{px(6,6,E);px(10,6,E)}
        px(8,7,I);
        if(o.sleeping){
          for(let x=3;x<=12;x++)px(x,9,O); for(let x=4;x<=11;x++)px(x,9,B);
          for(let x=3;x<=12;x++)px(x,10,O);
          px(12,8,D);px(13,8,D);px(13,7,D); return;
        }
        if(o.sitting){
          px(4,9,O);px(11,9,O); for(let x=5;x<=10;x++)px(x,9,B);
          for(let x=4;x<=11;x++)px(x,10,O);
          px(4,11,O);px(5,11,O);px(10,11,O);px(11,11,O);
          px(12,9,D);px(13,9,D);px(13,8,D); return;
        }
        // Body
        for(let y=9;y<=11;y++){px(4,y,O);px(11,y,O);for(let x=5;x<=10;x++)px(x,y,B);}
        // Legs
        if(o.legFrame===1){px(5,12,O);px(6,12,O);px(9,12,O);px(10,12,O);px(5,13,O);px(10,13,O)}
        else{px(4,12,O);px(5,12,O);px(10,12,O);px(11,12,O);px(4,13,O);px(11,13,O)}
        px(12,10,D);px(13,9,D);px(14,9,D);
      }
    },
    dog: {
      outline: '#3a2a1a', body: '#c49a6c', dark: '#a07848', inner: '#dbb88c', eye: '#2a2a2a',
      draw(px, o) {
        const B = this.body, D = this.dark, I = this.inner, O = this.outline, E = this.eye;
        // Floppy ears
        px(3,4,O);px(4,3,O);px(5,3,O);px(3,5,O);px(3,6,D);px(4,4,D);
        px(12,4,O);px(11,3,O);px(10,3,O);px(12,5,O);px(12,6,D);px(11,4,D);
        // Head
        for(let x=5;x<=10;x++)px(x,3,O);
        px(4,4,O);px(11,4,O);px(4,5,O);px(11,5,O);px(4,6,O);px(11,6,O);
        for(let x=5;x<=10;x++)px(x,7,O);
        for(let y=4;y<=6;y++)for(let x=5;x<=10;x++)px(x,y,B);
        if(o.blink){px(6,5,D);px(9,5,D)}else{px(6,5,E);px(9,5,E)}
        px(7,6,O);px(8,6,O); // nose
        if(o.sleeping){
          for(let x=4;x<=11;x++)px(x,8,O);for(let x=5;x<=10;x++)px(x,8,B);
          for(let x=4;x<=11;x++)px(x,9,O);
          // tail up
          px(12,7,D);px(13,6,D);px(13,5,D);return;
        }
        if(o.sitting){
          px(4,8,O);px(11,8,O);for(let x=5;x<=10;x++)px(x,8,B);
          for(let x=4;x<=11;x++)px(x,9,O);
          px(4,10,O);px(5,10,O);px(10,10,O);px(11,10,O);
          px(12,8,D);px(13,7,D);px(14,7,D);return;
        }
        for(let y=8;y<=10;y++){px(4,y,O);px(11,y,O);for(let x=5;x<=10;x++)px(x,y,B);}
        if(o.legFrame===1){px(5,11,O);px(6,11,O);px(9,11,O);px(10,11,O);px(5,12,O);px(10,12,O)}
        else{px(4,11,O);px(5,11,O);px(10,11,O);px(11,11,O);px(4,12,O);px(11,12,O)}
        // tail wagging
        if(o.legFrame===1){px(12,9,D);px(13,8,D);px(14,7,D)}
        else{px(12,9,D);px(13,9,D);px(14,8,D)}
      }
    },
    bunny: {
      outline: '#4a4a4a', body: '#eee', dark: '#ccc', inner: '#f5b0b0', eye: '#2a2a2a',
      draw(px, o) {
        const B = this.body, D = this.dark, I = this.inner, O = this.outline, E = this.eye;
        // Tall ears
        px(5,0,O);px(5,1,O);px(5,2,O);px(6,0,O);px(6,1,I);px(6,2,I);px(6,3,O);
        px(9,0,O);px(9,1,O);px(9,2,O);px(10,0,O);px(10,1,I);px(10,2,I);px(10,3,O);
        // Head
        for(let x=4;x<=11;x++)px(x,4,O);
        px(3,5,O);px(12,5,O);px(3,6,O);px(12,6,O);px(3,7,O);px(12,7,O);
        for(let x=4;x<=11;x++)px(x,8,O);
        for(let y=5;y<=7;y++)for(let x=4;x<=11;x++)px(x,y,B);
        if(o.blink){px(6,6,D);px(10,6,D)}else{px(6,6,E);px(10,6,E)}
        px(8,7,I);
        if(o.sleeping){
          for(let x=4;x<=11;x++)px(x,9,O);for(let x=5;x<=10;x++)px(x,9,B);
          for(let x=4;x<=11;x++)px(x,10,O);
          px(12,9,B);px(13,9,B);return;
        }
        if(o.sitting){
          px(4,9,O);px(11,9,O);for(let x=5;x<=10;x++)px(x,9,B);
          for(let x=4;x<=11;x++)px(x,10,O);
          px(4,11,O);px(5,11,O);px(10,11,O);px(11,11,O);
          px(12,9,B);px(13,9,B);return;
        }
        for(let y=9;y<=11;y++){px(4,y,O);px(11,y,O);for(let x=5;x<=10;x++)px(x,y,B);}
        if(o.legFrame===1){px(5,12,O);px(6,12,O);px(9,12,O);px(10,12,O)}
        else{px(4,12,O);px(5,12,O);px(10,12,O);px(11,12,O)}
        px(12,10,B);px(13,10,B);
      }
    },
    bird: {
      outline: '#1a1a2e', body: '#e84393', dark: '#c44dbb', inner: '#fdcb6e', eye: '#fff', pupil: '#1a1a2e',
      draw(px, o) {
        const B = this.body, D = this.dark, I = this.inner, O = this.outline, W = this.eye, E = this.pupil;
        // Tail feathers (behind body)
        if(!o.sleeping && !o.sitting) {
          px(3,9,D);px(2,8,D);px(2,9,O);
          px(3,10,D);px(2,10,O);
        }
        // Round head
        for(let x=6;x<=10;x++)px(x,3,O);
        px(5,4,O);px(11,4,O);px(5,5,O);px(11,5,O);px(5,6,O);px(11,6,O);
        for(let x=6;x<=10;x++)px(x,7,O);
        for(let y=4;y<=6;y++)for(let x=6;x<=10;x++)px(x,y,B);
        // Tuft on top
        px(7,2,O);px(8,1,D);px(8,2,D);px(9,2,O);
        // Eyes — big round white with pupil
        px(7,4,W);px(7,5,W);px(9,4,W);px(9,5,W);
        if(o.blink){px(7,5,B);px(9,5,B)}
        else{px(7,5,E);px(9,5,E)}
        // Beak
        px(11,5,I);px(12,5,I);px(12,6,I);
        // Cheek blush
        px(6,6,'#ff9ff3');px(10,6,'#ff9ff3');
        if(o.sleeping){
          // Tucked body
          for(let x=5;x<=11;x++)px(x,8,O);
          for(let x=6;x<=10;x++)px(x,8,B);
          for(let x=5;x<=11;x++)px(x,9,O);
          // Tail tucked
          px(5,8,D);px(4,8,D);px(4,9,O);
          return;
        }
        if(o.sitting){
          // Perched body
          px(6,8,O);px(10,8,O);for(let x=7;x<=9;x++)px(x,8,B);
          for(let x=6;x<=10;x++)px(x,9,O);
          // Feet
          px(7,10,O);px(8,10,O);px(9,10,O);
          // Wing folded
          px(5,7,D);px(4,7,D);px(4,8,D);
          return;
        }
        // Standing body — rounder
        px(6,8,O);px(10,8,O);for(let x=7;x<=9;x++)px(x,8,B);
        px(5,9,O);px(11,9,O);for(let x=6;x<=10;x++)px(x,9,B);
        px(5,10,O);px(11,10,O);for(let x=6;x<=10;x++)px(x,10,B);
        for(let x=6;x<=10;x++)px(x,11,O);
        // Wing flap
        if(o.legFrame===1){px(4,7,D);px(3,6,D);px(4,6,D);px(3,5,D)}
        else{px(4,8,D);px(3,8,D);px(4,7,D);px(3,9,D)}
        // Stick legs + feet
        px(7,12,O);px(9,12,O);
        if(o.legFrame===1){px(6,13,O);px(7,13,O);px(9,13,O);px(10,13,O)}
        else{px(7,13,O);px(8,13,O);px(9,13,O);px(10,13,O)}
      }
    },
    frog: {
      outline: '#7a1a1a', body: '#ef4444', dark: '#dc2626', face: '#c084fc', eye: '#fff', lid: '#ef4444',
      draw(px, o) {
        const B=this.body, D=this.dark, F=this.face, O=this.outline, W=this.eye, L=this.lid;
        const hi='#f87171';
        // ── Big chubby blob (rows 1-13, uses full width) ──
        for(let x=5;x<=10;x++)px(x,1,B);px(4,1,O);px(11,1,O);
        for(let x=3;x<=12;x++)px(x,2,B);px(2,2,O);px(13,2,O);
        for(let x=2;x<=13;x++)px(x,3,B);px(1,3,O);px(14,3,O);
        for(let y=4;y<=10;y++){px(0,y,O);px(15,y,O);for(let x=1;x<=14;x++)px(x,y,B);}
        for(let x=1;x<=14;x++)px(x,11,B);px(0,11,O);px(15,11,O);
        for(let x=2;x<=13;x++)px(x,12,B);px(1,12,O);px(14,12,O);
        for(let x=3;x<=12;x++)px(x,13,O);
        // Highlight
        px(10,2,hi);px(11,2,hi);px(12,2,hi);px(11,3,hi);px(12,3,hi);px(13,3,hi);px(12,4,hi);px(13,4,hi);
        // ── Purple face — big and round ──
        for(let x=4;x<=11;x++)px(x,3,F);
        for(let x=3;x<=12;x++)px(x,4,F);
        for(let x=2;x<=12;x++)px(x,5,F);
        for(let x=2;x<=12;x++)px(x,6,F);
        for(let x=2;x<=12;x++)px(x,7,F);
        for(let x=2;x<=12;x++)px(x,8,F);
        for(let x=3;x<=11;x++)px(x,9,F);
        for(let x=4;x<=10;x++)px(x,10,F);
        for(let x=5;x<=9;x++)px(x,11,F);
        // ── Eyes: simple purple dots ──
        if(!o.blink){px(5,6,'#7c3aed');px(10,6,'#7c3aed');}
        // ── Smiley mouth ──
        px(4,8,O);px(5,9,O);px(6,9,O);px(7,9,O);px(8,9,O);px(9,9,O);px(10,9,O);px(11,8,O);
        if(o.sleeping){
          // Extra squished loaf
          for(let x=2;x<=13;x++)px(x,13,B);px(1,13,O);px(14,13,O);
          for(let x=2;x<=13;x++)px(x,14,O);
          return;
        }
        if(o.sitting){
          px(2,13,D);px(3,13,D);px(4,13,D);px(11,13,D);px(12,13,D);px(13,13,D);
          px(2,14,O);px(3,14,O);px(12,14,O);px(13,14,O);
          return;
        }
        // ── Stubby legs ──
        if(o.legFrame===1){
          px(1,13,D);px(2,13,D);px(3,13,D);px(4,13,D);
          px(11,13,D);px(12,13,D);px(13,13,D);px(14,13,D);
          px(1,14,O);px(2,14,O);px(3,14,O);px(12,14,O);px(13,14,O);px(14,14,O);
        }else{
          px(2,13,D);px(3,13,D);px(4,13,D);px(5,13,D);
          px(10,13,D);px(11,13,D);px(12,13,D);px(13,13,D);
          px(2,14,O);px(3,14,O);px(4,14,O);px(11,14,O);px(12,14,O);px(13,14,O);
        }
      }
    },
  };

  function getPetType() { return localStorage.getItem('pixelPetType') || 'cat'; }

  // ── Particles ──
  function drawParticle(ctx, type, x, y, frame) {
    const s = S;
    if (type === 'heart') {
      ctx.fillStyle = '#e53935';
      const py = y - (frame % 8) * 0.5;
      ctx.globalAlpha = 1 - (frame % 8) / 8;
      ctx.fillRect(x*s,py*s,s,s); ctx.fillRect((x+2)*s,py*s,s,s);
      ctx.fillRect((x-1)*s,(py+1)*s,s*4,s); ctx.fillRect(x*s,(py+2)*s,s*2,s);
      ctx.globalAlpha = 1;
    } else if (type === 'zzz') {
      ctx.fillStyle = '#888';
      const off = frame % 3;
      ctx.font = `${5+off*2}px monospace`;
      ctx.globalAlpha = 0.5+off*0.15;
      ctx.fillText('z', x*s, (y-off*3)*s);
      ctx.globalAlpha = 1;
    }
  }

  // ── State machine ──
  let petState = 'idle', prevBaseState = 'idle';
  let petX = 200, petY = 400;
  let petTargetX = 300, petTargetY = 400;
  let petDir = 1;
  let petFrame = 0;
  let petStateTimer = 0, petTempTimer = 0;
  let _petLoop = null;
  let _lastActivity = Date.now();
  let _lastScrollY = 0, _scrollSpeed = 0;
  let _mouseX = -1, _mouseY = -1;
  let _fleeTimer = 0;

  function pickTarget() {
    const w = window.innerWidth, h = window.innerHeight;
    const margin = 20;
    // Bias toward edges: pick a random edge (top/bottom/left/right), then a position along it
    const edge = Math.floor(Math.random() * 4);
    if (edge === 0) { // top
      petTargetX = margin + Math.random() * (w - margin * 2);
      petTargetY = margin + Math.random() * (h * 0.15);
    } else if (edge === 1) { // bottom
      petTargetX = margin + Math.random() * (w - margin * 2);
      petTargetY = h - margin - Math.random() * (h * 0.15);
    } else if (edge === 2) { // left
      petTargetX = margin + Math.random() * (w * 0.15);
      petTargetY = margin + Math.random() * (h - margin * 2);
    } else { // right
      petTargetX = w - margin - Math.random() * (w * 0.15);
      petTargetY = margin + Math.random() * (h - margin * 2);
    }
    // Occasionally wander inward (~20% of the time)
    if (Math.random() < 0.2) {
      petTargetX = margin + Math.random() * (w - margin * 2);
      petTargetY = margin + Math.random() * (h - margin * 2);
    }
  }

  function petTick() {
    petFrame++;
    const now = Date.now();
    const idleMs = now - _lastActivity;

    // Temporary state expiry
    if (['happy','run','read'].includes(petState)) {
      petTempTimer--;
      if (petTempTimer <= 0) petState = prevBaseState;
    }

    // Sleep after 2min idle
    if (petState !== 'happy' && idleMs > 120000 && petState !== 'sleep') {
      prevBaseState = petState; petState = 'sleep';
    }

    // Scroll reactions
    if (petState !== 'happy' && petState !== 'sleep') {
      if (_scrollSpeed > 30) {
        if (petState !== 'run') prevBaseState = ['run','read'].includes(petState) ? prevBaseState : petState;
        petState = 'run'; petTempTimer = PET_FPS * 2;
      } else if (_scrollSpeed > 3) {
        if (petState !== 'read') prevBaseState = petState === 'read' ? prevBaseState : petState;
        petState = 'read'; petTempTimer = PET_FPS * 2;
      }
    }
    _scrollSpeed *= 0.9;

    // Mouse proximity flee
    if (_fleeTimer > 0) _fleeTimer--;
    if (_mouseX >= 0 && petState !== 'sleep') {
      const mdx = petX - _mouseX, mdy = petY - _mouseY;
      const mouseDist = Math.sqrt(mdx*mdx + mdy*mdy);
      if (mouseDist < 60) {
        const norm = mouseDist < 1 ? 1 : mouseDist;
        if (mouseDist < 30) {
          // Right on top — panic scoot
          const fleeDist = 150 + Math.random() * 80;
          petTargetX = petX + (mdx / norm) * fleeDist;
          petTargetY = petY + (mdy / norm) * fleeDist;
          _fleeTimer = 0;
        } else if (_fleeTimer <= 0) {
          // Close — nudge away
          const fleeDist = 80 + Math.random() * 40;
          petTargetX = petX + (mdx / norm) * fleeDist;
          petTargetY = petY + (mdy / norm) * fleeDist;
          _fleeTimer = PET_FPS;
        }
        petTargetX = Math.max(70, Math.min(window.innerWidth - 60, petTargetX));
        petTargetY = Math.max(20, Math.min(window.innerHeight - 60, petTargetY));
        if (petState !== 'run' && petState !== 'happy') {
          prevBaseState = ['idle','walk','sit'].includes(petState) ? petState : prevBaseState;
        }
        petState = 'run';
        petTempTimer = PET_FPS * 1.5;
      }
    }

    // Base state cycling — lazy: long idles/sits, short walks
    if (['idle','walk','sit'].includes(petState)) {
      petStateTimer--;
      if (petStateTimer <= 0) {
        if (petState === 'idle') {
          // 40% chance to just sit instead of walk
          if (Math.random() < 0.4) {
            petState = 'sit';
            petStateTimer = PET_FPS * (5 + Math.random() * 8);
          } else {
            petState = 'walk'; pickTarget();
            petStateTimer = PET_FPS * (2 + Math.random() * 3);
          }
        } else if (petState === 'walk') {
          petState = Math.random() > 0.3 ? 'sit' : 'idle';
          petStateTimer = PET_FPS * (5 + Math.random() * 8);
        } else {
          petState = 'idle';
          petStateTimer = PET_FPS * (4 + Math.random() * 6);
        }
        prevBaseState = petState;
      }
    }

    // 2D movement
    if (petState === 'walk' || petState === 'run') {
      const speed = petState === 'run' ? 5 : 0.6;
      const dx = petTargetX - petX, dy = petTargetY - petY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < speed) {
        petX = petTargetX; petY = petTargetY;
        if (petState === 'walk') {
          petState = 'idle'; petStateTimer = PET_FPS * (2+Math.random()*3); prevBaseState = 'idle';
        }
      } else {
        petDir = dx > 0 ? 1 : -1;
        petX += (dx/dist) * speed;
        petY += (dy/dist) * speed;
      }
    }

    // Bounds
    petX = Math.max(70, Math.min(window.innerWidth - 60, petX));
    petY = Math.max(20, Math.min(window.innerHeight - 60, petY));

    // Draw
    const container = document.getElementById('pixel-pet');
    const canvas = document.getElementById('pet-canvas');
    if (!container || !canvas) return;

    container.style.left = petX + 'px';
    container.style.top = petY + 'px';
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, CPX, CPX);

    const legFrame = (petState === 'walk' || petState === 'run') ? (Math.floor(petFrame / 3) % 2) : 0;
    const blink = petState === 'sleep' || (petState === 'idle' && petFrame % 48 < 3);
    const sitting = petState === 'sit' || petState === 'read';
    const sleeping = petState === 'sleep';
    const jump = petState === 'happy' && (petFrame % 6 < 3);
    const yOff = jump ? -2 : (sleeping ? 2 : (sitting ? 1 : 0));

    ctx.save();
    if (petDir === -1) { ctx.translate(CPX, 0); ctx.scale(-1, 1); }

    const pet = PET_TYPES[getPetType()] || PET_TYPES.cat;
    const pxFn = (x, y, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(x * S, (y + yOff) * S, S, S);
    };
    pet.draw(pxFn, { blink, legFrame, sitting, sleeping, jump });

    ctx.restore();

    if (petState === 'happy') drawParticle(ctx, 'heart', 1, 2, petFrame);
    if (petState === 'sleep') drawParticle(ctx, 'zzz', 12, 2, petFrame);
  }

  function getPetMode() { return localStorage.getItem('pixelPetMode') || 'free'; }

  function isSidebarMode() { return getPetMode() === 'sidebar'; }

  // ── Sidebar mode drawing ──
  function sidebarTick() {
    petFrame++;
    const now = Date.now();
    const idleMs = now - _lastActivity;

    if (['happy','run'].includes(petState)) {
      petTempTimer--;
      if (petTempTimer <= 0) petState = prevBaseState;
    }
    if (petState !== 'happy' && idleMs > 120000 && petState !== 'sleep') {
      prevBaseState = petState; petState = 'sleep';
    }
    // Simple idle/blink cycle in sidebar
    if (['idle','sit'].includes(petState)) {
      petStateTimer--;
      if (petStateTimer <= 0) {
        petState = petState === 'idle' ? 'sit' : 'idle';
        petStateTimer = PET_FPS * (4 + Math.random() * 6);
        prevBaseState = petState;
      }
    }

    const canvas = document.getElementById('pet-canvas-sb');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, CPX, CPX);

    const blink = petState === 'sleep' || (petState === 'idle' && petFrame % 48 < 3);
    const sitting = petState === 'sit' || petState === 'read';
    const sleeping = petState === 'sleep';
    const jump = petState === 'happy' && (petFrame % 6 < 3);
    const yOff = jump ? -2 : (sleeping ? 2 : (sitting ? 1 : 0));

    const pet = PET_TYPES[getPetType()] || PET_TYPES.cat;
    const pxFn = (x, y, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(x * S, (y + yOff) * S, S, S);
    };
    pet.draw(pxFn, { blink, legFrame: 0, sitting, sleeping, jump });

    if (petState === 'happy') drawParticle(ctx, 'heart', 1, 2, petFrame);
    if (petState === 'sleep') drawParticle(ctx, 'zzz', 12, 2, petFrame);
  }

  // ── Click handling ──
  let _lastClickTime = 0;
  function onPetClick(e) {
    e.stopPropagation();
    e.preventDefault();
    const now = Date.now();
    if (now - _lastClickTime < 350) {
      // Double click — run far away
      _lastClickTime = 0;
      if (petState !== 'happy') prevBaseState = ['idle','walk','sit'].includes(petState) ? petState : prevBaseState;
      if (!isSidebarMode()) {
        const fleeDist = 300 + Math.random() * 200;
        const angle = Math.random() * Math.PI * 2;
        petTargetX = Math.max(70, Math.min(window.innerWidth - 60, petX + Math.cos(angle) * fleeDist));
        petTargetY = Math.max(20, Math.min(window.innerHeight - 60, petY + Math.sin(angle) * fleeDist));
        petDir = petTargetX > petX ? 1 : -1;
      }
      petState = 'run';
      petTempTimer = PET_FPS * 3;
    } else {
      // Single click — happy
      _lastClickTime = now;
      setTimeout(() => {
        if (_lastClickTime === now) {
          if (petState !== 'happy') prevBaseState = ['idle','walk','sit'].includes(petState) ? petState : prevBaseState;
          petState = 'happy';
          petTempTimer = PET_FPS * 2.5;
        }
      }, 350);
    }
  }

  function startPixelPet() {
    if (_petLoop) return;
    const mode = getPetMode();
    const freeContainer = document.getElementById('pixel-pet');
    const sbContainer = document.getElementById('pixel-pet-sidebar');

    if (mode === 'sidebar') {
      if (freeContainer) freeContainer.style.display = 'none';
      if (sbContainer) sbContainer.style.display = '';
      petState = 'idle'; petStateTimer = PET_FPS * 5;
      _petLoop = setInterval(sidebarTick, 1000 / PET_FPS);
      if (sbContainer) sbContainer.onclick = onPetClick;
    } else {
      if (sbContainer) sbContainer.style.display = 'none';
      if (freeContainer) freeContainer.style.display = '';
      // Spawn at a random edge
      const edge = Math.floor(Math.random() * 4);
      if (edge === 0) { petX = Math.random() * window.innerWidth; petY = 20; }
      else if (edge === 1) { petX = Math.random() * window.innerWidth; petY = window.innerHeight - 60; }
      else if (edge === 2) { petX = 70; petY = Math.random() * window.innerHeight; }
      else { petX = window.innerWidth - 60; petY = Math.random() * window.innerHeight; }
      pickTarget();
      petStateTimer = PET_FPS * 3;
      _petLoop = setInterval(petTick, 1000 / PET_FPS);
      if (freeContainer) freeContainer.onclick = onPetClick;
    }
  }

  function stopPixelPet() {
    if (_petLoop) { clearInterval(_petLoop); _petLoop = null; }
    const freeContainer = document.getElementById('pixel-pet');
    const sbContainer = document.getElementById('pixel-pet-sidebar');
    if (freeContainer) { freeContainer.style.display = 'none'; freeContainer.onclick = null; }
    if (sbContainer) { sbContainer.style.display = 'none'; sbContainer.onclick = null; }
  }

  window.togglePixelPet = function(on) {
    localStorage.setItem('pixelPet', on ? 'on' : 'off');
    if (on) startPixelPet(); else stopPixelPet();
  };

  window.setPixelPetType = function(type) {
    localStorage.setItem('pixelPetType', type);
    if (typeof renderSettingsView === 'function') renderSettingsView();
  };

  window.setPixelPetMode = function(mode) {
    localStorage.setItem('pixelPetMode', mode);
    if (localStorage.getItem('pixelPet') === 'on') {
      stopPixelPet();
      startPixelPet();
    }
    if (typeof renderSettingsView === 'function') renderSettingsView();
  };

  window.petReact = function(reaction) {
    if (localStorage.getItem('pixelPet') !== 'on') return;
    if (reaction === 'happy') {
      if (petState !== 'happy') prevBaseState = ['idle','walk','sit'].includes(petState) ? petState : prevBaseState;
      petState = 'happy'; petTempTimer = PET_FPS * 2;
    }
  };

  // Track activity
  function onActivity() {
    _lastActivity = Date.now();
    if (petState === 'sleep') { petState = 'idle'; petStateTimer = PET_FPS * 3; prevBaseState = 'idle'; }
  }
  window.addEventListener('mousemove', function(e) { _mouseX = e.clientX; _mouseY = e.clientY; onActivity(); }, { passive: true });
  window.addEventListener('keydown', onActivity, { passive: true });
  window.addEventListener('scroll', function() {
    _scrollSpeed = Math.abs(window.scrollY - _lastScrollY);
    _lastScrollY = window.scrollY;
    onActivity();
  }, { passive: true });

  // Init
  if (localStorage.getItem('pixelPet') === 'on') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startPixelPet);
    else setTimeout(startPixelPet, 0);
  }
})();

