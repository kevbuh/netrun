// core-views.js — View management, feed catalog, window manager
// Extracted from core.js

// ── View management ──

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
  // Atom Format Feeds
  { key: 'github', name: 'GitHub Blog', desc: 'Developer platform news and features (Atom)', cat: 'Programming', url: 'https://github.blog/feed/', letter: 'G', bg: '#24292e', fg: '#fff', favicon: 'github.com' },
  { key: 'stackoverflow', name: 'Stack Overflow Blog', desc: 'Programming Q&A and developer insights (Atom)', cat: 'Programming', url: 'https://stackoverflow.blog/feed/', letter: 'SO', bg: '#f48024', fg: '#fff', favicon: 'stackoverflow.com' },
  { key: 'reddit-programming', name: 'r/programming', desc: 'Programming subreddit discussions (Atom)', cat: 'Programming', url: 'https://www.reddit.com/r/programming/.rss', letter: 'R', bg: '#ff4500', fg: '#fff', favicon: 'reddit.com' },
  { key: 'reddit-machinelearning', name: 'r/MachineLearning', desc: 'ML research and discussions (Atom)', cat: 'AI & Machine Learning', url: 'https://www.reddit.com/r/MachineLearning/.rss', letter: 'R', bg: '#ff4500', fg: '#fff', favicon: 'reddit.com' },
  { key: 'medium-engineering', name: 'Medium Engineering', desc: 'Engineering blog from Medium (Atom)', cat: 'Programming', url: 'https://medium.engineering/feed', letter: 'M', bg: '#12100e', fg: '#fff', favicon: 'medium.com' },
  { key: 'chromium', name: 'Chromium Blog', desc: 'Chrome and Chromium development (Atom)', cat: 'Programming', url: 'https://blog.chromium.org/feeds/posts/default', letter: 'C', bg: '#4285f4', fg: '#fff', favicon: 'blog.chromium.org' },
  { key: 'android-developers', name: 'Android Developers', desc: 'Official Android development blog (Atom)', cat: 'Programming', url: 'https://android-developers.googleblog.com/feeds/posts/default', letter: 'A', bg: '#3ddc84', fg: '#000', favicon: 'developer.android.com' },
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
const FEED_CAT_MAP = {};
FEED_CATALOG.forEach(f => {
  SOURCE_LOGO_INLINE[f.key] = catalogLogo(f, 'inline');
  SOURCE_NAMES[f.key] = f.name;
  FEED_CAT_MAP[f.key] = f.cat;
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

// ── View Manager (lazy-load templates) ──
const _viewTemplateCache = {};   // { viewId: htmlString }
const _mountedViews = new Set(); // currently injected view IDs

const VIEW_REGISTRY = {
  'exp-detail-view':     { template: '/views/experiment-detail.html', tier: 2 },
  'dashboard-view':      { template: '/views/dashboard.html', tier: 2 },
  'research-view':       { template: '/views/research.html',  tier: 2 },
  'vault-view':          { template: '/views/vault.html',     tier: 3 },
  'blog-view':           { template: '/views/blog.html',      tier: 2 },
  'settings-view':       { template: '/views/settings.html',  tier: 2 },
  'quality-view':        { template: '/views/quality.html',   tier: 2 },
  'algorithm-view':      { template: '/views/algorithm.html', tier: 2 },
  'inbox-view':          { template: '/views/inbox.html',     tier: 2 },
  'profile-view':        { template: '/views/profile.html',   tier: 2 },
  'author-profile-view': { template: '/views/author-profile.html', tier: 2 },
  'teams-view':          { template: '/views/teams.html',     tier: 2 },
  'neuralook-view':      { template: '/views/neuralook.html', tier: 2 },
  'dev-stats-view':      { template: '/views/dev.html',      tier: 2 },
  'knowledge-graph-view': { template: '/views/knowledge-graph.html', tier: 2 },
};

async function ensureView(viewId) {
  const existing = document.getElementById(viewId);
  if (existing) return existing;
  const config = VIEW_REGISTRY[viewId];
  if (!config) return null;
  if (!_viewTemplateCache[viewId]) {
    const resp = await api(config.template);
    _viewTemplateCache[viewId] = await resp.text();
  }
  const div = document.createElement('div');
  div.id = viewId;
  div.className = 'hidden view';
  // Preserve extra styles for specific views
  if (viewId === 'vault-view' || viewId === 'blog-view' || viewId === 'knowledge-graph-view') div.style.height = '100%';
  if (viewId === 'dashboard-view') div.classList.add('overflow-x-hidden');
  div.innerHTML = _viewTemplateCache[viewId];
  document.getElementById('view-mount').appendChild(div);
  _mountedViews.add(viewId);
  return div;
}

function unmountView(viewId) {
  if (!_mountedViews.has(viewId)) return;
  const el = document.getElementById(viewId);
  if (el) el.remove();
  _mountedViews.delete(viewId);
}

function hideAllViews() {
  document.getElementById('home-main').style.display = 'none';
  document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.classList.add('hidden'); v.style.display = ''; });
  // Unmount Tier 2 views to free DOM
  for (const viewId of [..._mountedViews]) {
    const config = VIEW_REGISTRY[viewId];
    if (config && config.tier === 2) unmountView(viewId);
  }
  // Stop feed refresh timer and any in-flight loading when leaving home
  if (typeof _refreshTimer !== 'undefined' && _refreshTimer) {
    clearInterval(_refreshTimer);
    _refreshTimer = null;
  }
  if (typeof stopFeedLoading === 'function') stopFeedLoading();
  if (typeof _stopScrollTracker === 'function') _stopScrollTracker();
  if (typeof _spinnerPreviewInterval !== 'undefined' && _spinnerPreviewInterval) { clearInterval(_spinnerPreviewInterval); _spinnerPreviewInterval = null; }
  if (typeof _setPillBrowseMode === 'function') _setPillBrowseMode(false);
  if (typeof _browseRemoveKeyGuard === 'function') _browseRemoveKeyGuard();
  if (typeof _devFpsRaf !== 'undefined' && _devFpsRaf) { cancelAnimationFrame(_devFpsRaf); _devFpsRaf = null; }
  if (typeof _vaultGitMode !== 'undefined' && _vaultGitMode) { document.removeEventListener('keydown', _vibeKeyHandler); }
  // Hide universal panel (next view's open function will re-show if it has registered tabs)
  const _upanel = document.getElementById('universal-panel');
  if (_upanel) _upanel.style.display = 'none';
  _removePanelMargin();
  _panelActiveView = null;
}

