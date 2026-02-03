// ── Electron detection ──
if (window.electronAPI && window.electronAPI.isElectron) {
  document.body.classList.add('electron-app');
}

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
    if (!els.length) {
      // No spinners in DOM — stop interval so MutationObserver can restart when new ones appear
      clearInterval(_spinnerInterval);
      _spinnerInterval = null;
      return;
    }
    els.forEach(el => { el.textContent = frames[i]; });
    i = (i + 1) % frames.length;
  }
  tick();
  if (document.querySelectorAll('.spinner').length) {
    _spinnerInterval = setInterval(tick, interval);
  }
}

// Observe DOM for new .spinner elements
const _spinnerMO = new MutationObserver(() => {
  const els = document.querySelectorAll('.spinner');
  if (els.length && !_spinnerInterval && _spinnerData) restartSpinners();
});
_spinnerMO.observe(document.documentElement, { childList: true, subtree: true });

loadSpinners();

// ── Mobile utilities ──
function isMobile() {
  return window.innerWidth < 768;
}

function isTablet() {
  return window.innerWidth >= 768 && window.innerWidth < 1024;
}

function isDesktop() {
  return window.innerWidth >= 1024;
}

function debounce(fn, ms) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), ms);
  };
}

function throttle(fn, ms) {
  let lastTime = 0;
  return function(...args) {
    const now = Date.now();
    if (now - lastTime >= ms) {
      lastTime = now;
      fn.apply(this, args);
    }
  };
}

// Track the last non-paper view for back navigation
let _lastActiveView = 'feed';
const _sidebarToView = { 'sb-home': 'feed', 'sb-dashboard': 'dashboard', 'sb-experiments': 'experiments', 'sb-search': 'search', 'sb-browse': 'browse', 'sb-inbox': 'inbox', 'sb-calendar': 'calendar', 'sb-settings': 'settings', 'sb-people': 'people' };

// Sync active state between desktop sidebar and mobile bottom nav
function setSidebarActive(id) {
  // Track last view (skip paper view since it's not a "main" view)
  if (id && _sidebarToView[id]) _lastActiveView = _sidebarToView[id];
  // Desktop sidebar
  document.querySelectorAll('.sidebar-icon').forEach(b => b.classList.remove('active'));
  const desktopEl = document.getElementById(id);
  if (desktopEl) desktopEl.classList.add('active');

  // Mobile bottom nav (map sb-* to mb-*)
  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
  const mobileId = id.replace('sb-', 'mb-');
  const mobileEl = document.getElementById(mobileId);
  if (mobileEl) mobileEl.classList.add('active');
}

// Enhance mobile navigation on window resize
function enhanceMobileNav() {
  const nav = document.getElementById('mobile-bottom-nav');
  if (!nav) return;

  if (isMobile()) {
    nav.style.display = 'flex';
  } else {
    nav.style.display = 'none';
  }
}

// Call on load and resize
enhanceMobileNav();
window.addEventListener('resize', debounce(enhanceMobileNav, 300));

// ── Performance Optimizations ──

// Lazy load images using IntersectionObserver
let _lazyImageObserver = null;

function initLazyImageLoading() {
  if (!('IntersectionObserver' in window)) {
    // Fallback: load all images immediately on older browsers
    return;
  }

  _lazyImageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.removeAttribute('data-src');
        }
        observer.unobserve(img);
      }
    });
  }, {
    rootMargin: '50px' // Start loading 50px before image enters viewport
  });
}

function observeLazyImages() {
  if (!_lazyImageObserver) return;

  document.querySelectorAll('img[data-src]').forEach(img => {
    _lazyImageObserver.observe(img);
  });
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initLazyImageLoading();
    observeLazyImages();
  });
} else {
  initLazyImageLoading();
  observeLazyImages();
}

// Passive event listeners for better scroll performance
function addPassiveEventListener(element, event, handler) {
  if (element && typeof element.addEventListener === 'function') {
    element.addEventListener(event, handler, { passive: true });
  }
}

// Batch DOM updates with requestAnimationFrame
let _rafPending = false;
let _rafCallbacks = [];

function batchDOMUpdate(callback) {
  _rafCallbacks.push(callback);
  if (!_rafPending) {
    _rafPending = true;
    requestAnimationFrame(() => {
      const callbacks = _rafCallbacks.slice();
      _rafCallbacks = [];
      _rafPending = false;
      callbacks.forEach(cb => cb());
    });
  }
}

// Optimized scroll handler
let _lastScrollY = 0;
let _scrollDirection = 'down';

function handleOptimizedScroll() {
  const currentScrollY = window.scrollY || window.pageYOffset;
  _scrollDirection = currentScrollY > _lastScrollY ? 'down' : 'up';
  _lastScrollY = currentScrollY;

  // Update UI elements that depend on scroll
  batchDOMUpdate(() => {
    // Example: hide/show elements based on scroll direction
    // Can be used for auto-hiding headers, etc.
  });
}

// Use throttled scroll handler
if (typeof window !== 'undefined') {
  addPassiveEventListener(window, 'scroll', throttle(handleOptimizedScroll, 100));
}

