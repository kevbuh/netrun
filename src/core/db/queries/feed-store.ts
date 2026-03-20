import { getDb, prepare } from '../connection.js';

const DEFAULT_USER_ID = 'default';

// ── Sources ──

export interface FeedSource {
  key: string;
  name: string;
  desc: string;
  cat: string;
  url: string;
  special: string;
  favicon: string;
}

export function upsertSource(src: FeedSource): void {
  prepare(`
    INSERT INTO feed_sources (key, name, desc_, cat, url, special, favicon)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      name=excluded.name, desc_=excluded.desc_, cat=excluded.cat,
      url=excluded.url, special=excluded.special, favicon=excluded.favicon
  `).run(src.key, src.name, src.desc ?? '', src.cat ?? '', src.url ?? '', src.special ?? '', src.favicon ?? '');
}

export function listSources(): FeedSource[] {
  return getDb().prepare('SELECT key, name, desc_ as desc, cat, url, special, favicon FROM feed_sources ORDER BY key').all() as FeedSource[];
}

export function sourceCount(): number {
  return (getDb().prepare('SELECT COUNT(*) as n FROM feed_sources').get() as { n: number }).n;
}

// ── User State ──

export function markRead(link: string, userId = DEFAULT_USER_ID): void {
  prepare(`
    INSERT INTO user_read_posts (user_id, link, read_at) VALUES (?, ?, ?)
    ON CONFLICT DO NOTHING
  `).run(userId, link, Math.floor(Date.now() / 1000));
}

export function savePost(link: string, userId = DEFAULT_USER_ID): void {
  prepare(`
    INSERT INTO user_saved_posts (user_id, link, saved_at) VALUES (?, ?, ?)
    ON CONFLICT DO NOTHING
  `).run(userId, link, Math.floor(Date.now() / 1000));
}

export function unsavePost(link: string, userId = DEFAULT_USER_ID): void {
  prepare('DELETE FROM user_saved_posts WHERE user_id=? AND link=?').run(userId, link);
}

export function hidePost(link: string, userId = DEFAULT_USER_ID): void {
  prepare(`
    INSERT INTO user_hidden_posts (user_id, link, hidden_at) VALUES (?, ?, ?)
    ON CONFLICT DO NOTHING
  `).run(userId, link, Math.floor(Date.now() / 1000));
}

export function ratePost(link: string, rating: number, userId = DEFAULT_USER_ID): void {
  prepare(`
    INSERT INTO user_ratings (user_id, link, rating) VALUES (?, ?, ?)
    ON CONFLICT(user_id, link) DO UPDATE SET rating=excluded.rating
  `).run(userId, link, rating);
}

export function getSavedPosts(userId = DEFAULT_USER_ID): any[] {
  return getDb().prepare(`
    SELECT fi.id, fi.source, fi.title, fi.link, fi.authors, fi.categories,
           fi.description, fi.pub_date, fi.display_date, fi.arxiv_id, fi.extra, fi.fetched_at
    FROM feed_items fi
    JOIN user_saved_posts sp ON fi.link = sp.link AND sp.user_id = ?
    ORDER BY sp.saved_at DESC
  `).all(userId);
}

export interface UserState {
  readPosts: Record<string, boolean>;
  savedPosts: Record<string, number>;
  hiddenPosts: Record<string, boolean>;
  ratings: Record<string, number>;
  blockedWords: string[];
  sourcePrefs: Record<string, boolean>;
  rankParams: RankParams;
}

export interface RankParams {
  weightBase: number;
  weightAffinity: number;
  weightRecency: number;
  weightExploration: number;
  maxPerCategoryRun: number;
}

const DEFAULT_RANK_PARAMS: RankParams = {
  weightBase: 0.7,
  weightAffinity: 0.3,
  weightRecency: 1.0,
  weightExploration: 0.10,
  maxPerCategoryRun: 3,
};