// ── Niri-style Tiling Window Manager ──

// Capture a preview screenshot of the current view (below the pill bar)
async function _wmCapturePreview() {
  if (!window.electronAPI?.captureScreen) return;
  const key = _wmWindows[_wmFocusIndex]?.key;
  if (!key) return;
  try {
    const pill = document.getElementById('sidebar-nav');
    const top = pill ? pill.offsetTop + pill.offsetHeight : 0;
    const base64 = await window.electronAPI.captureScreen({
      x: 0, y: top, width: window.innerWidth, height: window.innerHeight - top
    });
    if (base64) _wmPreviews[key] = 'data:image/png;base64,' + base64;
  } catch (e) { /* ignore capture failures */ }
}

const _wmViewMeta = {
  dashboard:  { sidebarId: 'sb-dashboard', label: 'Home',       openFn() { openDashboard(); } },
  feed:       { sidebarId: 'sb-home',      label: 'Feed',       openFn() { goHome(); } },
  vault:      { sidebarId: 'sb-vault',     label: 'Vault',      openFn() { openVault(); } },
  browse:     { sidebarId: 'sb-browse',    label: 'Browse',     openFn() { openBrowse(); } },
  inbox:      { sidebarId: 'sb-inbox',     label: 'Inbox',      openFn() { openInbox(); } },
  neuralook:  { sidebarId: 'sb-neuralook', label: 'Neuralook',  openFn() { openNeuralook(); } },
  dev:        { sidebarId: 'sb-dev',       label: 'Dev Stats',  openFn() { openDevStats(); } },
  settings:   { sidebarId: 'sb-settings',  label: 'Settings',   openFn() { openSettings(); } },
  calendar:   { sidebarId: 'sb-dashboard',  label: 'Dashboard',  openFn() { openDashboard(); } },
  graph:      { sidebarId: 'sb-graph',    label: 'Graph',      openFn() { openKnowledgeGraph(); } },
};

// Pre-populate all views (pill bar order)
const _wmWindows = _wmDefaultOrder.map(key => ({
  key,
  label: _wmViewMeta[key].label,
  sidebarId: _wmViewMeta[key].sidebarId,
}));