// Debounced window resize handler
window.addEventListener('resize', debounce(() => {
  batchDOMUpdate(() => {
    enhanceMobileNav();
    // Other resize-dependent updates
  });
}, 300));

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
  { key: 'polymarket', name: 'Polymarket', desc: 'Breaking prediction markets', cat: 'Prediction Markets', special: 'polymarket', letter: 'P', bg: '#0052ff', fg: '#fff', favicon: 'polymarket.com' },
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
  { key: 'geohot', name: 'geohot', desc: 'George Hotz on technology, AI, and hacking', cat: 'Blogs & Newsletters', url: 'https://geohot.github.io/blog/feed.xml', letter: 'G', bg: '#111', fg: '#0f0', favicon: 'geohot.github.io' },
  { key: 'lilianweng', name: "Lil'Log", desc: 'Lilian Weng on deep learning and AI research', cat: 'Blogs & Newsletters', url: 'https://lilianweng.github.io/index.xml', letter: 'L', bg: '#4a1a6b', fg: '#e8b4f8', favicon: 'lilianweng.github.io' },
  { key: 'colah', name: "colah's blog", desc: 'Visual explanations of neural networks', cat: 'Blogs & Newsletters', url: 'https://colah.github.io/rss.xml', letter: 'C', bg: '#2c3e50', fg: '#1abc9c', favicon: 'colah.github.io' },
  { key: 'dennybritz', name: 'Denny Britz', desc: 'Machine learning and software engineering', cat: 'Blogs & Newsletters', url: 'https://dennybritz.com/index.xml', letter: 'D', bg: '#1e3a5f', fg: '#fff', favicon: 'dennybritz.com' },
  { key: 'gwern', name: 'Gwern', desc: 'Essays on AI, statistics, and technology', cat: 'Blogs & Newsletters', url: 'https://gwern.substack.com/feed', letter: 'G', bg: '#1a1a1a', fg: '#98fb98', favicon: 'gwern.net' },
  { key: 'lesswrong', name: 'LessWrong', desc: 'Rationality, AI safety, and decision-making', cat: 'Blogs & Newsletters', url: 'https://www.lesswrong.com/feed.xml', letter: 'LW', bg: '#3d6b37', fg: '#fff', favicon: 'lesswrong.com' },
  { key: 'trentonbricken', name: 'Trenton Bricken', desc: 'Computational neuroscience and AI research', cat: 'Blogs & Newsletters', url: 'https://www.trentonbricken.com/feed.xml', letter: 'T', bg: '#1a1a2e', fg: '#7dd3fc', favicon: 'trentonbricken.com' },
  { key: 'jasonwei', name: 'Jason Wei', desc: 'Chain-of-thought and LLM research', cat: 'Blogs & Newsletters', url: 'https://www.jasonwei.net/blog?format=rss', letter: 'J', bg: '#1e293b', fg: '#fbbf24', favicon: 'jasonwei.net' },
  { key: 'fanpu', name: 'Fan Pu Zeng', desc: 'CS, math, and research', cat: 'Blogs & Newsletters', url: 'https://fanpu.io/feed.xml', letter: 'F', bg: '#1e40af', fg: '#fff', favicon: 'fanpu.io' },
  { key: 'mcyoung', name: 'mcyoung', desc: 'Compilers, performance, and systems programming', cat: 'Blogs & Newsletters', url: 'https://mcyoung.xyz/feed.xml', letter: 'M', bg: '#18181b', fg: '#f472b6', favicon: 'mcyoung.xyz' },
  { key: 'itcanthink', name: 'It Can Think!', desc: 'Substack on AI and cognition', cat: 'Blogs & Newsletters', url: 'https://itcanthink.substack.com/feed', letter: 'I', bg: '#312e81', fg: '#c4b5fd', favicon: 'itcanthink.substack.com' },
  { key: 'sanderai', name: 'Sander Dieleman', desc: 'Generative modeling and diffusion models', cat: 'Blogs & Newsletters', url: 'https://sander.ai/feed.xml', letter: 'S', bg: '#0f172a', fg: '#38bdf8', favicon: 'sander.ai' },
  { key: 'gundersen', name: 'Gregory Gundersen', desc: 'Statistics, ML, and technical writing', cat: 'Blogs & Newsletters', url: 'https://gregorygundersen.com/feed.xml', letter: 'G', bg: '#f5f0eb', fg: '#333', favicon: 'gregorygundersen.com' },
  { key: 'brandinho', name: 'Brandinho', desc: 'Data science and machine learning', cat: 'Blogs & Newsletters', url: 'https://brandinho.github.io/feed.xml', letter: 'B', bg: '#1e293b', fg: '#4ade80', favicon: 'brandinho.github.io' },
  { key: 'fabiensanglard', name: 'Fabien Sanglard', desc: 'Game engines, graphics, and systems', cat: 'Blogs & Newsletters', url: 'https://fabiensanglard.net/rss.xml', letter: 'F', bg: '#000', fg: '#e74c3c', favicon: 'fabiensanglard.net' },
  { key: 'andyjones', name: 'Andy Jones', desc: 'Statistics, ML, and academic life', cat: 'Blogs & Newsletters', url: 'https://andrewcharlesjones.github.io/feed.xml', letter: 'A', bg: '#2d3748', fg: '#fbd38d', favicon: 'andrewcharlesjones.github.io' },
  { key: 'thegeeko', name: 'thegeeko', desc: 'GPU debugging, rendering, and WebSockets', cat: 'Blogs & Newsletters', url: 'https://thegeeko.me/rss.xml', letter: 'T', bg: '#111827', fg: '#34d399', favicon: 'thegeeko.me' },
  { key: 'rohany', name: 'Rohan Yadav', desc: 'Compilers and high-performance computing', cat: 'Blogs & Newsletters', url: 'https://rohany.github.io/index.xml', letter: 'R', bg: '#1a1a2e', fg: '#a78bfa', favicon: 'rohany.github.io' },
  { key: 'eliben', name: 'Eli Bendersky', desc: 'Go, Python, compilers, and ML', cat: 'Blogs & Newsletters', url: 'https://eli.thegreenplace.net/feeds/all.atom.xml', letter: 'E', bg: '#2e7d32', fg: '#fff', favicon: 'eli.thegreenplace.net' },
  { key: 'jaredtumiel', name: 'Jared Tumiel', desc: 'Physics, computation, and AI', cat: 'Blogs & Newsletters', url: 'https://jaredtumiel.github.io/blog/feed.xml', letter: 'J', bg: '#1e293b', fg: '#60a5fa', favicon: 'jaredtumiel.github.io' },
  { key: 'paulcavallaro', name: 'Paul Cavallaro', desc: 'CS, systems, and software engineering', cat: 'Blogs & Newsletters', url: 'https://paulcavallaro.com/blog/index.xml', letter: 'P', bg: '#18181b', fg: '#e2e8f0', favicon: 'paulcavallaro.com' },
  { key: 'clashluke', name: 'Lucas Nestler', desc: 'ML normalization, attention, and AI research', cat: 'Blogs & Newsletters', url: 'https://clashluke.github.io/index.xml', letter: 'L', bg: '#1e1b4b', fg: '#818cf8', favicon: 'clashluke.github.io' },
  { key: 'karpathy', name: 'Andrej Karpathy', desc: 'AI, LLMs, and technical deep dives', cat: 'Blogs & Newsletters', url: 'https://karpathy.bearblog.dev/feed/', letter: 'K', bg: '#18181b', fg: '#f59e0b', favicon: 'karpathy.bearblog.dev' },
  { key: 'wzml', name: 'Hill Climbing', desc: 'Machine learning concepts and techniques', cat: 'Blogs & Newsletters', url: 'https://blog.wz-ml.com/feed.xml', letter: 'H', bg: '#0c4a6e', fg: '#7dd3fc', favicon: 'blog.wz-ml.com' },
  { key: 'simonwillison', name: 'Simon Willison', desc: 'Python, Django, AI tools, and LLMs', cat: 'Blogs & Newsletters', url: 'https://simonwillison.net/atom/everything/', letter: 'S', bg: '#1e3a5f', fg: '#fde68a', favicon: 'simonwillison.net' },
  { key: 'jeffgeerling', name: 'Jeff Geerling', desc: 'Raspberry Pi, Ansible, and open-source hardware', cat: 'Blogs & Newsletters', url: 'https://www.jeffgeerling.com/blog.xml', letter: 'J', bg: '#b91c1c', fg: '#fff', favicon: 'jeffgeerling.com' },
  { key: 'robotsinplainenglish', name: 'Robots In Plain English', desc: 'Robotics, engineering, and automation', cat: 'Blogs & Newsletters', url: 'https://robotsinplainenglish.substack.com/feed', letter: 'R', bg: '#334155', fg: '#fb923c', favicon: 'robotsinplainenglish.com' },
  { key: 'occasionalinformationist', name: 'The Occasional Informationist', desc: 'Information science and related topics', cat: 'Blogs & Newsletters', url: 'https://theoccasionalinformationist.com/feed/', letter: 'O', bg: '#4a2c6e', fg: '#f0d78c', favicon: 'theoccasionalinformationist.com' },
  { key: 'bactra', name: 'Cosma Shalizi', desc: 'Statistics, complexity, and social science', cat: 'Blogs & Newsletters', url: 'http://bactra.org/weblog/index.rss', letter: 'C', bg: '#1a1a1a', fg: '#d4d4d4', favicon: 'bactra.org' },
  { key: 'nearblog', name: 'near.blog', desc: 'AI, animals, philosophy, and reflections', cat: 'Blogs & Newsletters', url: 'https://near.blog/feed/', letter: 'N', bg: '#1e293b', fg: '#86efac', favicon: 'near.blog' },
  { key: 'moultano', name: 'Ryan Moulton', desc: 'ML, game dev, and miscellaneous topics', cat: 'Blogs & Newsletters', url: 'https://moultano.wordpress.com/feed/', letter: 'R', bg: '#374151', fg: '#93c5fd', favicon: 'moultano.wordpress.com' },
  { key: 'convergentthinking', name: 'Convergent Thinking', desc: 'ML research and deep learning', cat: 'Blogs & Newsletters', url: 'https://convergentthinking.sh/index.xml', letter: 'C', bg: '#0f172a', fg: '#a78bfa', favicon: 'convergentthinking.sh' },
  { key: 'entropicthoughts', name: 'Entropic Thoughts', desc: 'Programming and software engineering', cat: 'Blogs & Newsletters', url: 'https://entropicthoughts.com/feed.xml', letter: 'E', bg: '#1c1917', fg: '#d6d3d1', favicon: 'entropicthoughts.com' },
  // HN Top Blogs 2025
  { key: 'seangoedecke', name: 'Sean Goedecke', desc: 'Software engineering and career', cat: 'HN Top Blogs 2025', url: 'https://www.seangoedecke.com/rss.xml', letter: 'S', bg: '#1e293b', fg: '#94a3b8', favicon: 'seangoedecke.com' },
  { key: 'daringfireball', name: 'Daring Fireball', desc: 'Apple, tech, and culture by John Gruber', cat: 'HN Top Blogs 2025', url: 'https://daringfireball.net/feeds/main', letter: 'DF', bg: '#4a4a4a', fg: '#fff', favicon: 'daringfireball.net' },
  { key: 'ericmigi', name: 'Eric Migicovsky', desc: 'Hardware, startups, and Pebble', cat: 'HN Top Blogs 2025', url: 'https://ericmigi.com/rss.xml', letter: 'E', bg: '#111', fg: '#4ade80', favicon: 'ericmigi.com' },
  { key: 'antirez', name: 'antirez', desc: 'Redis creator on programming and systems', cat: 'HN Top Blogs 2025', url: 'http://antirez.com/rss', letter: 'A', bg: '#1a1a1a', fg: '#e74c3c', favicon: 'antirez.com' },
  { key: 'idiallo', name: 'Ibrahim Diallo', desc: 'Web development and programming stories', cat: 'HN Top Blogs 2025', url: 'https://idiallo.com/feed.rss', letter: 'I', bg: '#1e3a5f', fg: '#fff', favicon: 'idiallo.com' },
  { key: 'maurycyz', name: 'Maurycy Zarzycki', desc: 'Programming and tech', cat: 'HN Top Blogs 2025', url: 'https://maurycyz.com/index.xml', letter: 'M', bg: '#18181b', fg: '#a78bfa', favicon: 'maurycyz.com' },
  { key: 'pluralistic', name: 'Pluralistic', desc: 'Cory Doctorow on tech, monopolies, and rights', cat: 'HN Top Blogs 2025', url: 'https://pluralistic.net/feed/', letter: 'P', bg: '#1a1a2e', fg: '#ff6b6b', favicon: 'pluralistic.net' },
  { key: 'shkspr', name: 'Terence Eden', desc: 'Web standards, tech, and open source', cat: 'HN Top Blogs 2025', url: 'https://shkspr.mobi/blog/feed/', letter: 'T', bg: '#2d3748', fg: '#fbd38d', favicon: 'shkspr.mobi' },
  { key: 'lcamtuf', name: 'lcamtuf', desc: 'Security research and fuzzing', cat: 'HN Top Blogs 2025', url: 'https://lcamtuf.substack.com/feed', letter: 'L', bg: '#111827', fg: '#34d399', favicon: 'lcamtuf.substack.com' },
  { key: 'mitchellh', name: 'Mitchell Hashimoto', desc: 'Ghostty, systems, and open source', cat: 'HN Top Blogs 2025', url: 'https://mitchellh.com/feed.xml', letter: 'M', bg: '#0f172a', fg: '#38bdf8', favicon: 'mitchellh.com' },
  { key: 'dynomight', name: 'Dynomight', desc: 'Science, data, and contrarian analysis', cat: 'HN Top Blogs 2025', url: 'https://dynomight.net/feed.xml', letter: 'D', bg: '#1c1917', fg: '#fb923c', favicon: 'dynomight.net' },
  { key: 'cks', name: 'Chris Siebenmann', desc: 'Unix, sysadmin, and systems', cat: 'HN Top Blogs 2025', url: 'https://utcc.utoronto.ca/~cks/space/blog/?atom', letter: 'C', bg: '#334155', fg: '#e2e8f0', favicon: 'utcc.utoronto.ca' },
  { key: 'xeiaso', name: 'Xe Iaso', desc: 'Nix, Go, and philosophy of tech', cat: 'HN Top Blogs 2025', url: 'https://xeiaso.net/blog.rss', letter: 'X', bg: '#4c1d95', fg: '#c4b5fd', favicon: 'xeiaso.net' },
  { key: 'oldnewthing', name: 'The Old New Thing', desc: 'Raymond Chen on Windows internals', cat: 'HN Top Blogs 2025', url: 'https://devblogs.microsoft.com/oldnewthing/feed', letter: 'O', bg: '#0078d4', fg: '#fff', favicon: 'devblogs.microsoft.com' },
  { key: 'righto', name: 'Ken Shirriff', desc: 'Reverse engineering chips and hardware', cat: 'HN Top Blogs 2025', url: 'https://www.righto.com/feeds/posts/default', letter: 'K', bg: '#1a1a1a', fg: '#4fc3f7', favicon: 'righto.com' },
  { key: 'lucumr', name: 'Armin Ronacher', desc: 'Python, Rust, and developer tooling', cat: 'HN Top Blogs 2025', url: 'https://lucumr.pocoo.org/feed.atom', letter: 'A', bg: '#1e293b', fg: '#f472b6', favicon: 'lucumr.pocoo.org' },
  { key: 'skyfall', name: 'Skyfall', desc: 'Tech and engineering', cat: 'HN Top Blogs 2025', url: 'https://skyfall.dev/rss.xml', letter: 'S', bg: '#0c4a6e', fg: '#7dd3fc', favicon: 'skyfall.dev' },
  { key: 'garymarcus', name: 'Gary Marcus', desc: 'AI criticism and cognitive science', cat: 'HN Top Blogs 2025', url: 'https://garymarcus.substack.com/feed', letter: 'G', bg: '#312e81', fg: '#fbbf24', favicon: 'garymarcus.substack.com' },
  { key: 'rachelbythebay', name: 'rachelbythebay', desc: 'Systems programming war stories', cat: 'HN Top Blogs 2025', url: 'https://rachelbythebay.com/w/atom.xml', letter: 'R', bg: '#18181b', fg: '#d6d3d1', favicon: 'rachelbythebay.com' },
  { key: 'overreacted', name: 'Overreacted', desc: 'Dan Abramov on React and programming', cat: 'HN Top Blogs 2025', url: 'https://overreacted.io/rss.xml', letter: 'O', bg: '#000', fg: '#ff6a6a', favicon: 'overreacted.io' },
  { key: 'timsh', name: 'Tim Shedor', desc: 'Tech and engineering', cat: 'HN Top Blogs 2025', url: 'https://timsh.org/rss/', letter: 'T', bg: '#1e293b', fg: '#86efac', favicon: 'timsh.org' },
  { key: 'johndcook', name: 'John D. Cook', desc: 'Math, statistics, and computing', cat: 'HN Top Blogs 2025', url: 'https://www.johndcook.com/blog/feed/', letter: 'J', bg: '#1e3a5f', fg: '#fff', favicon: 'johndcook.com' },
  { key: 'gilesthomas', name: 'Giles Thomas', desc: 'Programming and tech', cat: 'HN Top Blogs 2025', url: 'https://gilesthomas.com/feed/rss.xml', letter: 'G', bg: '#374151', fg: '#93c5fd', favicon: 'gilesthomas.com' },
  { key: 'matklad', name: 'matklad', desc: 'Rust, rust-analyzer, and IDE tooling', cat: 'HN Top Blogs 2025', url: 'https://matklad.github.io/feed.xml', letter: 'M', bg: '#1a1a2e', fg: '#f97316', favicon: 'matklad.github.io' },
  { key: 'derekthompson', name: 'Derek Thompson', desc: 'Culture, economics, and ideas', cat: 'HN Top Blogs 2025', url: 'https://www.theatlantic.com/feed/author/derek-thompson/', letter: 'D', bg: '#000', fg: '#e4c9a8', favicon: 'theatlantic.com' },
  { key: 'evanhahn', name: 'Evan Hahn', desc: 'Web development and JavaScript', cat: 'HN Top Blogs 2025', url: 'https://evanhahn.com/feed.xml', letter: 'E', bg: '#1e293b', fg: '#60a5fa', favicon: 'evanhahn.com' },
  { key: 'terriblesoftware', name: 'Terrible Software', desc: 'Software engineering opinions', cat: 'HN Top Blogs 2025', url: 'https://terriblesoftware.org/feed/', letter: 'T', bg: '#18181b', fg: '#ef4444', favicon: 'terriblesoftware.org' },
  { key: 'rakhim', name: 'Rakhim', desc: 'Programming and creativity', cat: 'HN Top Blogs 2025', url: 'https://rakhim.exotext.com/rss.xml', letter: 'R', bg: '#1c1917', fg: '#fde68a', favicon: 'rakhim.exotext.com' },
  { key: 'joanwestenberg', name: 'Joan Westenberg', desc: 'Tech culture and criticism', cat: 'HN Top Blogs 2025', url: 'https://joanwestenberg.com/rss', letter: 'J', bg: '#111827', fg: '#f9a8d4', favicon: 'joanwestenberg.com' },
  { key: 'xania', name: 'Matt Godbolt', desc: 'Compilers, C++, and Compiler Explorer', cat: 'HN Top Blogs 2025', url: 'https://xania.org/feed', letter: 'M', bg: '#1a1a1a', fg: '#4ade80', favicon: 'xania.org' },
  { key: 'micahflee', name: 'Micah Lee', desc: 'Security, privacy, and journalism', cat: 'HN Top Blogs 2025', url: 'https://micahflee.com/feed/', letter: 'M', bg: '#1e293b', fg: '#38bdf8', favicon: 'micahflee.com' },
  { key: 'nesbitt', name: 'Andrew Nesbitt', desc: 'Open source and software supply chain', cat: 'HN Top Blogs 2025', url: 'https://nesbitt.io/feed.xml', letter: 'N', bg: '#0f172a', fg: '#a78bfa', favicon: 'nesbitt.io' },
  { key: 'constructionphysics', name: 'Construction Physics', desc: 'Engineering, building, and infrastructure', cat: 'HN Top Blogs 2025', url: 'https://www.construction-physics.com/feed', letter: 'C', bg: '#78350f', fg: '#fde68a', favicon: 'construction-physics.com' },
  { key: 'tedium', name: 'Tedium', desc: 'The dull side of the internet', cat: 'HN Top Blogs 2025', url: 'https://feed.tedium.co/', letter: 'T', bg: '#1a1a2e', fg: '#e2e8f0', favicon: 'tedium.co' },
  { key: 'susam', name: 'Susam Pal', desc: 'Math, programming, and Unix', cat: 'HN Top Blogs 2025', url: 'https://susam.net/feed.xml', letter: 'S', bg: '#1e3a5f', fg: '#d6d3d1', favicon: 'susam.net' },
  { key: 'hillelwayne', name: 'Hillel Wayne', desc: 'Formal methods and software engineering', cat: 'HN Top Blogs 2025', url: 'https://buttondown.com/hillelwayne/rss', letter: 'H', bg: '#1e293b', fg: '#fbbf24', favicon: 'buttondown.com' },
  { key: 'borretti', name: 'Fernando Borretti', desc: 'Programming languages and compilers', cat: 'HN Top Blogs 2025', url: 'https://borretti.me/feed.xml', letter: 'F', bg: '#18181b', fg: '#a78bfa', favicon: 'borretti.me' },
  { key: 'wheresyoured', name: "Where's Your Ed At", desc: 'Tech industry criticism', cat: 'HN Top Blogs 2025', url: 'https://www.wheresyoured.at/rss/', letter: 'W', bg: '#111827', fg: '#f87171', favicon: 'wheresyoured.at' },
  { key: 'jaydml', name: 'Jay Dixit', desc: 'Programming and tech', cat: 'HN Top Blogs 2025', url: 'https://jayd.ml/feed.xml', letter: 'J', bg: '#1c1917', fg: '#86efac', favicon: 'jayd.ml' },
  { key: 'minimaxir', name: 'Max Woolf', desc: 'Data science, AI, and Python', cat: 'HN Top Blogs 2025', url: 'https://minimaxir.com/index.xml', letter: 'M', bg: '#0f172a', fg: '#fb923c', favicon: 'minimaxir.com' },
  { key: 'paulgraham', name: 'Paul Graham', desc: 'Startups, programming, and essays', cat: 'HN Top Blogs 2025', url: 'http://www.aaronsw.com/2002/feeds/pgessays.rss', letter: 'P', bg: '#000', fg: '#fff', favicon: 'paulgraham.com' },
  { key: 'filfre', name: 'The Digital Antiquarian', desc: 'History of computing and games', cat: 'HN Top Blogs 2025', url: 'https://www.filfre.net/feed/', letter: 'F', bg: '#1a1a1a', fg: '#d4a853', favicon: 'filfre.net' },
  { key: 'jimnielsen', name: 'Jim Nielsen', desc: 'Web design and development', cat: 'HN Top Blogs 2025', url: 'https://blog.jim-nielsen.com/feed.xml', letter: 'J', bg: '#1e293b', fg: '#93c5fd', favicon: 'blog.jim-nielsen.com' },
  { key: 'dfarq', name: 'Dave Farquhar', desc: 'Vintage computing and IT', cat: 'HN Top Blogs 2025', url: 'https://dfarq.homeip.net/feed/', letter: 'D', bg: '#334155', fg: '#e2e8f0', favicon: 'dfarq.homeip.net' },
  { key: 'jyndev', name: 'jyn', desc: 'Rust and compiler development', cat: 'HN Top Blogs 2025', url: 'https://jyn.dev/atom.xml', letter: 'J', bg: '#4c1d95', fg: '#c4b5fd', favicon: 'jyn.dev' },
  { key: 'geoffreylitt', name: 'Geoffrey Litt', desc: 'End-user programming and local-first', cat: 'HN Top Blogs 2025', url: 'https://www.geoffreylitt.com/feed.xml', letter: 'G', bg: '#1e3a5f', fg: '#fde68a', favicon: 'geoffreylitt.com' },
  { key: 'dougbrown', name: 'Doug Brown', desc: 'Retro computing and hardware hacking', cat: 'HN Top Blogs 2025', url: 'https://www.downtowndougbrown.com/feed/', letter: 'D', bg: '#1a1a1a', fg: '#4fc3f7', favicon: 'downtowndougbrown.com' },
  { key: 'brutecat', name: 'Brutecat', desc: 'Security research and exploits', cat: 'HN Top Blogs 2025', url: 'https://brutecat.com/rss.xml', letter: 'B', bg: '#111', fg: '#ef4444', favicon: 'brutecat.com' },
  { key: 'abortretryfail', name: 'Abort Retry Fail', desc: 'Computing history and retro tech', cat: 'HN Top Blogs 2025', url: 'https://www.abortretry.fail/feed', letter: 'A', bg: '#1a1a2e', fg: '#fb923c', favicon: 'abortretry.fail' },
  { key: 'oldvcr', name: 'Old VCR', desc: 'Vintage computing and retrotech', cat: 'HN Top Blogs 2025', url: 'https://oldvcr.blogspot.com/feeds/posts/default', letter: 'O', bg: '#18181b', fg: '#d6d3d1', favicon: 'oldvcr.blogspot.com' },
  { key: 'bogdanthegeek', name: 'Bogdan Rosu', desc: 'Electronics and embedded systems', cat: 'HN Top Blogs 2025', url: 'https://bogdanthegeek.github.io/blog/index.xml', letter: 'B', bg: '#1e293b', fg: '#34d399', favicon: 'bogdanthegeek.github.io' },
  { key: 'hugotunius', name: 'Hugo Tunius', desc: 'Software engineering and compilers', cat: 'HN Top Blogs 2025', url: 'https://hugotunius.se/feed.xml', letter: 'H', bg: '#1c1917', fg: '#7dd3fc', favicon: 'hugotunius.se' },
  { key: 'berthub', name: 'bert hubert', desc: 'DNS, networking, and policy', cat: 'HN Top Blogs 2025', url: 'https://berthub.eu/articles/index.xml', letter: 'B', bg: '#0f172a', fg: '#fbbf24', favicon: 'berthub.eu' },
  { key: 'chadnauseam', name: 'Chad Nauseam', desc: 'Philosophy, AI, and contrarian takes', cat: 'HN Top Blogs 2025', url: 'https://chadnauseam.com/rss.xml', letter: 'C', bg: '#312e81', fg: '#e2e8f0', favicon: 'chadnauseam.com' },
  { key: 'simoneorg', name: 'Simone', desc: 'Creative tech projects and hardware', cat: 'HN Top Blogs 2025', url: 'https://simone.org/feed/', letter: 'S', bg: '#111827', fg: '#f9a8d4', favicon: 'simone.org' },
  { key: 'dragas', name: 'IT Notes', desc: 'Sysadmin and IT operations', cat: 'HN Top Blogs 2025', url: 'https://it-notes.dragas.net/feed/', letter: 'I', bg: '#334155', fg: '#94a3b8', favicon: 'it-notes.dragas.net' },
  { key: 'beej', name: "Beej's Blog", desc: 'Network programming guides and C', cat: 'HN Top Blogs 2025', url: 'https://beej.us/blog/rss.xml', letter: 'B', bg: '#1e3a5f', fg: '#4ade80', favicon: 'beej.us' },
  { key: 'heyparis', name: 'hey.paris', desc: 'Design and technology', cat: 'HN Top Blogs 2025', url: 'https://hey.paris/index.xml', letter: 'H', bg: '#1a1a1a', fg: '#f472b6', favicon: 'hey.paris' },
  { key: 'danielwirtz', name: 'Daniel Wirtz', desc: 'Design, productivity, and indie dev', cat: 'HN Top Blogs 2025', url: 'https://danielwirtz.com/rss.xml', letter: 'D', bg: '#18181b', fg: '#60a5fa', favicon: 'danielwirtz.com' },
  { key: 'matduggan', name: 'Mat Duggan', desc: 'Infrastructure and DevOps', cat: 'HN Top Blogs 2025', url: 'https://matduggan.com/rss/', letter: 'M', bg: '#1e293b', fg: '#ef4444', favicon: 'matduggan.com' },
  { key: 'refactoringenglish', name: 'Refactoring English', desc: 'Technical writing and communication', cat: 'HN Top Blogs 2025', url: 'https://refactoringenglish.com/index.xml', letter: 'R', bg: '#1c1917', fg: '#fde68a', favicon: 'refactoringenglish.com' },
  { key: 'worksonmymachine', name: 'Works On My Machine', desc: 'Software and engineering culture', cat: 'HN Top Blogs 2025', url: 'https://worksonmymachine.substack.com/feed', letter: 'W', bg: '#0f172a', fg: '#a78bfa', favicon: 'worksonmymachine.substack.com' },
  { key: 'philiplaine', name: 'Philip Laine', desc: 'Kubernetes and cloud native', cat: 'HN Top Blogs 2025', url: 'https://philiplaine.com/index.xml', letter: 'P', bg: '#111827', fg: '#38bdf8', favicon: 'philiplaine.com' },
  { key: 'steveblank', name: 'Steve Blank', desc: 'Startups and entrepreneurship', cat: 'HN Top Blogs 2025', url: 'https://steveblank.com/feed/', letter: 'S', bg: '#1e3a5f', fg: '#fff', favicon: 'steveblank.com' },
  { key: 'bernsteinbear', name: 'Max Bernstein', desc: 'Compilers, runtimes, and PL research', cat: 'HN Top Blogs 2025', url: 'https://bernsteinbear.com/feed.xml', letter: 'M', bg: '#1a1a2e', fg: '#86efac', favicon: 'bernsteinbear.com' },
  { key: 'danieldelaney', name: 'Daniel Delaney', desc: 'Web and software engineering', cat: 'HN Top Blogs 2025', url: 'https://danieldelaney.net/feed', letter: 'D', bg: '#374151', fg: '#fbd38d', favicon: 'danieldelaney.net' },
  { key: 'troyhunt', name: 'Troy Hunt', desc: 'Security, HIBP, and web safety', cat: 'HN Top Blogs 2025', url: 'https://www.troyhunt.com/rss/', letter: 'T', bg: '#1a1a1a', fg: '#3b82f6', favicon: 'troyhunt.com' },
  { key: 'herman', name: 'Herman Martinus', desc: 'Indie dev and Bear Blog creator', cat: 'HN Top Blogs 2025', url: 'https://herman.bearblog.dev/feed/', letter: 'H', bg: '#18181b', fg: '#fb923c', favicon: 'herman.bearblog.dev' },
  { key: 'tomrenner', name: 'Tom Renner', desc: 'Engineering and tech', cat: 'HN Top Blogs 2025', url: 'https://tomrenner.com/index.xml', letter: 'T', bg: '#1e293b', fg: '#d6d3d1', favicon: 'tomrenner.com' },
  { key: 'pixelmelt', name: 'PixelMelt', desc: 'Creative coding and projects', cat: 'HN Top Blogs 2025', url: 'https://blog.pixelmelt.dev/rss/', letter: 'P', bg: '#4c1d95', fg: '#c4b5fd', favicon: 'blog.pixelmelt.dev' },
  { key: 'martinalderson', name: 'Martin Alderson', desc: 'Security and tech', cat: 'HN Top Blogs 2025', url: 'https://martinalderson.com/feed.xml', letter: 'M', bg: '#0f172a', fg: '#34d399', favicon: 'martinalderson.com' },
  { key: 'danielhooper', name: 'Daniel Hooper', desc: 'Graphics, shaders, and creative coding', cat: 'HN Top Blogs 2025', url: 'https://danielchasehooper.com/feed.xml', letter: 'D', bg: '#111', fg: '#f97316', favicon: 'danielchasehooper.com' },
  { key: 'sgtatham', name: 'Simon Tatham', desc: 'PuTTY author on puzzles and programming', cat: 'HN Top Blogs 2025', url: 'https://www.chiark.greenend.org.uk/~sgtatham/quasiblog/feed.xml', letter: 'S', bg: '#334155', fg: '#94a3b8', favicon: 'chiark.greenend.org.uk' },
  { key: 'grantslatton', name: 'Grant Slatton', desc: 'Programming and software engineering', cat: 'HN Top Blogs 2025', url: 'https://grantslatton.com/rss.xml', letter: 'G', bg: '#1e293b', fg: '#fbbf24', favicon: 'grantslatton.com' },
  { key: 'experimentalhistory', name: 'Experimental History', desc: 'Science, psychology, and culture', cat: 'HN Top Blogs 2025', url: 'https://www.experimental-history.com/feed', letter: 'E', bg: '#1a1a2e', fg: '#f9a8d4', favicon: 'experimental-history.com' },
  { key: 'anildash', name: 'Anil Dash', desc: 'Tech culture, ethics, and the web', cat: 'HN Top Blogs 2025', url: 'https://anildash.com/feed.xml', letter: 'A', bg: '#18181b', fg: '#60a5fa', favicon: 'anildash.com' },
  { key: 'aresluna', name: 'Marcin Wichary', desc: 'Design, keyboards, and typography', cat: 'HN Top Blogs 2025', url: 'https://aresluna.org/main.rss', letter: 'M', bg: '#1c1917', fg: '#e2e8f0', favicon: 'aresluna.org' },
  { key: 'stapelberg', name: 'Michael Stapelberg', desc: 'Linux, i3wm, and infrastructure', cat: 'HN Top Blogs 2025', url: 'https://michael.stapelberg.ch/feed.xml', letter: 'M', bg: '#1e3a5f', fg: '#4fc3f7', favicon: 'michael.stapelberg.ch' },
  { key: 'miguelgrinberg', name: 'Miguel Grinberg', desc: 'Python, Flask, and web development', cat: 'HN Top Blogs 2025', url: 'https://blog.miguelgrinberg.com/feed', letter: 'M', bg: '#0f172a', fg: '#4ade80', favicon: 'miguelgrinberg.com' },
  { key: 'keygen', name: 'Keygen', desc: 'Software licensing and distribution', cat: 'HN Top Blogs 2025', url: 'https://keygen.sh/blog/feed.xml', letter: 'K', bg: '#111827', fg: '#a78bfa', favicon: 'keygen.sh' },
  { key: 'mjg59', name: 'Matthew Garrett', desc: 'Linux, firmware, and security', cat: 'HN Top Blogs 2025', url: 'https://mjg59.dreamwidth.org/data/rss', letter: 'M', bg: '#374151', fg: '#fb923c', favicon: 'mjg59.dreamwidth.org' },
  { key: 'computerrip', name: 'computer.rip', desc: 'Telecom, networking, and computing history', cat: 'HN Top Blogs 2025', url: 'https://computer.rip/rss.xml', letter: 'C', bg: '#1a1a1a', fg: '#7dd3fc', favicon: 'computer.rip' },
  { key: 'tedunangst', name: 'Ted Unangst', desc: 'OpenBSD and systems programming', cat: 'HN Top Blogs 2025', url: 'https://www.tedunangst.com/flak/rss', letter: 'T', bg: '#1e293b', fg: '#fde68a', favicon: 'tedunangst.com' },
];

