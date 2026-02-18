import { randomUUID } from 'crypto';
import { getDb, prepare } from '../connection.js';

// ── DM operations ──

export function markMessageRead(googleId: string, messageId: string): void {
  prepare('UPDATE direct_messages SET read = 1 WHERE id = ? AND to_google_id = ?').run(messageId, googleId);
}

export function deleteDirectMessage(googleId: string, messageId: string): boolean {
  return prepare('DELETE FROM direct_messages WHERE id = ? AND to_google_id = ?').run(messageId, googleId).changes > 0;
}

export function getUnreadMessageCount(googleId: string): number {
  return (prepare('SELECT COUNT(*) as count FROM direct_messages WHERE to_google_id = ? AND read = 0').get(googleId) as { count: number }).count;
}

// ── Comments ──

export function getComments(paperLink?: string): unknown[] {
  if (paperLink) {
    return prepare('SELECT id, paper_link, google_id, author, content, timestamp, parent_id FROM comments WHERE paper_link = ? ORDER BY timestamp').all(paperLink);
  }
  return prepare('SELECT id, paper_link, google_id, author, content, timestamp, parent_id FROM comments ORDER BY timestamp').all();
}

export function createComment(googleId: string, data: { paperLink: string; content: string; author?: string; parentId?: string }): unknown {
  const id = randomUUID();
  const ts = Date.now();
  prepare(
    'INSERT INTO comments (id, paper_link, google_id, author, content, timestamp, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, data.paperLink, googleId, data.author ?? 'Anonymous', data.content, ts, data.parentId ?? null);
  return { id, paperLink: data.paperLink, author: data.author ?? 'Anonymous', content: data.content, timestamp: ts, parentId: data.parentId ?? null };
}

export function deleteComment(googleId: string, commentId: string): boolean {
  const row = prepare('SELECT id FROM comments WHERE id = ? AND google_id = ?').get(commentId, googleId);
  if (!row) return false;

  // Remove comment and all replies (cascade)
  const toRemove = new Set<string>([commentId]);
  const allComments = prepare('SELECT id, parent_id FROM comments').all() as Array<{ id: string; parent_id: string | null }>;
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of allComments) {
      if (c.parent_id && toRemove.has(c.parent_id) && !toRemove.has(c.id)) {
        toRemove.add(c.id);
        changed = true;
      }
    }
  }
  // Dynamic placeholders — can't cache
  const placeholders = [...toRemove].map(() => '?').join(', ');
  getDb().prepare(`DELETE FROM comments WHERE id IN (${placeholders})`).run(...toRemove);
  return true;
}

// ── Reposts ──