function wmOpen(key) {
  const meta = _wmViewMeta[key];
  if (!meta) return;
  // Dismiss overview if open
  if (typeof _browseTabOverviewVisible !== 'undefined' && _browseTabOverviewVisible && typeof hideBrowseTabOverview === 'function') hideBrowseTabOverview();
  const existIdx = _wmWindows.findIndex(w => w.key === key);
  if (existIdx >= 0 && existIdx === _wmFocusIndex && _wmMode === 'fullscreen') {
    // Skip if this is a re-entrant call from the hash router after a recent navigation
    if (Date.now() - _wmLastNavTime < 500) return;
    // Already on browse NTP — toggle the nowplaying context pill tray
    if (key === 'browse') {
      const activeTab = typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined'
        ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
      if (activeTab && activeTab.blank) {
        const npPill = document.querySelector('.pill-island[data-island-id="nowplaying"]');
        if (npPill) { npPill.classList.toggle('island-tray-open'); return; }
      }
    }
    // Already on this view — wiggle the sidebar icon
    const btn = document.getElementById(meta.sidebarId);
    if (btn) {
      Motion.retrigger(btn, 'sb-wiggle', 400);
    }
    setSidebarLoading(meta.sidebarId);
    return;
  }
  _wmCapturePreview();
  if (existIdx >= 0) {
    _wmFocusIndex = existIdx;
  } else {
    _wmWindows.push({ key, label: meta.label, sidebarId: meta.sidebarId });
    _wmFocusIndex = _wmWindows.length - 1;
  }
  _wmLastNavTime = Date.now();
  _invalidateBoundsCache(); // view switch may show/hide tab bars
  _wmActivateWindow(_wmFocusIndex);
}

function _wmActivateWindow(index) {
  if (index < 0 || index >= _wmWindows.length) return;
  _wmFocusIndex = index;
  _wmMode = 'fullscreen';
  const w = _wmWindows[index];
  const meta = _wmViewMeta[w.key];
  if (meta) meta.openFn();
}

function _wmToggleTiling() {
  if (typeof toggleBrowseTabOverview === 'function') toggleBrowseTabOverview();
}

/* ── Drag pill — horizontal drag to switch windows ── */
(function() {
  const STEP = 5; // px per window step
  let _dragStartX = 0;
  let _dragAccum = 0;
  let _previewIdx = -1;
  let _originIdx = -1;
  let _icons = []; // visible sidebar icons for this drag

  function _getVisibleIcons() {
    const nav = document.getElementById('sidebar-nav');
    if (!nav) return [];
    const all = nav.querySelectorAll('.sidebar-icon');
    const visible = [];
    for (let i = 0; i < all.length; i++) {
      if (all[i].offsetParent !== null || all[i].offsetWidth > 0) visible.push(all[i]);
    }
    return visible;
  }
  function _iconToWmIndex(el) {
    const id = el.id;
    for (let i = 0; i < _wmWindows.length; i++) {
      if (_wmWindows[i].sidebarId === id) return i;
    }
    // Settings icon → settings
    if (id === 'sb-settings') {
      for (let j = 0; j < _wmWindows.length; j++) {
        if (_wmWindows[j].key === 'settings') return j;
      }
    }
    return -1;
  }
  function _clearPreview() {
    document.querySelectorAll('.sidebar-icon.drag-preview').forEach(function(el) {
      el.classList.remove('drag-preview');
    });
    _previewIdx = -1;
  }
  function _showPreview(idx) {
    if (idx === _previewIdx) return;
    _clearPreview();
    _previewIdx = idx;
    if (_icons[idx]) _icons[idx].classList.add('drag-preview');
  }
  function _currentIconIdx() {
    for (let i = 0; i < _icons.length; i++) {
      if (_icons[i].classList.contains('active')) return i;
    }
    return 0;
  }

  function onMove(e) {
    const x = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    _dragAccum += x - _dragStartX;
    _dragStartX = x;
    const steps = Math.round(_dragAccum / STEP);
    let target = _originIdx + steps;
    const n = _icons.length;
    if (n > 0) target = ((target % n) + n) % n;
    _showPreview(target);
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onUp);
    if (_previewIdx >= 0 && _previewIdx !== _originIdx) {
      const targetIcon = _icons[_previewIdx];
      if (targetIcon) {
        const wmIdx = _iconToWmIndex(targetIcon);
        if (wmIdx >= 0) _wmActivateWindow(wmIdx);
        else targetIcon.click();
      }
    }
    _clearPreview();
  }

  function startDrag(x) {
    _dragStartX = x;
    _dragAccum = 0;
    _icons = _getVisibleIcons();
    _originIdx = _currentIconIdx();
    _previewIdx = -1;
  }

})();

