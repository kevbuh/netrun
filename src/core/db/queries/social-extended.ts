import { randomUUID } from 'crypto';
import { getDb } from '../connection.js';

// ── Team invites ──

export function inviteToTeam(teamId: number, fromGoogleId: string, toUsername: string): { ok?: boolean; error?: string } {
  const db = getDb();
  const member = db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND google_id = ?').get(teamId, fromGoogleId);
  if (!member) return { error: 'Not a team member' };

  const target = db.prepare('SELECT google_id FROM users WHERE lower(username) = ?').get(toUsername.toLowerCase()) as { google_id: string } | undefined;
  if (!target) return { error: 'Username not found' };
  const toGoogleId = target.google_id;

  const existing = db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND google_id = ?').get(teamId, toGoogleId);
  if (existing) return { error: 'Already a team member' };

  const pending = db.prepare("SELECT 1 FROM team_invites WHERE team_id = ? AND to_google_id = ? AND status = 'pending'").get(teamId, toGoogleId);
  if (pending) return { error: 'Invite already pending' };

  db.prepare('INSERT INTO team_invites (team_id, from_google_id, to_google_id) VALUES (?, ?, ?)').run(teamId, fromGoogleId, toGoogleId);
  return { ok: true };
}

export function getPendingInvites(googleId: string): Array<{ id: number; team_name: string; from_username: string; created: string }> {
  const db = getDb();
  return db.prepare(`
    SELECT ti.id, t.name AS team_name, u.username AS from_username, ti.created
    FROM team_invites ti
    JOIN teams t ON t.id = ti.team_id
    JOIN users u ON u.google_id = ti.from_google_id
    WHERE ti.to_google_id = ? AND ti.status = 'pending'
    ORDER BY ti.created DESC
  `).all(googleId) as any[];
}

export function respondToInvite(inviteId: number, googleId: string, accept: boolean): boolean {
  const db = getDb();
  const invite = db.prepare("SELECT team_id, to_google_id FROM team_invites WHERE id = ? AND status = 'pending'").get(inviteId) as { team_id: number; to_google_id: string } | undefined;
  if (!invite || invite.to_google_id !== googleId) return false;

  if (accept) {
    db.prepare("INSERT OR IGNORE INTO team_members (team_id, google_id, role) VALUES (?, ?, 'member')").run(invite.team_id, googleId);
    db.prepare("UPDATE team_invites SET status = 'accepted' WHERE id = ?").run(inviteId);
  } else {
    db.prepare("UPDATE team_invites SET status = 'declined' WHERE id = ?").run(inviteId);
  }
  return true;
}

// ── Team member management ──

export function removeTeamMember(teamId: number, ownerGoogleId: string, targetGoogleId: string): boolean {
  const db = getDb();
  const team = db.prepare('SELECT owner_google_id FROM teams WHERE id = ?').get(teamId) as { owner_google_id: string } | undefined;
  if (!team || team.owner_google_id !== ownerGoogleId) return false;
  if (targetGoogleId === ownerGoogleId) return false;
  db.prepare('DELETE FROM team_members WHERE team_id = ? AND google_id = ?').run(teamId, targetGoogleId);
  return true;
}

export function renameTeam(teamId: number, newName: string, googleId: string): boolean {
  const db = getDb();
  const team = db.prepare('SELECT owner_google_id FROM teams WHERE id = ?').get(teamId) as { owner_google_id: string } | undefined;
  if (!team || team.owner_google_id !== googleId) return false;
  db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(newName, teamId);
  return true;
}

export function setTeamPrivate(teamId: number, isPrivate: boolean, googleId: string): boolean {
  const db = getDb();
  const team = db.prepare('SELECT owner_google_id FROM teams WHERE id = ?').get(teamId) as { owner_google_id: string } | undefined;
  if (!team || team.owner_google_id !== googleId) return false;
  db.prepare('UPDATE teams SET private = ? WHERE id = ?').run(isPrivate ? 1 : 0, teamId);
  return true;
}

export function setTeamParent(teamId: number, parentId: number | null, googleId: string): boolean {
  const db = getDb();
  const team = db.prepare('SELECT owner_google_id FROM teams WHERE id = ?').get(teamId) as { owner_google_id: string } | undefined;
  if (!team || team.owner_google_id !== googleId) return false;

  // Check circular reference
  if (parentId !== null) {
    const visited = new Set<number>([teamId]);
    let current: number | null = parentId;
    let depth = 0;
    while (current !== null && depth < 10) {
      if (visited.has(current)) return false;
      visited.add(current);
      const row = db.prepare('SELECT parent_id FROM teams WHERE id = ?').get(current) as { parent_id: number | null } | undefined;
      if (!row) break;
      current = row.parent_id;
      depth++;
    }
  }
  db.prepare('UPDATE teams SET parent_id = ? WHERE id = ?').run(parentId, teamId);
  return true;
}

