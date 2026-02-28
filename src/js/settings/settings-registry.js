// settings-registry.js — flat registry of all searchable settings for settings search
export const _SETTINGS_REGISTRY = [
  // ── Profile ──
  { section: 'profile', label: 'Private Profile', desc: 'Hide your profile from search and browse', keywords: 'privacy private hide search' },

  // ── Appearance: Visual ──
  { section: 'appearance', label: 'Theme', desc: 'App-wide color theme: dark, light, daylight, or clear', keywords: 'dark light daylight clear theme mode color scheme' },
  { section: 'appearance', label: 'Aether Theme', desc: 'Color scheme for the Aether chat panel', keywords: 'aether panel chat midnight match color' },
  { section: 'appearance', label: 'Accent Color', desc: 'Pick the app accent color', keywords: 'accent color brand tint orange red gold green blue purple pink' },
  { section: 'appearance', label: 'Editor Theme', desc: 'Code editor syntax theme', keywords: 'editor code syntax monokai dracula solarized github nord' },
  { section: 'appearance', label: 'Icon Size', desc: 'Sidebar icon size: small, medium, or large', keywords: 'icon size sidebar density' },
  { section: 'appearance', label: 'Pixel Pet', desc: 'Animated companion that follows the cursor', keywords: 'pet mascot animation cursor cat dog bunny' },

  // ── Appearance: Layout ──
  { section: 'appearance', label: 'Loading Spinner', desc: 'Choose which spinner animation plays during page loads', keywords: 'spinner loading animation progress' },
  { section: 'appearance', label: 'Custom Cursor', desc: 'Smooth cursor with context-aware styling and inertia', keywords: 'cursor mouse pointer smooth' },

  // ── Appearance: Ambient ──
  { section: 'appearance', label: 'Button Sounds', desc: 'Play a short sound on button clicks', keywords: 'sound audio click feedback tap pop' },

  // ── Appearance: Read Aloud ──
  { section: 'appearance', label: 'Read Aloud Highlight', desc: 'Highlight text as it is read aloud via TTS', keywords: 'text to speech tts highlight read aloud' },
  { section: 'appearance', label: 'Read Aloud Speed', desc: 'Playback speed for TTS read-aloud', keywords: 'tts speed rate playback fast slow' },

  // ── Appearance: Captions ──
  { section: 'appearance', label: 'Captions Overlay', desc: 'Display captions as a floating bar on the page', keywords: 'captions overlay subtitle transcript' },

  // ── Appearance: Menu Icons ──
  { section: 'appearance', label: 'Menu Icons', desc: 'Toggle and reorder sidebar menu icons', keywords: 'sidebar menu icon reorder drag visibility' },

  // ── Browser: Layout ──
  { section: 'browser', label: 'Simplify URLs', desc: 'Show only the domain name in the URL bar', keywords: 'url domain address bar shorten clean' },
  { section: 'browser', label: 'Adaptive Background', desc: 'Match the browser background to the current site color', keywords: 'adaptive color background url bar site' },
  { section: 'browser', label: 'URL Bar Sections', desc: 'Reorder and toggle sections in the URL bar dropdown', keywords: 'url bar sections reorder drag layout' },
  { section: 'browser', label: 'Visible Tab Favicons', desc: 'Number of tab favicons shown in the compact toolbar pill', keywords: 'tab favicon island pill compact strip count visible' },

  // ── Browser: Privacy ──
  { section: 'browser', label: 'Ad Blocker', desc: 'Block ads and trackers at the network level', keywords: 'ads block tracker privacy filter list' },
  { section: 'browser', label: 'Hide YouTube Shorts', desc: 'Hide Shorts from YouTube homepage, sidebar, and search', keywords: 'youtube shorts hide block filter' },
  { section: 'browser', label: 'Encrypted DNS', desc: 'Encrypt all DNS queries over HTTPS (DoH)', keywords: 'dns doh encrypted https cloudflare privacy' },
  { section: 'browser', label: 'DNS Provider', desc: 'Choose DoH provider: Cloudflare, Quad9, or Mullvad', keywords: 'dns provider cloudflare quad9 mullvad' },
  { section: 'browser', label: 'HTTPS-Only Mode', desc: 'Upgrade insecure HTTP connections to HTTPS', keywords: 'https http upgrade security ssl tls' },
  { section: 'browser', label: 'Tracking Protection', desc: 'Strip tracking parameters (UTM, fbclid) from URLs', keywords: 'tracking utm fbclid url strip privacy' },
  { section: 'browser', label: 'Block Third-Party Cookies', desc: 'Block cookies from domains other than the visited site', keywords: 'cookies third party block privacy' },
  { section: 'browser', label: 'Focus Mode', desc: 'Block or limit time on distracting sites', keywords: 'focus doom scroll block limit distraction' },
  { section: 'browser', label: 'Site Permissions', desc: 'Manage camera, microphone, location, and notification permissions per site', keywords: 'permissions camera microphone location notification popup' },
  { section: 'browser', label: 'Saved Passwords', desc: 'View and manage saved passwords', keywords: 'passwords keychain saved credentials login' },
  { section: 'browser', label: 'Import Bookmarks', desc: 'Import bookmarks from other browsers', keywords: 'bookmarks import chrome firefox safari reading list' },

  // ── AI ──
  { section: 'ai', label: 'AI Features', desc: 'Master switch for all AI models and features', keywords: 'ai master toggle disable enable kill switch' },
  { section: 'ai', label: 'Provider', desc: 'Choose between Local (Ollama) or Cloud (OpenRouter)', keywords: 'provider ollama openrouter local cloud llm' },
  { section: 'ai', label: 'API Key', desc: 'OpenRouter API key for cloud models', keywords: 'api key openrouter cloud secret' },
  { section: 'ai', label: 'Chat Model', desc: 'Default model for Aether panel chat', keywords: 'chat model llm select' },
  { section: 'ai', label: 'Vision Model', desc: 'Model for chatting with screenshots', keywords: 'vision model multimodal screenshot image' },
  { section: 'ai', label: 'Summary Model', desc: 'Model for the daily overview summary', keywords: 'summary model daily overview' },
  { section: 'ai', label: 'Annotation Model', desc: 'Model that analyzes pages and highlights findings', keywords: 'annotation insight page analysis model' },
  { section: 'ai', label: 'OCR Model', desc: 'Visual OCR model for extracting text from screenshots', keywords: 'ocr model visual text extraction' },
  { section: 'ai', label: 'Chat Tools', desc: 'Allow AI to take actions during chat (function calling)', keywords: 'tools function calling agent actions' },
  { section: 'ai', label: 'Thinking', desc: 'Let the model reason step-by-step before responding', keywords: 'thinking reasoning chain of thought tokens' },
  { section: 'ai', label: 'Voice Auto-Send', desc: 'Auto-send message after voice transcription completes', keywords: 'voice auto send transcription mic speech' },
  { section: 'ai', label: 'Tab Completion', desc: 'Suggest a question when you open the panel or select text', keywords: 'tab complete suggestion autocomplete panel' },
  { section: 'ai', label: 'Click Aether', desc: 'Right-click anywhere to open an Aether panel', keywords: 'right click context aether panel' },
  { section: 'ai', label: 'Insight', desc: 'Analyze pages with a local LLM for highlights and findings', keywords: 'insight page analysis llm annotation browse' },
  { section: 'ai', label: 'Auto Insight', desc: 'Automatically run insight on every page you visit', keywords: 'auto insight automatic analyze page' },
  { section: 'ai', label: 'Visual OCR', desc: 'Capture a screenshot before analysis to extract visual text', keywords: 'ocr visual screenshot text extraction insight' },

  // ── Feed ──
  { section: 'feed', label: 'Allow Heuristics', desc: 'Use regex/keyword matching for insight extraction', keywords: 'heuristics regex keyword matching insight' },
  { section: 'feed', label: 'Base Weight', desc: 'Baseline content-score multiplier in the ranking formula', keywords: 'algorithm weight base score ranking' },
  { section: 'feed', label: 'Affinity Weight', desc: 'Bonus multiplier for sources you engage with', keywords: 'affinity source weight engagement ranking' },
  { section: 'feed', label: 'Recency Weight', desc: 'How much newer posts are favored in scoring', keywords: 'recency weight time ranking fresh' },
  { section: 'feed', label: 'Explore Weight', desc: 'Bonus for low-affinity sources to surface new content', keywords: 'exploration discovery weight ranking diversity' },
  { section: 'feed', label: 'Max Same-Category Run', desc: 'Max consecutive posts from the same category', keywords: 'category diversity run length ranking' },
  { section: 'feed', label: 'Reset Personalization', desc: 'Clear your interest profile and reset algorithm weights', keywords: 'reset personalization profile weights default' },

  // ── Downloads ──
  { section: 'downloads', label: 'Downloads', desc: 'View and manage browser downloads', keywords: 'downloads files browser history' },

  // ── Context ──
  { section: 'context', label: 'Context Files', desc: 'Manage AI task-context markdown files', keywords: 'context files storage markdown task' },
];
