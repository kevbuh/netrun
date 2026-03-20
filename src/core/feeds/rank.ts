import type { UserState } from '../db/queries/feed-store.js';

// ── Types ──

export interface FeedItemJSON {
  id: number;
  source: string;
  title: string;
  link: string;
  authors: string;
  categories: string[];
  description: string;
  pubDate: string;
  date: string;
  arxivId?: string;
  extra?: Record<string, any>;
  [key: string]: any;
}

export type CatMap = Record<string, string>;

export interface RankParams {
  sort?: string;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface RankedResult {
  items: FeedItemJSON[];
  total: number;
}

// ── Stop words ──

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'is', 'it', 'that', 'this', 'are', 'was', 'were', 'be', 'been',
  'has', 'have', 'had', 'not', 'no', 'do', 'does', 'did', 'will', 'would', 'can', 'could',
  'should', 'may', 'might', 'shall', 'into', 'as', 'if', 'its', 'than', 'so', 'very', 'just',
  'about', 'also', 'more', 'other', 'some', 'only', 'over', 'such', 'after', 'before', 'between',
  'each', 'all', 'both', 'through', 'during', 'up', 'out', 'then', 'them', 'these', 'those',
  'own', 'same', 'how', 'our', 'new', 'using', 'via', 'based', 'we', 'i', 'you', 'he',
  'she', 'they', 'what', 'which', 'who', 'when', 'where', 'why', 'two', 'one', 'three', 'first',
  'second', 'third', 'most', 'many', 'any', 'few', 'large', 'small', 'high', 'low', 'long', 'short', 'old',
]);

function tokenize(title: string): string[] {
  return title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function topN(scores: Record<string, number>, n: number): string[] {
  return Object.entries(scores)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([k]) => k);
}

// ── Interest profile ──

interface InterestProfile {
  topTopics: string[];
  topCategories: string[];
}

function getInterestProfile(items: FeedItemJSON[], state: UserState): InterestProfile {
  const topicScores: Record<string, number> = {};
  const catScores: Record<string, number> = {};

  const addTitle = (title: string, weight: number) => {
    for (const w of tokenize(title)) topicScores[w] = (topicScores[w] ?? 0) + weight;
  };
  const addCats = (cats: string[], weight: number) => {
    for (const c of cats) catScores[c] = (catScores[c] ?? 0) + weight;
  };

  for (const item of items) {
    if (state.readPosts[item.link]) { addTitle(item.title, 1); addCats(item.categories, 1); }
    if (item.link in state.savedPosts) { addTitle(item.title, 3); addCats(item.categories, 3); }
    const r = state.ratings[item.link];
    if (r && r > 0) { addTitle(item.title, r); addCats(item.categories, r); }
    if (state.hiddenPosts[item.link]) { addTitle(item.title, -0.5); addCats(item.categories, -0.5); }
  }

  return { topTopics: topN(topicScores, 15), topCategories: topN(catScores, 10) };
}

// ── Source affinity ──

function getSourceAffinity(items: FeedItemJSON[], state: UserState): Record<string, number> {
  const sc: Record<string, { total: number; read: number; saved: number; rated: number; hidden: number }> = {};
  for (const item of items) {
    if (!sc[item.source]) sc[item.source] = { total: 0, read: 0, saved: 0, rated: 0, hidden: 0 };
    const c = sc[item.source];
    c.total++;
    if (state.readPosts[item.link]) c.read++;
    if (item.link in state.savedPosts) c.saved++;
    if (item.link in state.ratings) c.rated++;
    if (state.hiddenPosts[item.link]) c.hidden++;
  }

  const aff: Record<string, number> = {};
  for (const [source, c] of Object.entries(sc)) {
    if (c.total < 3) { aff[source] = 0.5; continue; }
    const engagement = (c.read + c.saved * 2 + c.rated * 3) / c.total;
    const penalty = (c.hidden / c.total) * 0.5;
    aff[source] = Math.max(0.1, Math.min(1.0, engagement - penalty));
  }
  return aff;
}

// ── Content scoring ──