export function getTeamChildren(teamId: number): Array<{ id: number; name: string; private: boolean }> {
  const db = getDb();
  const rows = db.prepare('SELECT id, name, private FROM teams WHERE parent_id = ? ORDER BY name').all(teamId) as Array<{ id: number; name: string; private: number }>;
  return rows.map(r => ({ id: r.id, name: r.name, private: !!r.private }));
}

export function getTeamAncestors(teamId: number): Array<{ id: number; name: string }> {
  const db = getDb();
  const ancestors: Array<{ id: number; name: string }> = [];
  let current = teamId;
  let depth = 0;
  while (depth < 10) {
    const row = db.prepare('SELECT id, name, parent_id FROM teams WHERE id = ?').get(current) as { id: number; name: string; parent_id: number | null } | undefined;
    if (!row || row.parent_id === null) break;
    const parent = db.prepare('SELECT id, name, parent_id FROM teams WHERE id = ?').get(row.parent_id) as { id: number; name: string; parent_id: number | null } | undefined;
    if (!parent) break;
    ancestors.push({ id: parent.id, name: parent.name });
    current = parent.id;
    depth++;
  }
  ancestors.reverse();
  return ancestors;
}

// ── Team message edit ──

export function updateTeamMessage(teamId: number, messageId: string, googleId: string, content: string): boolean {
  const db = getDb();
  const result = db.prepare(
    'UPDATE team_messages SET content = ?, edited = 1 WHERE id = ? AND team_id = ? AND google_id = ?'
  ).run(content, messageId, teamId, googleId);
  return result.changes > 0;
}

// ── Team chat read tracking ──

export function markTeamChatRead(teamId: number, googleId: string): void {
  const db = getDb();
  const ts = Date.now();
  db.prepare(
    'INSERT INTO team_chat_read (team_id, google_id, last_read) VALUES (?, ?, ?) ON CONFLICT(team_id, google_id) DO UPDATE SET last_read = ?'
  ).run(teamId, googleId, ts, ts);
}

export function getUnreadTeamChats(googleId: string): unknown[] {
  const db = getDb();
  return db.prepare(`
    SELECT tm.id, tm.team_id, tm.google_id, tm.content, tm.timestamp,
           u.username, u.picture, t.name AS team_name,
           COALESCE(tcr.last_read, 0) AS last_read
    FROM team_messages tm
    JOIN team_members tmem ON tmem.team_id = tm.team_id AND tmem.google_id = ?
    JOIN users u ON u.google_id = tm.google_id
    JOIN teams t ON t.id = tm.team_id
    LEFT JOIN team_chat_read tcr ON tcr.team_id = tm.team_id AND tcr.google_id = ?
    WHERE tm.google_id != ?
      AND tm.timestamp > COALESCE(tcr.last_read, 0)
    ORDER BY tm.timestamp DESC
    LIMIT 50
  `).all(googleId, googleId, googleId);
}

export function getUnreadTeamChatCount(googleId: string): number {
  const db = getDb();
  return (db.prepare(`
    SELECT COUNT(*) as count
    FROM team_messages tm
    JOIN team_members tmem ON tmem.team_id = tm.team_id AND tmem.google_id = ?
    LEFT JOIN team_chat_read tcr ON tcr.team_id = tm.team_id AND tcr.google_id = ?
    WHERE tm.google_id != ?
      AND tm.timestamp > COALESCE(tcr.last_read, 0)
  `).get(googleId, googleId, googleId) as { count: number }).count;
}

// ── Team todo update/delete ──

export function updateTeamTodo(teamId: number, todoId: string, updates: Record<string, unknown>): { ok: boolean } | null {
  const db = getDb();
  const row = db.prepare('SELECT id FROM team_todos WHERE id = ? AND team_id = ?').get(todoId, teamId);
  if (!row) return null;

  const allowed: Record<string, string> = {
    title: 'title', done: 'done', priority: 'priority',
    assigned_to: 'assigned_to', description: 'description'
  };
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [jsKey, dbCol] of Object.entries(allowed)) {
    if (jsKey in updates) {
      sets.push(`${dbCol} = ?`);
      let val = updates[jsKey];
      if (dbCol === 'done') val = val ? 1 : 0;
      vals.push(val);
    }
  }
  if (sets.length > 0) {
    vals.push(todoId, teamId);
    db.prepare(`UPDATE team_todos SET ${sets.join(', ')} WHERE id = ? AND team_id = ?`).run(...vals);
  }
  return { ok: true };
}