function catalogLogo(entry, size) {
  // For inline (card chips), prefer favicon
  if (size === 'inline' && entry.favicon) {
    return `<img class="h-3.5 w-3.5 rounded-sm inline-block" src="https://www.google.com/s2/favicons?domain=${entry.favicon}&sz=32" alt="${entry.name}" onerror="this.style.display='none'" />`;
  }
  if (entry.img) {
    const cls = size === 'onboard' ? 'h-5 w-auto opacity-70'
      : size === 'inline' ? 'h-3.5 w-auto opacity-50 inline-block'
      : 'absolute top-2.5 right-2.5 h-4 w-auto opacity-30';
    return `<img class="${cls}" src="${entry.img}" alt="${entry.name}" />`;
  }
  const cls = size === 'onboard' ? 'h-5 w-auto opacity-70'
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
SOURCE_LOGO_INLINE['quote'] = '<svg class="h-3.5 w-auto opacity-50 inline-block" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect fill="#6b7280" width="256" height="256" rx="24"/><text x="128" y="185" text-anchor="middle" fill="#fff" font-size="180" font-weight="bold" font-family="Georgia,serif">&quot;</text></svg>';
SOURCE_NAMES['quote'] = 'Quote';

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
  if (typeof _browseRemoveKeyGuard === 'function') _browseRemoveKeyGuard();
}