export function getUserState(userId = DEFAULT_USER_ID): UserState {
  const db = getDb();
  const state: UserState = {
    readPosts: {},
    savedPosts: {},
    hiddenPosts: {},
    ratings: {},
    blockedWords: [],
    sourcePrefs: {},
    rankParams: { ...DEFAULT_RANK_PARAMS },
  };

  for (const row of db.prepare('SELECT link FROM user_read_posts WHERE user_id=?').all(userId) as Array<{ link: string }>) {
    state.readPosts[row.link] = true;
  }
  for (const row of db.prepare('SELECT link, saved_at FROM user_saved_posts WHERE user_id=?').all(userId) as Array<{ link: string; saved_at: number }>) {
    state.savedPosts[row.link] = row.saved_at;
  }
  for (const row of db.prepare('SELECT link FROM user_hidden_posts WHERE user_id=?').all(userId) as Array<{ link: string }>) {
    state.hiddenPosts[row.link] = true;
  }
  for (const row of db.prepare('SELECT link, rating FROM user_ratings WHERE user_id=?').all(userId) as Array<{ link: string; rating: number }>) {
    state.ratings[row.link] = row.rating;
  }
  for (const row of db.prepare('SELECT word FROM user_blocked_words WHERE user_id=?').all(userId) as Array<{ word: string }>) {
    state.blockedWords.push(row.word);
  }
  for (const row of db.prepare('SELECT source, enabled FROM user_source_prefs WHERE user_id=?').all(userId) as Array<{ source: string; enabled: number }>) {
    state.sourcePrefs[row.source] = row.enabled === 1;
  }

  const rp = db.prepare('SELECT weight_base, weight_affinity, weight_recency, weight_exploration, max_per_cat_run FROM user_rank_params WHERE user_id=?').get(userId) as any;
  if (rp) {
    state.rankParams = {
      weightBase: rp.weight_base,
      weightAffinity: rp.weight_affinity,
      weightRecency: rp.weight_recency,
      weightExploration: rp.weight_exploration,
      maxPerCategoryRun: rp.max_per_cat_run,
    };
  }

  return state;
}

export function updateRankParams(params: RankParams, userId = DEFAULT_USER_ID): void {
  prepare(`
    INSERT INTO user_rank_params (user_id, weight_base, weight_affinity, weight_recency, weight_exploration, max_per_cat_run)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      weight_base=excluded.weight_base, weight_affinity=excluded.weight_affinity,
      weight_recency=excluded.weight_recency, weight_exploration=excluded.weight_exploration,
      max_per_cat_run=excluded.max_per_cat_run
  `).run(userId, params.weightBase, params.weightAffinity, params.weightRecency, params.weightExploration, params.maxPerCategoryRun);
}

export function setSourcePrefs(prefs: Record<string, boolean>, userId = DEFAULT_USER_ID): void {
  const db = getDb();
  const stmt = prepare(`
    INSERT INTO user_source_prefs (user_id, source, enabled) VALUES (?, ?, ?)
    ON CONFLICT(user_id, source) DO UPDATE SET enabled=excluded.enabled
  `);
  const tx = db.transaction(() => {
    for (const [source, enabled] of Object.entries(prefs)) {
      stmt.run(userId, source, enabled ? 1 : 0);
    }
  });
  tx();
}

export function toggleSource(sourceKey: string, userId = DEFAULT_USER_ID): boolean {
  const db = getDb();
  const row = db.prepare('SELECT enabled FROM user_source_prefs WHERE user_id=? AND source=?').get(userId, sourceKey) as { enabled: number } | undefined;
  if (!row) {
    prepare('INSERT INTO user_source_prefs (user_id, source, enabled) VALUES (?, ?, 0)').run(userId, sourceKey);
    return false;
  }
  const newEnabled = 1 - row.enabled;
  prepare('UPDATE user_source_prefs SET enabled=? WHERE user_id=? AND source=?').run(newEnabled, userId, sourceKey);
  return newEnabled === 1;
}

export function getAllFeedItems(limit: number): any[] {
  return getDb().prepare(`
    SELECT id, source, title, link, authors, categories, description,
           pub_date, display_date, arxiv_id, extra, fetched_at
    FROM feed_items ORDER BY pub_date DESC LIMIT ?
  `).all(limit);
}
