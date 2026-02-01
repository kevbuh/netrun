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

// Sync active state between desktop sidebar and mobile bottom nav
function setSidebarActive(id) {
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
  if (hash === '#experiments') openExperiments();
  else if (hash === '#settings' || hash === '#quality') openSettings();
  else if (hash === '#calendar') openCalendar();
else if (hash === '#saved-all') openAllSaved();
  else if (hash === '#saved') openDashboard();
  else if (hash === '#search') openSearch();
  else if (hash === '#feed') goHome();
  else if (hash.startsWith('#experiment/')) openExperimentDetail(hash.slice('#experiment/'.length));
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

    const type = localStorage.getItem('clickSoundType') || 'tap';
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
  // Update volume indicator if visible
  const ind = document.getElementById('rain-vol-indicator');
  if (ind) ind.textContent = Math.round(_rainVolume * 100) + '%';
  // Update settings slider if visible
  const slider = document.getElementById('rain-volume-slider');
  if (slider && Math.abs(parseFloat(slider.value) - _rainVolume) > 0.01) slider.value = _rainVolume;
  const sliderVal = document.getElementById('rain-volume-value');
  if (sliderVal) sliderVal.textContent = Math.round(_rainVolume * 100) + '%';
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
  let _rainVolIndicator = null;

  function showVolIndicator() {
    if (_rainVolIndicator) return;
    const btn = document.getElementById('sb-rain');
    if (!btn) return;
    _rainVolIndicator = document.createElement('div');
    _rainVolIndicator.id = 'rain-vol-indicator';
    _rainVolIndicator.style.cssText = 'position:fixed;left:70px;background:var(--bg-tooltip);color:var(--text-primary);font-size:0.72rem;padding:3px 8px;border-radius:6px;border:1px solid var(--tooltip-border);pointer-events:none;white-space:nowrap;z-index:99999;font-variant-numeric:tabular-nums;';
    const rect = btn.getBoundingClientRect();
    _rainVolIndicator.style.top = (rect.top + rect.height/2 - 12) + 'px';
    _rainVolIndicator.textContent = Math.round(_rainVolume * 100) + '%';
    document.body.appendChild(_rainVolIndicator);
  }

  function hideVolIndicator() {
    if (_rainVolIndicator) { _rainVolIndicator.remove(); _rainVolIndicator = null; }
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
          showVolIndicator();
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
          hideVolIndicator();
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