function goHome() {
  const alreadyOnFeed = window.location.hash === '#feed';
  document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.style.display = ''; });
  document.getElementById('home-main').style.display = '';
  window.location.hash = 'feed';
  setSidebarActive('sb-home');
  if (alreadyOnFeed) {
    // Reset source filter pills
    if (typeof hiddenSourceFilters !== 'undefined') hiddenSourceFilters.clear();
    if (typeof renderSourceBubbles === 'function') renderSourceBubbles();
    if (allPapers.length) loadAllFeeds();
  } else if (!allPapers.length) loadAllFeeds();
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

function expGoBack() {
  if (_expBackAction && _expBackAction.fn) {
    _expBackAction.fn();
  } else {
    openExperiments();
  }
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

let _expBackAction = null; // stores {fn, label} for context-aware back button
let _prevRouteHash = ''; // the hash before the current route
let _currentRouteHash = ''; // the current route hash

function openExperimentDetail(id) {
  // _prevRouteHash is set by routeFromHash for link-based navigation.
  // For direct calls (onclick), the hash hasn't changed yet, so window.location.hash is the "previous".
  const currentHash = window.location.hash;
  const prevHash = currentHash.startsWith('#experiment/') ? (_prevRouteHash || '') : currentHash;
  if (!prevHash.startsWith('#experiment/')) {
    if (prevHash.startsWith('#teams') || prevHash.startsWith('#team/')) {
      const teamId = typeof _lastTeamDetailId !== 'undefined' ? _lastTeamDetailId : null;
      _expBackAction = { fn: () => { openTeams(); if (teamId) showTeamDetailView(teamId); }, label: 'Team' };
    } else if (prevHash === '#saved' || prevHash === '#' || prevHash === '' || prevHash === '#dashboard') {
      _expBackAction = { fn: () => openDashboard(), label: 'Home' };
    } else if (prevHash === '#search') {
      _expBackAction = { fn: () => openSearch(), label: 'Search' };
    } else if (prevHash.startsWith('#view/') || prevHash.startsWith('#paper/')) {
      _expBackAction = { fn: () => { window.location.hash = prevHash; routeFromHash(); }, label: 'Paper' };
    } else if (prevHash === '#inbox') {
      _expBackAction = { fn: () => openInbox(), label: 'Inbox' };
    } else if (prevHash === '#experiments') {
      _expBackAction = { fn: () => openExperiments(), label: 'Projects' };
    } else {
      _expBackAction = { fn: () => openExperiments(), label: 'Projects' };
    }
  }
  // Update back button label
  const backBtn = document.querySelector('#exp-sidebar .exp-back-btn');
  if (backBtn) {
    const lbl = backBtn.querySelector('.exp-sidebar-label');
    if (lbl) lbl.textContent = (_expBackAction && _expBackAction.label) || 'Back';
  }
  hideAllViews();
  const view = document.getElementById('exp-detail-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'experiment/' + id;
  setSidebarActive('sb-experiments');
  currentExpId = id;
  if (id === '_unstructured') {
    // Stripped-down detail view for loose files
    document.getElementById('exp-detail-title').innerHTML = 'Files';
    const descEl = document.getElementById('exp-detail-desc');
    descEl.textContent = 'Loose files not attached to any project. Drag files onto a project card to move them.';
    descEl.classList.add('text-dimmest');
    descEl.classList.remove('text-muted');
    descEl.ondblclick = null;
    const metaEl = document.getElementById('exp-metadata');
    if (metaEl) metaEl.innerHTML = '';
    const treeEl = document.getElementById('exp-file-tree');
    if (treeEl) treeEl.innerHTML = '';
    const papersSection = document.getElementById('exp-papers-section');
    if (papersSection) papersSection.style.display = 'none';
    document.getElementById('exp-file-editor').style.display = 'none';
    document.getElementById('exp-file-editor').innerHTML = '';
    document.getElementById('exp-default-content').style.display = '';
    currentFile = null;
    currentExp = { title: 'Files', desc: '', runs: [], papers: [] };
    fetchExpFiles();
  } else {
    fetchExperimentDetail(id);
  }
}

function routeFromHash() {
  const hash = window.location.hash;
  const _oldHash = _currentRouteHash || '';
  _currentRouteHash = hash;
  _prevRouteHash = _oldHash;
  if (hash === '#experiments') openExperiments();
  else if (hash === '#settings') openSettings();
  else if (hash === '#quality') openQualityView();
  else if (hash === '#calendar') openCalendar();
  else if (hash === '#inbox') openInbox();
  else if (hash === '#teams') openTeams();
  else if (hash === '#profile') openUserProfile('');
  else if (hash.startsWith('#profile/')) openUserProfile(decodeURIComponent(hash.slice('#profile/'.length)));
else if (hash === '#saved-all') openAllSaved();
  else if (hash === '#saved') openDashboard();
  else if (hash === '#browse') openBrowse();
  else if (hash === '#search') openSearch();
  else if (hash === '#feed') goHome();
  else if (hash.startsWith('#experiment/')) {
    const expPart = hash.slice('#experiment/'.length);
    const qIdx = expPart.indexOf('?');
    const expId = qIdx >= 0 ? expPart.slice(0, qIdx) : expPart;
    const params = qIdx >= 0 ? new URLSearchParams(expPart.slice(qIdx)) : null;
    const autoFile = params && params.get('file');
    openExperimentDetail(expId);
    if (autoFile) setTimeout(() => { if (typeof openFile === 'function') openFile(decodeURIComponent(autoFile)); }, 600);
  }
  else if (hash.startsWith('#paper/')) openPaperByUrl(decodeURIComponent(hash.slice('#paper/'.length)));
  else if (hash.startsWith('#view/')) openPaperByUrl(decodeURIComponent(hash.slice('#view/'.length)));
  else openDashboard();
}

window.addEventListener('hashchange', routeFromHash);
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', routeFromHash);
} else {
  setTimeout(routeFromHash, 0);
}

// ── User Profile ──

function openUserProfile(username) {
  hideAllViews();
  const view = document.getElementById('profile-view');
  view.classList.add('active');
  view.style.display = 'block';
  if (username) {
    window.location.hash = 'profile/' + encodeURIComponent(username);
  } else {
    window.location.hash = 'profile';
  }
  setSidebarActive(username ? '' : 'sb-people');
  renderUserProfile(username);
}

async function renderUserProfile(username) {
  const el = document.getElementById('profile-content');
  if (!el) return;

  // No username → search/browse mode
  if (!username) {
    el.innerHTML = `
      <h2 class="text-[1.3rem] font-semibold text-white_ mb-5">Find a user</h2>
      <input type="text" id="profile-search-input" placeholder="Search by username..." class="w-full bg-input border border-border-input rounded-lg px-4 py-2.5 text-primary text-sm outline-none focus:border-accent mb-4">
      <div id="profile-search-results"></div>
      <div id="profile-all-users"></div>
    `;

    function renderUserGrid(container, users) {
      if (!users.length) { container.innerHTML = '<div class="text-dimmer text-sm">No users yet</div>'; return; }
      container.innerHTML = `<div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))">` +
        users.map(u => {
          const joinDate = u.created ? new Date(u.created * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short' }) : '';
          return `<a href="#profile/${encodeURIComponent(u.username)}" class="flex flex-col items-center gap-2 px-4 py-4 rounded-lg border border-border-card bg-card hover:border-accent/40 transition-colors" style="text-decoration:none">
            ${u.picture
              ? `<img src="${escapeAttr(u.picture)}" class="w-12 h-12 rounded-full" referrerpolicy="no-referrer" />`
              : `<div class="w-12 h-12 rounded-full bg-accent/20 text-accent flex items-center justify-center text-lg font-bold">${escapeHtml((u.username || '?')[0].toUpperCase())}</div>`
            }
            <span class="text-primary text-sm font-medium">${escapeHtml(u.username)}</span>
            ${joinDate ? `<span class="text-dimmer text-[0.7rem]">Joined ${joinDate}</span>` : ''}
          </a>`;
        }).join('') + '</div>';
    }

    // Load all users immediately
    const allUsersEl = document.getElementById('profile-all-users');
    allUsersEl.innerHTML = '<div class="text-dimmer text-sm">Loading users...</div>';
    try {
      const res = await fetch('/api/users', { headers: _authHeaders() });
      const users = await res.json();
      renderUserGrid(allUsersEl, users);
    } catch (e) {
      allUsersEl.innerHTML = '<div class="text-dimmer text-sm">Failed to load users</div>';
      console.error('Load users error', e);
    }

    const input = document.getElementById('profile-search-input');
    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const q = input.value.trim();
        const results = document.getElementById('profile-search-results');
        const allUsers = document.getElementById('profile-all-users');
        if (!q) {
          results.innerHTML = '';
          allUsers.style.display = '';
          return;
        }
        allUsers.style.display = 'none';
        try {
          const res = await fetch('/api/users?q=' + encodeURIComponent(q), { headers: _authHeaders() });
          const users = await res.json();
          if (!users.length) { results.innerHTML = '<div class="text-dimmer text-sm">No users found</div>'; return; }
          results.innerHTML = users.map(u => `
            <a href="#profile/${encodeURIComponent(u.username)}" class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-hover transition-colors" style="text-decoration:none">
              ${u.picture
                ? `<img src="${escapeAttr(u.picture)}" class="w-8 h-8 rounded-full" referrerpolicy="no-referrer" />`
                : `<div class="w-8 h-8 rounded-full bg-accent/20 text-accent flex items-center justify-center text-sm font-bold">${escapeHtml((u.username || '?')[0].toUpperCase())}</div>`
              }
              <span class="text-primary text-sm font-medium">${escapeHtml(u.username)}</span>
            </a>
          `).join('');
        } catch (e) { console.error('User search error', e); }
      }, 300);
    });
    setTimeout(() => input.focus(), 50);
    return;
  }

  // Loading state
  el.innerHTML = '<div class="text-dimmer text-sm mt-8 text-center">Loading profile...</div>';

  try {
    const [profileRes, commentsRes, experimentsRes, teamsRes, repostsRes] = await Promise.all([
      fetch('/api/users/' + encodeURIComponent(username), { headers: _authHeaders() }),
      fetch('/api/users/' + encodeURIComponent(username) + '/comments', { headers: _authHeaders() }),
      fetch('/api/users/' + encodeURIComponent(username) + '/experiments', { headers: _authHeaders() }),
      fetch('/api/users/' + encodeURIComponent(username) + '/teams', { headers: _authHeaders() }),
      fetch('/api/users/' + encodeURIComponent(username) + '/reposts', { headers: _authHeaders() }),
    ]);

    if (!profileRes.ok) {
      el.innerHTML = '<div class="text-dimmer text-sm mt-8 text-center">User not found</div>';
      return;
    }

    const profile = await profileRes.json();
    const comments = await commentsRes.json();
    const experiments = await experimentsRes.json();
    const teams = teamsRes.ok ? await teamsRes.json() : [];
    const reposts = repostsRes.ok ? await repostsRes.json() : [];

    // Handle private profiles
    if (profile.profile_private) {
      el.innerHTML = `
        <div class="flex flex-col items-center justify-center py-16">
          ${profile.picture
            ? `<img src="${escapeAttr(profile.picture)}" class="w-20 h-20 rounded-full mb-4 opacity-60" referrerpolicy="no-referrer" />`
            : `<div class="w-20 h-20 rounded-full bg-accent/10 text-accent/40 flex items-center justify-center text-3xl font-bold mb-4">${escapeHtml((profile.username || '?')[0].toUpperCase())}</div>`
          }
          <h2 class="text-[1.2rem] font-semibold text-white_ mb-2">${escapeHtml(profile.username)}</h2>
          <div class="flex items-center gap-1.5 text-dimmer text-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            This profile is private
          </div>
        </div>`;
      return;
    }

    const joinDate = profile.created ? new Date(profile.created * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) : '';
    const isOwnProfile = _authUserInfo && _authUserInfo.username === profile.username;

    let html = `
      <div class="flex items-center gap-4 mb-6">
        ${profile.picture
          ? `<img src="${escapeAttr(profile.picture)}" class="w-16 h-16 rounded-full" referrerpolicy="no-referrer" />`
          : `<div class="w-16 h-16 rounded-full bg-accent/20 text-accent flex items-center justify-center text-2xl font-bold">${escapeHtml((profile.username || '?')[0].toUpperCase())}</div>`
        }
        <div>
          <h2 class="text-[1.3rem] font-semibold text-white_">${escapeHtml(profile.username)}</h2>
          ${joinDate ? `<div class="text-dimmer text-[0.78rem] mt-0.5">Joined ${joinDate}</div>` : ''}
        </div>
        <div class="ml-auto flex items-center gap-2">
          ${isOwnProfile ? `<button onclick="openSettings()" class="w-8 h-8 rounded-lg flex items-center justify-center bg-transparent border border-border-card text-dim hover:text-primary hover:border-accent/40 cursor-pointer transition-colors" title="Settings"><svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z"/></svg></button>` : `<button onclick="showProfileMessageForm('${escapeAttr(profile.username)}')" class="px-3 py-1 rounded-md text-[0.78rem] bg-accent text-white border-none cursor-pointer hover:bg-accent-hover transition-colors">Message</button>`}
        </div>
      </div>
      <div id="profile-message-form" class="hidden mb-6"></div>

      <div class="flex gap-6 mb-8 text-[0.82rem]">
        <div><span class="text-white_ font-semibold">${profile.comment_count || 0}</span> <span class="text-dimmer">comments</span></div>
        <div><span class="text-white_ font-semibold">${profile.repost_count || 0}</span> <span class="text-dimmer">reposts</span></div>
        <div><span class="text-white_ font-semibold">${profile.team_count || 0}</span> <span class="text-dimmer">teams</span></div>
        <div><span class="text-white_ font-semibold">${profile.experiment_count || 0}</span> <span class="text-dimmer">projects</span></div>
      </div>
    `;

    // Shared experiments section
    if (experiments.length) {
      html += `<div class="mb-8">
        <h3 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Shared Projects</h3>
        <div class="flex flex-col gap-2">`;
      for (const exp of experiments) {
        html += `
          <a href="#experiment/${exp.id}" class="block px-4 py-3 rounded-lg border border-border-card bg-card hover:border-accent/40 transition-colors" style="text-decoration:none">
            <div class="text-primary text-sm font-medium">${escapeHtml(exp.title || exp.id)}</div>
            ${exp.desc ? `<div class="text-dimmer text-[0.75rem] mt-1 line-clamp-1">${escapeHtml(exp.desc)}</div>` : ''}
          </a>`;
      }
      html += '</div></div>';
    }

    // Teams section
    if (teams.length) {
      html += `<div class="mb-8">
        <h3 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Teams</h3>
        <div class="flex flex-col gap-2">`;
      for (const t of teams) {
        const lockIcon = t.private ? ' <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-1px;opacity:0.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' : '';
        html += `
          <div class="block px-4 py-3 rounded-lg border border-border-card bg-card hover:border-accent/40 transition-colors cursor-pointer" style="text-decoration:none" onclick="openTeams(); showTeamDetailView(${t.id})">
            <div class="text-primary text-sm font-medium">${escapeHtml(t.name)}${lockIcon}</div>
            <div class="text-dimmer text-[0.75rem] mt-1">${t.member_count} member${t.member_count !== 1 ? 's' : ''}</div>
          </div>`;
      }
      html += '</div></div>';
    }

    // Recent comments section
    if (comments.length) {
      html += `<div class="mb-8">
        <h3 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Recent Comments</h3>
        <div class="flex flex-col gap-2">`;
      for (const c of comments) {
        const timeAgo = typeof _relativeTime === 'function' ? _relativeTime(c.timestamp) : '';
        const contentPreview = (c.content || '').length > 120 ? c.content.slice(0, 120) + '...' : c.content;
        html += `
          <a href="#paper/${encodeURIComponent(c.paperLink)}" class="block px-4 py-3 rounded-lg border border-border-card bg-card hover:border-accent/40 transition-colors" style="text-decoration:none">
            <div class="text-[0.78rem] text-primary leading-relaxed">${escapeHtml(contentPreview)}</div>
            <div class="text-dimmer text-[0.7rem] mt-1">${timeAgo}</div>
          </a>`;
      }
      html += '</div></div>';
    }

    // Reposts section
    if (reposts.length) {
      html += `<div class="mb-8">
        <h3 class="text-muted text-xs font-semibold mb-3 uppercase tracking-wide">Reposts</h3>
        <div class="flex flex-col gap-2">`;
      for (const r of reposts) {
        const timeAgo = typeof _relativeTime === 'function' ? _relativeTime(r.timestamp) : '';
        const hostname = (() => { try { return new URL(r.paperLink).hostname.replace(/^www\./, ''); } catch { return ''; } })();
        html += `
          <a href="#view/${encodeURIComponent(r.paperLink)}" class="block px-4 py-3 rounded-lg border border-border-card bg-card hover:border-accent/40 transition-colors" style="text-decoration:none">
            <div class="flex items-center gap-2">
              <svg class="w-3.5 h-3.5 text-green-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
              <div class="text-[0.78rem] text-primary leading-relaxed truncate">${escapeHtml(r.paperTitle || r.paperLink)}</div>
            </div>
            <div class="text-dimmer text-[0.7rem] mt-1">${hostname ? escapeHtml(hostname) + ' · ' : ''}${timeAgo}</div>
          </a>`;
      }
      html += '</div></div>';
    }

    if (!experiments.length && !comments.length && !teams.length && !reposts.length) {
      html += '<div class="text-dimmer text-sm mt-4">No shared activity yet.</div>';
    }

    el.innerHTML = html;
  } catch (e) {
    console.error('Profile load error', e);
    el.innerHTML = '<div class="text-dimmer text-sm mt-8 text-center">Failed to load profile</div>';
  }
}

function showProfileMessageForm(username) {
  const el = document.getElementById('profile-message-form');
  if (!el) return;
  if (!el.classList.contains('hidden')) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="p-4 rounded-lg border border-border-card bg-card">
      <textarea id="profile-msg-textarea" class="w-full text-[0.82rem] bg-input border border-border-input rounded-lg px-3 py-2 text-primary resize-none outline-none focus:border-accent" rows="3" placeholder="Write a message to ${escapeHtml(username)}..."></textarea>
      <div class="flex items-center gap-2 mt-2">
        <button onclick="sendProfileMessage('${escapeAttr(username)}')" class="px-3 py-1 rounded-md text-[0.78rem] bg-accent text-white border-none cursor-pointer hover:bg-accent-hover transition-colors">Send</button>
        <button onclick="document.getElementById('profile-message-form').classList.add('hidden')" class="px-3 py-1 rounded-md text-[0.78rem] border border-border-input text-muted bg-transparent cursor-pointer hover:text-primary transition-colors">Cancel</button>
        <span id="profile-msg-status" class="text-[0.75rem] ml-2"></span>
      </div>
    </div>
  `;
  setTimeout(() => document.getElementById('profile-msg-textarea')?.focus(), 50);
}