export function deleteTeamTodo(teamId: number, todoId: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM team_todos WHERE id = ? AND team_id = ?').run(todoId, teamId).changes > 0;
}

export function getMyAssignedTodos(googleId: string): unknown[] {
  const db = getDb();
  return db.prepare(`
    SELECT tt.id, tt.team_id, tt.google_id, tt.title, tt.done, tt.priority,
           tt.assigned_to, tt.description, tt.timestamp,
           u.username AS author, t.name AS team_name
    FROM team_todos tt
    JOIN users u ON u.google_id = tt.google_id
    JOIN teams t ON t.id = tt.team_id
    WHERE tt.assigned_to = ? AND tt.done = 0
    ORDER BY
      CASE tt.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
      tt.timestamp DESC
  `).all(googleId);
}

// ── DM operations ──

export function markMessageRead(googleId: string, messageId: string): void {
  const db = getDb();
  db.prepare('UPDATE direct_messages SET read = 1 WHERE id = ? AND to_google_id = ?').run(messageId, googleId);
}

export function deleteDirectMessage(googleId: string, messageId: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM direct_messages WHERE id = ? AND to_google_id = ?').run(messageId, googleId).changes > 0;
}

export function getUnreadMessageCount(googleId: string): number {
  const db = getDb();
  return (db.prepare('SELECT COUNT(*) as count FROM direct_messages WHERE to_google_id = ? AND read = 0').get(googleId) as { count: number }).count;
}

// ── Comments ──

export function getComments(paperLink?: string): unknown[] {
  const db = getDb();
  if (paperLink) {
    return db.prepare('SELECT id, paper_link, google_id, author, content, timestamp, parent_id FROM comments WHERE paper_link = ? ORDER BY timestamp').all(paperLink);
  }
  return db.prepare('SELECT id, paper_link, google_id, author, content, timestamp, parent_id FROM comments ORDER BY timestamp').all();
}