export function createRepost(googleId: string, username: string, paperLink: string, paperTitle: string): unknown {
  const id = randomUUID();
  const ts = Date.now();
  prepare(
    'INSERT INTO reposts (id, google_id, username, paper_link, paper_title, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, googleId, username, paperLink, paperTitle, ts);
  return { id, paperLink, paperTitle, username, timestamp: ts };
}

export function deleteRepost(googleId: string, paperLink: string): void {
  prepare('DELETE FROM reposts WHERE google_id = ? AND paper_link = ?').run(googleId, paperLink);
}

export function getUserReposts(googleId: string, limit = 20): unknown[] {
  return prepare(
    'SELECT id, paper_link, paper_title, username, timestamp FROM reposts WHERE google_id = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(googleId, limit);
}

// ── Blog votes ──

export function setBlogVote(blogAuthor: string, blogSlug: string, voterGoogleId: string, vote: number): { upvotes: number; downvotes: number } {
  if (vote === 0) {
    prepare('DELETE FROM blog_votes WHERE blog_author = ? AND blog_slug = ? AND voter_google_id = ?').run(blogAuthor, blogSlug, voterGoogleId);
  } else {
    prepare(
      'INSERT OR REPLACE INTO blog_votes (blog_author, blog_slug, voter_google_id, vote, timestamp) VALUES (?, ?, ?, ?, ?)'
    ).run(blogAuthor, blogSlug, voterGoogleId, vote, Date.now() / 1000);
  }
  const upvotes = (prepare('SELECT COUNT(*) as c FROM blog_votes WHERE blog_author = ? AND blog_slug = ? AND vote = 1').get(blogAuthor, blogSlug) as { c: number }).c;
  const downvotes = (prepare('SELECT COUNT(*) as c FROM blog_votes WHERE blog_author = ? AND blog_slug = ? AND vote = -1').get(blogAuthor, blogSlug) as { c: number }).c;
  return { upvotes, downvotes };
}

export function getBlogVotes(blogAuthor: string, blogSlug: string, viewerGoogleId?: string): { upvotes: number; downvotes: number; userVote: number } {
  const upvotes = (prepare('SELECT COUNT(*) as c FROM blog_votes WHERE blog_author = ? AND blog_slug = ? AND vote = 1').get(blogAuthor, blogSlug) as { c: number }).c;
  const downvotes = (prepare('SELECT COUNT(*) as c FROM blog_votes WHERE blog_author = ? AND blog_slug = ? AND vote = -1').get(blogAuthor, blogSlug) as { c: number }).c;
  let userVote = 0;
  if (viewerGoogleId) {
    const row = prepare('SELECT vote FROM blog_votes WHERE blog_author = ? AND blog_slug = ? AND voter_google_id = ?').get(blogAuthor, blogSlug, viewerGoogleId) as { vote: number } | undefined;
    if (row) userVote = row.vote;
  }
  return { upvotes, downvotes, userVote };
}

// ── Achievements ──

const ACHIEVEMENTS: Record<string, { id: string; name: string; description: string; icon: string }> = {
  first_blog: { id: 'first_blog', name: 'First Post', description: 'Published your first blog post', icon: '\u{1F4DD}' },
  prolific_writer: { id: 'prolific_writer', name: 'Prolific Writer', description: 'Published 10 blog posts', icon: '\u{270D}\u{FE0F}' },
  first_note: { id: 'first_note', name: 'Note Taker', description: 'Created your first note', icon: '\u{1F4D3}' },
  first_status: { id: 'first_status', name: 'Statusphere', description: 'Set your first status', icon: '\u{1F4AC}' },
  pet_adopter: { id: 'pet_adopter', name: 'Pet Parent', description: 'Adopted a pixel pet', icon: '\u{1F43E}' },
  gaze_master: { id: 'gaze_master', name: 'Gaze Master', description: 'Trained your eye-tracking model 5 times', icon: '\u{1F441}\u{FE0F}' },
};

export function getUserAchievements(googleId: string): unknown[] {
  const rows = prepare(
    'SELECT achievement_id, unlocked_at FROM achievements WHERE google_id = ? ORDER BY unlocked_at DESC'
  ).all(googleId) as Array<{ achievement_id: string; unlocked_at: number }>;
  return rows
    .filter(r => r.achievement_id in ACHIEVEMENTS)
    .map(r => ({ ...ACHIEVEMENTS[r.achievement_id], unlocked_at: r.unlocked_at }));
}

export function grantAchievement(googleId: string, achievementId: string): unknown | null {
  if (!(achievementId in ACHIEVEMENTS)) return null;
  const existing = prepare('SELECT 1 FROM achievements WHERE google_id = ? AND achievement_id = ?').get(googleId, achievementId);
  if (existing) return null;
  const unlockedAt = Date.now() / 1000;
  prepare('INSERT INTO achievements (google_id, achievement_id, unlocked_at) VALUES (?, ?, ?)').run(googleId, achievementId, unlockedAt);
  return { ...ACHIEVEMENTS[achievementId], unlocked_at: unlockedAt };
}

// ── User profile helpers ──

export function getPublicUserInfo(username: string): Record<string, unknown> | null {
  const row = prepare(
    'SELECT google_id, username, picture, created, profile_private, profile_bg, last_seen, status_emoji, status_text FROM users WHERE lower(username) = ?'
  ).get(username.toLowerCase()) as Record<string, unknown> | undefined;
  if (!row) return null;
  return { ...row, profile_private: !!row.profile_private };
}

export function getUserPublicStats(googleId: string): { comment_count: number; experiment_count: number; repost_count: number } {
  const cc = (prepare('SELECT COUNT(*) as c FROM comments WHERE google_id = ?').get(googleId) as { c: number }).c;
  const ec = (prepare('SELECT COUNT(*) as c FROM experiment_owners WHERE google_id = ?').get(googleId) as { c: number }).c;
  const rc = (prepare('SELECT COUNT(*) as c FROM reposts WHERE google_id = ?').get(googleId) as { c: number }).c;
  return { comment_count: cc, experiment_count: ec, repost_count: rc };
}

export function getUserRecentComments(googleId: string, limit = 20): unknown[] {
  return prepare(
    'SELECT id, paper_link, content, author, timestamp FROM comments WHERE google_id = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(googleId, limit);
}

export function getUserFeedSources(googleId: string): { feedSources: Record<string, unknown>; customFeeds: unknown[] } {
  const rows = prepare(
    "SELECT key, value FROM user_data WHERE google_id = ? AND key IN ('feedSources', 'customFeeds')"
  ).all(googleId) as Array<{ key: string; value: string }>;
  const result: { feedSources: Record<string, unknown>; customFeeds: unknown[] } = { feedSources: {}, customFeeds: [] };
  for (const row of rows) {
    try {
      (result as any)[row.key] = JSON.parse(row.value);
    } catch { /* skip */ }
  }
  return result;
}

export function getUserAccentColor(googleId: string): string {
  const row = prepare("SELECT value FROM user_data WHERE google_id = ? AND key = 'accentColor'").get(googleId) as { value: string } | undefined;
  if (!row) return '#b4451a';
  try { return JSON.parse(row.value); } catch { return '#b4451a'; }
}

// ── Unread counts (aggregate) ──

export function getUnreadCounts(googleId: string): { messages: number; total: number } {
  const messages = getUnreadMessageCount(googleId);
  return { messages, total: messages };
}