async function sendProfileMessage(username) {
  const textarea = document.getElementById('profile-msg-textarea');
  const status = document.getElementById('profile-msg-status');
  const content = (textarea?.value || '').trim();
  if (!content) return;
  try {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ to_username: username, content })
    });
    const data = await res.json();
    if (data.error) {
      if (status) { status.style.color = 'var(--text-muted)'; status.textContent = data.error; }
    } else {
      if (status) { status.style.color = 'var(--accent)'; status.textContent = 'Message sent!'; }
      textarea.value = '';
      setTimeout(() => document.getElementById('profile-message-form')?.classList.add('hidden'), 1500);
    }
  } catch (err) {
    if (status) { status.style.color = 'var(--text-muted)'; status.textContent = 'Failed to send'; }
  }
}

// ── Greeting system ──
function getGreeting() {
  const name = (_authUserInfo && (_authUserInfo.name || '').split(' ')[0]) || localStorage.getItem('userName') || '';
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

// ── Paper ratings (1-5 stars) ──
function getPaperRatings() {
  try { return JSON.parse(localStorage.getItem('paperRatings') || '{}'); } catch { return {}; }
}
function _normalizeRatingKey(link) {
  // Normalize arXiv URLs: strip version, use https, use /abs/ form
  let k = link;
  try {
    const u = new URL(k);
    if (u.hostname.includes('arxiv.org')) {
      u.protocol = 'https:';
      // /abs/1706.03762v7 → /abs/1706.03762
      u.pathname = u.pathname.replace(/(\/abs\/[\d.]+)v\d+$/, '$1');
      // /pdf/... → /abs/...
      u.pathname = u.pathname.replace(/^\/pdf\//, '/abs/');
      k = u.origin + u.pathname;
    }
  } catch {}
  return k;
}
function getPaperRating(link) {
  const ratings = getPaperRatings();
  return ratings[_normalizeRatingKey(link)] || ratings[link] || 0;
}
function setPaperRating(link, rating) {
  const r = getPaperRatings();
  const key = _normalizeRatingKey(link);
  // Clean up old non-normalized key if different
  if (key !== link && r[link]) delete r[link];
  if (rating <= 0) delete r[key]; else r[key] = rating;
  localStorage.setItem('paperRatings', JSON.stringify(r));
}

function renderStarRating(link, opts) {
  const nLink = _normalizeRatingKey(link);
  const rating = getPaperRating(nLink);
  const size = opts?.size || 'sm';
  const interactive = opts?.interactive !== false;
  const cls = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';
  let html = `<span class="inline-flex items-center gap-px paper-rating" data-link="${escapeAttr(nLink)}">`;
  for (let i = 1; i <= 5; i++) {
    const filled = i <= rating;
    const fill = filled ? 'var(--accent)' : 'none';
    const stroke = filled ? 'var(--accent)' : 'currentColor';
    const opacity = filled ? '' : 'opacity:0.3;';
    const click = interactive ? ` onclick="event.stopPropagation();ratePaper('${escapeAttr(nLink)}',${i})" style="cursor:pointer;${opacity}"` : ` style="${opacity}"`;
    html += `<svg class="${cls}"${click} viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  html += '</span>';
  return html;
}

function ratePaper(link, rating) {
  const current = getPaperRating(link);
  // Click same star again → clear rating
  setPaperRating(link, current === rating ? 0 : rating);
  // Update all visible rating widgets for this paper
  document.querySelectorAll(`.paper-rating[data-link="${CSS.escape(link)}"]`).forEach(el => {
    el.outerHTML = renderStarRating(link, { interactive: el.closest('#paper-topbar') ? true : true, size: el.closest('#paper-topbar') ? 'md' : 'sm' });
  });
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
  if ((e.metaKey || e.ctrlKey) && e.key === 't') {
    e.preventDefault();
    const browseView = document.getElementById('browse-view');
    const isOpen = browseView && browseView.style.display !== 'none' && browseView.style.display !== '';
    if (!isOpen && typeof openBrowse === 'function') openBrowse();
    if (typeof browseNewTab === 'function') {
      if (!isOpen) setTimeout(browseNewTab, 50);
      else browseNewTab();
    }
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
    const browseView = document.getElementById('browse-view');
    if (browseView && browseView.style.display !== 'none' && browseView.style.display !== '' && typeof _browseActiveTab !== 'undefined' && _browseActiveTab !== null) {
      e.preventDefault();
      browseCloseTab(_browseActiveTab);
    }
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

// ── Button click sound (Web Audio API) ──
let _clickSoundCtx = null;
let _clickSoundOn = localStorage.getItem('clickSound') === 'on';

const CLICK_SOUND_PRESETS = {
  tap: { label: 'Tap', play(ctx, t) {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'sine'; o.frequency.setValueAtTime(400, t); o.frequency.exponentialRampToValueAtTime(250, t + 0.04);
    f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 0.5;
    g.gain.setValueAtTime(0.04, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(f); f.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.08);
  }},
  pop: { label: 'Pop', play(ctx, t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(800, t); o.frequency.exponentialRampToValueAtTime(400, t + 0.05);
    g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.09);
  }},
  click: { label: 'Click', play(ctx, t) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.02, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.003));
    const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    src.buffer = buf; f.type = 'bandpass'; f.frequency.value = 2000; f.Q.value = 1;
    g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    src.connect(f); f.connect(g); g.connect(ctx.destination); src.start(t);
  }},
  bubble: { label: 'Bubble', play(ctx, t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(600, t + 0.06);
    g.gain.setValueAtTime(0.04, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.1);
  }},
  key: { label: 'Key', play(ctx, t) {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'triangle'; o.frequency.setValueAtTime(1000, t); o.frequency.exponentialRampToValueAtTime(500, t + 0.02);
    f.type = 'lowpass'; f.frequency.value = 800; f.Q.value = 0.3;
    g.gain.setValueAtTime(0.03, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    o.connect(f); f.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.06);
  }},
  thud: { label: 'Thud', play(ctx, t) {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.05);
    f.type = 'lowpass'; f.frequency.value = 200; f.Q.value = 0.5;
    g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(f); f.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.1);
  }},
};

function toggleClickSound(on) {
  _clickSoundOn = on;
  localStorage.setItem('clickSound', on ? 'on' : 'off');
  if (on) playClickSound();
}

function setClickSoundType(type) {
  localStorage.setItem('clickSoundType', type);
  // Play a preview
  const wasOn = _clickSoundOn;
  _clickSoundOn = true;
  playClickSound();
  _clickSoundOn = wasOn;
}

function playClickSound() {
  if (!_clickSoundOn) return;
  try {
    if (!_clickSoundCtx) _clickSoundCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _clickSoundCtx;
    const t = ctx.currentTime;

    const type = localStorage.getItem('clickSoundType') || 'thud';
    const preset = CLICK_SOUND_PRESETS[type] || CLICK_SOUND_PRESETS.tap;
    preset.play(ctx, t);
  } catch {}
}

// Global click listener for interactive elements
document.addEventListener('click', function(e) {
  if (!_clickSoundOn) return;
  const el = e.target.closest('button, a, .sidebar-icon, [onclick], input[type="checkbox"], input[type="radio"], .toggle-switch');
  if (el) playClickSound();
}, { passive: true });

// ── Ambient rain sounds (Web Audio API) ──

let _rainCtx = null;
let _rainNodes = [];
let _rainOn = false;
let _rainVolume = parseFloat(localStorage.getItem('rainVolume') || '0.3');
let _rainNoiseType = localStorage.getItem('rainNoiseType') || 'rain';

// Noise type presets: each defines layers for _makeNoise
const NOISE_PRESETS = {
  rain:    { label: 'Rain',    layers: [['brown', 0.7], ['pink', 0.3]], thunder: true },
  brown:   { label: 'Brown',   layers: [['brown', 1.0]], thunder: false },
  storm:   { label: 'Storm',   layers: [['brown', 0.8], ['pink', 0.2]], thunder: true, thunderFreq: 0.4 },
};

function toggleRain() {
  _rainOn ? stopRain() : startRain();
}

function startRain() {
  if (_rainOn) return;
  _rainOn = true;
  const btn = document.getElementById('sb-rain');
  if (btn) btn.classList.add('active');
  localStorage.setItem('rainOn', '1');

  _rainCtx = new (window.AudioContext || window.webkitAudioContext)();
  const master = _rainCtx.createGain();
  master.gain.value = _rainVolume;
  master.connect(_rainCtx.destination);
  _rainNodes.push(master);

  const preset = NOISE_PRESETS[_rainNoiseType] || NOISE_PRESETS.rain;
  preset.layers.forEach(([type, amp]) => _makeNoise(_rainCtx, master, type, amp));
  if (preset.thunder) _rainThunderLoop(_rainCtx, master, preset.thunderFreq || 1);
}

function stopRain() {
  if (!_rainOn) return;
  _rainOn = false;
  const btn = document.getElementById('sb-rain');
  if (btn) btn.classList.remove('active');
  localStorage.removeItem('rainOn');
  if (_rainCtx) {
    _rainCtx.close();
    _rainCtx = null;
  }
  _rainNodes = [];
}

function setRainNoiseType(type) {
  _rainNoiseType = type;
  localStorage.setItem('rainNoiseType', type);
  if (_rainOn) { stopRain(); startRain(); }
}

function setRainVolume(v) {
  _rainVolume = Math.max(0, Math.min(1, v));
  localStorage.setItem('rainVolume', _rainVolume.toString());
  if (_rainNodes.length && _rainNodes[0]) {
    _rainNodes[0].gain.value = _rainVolume;
  }
  // Update settings percentage if visible
  const sliderVal = document.getElementById('rain-volume-value');
  if (sliderVal) sliderVal.textContent = Math.round(_rainVolume * 100) + '%';
  // Update sidebar tooltip if dragging
  const tooltip = document.querySelector('#sb-rain .sidebar-tooltip');
  if (tooltip && tooltip.dataset.volDrag) tooltip.textContent = Math.round(_rainVolume * 100) + '%';
}

function _rainVolDragStart(e) {
  e.preventDefault();
  const startY = e.clientY;
  const startVol = _rainVolume;
  const el = document.getElementById('rain-volume-value');
  function onMove(ev) {
    const dy = ev.clientY - startY;
    const newVol = Math.max(0, Math.min(1, startVol - dy / 150));
    setRainVolume(newVol);
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function setRainSidebarVisible(show) {
  localStorage.setItem('rainSidebarVisible', show ? '1' : '0');
  const btn = document.getElementById('sb-rain');
  if (btn) btn.style.display = show ? '' : 'none';
}

function isRainSidebarVisible() {
  const v = localStorage.getItem('rainSidebarVisible');
  return v !== '0'; // default visible
}

// ── Rain button drag-to-adjust-volume ──
(function() {
  let _rainDragging = false;
  let _rainDragStartY = 0;
  let _rainDragStartVol = 0;

  function showVolInTooltip() {
    const tooltip = document.querySelector('#sb-rain .sidebar-tooltip');
    if (tooltip) {
      tooltip.dataset.volDrag = '1';
      tooltip.style.opacity = '1';
      tooltip.style.visibility = 'visible';
      tooltip.textContent = Math.round(_rainVolume * 100) + '%';
    }
  }

  function restoreTooltip() {
    const tooltip = document.querySelector('#sb-rain .sidebar-tooltip');
    if (tooltip) {
      delete tooltip.dataset.volDrag;
      tooltip.textContent = 'White noise';
      tooltip.style.opacity = '';
      tooltip.style.visibility = '';
    }
  }

  document.addEventListener('DOMContentLoaded', function() {
    const btn = document.getElementById('sb-rain');
    if (!btn) return;
    // Apply initial sidebar visibility
    if (!isRainSidebarVisible()) btn.style.display = 'none';

    btn.addEventListener('mousedown', function(e) {
      if (e.button !== 0) return;
      _rainDragStartY = e.clientY;
      _rainDragStartVol = _rainVolume;
      _rainDragging = false;

      function onMove(ev) {
        const dy = ev.clientY - _rainDragStartY;
        if (!_rainDragging && Math.abs(dy) > 4) {
          _rainDragging = true;
          showVolInTooltip();
        }
        if (_rainDragging) {
          // drag down = lower volume, drag up = raise volume; 150px = full range
          const newVol = Math.max(0, Math.min(1, _rainDragStartVol - dy / 150));
          setRainVolume(newVol);
        }
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (_rainDragging) {
          restoreTooltip();
          // Delay reset so click handler can see the flag
          setTimeout(function() { _rainDragging = false; }, 50);
        }
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    btn.addEventListener('click', function(e) {
      if (_rainDragging) { e.preventDefault(); e.stopPropagation(); return; }
      toggleRain();
    });
  });
})();

function _makeNoise(ctx, dest, type, amp) {
  const bufSize = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(2, bufSize, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufSize; i++) {
      const white = Math.random() * 2 - 1;
      if (type === 'brown') {
        b0 = (b0 + (0.02 * white)) / 1.02;
        data[i] = b0 * 3.5 * amp;
      } else {
        // pink noise (Paul Kellet's algorithm)
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11 * amp;
        b6 = white * 0.115926;
      }
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;

  // Shape the noise
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = type === 'brown' ? 400 : 2500;
  lp.Q.value = 0.5;

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = type === 'brown' ? 40 : 200;
  hp.Q.value = 0.5;

  src.connect(hp);
  hp.connect(lp);
  lp.connect(dest);
  src.start();
  _rainNodes.push(src);
}

function _rainThunderLoop(ctx, dest, freqMul) {
  if (!_rainOn) return;
  const baseDelay = freqMul > 1 ? 5000 : 15000;
  const randDelay = freqMul > 1 ? 15000 : 45000;
  const delay = baseDelay + Math.random() * randDelay;
  setTimeout(function() {
    if (!_rainOn || !_rainCtx) return;
    // Low rumble
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 40 + Math.random() * 30;
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.08 * _rainVolume, ctx.currentTime + 0.5);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2 + Math.random() * 2);
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    osc.stop(ctx.currentTime + 4);
    _rainThunderLoop(ctx, dest, freqMul);
  }, delay);
}

// Restore rain on page load
if (localStorage.getItem('rainOn') === '1') {
  document.addEventListener('click', function _resumeRain() {
    document.removeEventListener('click', _resumeRain);
    startRain();
  }, { once: true });
  // Visually mark button as active immediately
  requestAnimationFrame(function() {
    const btn = document.getElementById('sb-rain');
    if (btn) btn.classList.add('active');
  });
}

// ── User accounts & sync ──

const GOOGLE_CLIENT_ID = '856091829253-1n5fu44j867fu88larg1vvnqds4pmkh4.apps.googleusercontent.com';
let _authToken = localStorage.getItem('authToken') || null;
let _authUser = localStorage.getItem('authUser') || null;  // email or name
let _authUserInfo = JSON.parse(localStorage.getItem('authUserInfo') || 'null');  // { google_id, email, name, username }
let _syncInterval = null;
let _authReady = false;  // true once login gate has been resolved

// Keys to sync between devices (all user settings)
const SYNC_KEYS = [
  'feedSources', 'customFeeds', 'qualityFilter', 'qualityPrompt',
  'qualityThreshold', 'qualityCache', 'hiddenPosts', 'savedPosts',
  'readPosts', 'qualityTestTitles', 'paperRatings', 'theme',
  'accentColor', 'spinner', 'userName', 'sidebarOrder',
  'clickSound', 'clickSoundType', 'rainNoiseType', 'rainVolume',
  'editorTheme', 'rainSidebarVisible',
  'pixelPet', 'pixelPetType', 'pixelPetMode',
  'feedNotifications', 'seenPostLinks',
  'adBlockEnabled', 'feedNotifSources'
];

// Default ad blocker to enabled
if (localStorage.getItem('adBlockEnabled') === null) {
  localStorage.setItem('adBlockEnabled', 'true');
}

function _authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (_authToken) h['Authorization'] = 'Bearer ' + _authToken;
  return h;
}

// ── Login gate ──

function _showLoginGate() {
  const gate = document.getElementById('login-gate');
  if (gate) gate.style.display = '';
  // Defer until DOM is ready (login gate HTML is at bottom of body, after scripts)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _renderGoogleButton);
  } else {
    _renderGoogleButton();
  }
}

function _hideLoginGate() {
  const gate = document.getElementById('login-gate');
  if (gate) gate.style.display = 'none';
}

let _gisRetries = 0;
function _renderGoogleButton() {
  const container = document.getElementById('google-signin-btn');
  if (!container) { console.warn('[auth] no google-signin-btn container'); return; }
  // Wait for GIS library to load (up to ~10s)
  if (typeof google === 'undefined' || !google.accounts) {
    _gisRetries++;
    if (_gisRetries % 10 === 1) console.log('[auth] waiting for GIS library... attempt', _gisRetries);
    if (_gisRetries < 50) {
      setTimeout(_renderGoogleButton, 200);
    } else {
      console.error('[auth] Google Identity Services failed to load after 50 attempts');
      container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Google Sign-In failed to load. Check that accounts.google.com is reachable and the current origin is an authorized JavaScript origin in your Google Cloud Console.</p>';
    }
    return;
  }
  console.log('[auth] GIS loaded, rendering button');
  try {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: _handleGoogleCredential,
    });
    // Render real Google button inside a wrapper we style ourselves
    container.innerHTML = '<div id="google-btn-real"></div>';
    google.accounts.id.renderButton(document.getElementById('google-btn-real'), {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      text: 'continue_with',
      shape: 'pill',
      width: 280,
    });
  } catch (e) {
    console.error('[auth] GIS renderButton error:', e);
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Google Sign-In error: ' + e.message + '</p>';
  }
}

async function _handleGoogleCredential(response) {
  const errEl = document.getElementById('auth-error');
  if (errEl) errEl.textContent = '';
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sign-in failed');
    _authToken = data.token;
    _authUser = (data.name || data.email || '').split(' ')[0];
    _authUserInfo = { email: data.email, name: data.name, username: data.username || null, picture: data.picture || null };
    localStorage.setItem('authToken', _authToken);
    localStorage.setItem('authUser', _authUser);
    localStorage.setItem('authUserInfo', JSON.stringify(_authUserInfo));
    // Clear any stale user data before pulling new user's data
    for (const key of SYNC_KEYS) localStorage.removeItem(key);
    // Sync: pull from server for returning users
    await syncFromServer();
    if (!data.username) {
      _showUsernamePicker();
    } else {
      _onLoginSuccess();
    }
  } catch (e) {
    if (errEl) errEl.textContent = e.message;
  }
}

// ── Username picker ──

function _showUsernamePicker() {
  const container = document.getElementById('google-signin-btn');
  if (!container) return;
  container.innerHTML = `
    <div style="text-align:center;max-width:320px;margin:0 auto;">
      <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">Choose a username</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">This will be your public identity for comments.</div>
      <div style="position:relative;">
        <input id="username-input" type="text" maxlength="20" placeholder="username"
          style="width:100%;box-sizing:border-box;padding:8px 12px;font-size:14px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input,var(--bg-secondary));color:var(--text-primary);outline:none;" />
        <div id="username-hint" style="font-size:11px;color:var(--text-muted);margin-top:4px;text-align:left;">2-20 chars: letters, numbers, hyphens, underscores</div>
      </div>
      <div id="username-error" style="font-size:12px;color:#e74c3c;margin-top:8px;min-height:18px;"></div>
      <button id="username-submit-btn" onclick="_submitUsername()"
        style="margin-top:8px;padding:8px 24px;font-size:14px;font-weight:500;border-radius:6px;border:none;background:var(--accent);color:#fff;cursor:pointer;opacity:0.5;" disabled>
        Continue
      </button>
    </div>
  `;
  const input = document.getElementById('username-input');
  input.addEventListener('input', () => {
    const val = input.value.replace(/[^a-zA-Z0-9_-]/g, '');
    if (val !== input.value) input.value = val;
    const btn = document.getElementById('username-submit-btn');
    const valid = val.length >= 2 && val.length <= 20;
    btn.disabled = !valid;
    btn.style.opacity = valid ? '1' : '0.5';
    document.getElementById('username-error').textContent = '';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const btn = document.getElementById('username-submit-btn');
      if (!btn.disabled) _submitUsername();
    }
  });
  input.focus();
}

async function _submitUsername() {
  const input = document.getElementById('username-input');
  const errEl = document.getElementById('username-error');
  const btn = document.getElementById('username-submit-btn');
  if (!input || !errEl) return;
  const username = input.value.trim();
  if (username.length < 2 || username.length > 20 || !/^[a-zA-Z0-9_-]+$/.test(username)) {
    errEl.textContent = 'Invalid username format';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Checking...';
  try {
    const res = await fetch('/api/auth/username', {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ username })
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Failed to set username';
      btn.disabled = false;
      btn.textContent = 'Continue';
      return;
    }
    _authUserInfo.username = data.username;
    localStorage.setItem('authUserInfo', JSON.stringify(_authUserInfo));
    _onLoginSuccess();
  } catch (e) {
    errEl.textContent = 'Network error, please try again';
    btn.disabled = false;
    btn.textContent = 'Continue';
  }
}

async function _saveUsernameFromSettings() {
  const input = document.getElementById('settings-username');
  const msg = document.getElementById('settings-username-msg');
  const btn = document.getElementById('settings-username-save');
  if (!input || !msg) return;
  const username = input.value.trim();
  input.value = username;
  if (!username) { msg.style.color = '#e74c3c'; msg.textContent = 'Username cannot be empty'; return; }
  if (username.length < 2 || username.length > 20) { msg.style.color = '#e74c3c'; msg.textContent = '2-20 characters required'; return; }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) { msg.style.color = '#e74c3c'; msg.textContent = 'Only letters, numbers, hyphens, underscores'; return; }
  if (_authUserInfo && _authUserInfo.username === username) { msg.style.color = 'var(--text-muted)'; msg.textContent = 'No change'; return; }
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    const res = await fetch('/api/auth/username', {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ username })
    });
    const data = await res.json();
    if (!res.ok) { msg.style.color = '#e74c3c'; msg.textContent = data.error || 'Failed'; return; }
    if (_authUserInfo) _authUserInfo.username = data.username;
    msg.style.color = 'var(--accent)'; msg.textContent = 'Username updated';
  } catch (e) {
    msg.style.color = '#e74c3c'; msg.textContent = 'Network error';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  }
}

// ── Auth actions ──

function _onLoginSuccess() {
  _authReady = true;
  _hideLoginGate();
  _updateAccountUI();
  _startSyncInterval();
  // Apply any synced appearance settings
  if (typeof applyStoredAppearance === 'function') applyStoredAppearance();
  // Refresh inbox badge
  if (typeof refreshInboxBadge === 'function') {
    refreshInboxBadge();
    setInterval(refreshInboxBadge, 60000);
  }
  // Route to the correct view now that auth is resolved
  routeFromHash();
}

async function authLogout() {
  if (_authToken) {
    // Push latest settings before logging out
    await syncToServer().catch(() => {});
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: _authHeaders()
    }).catch(() => {});
  }
  _authToken = null;
  _authUser = null;
  _authUserInfo = null;
  _authReady = false;
  // Clear all user-specific data from localStorage
  for (const key of SYNC_KEYS) localStorage.removeItem(key);
  localStorage.removeItem('authToken');
  localStorage.removeItem('authUser');
  localStorage.removeItem('authUserInfo');
  _updateAccountUI();
  _stopSyncInterval();
  _showLoginGate();
}

function _updateAccountUI() {
  const wrap = document.getElementById('sb-user-wrap');
  const avatar = document.getElementById('sb-user-avatar');
  const gear = document.getElementById('sb-settings');
  if (!wrap || !avatar) {
    // DOM not ready yet, retry after load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _updateAccountUI, { once: true });
    }
    return;
  }
  if (_authUserInfo && (_authUserInfo.username || _authUserInfo.name)) {
    if (_authUserInfo.picture) {
      avatar.innerHTML = `<img src="${_authUserInfo.picture.replace(/"/g, '&quot;')}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" referrerpolicy="no-referrer" />`;
      avatar.style.cssText = 'background:none; padding:0;';
    } else {
      const letter = (_authUserInfo.username || _authUserInfo.name || '?')[0].toUpperCase();
      avatar.textContent = letter;
      avatar.style.cssText = 'background:var(--accent);';
    }
    wrap.style.display = '';
    if (gear) gear.style.display = 'none';
  } else {
    wrap.style.display = 'none';
    if (gear) gear.style.display = '';
  }
}