export function createComment(googleId: string, data: { paperLink: string; content: string; author?: string; parentId?: string }): unknown {
  const db = getDb();
  const id = randomUUID();
  const ts = Date.now();
  db.prepare(
    'INSERT INTO comments (id, paper_link, google_id, author, content, timestamp, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, data.paperLink, googleId, data.author ?? 'Anonymous', data.content, ts, data.parentId ?? null);
  return { id, paperLink: data.paperLink, author: data.author ?? 'Anonymous', content: data.content, timestamp: ts, parentId: data.parentId ?? null };
}

export function deleteComment(googleId: string, commentId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT id FROM comments WHERE id = ? AND google_id = ?').get(commentId, googleId);
  if (!row) return false;

  // Remove comment and all replies (cascade)
  const toRemove = new Set<string>([commentId]);
  const allComments = db.prepare('SELECT id, parent_id FROM comments').all() as Array<{ id: string; parent_id: string | null }>;
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
  const placeholders = [...toRemove].map(() => '?').join(', ');
  db.prepare(`DELETE FROM comments WHERE id IN (${placeholders})`).run(...toRemove);
  return true;
}

// ── Reposts ──

export function createRepost(googleId: string, username: string, paperLink: string, paperTitle: string): unknown {
  const db = getDb();
  const id = randomUUID();
  const ts = Date.now();
  db.prepare(
    'INSERT INTO reposts (id, google_id, username, paper_link, paper_title, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, googleId, username, paperLink, paperTitle, ts);
  return { id, paperLink, paperTitle, username, timestamp: ts };
}

export function deleteRepost(googleId: string, paperLink: string): void {
  const db = getDb();
  db.prepare('DELETE FROM reposts WHERE google_id = ? AND paper_link = ?').run(googleId, paperLink);
}

export function getUserReposts(googleId: string, limit = 20): unknown[] {
  const db = getDb();
  return db.prepare(
    'SELECT id, paper_link, paper_title, username, timestamp FROM reposts WHERE google_id = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(googleId, limit);
}

// ── Blog votes ──

export function setBlogVote(blogAuthor: string, blogSlug: string, voterGoogleId: string, vote: number): { upvotes: number; downvotes: number } {
  const db = getDb();
  if (vote === 0) {
    db.prepare('DELETE FROM blog_votes WHERE blog_author = ? AND blog_slug = ? AND voter_google_id = ?').run(blogAuthor, blogSlug, voterGoogleId);
  } else {
    db.prepare(
      'INSERT OR REPLACE INTO blog_votes (blog_author, blog_slug, voter_google_id, vote, timestamp) VALUES (?, ?, ?, ?, ?)'
    ).run(blogAuthor, blogSlug, voterGoogleId, vote, Date.now() / 1000);
  }
  const upvotes = (db.prepare('SELECT COUNT(*) as c FROM blog_votes WHERE blog_author = ? AND blog_slug = ? AND vote = 1').get(blogAuthor, blogSlug) as { c: number }).c;
  const downvotes = (db.prepare('SELECT COUNT(*) as c FROM blog_votes WHERE blog_author = ? AND blog_slug = ? AND vote = -1').get(blogAuthor, blogSlug) as { c: number }).c;
  return { upvotes, downvotes };
}

export function getBlogVotes(blogAuthor: string, blogSlug: string, viewerGoogleId?: string): { upvotes: number; downvotes: number; userVote: number } {
  const db = getDb();
  const upvotes = (db.prepare('SELECT COUNT(*) as c FROM blog_votes WHERE blog_author = ? AND blog_slug = ? AND vote = 1').get(blogAuthor, blogSlug) as { c: number }).c;
  const downvotes = (db.prepare('SELECT COUNT(*) as c FROM blog_votes WHERE blog_author = ? AND blog_slug = ? AND vote = -1').get(blogAuthor, blogSlug) as { c: number }).c;
  let userVote = 0;
  if (viewerGoogleId) {
    const row = db.prepare('SELECT vote FROM blog_votes WHERE blog_author = ? AND blog_slug = ? AND voter_google_id = ?').get(blogAuthor, blogSlug, viewerGoogleId) as { vote: number } | undefined;
    if (row) userVote = row.vote;
  }
  return { upvotes, downvotes, userVote };
}

// ── Achievements ──

const ACHIEVEMENTS: Record<string, { id: string; name: string; description: string; icon: string }> = {
  first_blog: { id: 'first_blog', name: 'First Post', description: 'Published your first blog post', icon: '\u{1F4DD}' },
  prolific_writer: { id: 'prolific_writer', name: 'Prolific Writer', description: 'Published 10 blog posts', icon: '\u{270D}\u{FE0F}' },
  first_note: { id: 'first_note', name: 'Note Taker', description: 'Created your first note', icon: '\u{1F4D3}' },
  vault_master: { id: 'vault_master', name: 'Vault Master', description: 'Created 50 notes', icon: '\u{1F5C4}\u{FE0F}' },
  first_status: { id: 'first_status', name: 'Statusphere', description: 'Set your first status', icon: '\u{1F4AC}' },
  pet_adopter: { id: 'pet_adopter', name: 'Pet Parent', description: 'Adopted a pixel pet', icon: '\u{1F43E}' },
  gaze_master: { id: 'gaze_master', name: 'Gaze Master', description: 'Trained your eye-tracking model 5 times', icon: '\u{1F441}\u{FE0F}' },
};

export function getUserAchievements(googleId: string): unknown[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT achievement_id, unlocked_at FROM achievements WHERE google_id = ? ORDER BY unlocked_at DESC'
  ).all(googleId) as Array<{ achievement_id: string; unlocked_at: number }>;
  return rows
    .filter(r => r.achievement_id in ACHIEVEMENTS)
    .map(r => ({ ...ACHIEVEMENTS[r.achievement_id], unlocked_at: r.unlocked_at }));
}

export function grantAchievement(googleId: string, achievementId: string): unknown | null {
  if (!(achievementId in ACHIEVEMENTS)) return null;
  const db = getDb();
  const existing = db.prepare('SELECT 1 FROM achievements WHERE google_id = ? AND achievement_id = ?').get(googleId, achievementId);
  if (existing) return null;
  const unlockedAt = Date.now() / 1000;
  db.prepare('INSERT INTO achievements (google_id, achievement_id, unlocked_at) VALUES (?, ?, ?)').run(googleId, achievementId, unlockedAt);
  return { ...ACHIEVEMENTS[achievementId], unlocked_at: unlockedAt };
}

// ── User profile helpers ──

export function getPublicUserInfo(username: string): Record<string, unknown> | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT google_id, username, picture, created, profile_private, profile_bg, last_seen, status_emoji, status_text FROM users WHERE lower(username) = ?'
  ).get(username.toLowerCase()) as Record<string, unknown> | undefined;
  if (!row) return null;
  return { ...row, profile_private: !!row.profile_private };
}