function contentScore(item: FeedItemJSON, profile: InterestProfile): number {
  let score = 30;
  const titleWords = tokenize(item.title);
  const topicSet = new Set(profile.topTopics);
  let matches = 0;
  for (const w of titleWords) if (topicSet.has(w)) matches++;
  score += Math.min(40, matches * 15);

  const catSet = new Set(profile.topCategories);
  let catMatches = 0;
  for (const c of item.categories) if (catSet.has(c)) catMatches++;
  score += Math.min(30, catMatches * 15);

  return Math.min(100, score);
}

// ── Search parsing ──

interface SearchQuery {
  authorFilter: string;
  sourceFilter: string;
  sortOverride: string;
  textTokens: string[];
  exactPhrases: string[];
  titleTokens: string[];
  titlePhrases: string[];
}

function parseSearch(raw: string): SearchQuery {
  const q: SearchQuery = { authorFilter: '', sourceFilter: '', sortOverride: '', textTokens: [], exactPhrases: [], titleTokens: [], titlePhrases: [] };
  let lower = raw.toLowerCase();

  // by:author
  const byIdx = lower.indexOf('by:');
  if (byIdx !== -1) {
    q.authorFilter = lower.slice(byIdx + 3).trim();
    lower = lower.slice(0, byIdx).trim();
  }

  // title:"phrase"
  for (const m of lower.matchAll(/title:"([^"]+)"/g)) q.titlePhrases.push(m[1]);
  lower = lower.replace(/title:"[^"]+"/g, '');

  // "exact phrase"
  for (const m of lower.matchAll(/"([^"]+)"/g)) q.exactPhrases.push(m[1]);
  lower = lower.replace(/"[^"]+"/g, '');

  for (const tok of lower.split(/\s+/).filter(Boolean)) {
    if (tok.startsWith('source:')) q.sourceFilter = tok.slice(7);
    else if (tok.startsWith('sort:')) q.sortOverride = tok.slice(5);
    else if (tok.startsWith('title:')) q.titleTokens.push(tok.slice(6));
    else q.textTokens.push(tok);
  }
  return q;
}

function matchSearch(item: FeedItemJSON, _catMap: CatMap, q: SearchQuery): boolean {
  if (q.authorFilter && !item.authors.toLowerCase().includes(q.authorFilter)) return false;
  if (q.sourceFilter && !item.source.toLowerCase().includes(q.sourceFilter)) return false;
  const titleLow = item.title.toLowerCase();
  const haystack = (item.title + ' ' + item.authors + ' ' + item.description).toLowerCase();
  if (q.textTokens.length > 0 && !haystack.includes(q.textTokens.join(' '))) return false;
  for (const p of q.exactPhrases) if (!haystack.includes(p)) return false;
  for (const p of q.titlePhrases) if (!titleLow.includes(p)) return false;
  for (const t of q.titleTokens) if (!titleLow.includes(t)) return false;
  return true;
}

// ── Filtering ──

function filterItems(items: FeedItemJSON[], state: UserState, catMap: CatMap, params: RankParams): FeedItemJSON[] {
  const blockedSet = new Set(state.blockedWords);
  const disabledSources = new Set<string>();
  for (const [k, enabled] of Object.entries(state.sourcePrefs)) {
    if (!enabled) disabledSources.add(k);
  }

  let parsed: SearchQuery | null = null;
  if (params.search) parsed = parseSearch(params.search);

  return items.filter(item => {
    if (disabledSources.has(item.source)) return false;
    if (state.hiddenPosts[item.link]) return false;
    if (blockedSet.size > 0) {
      const titleLow = item.title.toLowerCase();
      for (const w of blockedSet) if (titleLow.includes(w)) return false;
    }
    if (params.category) {
      if (!item.categories.includes(params.category)) return false;
    }
    if (parsed && !matchSearch(item, catMap, parsed)) return false;
    return true;
  });
}

// ── For-you sorting ──