function _toggleUserMenu() {
  const pop = document.getElementById('user-menu-popover');
  if (!pop) return;
  // Always close first then re-open (always show popup on click)
  pop.style.display = 'none';
  const email = _authUserInfo?.email || '';
  const username = _authUserInfo?.username || '';
  pop.innerHTML = `
    <div style="padding:10px 16px 8px;border-bottom:1px solid var(--border-card);">
      <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${escapeHtml(username)}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:1px;">${escapeHtml(email)}</div>
    </div>
    <button onclick="_userMenuAction('profile')" style="display:flex;align-items:center;gap:10px;width:100%;padding:8px 16px;border:none;background:none;color:var(--text-primary);font-size:13px;cursor:pointer;text-align:left;" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">
      <svg class="w-4 h-4" style="flex-shrink:0;opacity:.6;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.118a7.5 7.5 0 0115 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.5-1.632z"/></svg>
      View Profile
    </button>
    <button onclick="_userMenuAction('settings')" style="display:flex;align-items:center;gap:10px;width:100%;padding:8px 16px;border:none;background:none;color:var(--text-primary);font-size:13px;cursor:pointer;text-align:left;" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">
      <svg class="w-4 h-4" style="flex-shrink:0;opacity:.6;" fill="currentColor" viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z"/></svg>
      Settings
    </button>
    <div style="border-top:1px solid var(--border-card);margin:2px 0;"></div>
    <button onclick="_userMenuAction('logout')" style="display:flex;align-items:center;gap:10px;width:100%;padding:8px 16px;border:none;background:none;color:var(--text-primary);font-size:13px;cursor:pointer;text-align:left;" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">
      <svg class="w-4 h-4" style="flex-shrink:0;opacity:.6;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3-3h-9m9 0l-3-3m3 3l-3 3"/></svg>
      Sign Out
    </button>
  `;
  pop.style.display = '';
  // Close on outside click
  setTimeout(() => {
    function _closeMenu(e) {
      if (!pop.contains(e.target) && e.target.id !== 'sb-user-avatar') {
        pop.style.display = 'none';
        document.removeEventListener('click', _closeMenu);
      }
    }
    document.addEventListener('click', _closeMenu);
  }, 0);
}