function goHome() {
  const alreadyOnFeed = window.location.hash === '#feed';
  document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.style.display = ''; });
  // Unmount Tier 2 views when going home
  for (const viewId of [..._mountedViews]) {
    const config = VIEW_REGISTRY[viewId];
    if (config && config.tier === 2) unmountView(viewId);
  }
  document.getElementById('home-main').style.display = '';
  window.location.hash = 'feed';
  setSidebarActive('sb-home');
  if (alreadyOnFeed) {
    // Reset source filter pills
    if (typeof hiddenSourceFilters !== 'undefined') hiddenSourceFilters.clear();
    if (typeof renderSourceBubbles === 'function') renderSourceBubbles();
  }
  loadAllFeeds();
}

async function openResearch(tab) {
  if (tab) _researchActiveTab = tab;
  // Open browse and ensure a blank tab is active
  openBrowse();
  const win = typeof _getCurrentWindow === 'function' ? _getCurrentWindow() : null;
  if (win) {
    const blank = win.tabs.find(t => t.blank);
    if (blank) {
      browseSelectTab(blank.id);
    } else {
      browseNewTab();
    }
  }
  switchResearchTab(_researchActiveTab);
}

function switchResearchTab(tab) {
  _researchActiveTab = tab;

  // Update tab buttons
  document.querySelectorAll('.research-tab').forEach(btn => btn.classList.remove('active'));
  if (tab) {
    const activeBtn = document.getElementById('research-tab-' + tab);
    if (activeBtn) activeBtn.classList.add('active');
  }

  // Update panels
  document.querySelectorAll('.research-panel').forEach(panel => panel.style.display = 'none');
  if (tab) {
    const activePanel = document.getElementById('research-panel-' + tab);
    if (activePanel) activePanel.style.display = '';
  }

  // Focus search input on new tab page (always visible)
  const searchInput = document.getElementById('search-query');
  if (searchInput) setTimeout(() => searchInput.focus(), 50);

  // Tab-specific initialization
  if (tab === 'search') {
    // focus already handled above
  } else if (tab === 'users') {
    const input = document.getElementById('user-search-query');
    if (input) setTimeout(() => input.focus(), 50);
    renderResearchUsers();
  } else if (tab === 'teams') {
    renderResearchTeams();
  } else if (tab === 'vault') {
    if (typeof renderNtpVaultPanel === 'function') renderNtpVaultPanel();
  }
}

// User search in Research view
async function submitUserSearch() {
  const input = document.getElementById('user-search-query');
  const query = input?.value.trim() || '';
  renderResearchUsers(query);
}

async function renderResearchUsers(query = '') {
  const container = document.getElementById('user-search-results');
  if (!container) return;

  container.innerHTML = '<div class="text-dimmer text-sm">Loading users...</div>';

  try {
    const url = query ? '/api/users?q=' + encodeURIComponent(query) : '/api/users';
    const users = await apiGet(url);

    if (!users.length) {
      container.innerHTML = '<div class="text-dimmer text-sm py-4">No users found</div>';
      return;
    }

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
  } catch (e) {
    container.innerHTML = '<div class="text-dimmer text-sm">Failed to load users</div>';
    console.error('User search error', e);
  }
}

// Legacy functions for compatibility
function openSearch() {
  openResearch('search');
}

function openExperiments() {
  wmOpen('vault');
}

async function openDashboard() {
  hideAllViews();
  const view = await ensureView('dashboard-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = '';
  setSidebarActive('sb-dashboard');
  renderDashboard();
}

async function openDevStats() {
  hideAllViews();
  const view = await ensureView('dev-stats-view');
  view.classList.add('active');
  view.style.display = 'block';
  if (window.location.hash !== '#dev') window.location.hash = '#dev';
  setSidebarActive('sb-dev');
  renderDevPanel();
}

function expGoBack() {
  if (_expBackAction && _expBackAction.fn) {
    _expBackAction.fn();
  } else if (!navBack()) {
    wmOpen('vault');
  }
}


// ── Navigation history stack (survives Cmd+Shift+R via localStorage) ──