function sortForYou(filtered: FeedItemJSON[], allItems: FeedItemJSON[], state: UserState, _catMap: CatMap): void {
  const affinity = getSourceAffinity(allItems, state);
  const profile = getInterestProfile(allItems, state);
  const now = Date.now();
  const p = state.rankParams;

  const scores = new Map<number, number>();
  for (let i = 0; i < filtered.length; i++) {
    const item = filtered[i];
    const content = contentScore(item, profile);
    const aff = affinity[item.source] ?? 0.5;

    let ageHours = 24;
    if (item.pubDate) {
      const t = new Date(item.pubDate).getTime();
      if (!isNaN(t)) ageHours = Math.max(0, (now - t) / 3_600_000);
    }
    const recency = Math.max(0, 10 - ageHours * 0.5) * p.weightRecency;
    const explore = aff <= 0.5 ? p.weightExploration * 10 : 0;
    scores.set(i, content * (p.weightBase + aff * p.weightAffinity) + recency + explore);
  }

  filtered.sort((a, b) => (scores.get(filtered.indexOf(b)) ?? 0) - (scores.get(filtered.indexOf(a)) ?? 0));
}

function getScore(item: FeedItemJSON): number {
  if (item.source === 'hn' && typeof item.hnScore === 'number') return item.hnScore;
  if (typeof item.citations === 'number') return item.citations;
  return 0;
}

// ── Interleave ──

function interleave(items: FeedItemJSON[], catMap: CatMap, maxRun: number): FeedItemJSON[] {
  const bucketMap = new Map<string, FeedItemJSON[]>();
  const catOrder: string[] = [];

  for (const item of items) {
    const cat = catMap[item.source] || item.source;
    if (!bucketMap.has(cat)) {
      bucketMap.set(cat, []);
      catOrder.push(cat);
    }
    bucketMap.get(cat)!.push(item);
  }

  if (bucketMap.size <= 1) return items;

  const result: FeedItemJSON[] = [];
  const cursors = new Map<string, number>();
  let remaining = items.length;

  while (remaining > 0) {
    for (const cat of catOrder) {
      const bucket = bucketMap.get(cat)!;
      const cur = cursors.get(cat) ?? 0;
      if (cur >= bucket.length) continue;
      const take = Math.min(maxRun, bucket.length - cur);
      result.push(...bucket.slice(cur, cur + take));
      cursors.set(cat, cur + take);
      remaining -= take;
    }
  }
  return result;
}

// ── Public API ──

export function buildCatMap(sources: Array<{ key: string; cat: string }>): CatMap {
  const m: CatMap = {};
  for (const s of sources) m[s.key] = s.cat;
  return m;
}

export function itemsToJSON(items: any[]): FeedItemJSON[] {
  return items.map(row => {
    let cats: string[] = [];
    try { cats = typeof row.categories === 'string' ? JSON.parse(row.categories) : (row.categories ?? []); } catch { cats = []; }
    let extra: Record<string, any> = {};
    try { extra = typeof row.extra === 'string' ? JSON.parse(row.extra) : (row.extra ?? {}); } catch { extra = {}; }

    return {
      id: row.id,
      source: row.source,
      title: row.title,
      link: row.link,
      authors: row.authors,
      categories: cats,
      description: row.description,
      pubDate: row.pub_date,
      date: row.display_date,
      arxivId: row.arxiv_id || undefined,
      ...extra,
    };
  });
}

export function rank(items: FeedItemJSON[], state: UserState, catMap: CatMap, params: RankParams): RankedResult {
  const filtered = filterItems(items, state, catMap, params);

  const effectiveSort = params.sort || 'foryou';
  switch (effectiveSort) {
    case 'foryou':
      sortForYou(filtered, items, state, catMap);
      break;
    case 'citations':
      filtered.sort((a, b) => getScore(b) - getScore(a));
      break;
    default: // "latest"
      filtered.sort((a, b) => (b.pubDate ?? '').localeCompare(a.pubDate ?? ''));
  }

  if (effectiveSort === 'foryou' && filtered.length > 1) {
    const maxRun = state.rankParams.maxPerCategoryRun || 3;
    const interleaved = interleave(filtered, catMap, maxRun);
    filtered.length = 0;
    filtered.push(...interleaved);
  }

  const total = filtered.length;
  let result = filtered;
  if (params.offset && params.offset > 0 && params.offset < result.length) {
    result = result.slice(params.offset);
  } else if (params.offset && params.offset >= result.length) {
    result = [];
  }
  if (params.limit && params.limit > 0 && params.limit < result.length) {
    result = result.slice(0, params.limit);
  }

  return { items: result, total };
}