function _userMenuAction(action) {
  document.getElementById('user-menu-popover').style.display = 'none';
  if (action === 'profile') openUserProfile(_authUserInfo?.username || '');
  else if (action === 'settings') openSettings();
  else if (action === 'logout') _doLogout();
  else if (action === 'delete') _doDeleteAccount();
}

function openAuthModal() {
  if (!_authUser) { _showLoginGate(); return; }
  // Already logged in — open settings instead
  if (typeof openSettings === 'function') openSettings();
}

// ── Sync ──

function _buildSyncPayload() {
  const data = {};
  const now = Date.now() / 1000;
  for (const key of SYNC_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      let value;
      try { value = JSON.parse(raw); } catch { value = raw; }
      data[key] = { value, updated: now };
    }
  }
  return data;
}

function _applySyncData(serverData) {
  for (const [key, entry] of Object.entries(serverData)) {
    if (!SYNC_KEYS.includes(key)) continue;
    const value = entry.value;
    if (value === null || value === undefined) continue;
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
}

async function syncToServer() {
  if (!_authToken) return;
  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ data: _buildSyncPayload() })
    });
    if (res.status === 401) { authLogout(); return; }
    const result = await res.json();
    if (result.data) _applySyncData(result.data);
  } catch (e) {
    console.warn('[sync] push failed:', e);
  }
}