export function getUserPublicStats(googleId: string): { comment_count: number; team_count: number; experiment_count: number; repost_count: number } {
  const db = getDb();
  const cc = (db.prepare('SELECT COUNT(*) as c FROM comments WHERE google_id = ?').get(googleId) as { c: number }).c;
  const tc = (db.prepare('SELECT COUNT(*) as c FROM team_members WHERE google_id = ?').get(googleId) as { c: number }).c;
  const ec = (db.prepare('SELECT COUNT(*) as c FROM experiment_owners WHERE google_id = ?').get(googleId) as { c: number }).c;
  const rc = (db.prepare('SELECT COUNT(*) as c FROM reposts WHERE google_id = ?').get(googleId) as { c: number }).c;
  return { comment_count: cc, team_count: tc, experiment_count: ec, repost_count: rc };
}

export function getUserRecentComments(googleId: string, limit = 20): unknown[] {
  const db = getDb();
  return db.prepare(
    'SELECT id, paper_link, content, author, timestamp FROM comments WHERE google_id = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(googleId, limit);
}

export function getUserPublicTeams(googleId: string, viewerGoogleId?: string): unknown[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT t.id, t.name, t.private,
           (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) AS member_count
    FROM teams t
    JOIN team_members tm ON tm.team_id = t.id AND tm.google_id = ?
    ORDER BY t.name
  `).all(googleId) as Array<{ id: number; name: string; private: number; member_count: number }>;

  return rows.filter(r => {
    if (!r.private) return true;
    if (!viewerGoogleId) return false;
    const isMember = db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND google_id = ?').get(r.id, viewerGoogleId);
    return !!isMember;
  }).map(r => ({ id: r.id, name: r.name, member_count: r.member_count, private: !!r.private }));
}

export function getUserFeedSources(googleId: string): { feedSources: Record<string, unknown>; customFeeds: unknown[] } {
  const db = getDb();
  const rows = db.prepare(
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
  const db = getDb();
  const row = db.prepare("SELECT value FROM user_data WHERE google_id = ? AND key = 'accentColor'").get(googleId) as { value: string } | undefined;
  if (!row) return '#b4451a';
  try { return JSON.parse(row.value); } catch { return '#b4451a'; }
}

export function areTeammates(gidA: string, gidB: string): boolean {
  const db = getDb();
  const row = db.prepare(`
    SELECT 1 FROM team_members tm1
    JOIN team_members tm2 ON tm1.team_id = tm2.team_id
    WHERE tm1.google_id = ? AND tm2.google_id = ?
    LIMIT 1
  `).get(gidA, gidB);
  return !!row;
}

// ── Unread counts (aggregate) ──

export function getUnreadCounts(googleId: string): { invites: number; messages: number; chats: number; tasks: number; total: number } {
  const invites = getPendingInvites(googleId).length;
  const messages = getUnreadMessageCount(googleId);
  const chats = getUnreadTeamChatCount(googleId);
  const db = getDb();
  const tasks = db.prepare(`
    SELECT COUNT(*) as c FROM team_todos WHERE assigned_to = ? AND done = 0
  `).get(googleId) as { count?: number; c?: number };
  const taskCount = (tasks as any).c ?? 0;
  return { invites, messages, chats, tasks: taskCount, total: invites + messages + chats + taskCount };
}

// ── Team detail with children/ancestors ──

export function getTeamDetail(teamId: number): unknown | null {
  const db = getDb();
  const team = db.prepare('SELECT id, name, owner_google_id, created, private, parent_id FROM teams WHERE id = ?').get(teamId) as Record<string, unknown> | undefined;
  if (!team) return null;

  const members = db.prepare(`
    SELECT tm.google_id, u.username, u.picture, tm.role
    FROM team_members tm
    JOIN users u ON u.google_id = tm.google_id
    WHERE tm.team_id = ?
    ORDER BY tm.role DESC, u.username
  `).all(teamId);

  return {
    ...team,
    private: !!team.private,
    members,
    children: getTeamChildren(teamId),
    ancestors: getTeamAncestors(teamId),
  };
}