async function syncFromServer() {
  if (!_authToken) return;
  try {
    // Pull only — send empty payload so server data always wins
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ data: {} })
    });
    if (res.status === 401) { authLogout(); return; }
    const result = await res.json();
    if (result.data) _applySyncData(result.data);
  } catch (e) {
    console.warn('[sync] pull failed:', e);
  }
}

function _startSyncInterval() {
  _stopSyncInterval();
  _syncInterval = setInterval(syncToServer, 60000);
}

function _stopSyncInterval() {
  if (_syncInterval) { clearInterval(_syncInterval); _syncInterval = null; }
}

// ── UI action handlers ──

async function _doSettingsSync() {
  const s = document.getElementById('settings-sync-status');
  if (s) s.textContent = 'Syncing...';
  await syncToServer();
  if (s) s.textContent = 'Synced just now';
}

function _doLogout() {
  authLogout();
}

async function _doDeleteAccount() {
  if (!confirm('Are you sure you want to delete your account? This cannot be undone.')) return;
  if (!confirm('All your data will be permanently deleted. Continue?')) return;
  try {
    await fetch('/api/auth/delete-account', {
      method: 'POST',
      headers: _authHeaders()
    });
  } catch (e) { /* proceed with local cleanup regardless */ }
  _authToken = null;
  _authUser = null;
  _authUserInfo = null;
  _authReady = false;
  localStorage.clear();
  _updateAccountUI();
  _stopSyncInterval();
  _showLoginGate();
}

// ── Initialize: check session, show login gate if needed ──
(function _initAuth() {
  _updateAccountUI();
  if (_authToken) {
    // Verify session is still valid
    fetch('/api/auth/me', { headers: _authHeaders() })
      .then(r => {
        if (r.ok) return r.json();
        throw new Error('expired');
      })
      .then(data => {
        _authUser = (data.name || data.email || _authUser || '').split(' ')[0];
        _authUserInfo = { email: data.email, name: data.name, google_id: data.google_id, username: data.username || null, picture: data.picture || null };
        localStorage.setItem('authUser', _authUser);
        localStorage.setItem('authUserInfo', JSON.stringify(_authUserInfo));
        if (!data.username) {
          _showLoginGate();
          _showUsernamePicker();
        } else {
          _onLoginSuccess();
        }
        syncFromServer();
      })
      .catch(() => {
        _authToken = null;
        _authUser = null;
        _authUserInfo = null;
        localStorage.removeItem('authToken');
        localStorage.removeItem('authUser');
        localStorage.removeItem('authUserInfo');
        _updateAccountUI();
        _showLoginGate();
      });
  } else {
    // No token — show login gate
    _showLoginGate();
  }
})();

