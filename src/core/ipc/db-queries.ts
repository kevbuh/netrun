import { ipcMain } from 'electron';
import * as calendarQueries from '../db/queries/calendar.js';
import * as userQueries from '../db/queries/users.js';
import * as feedQueries from '../db/queries/feeds.js';
import * as socialQueries from '../db/queries/social.js';
import * as contentQueries from '../db/queries/content.js';
import * as socialExtQueries from '../db/queries/social-extended.js';
import { GOOGLE_CLIENT_ID } from './shared.js';

export function registerDbQueriesIPC(): void {
  // Calendar
  ipcMain.handle('db:calendar-list', (_event, googleId: string) => {
    return calendarQueries.getCalendarEvents(googleId);
  });
  ipcMain.handle('db:calendar-create', (_event, googleId: string, data: { title: string; date: string; description?: string; color?: string }) => {
    return calendarQueries.createCalendarEvent(googleId, data);
  });
  ipcMain.handle('db:calendar-update', (_event, googleId: string, eventId: string, updates: any) => {
    return calendarQueries.updateCalendarEvent(googleId, eventId, updates);
  });
  ipcMain.handle('db:calendar-delete', (_event, googleId: string, eventId: string) => {
    return calendarQueries.deleteCalendarEvent(googleId, eventId);
  });

  // Users
  ipcMain.handle('db:user-get', (_event, googleId: string) => {
    return userQueries.getUser(googleId);
  });
  ipcMain.handle('db:user-by-username', (_event, username: string) => {
    return userQueries.getUserByUsername(username);
  });
  ipcMain.handle('db:user-upsert', (_event, data: { google_id: string; email: string; name: string; picture?: string }) => {
    return userQueries.upsertUser(data);
  });
  ipcMain.handle('db:session-create', (_event, googleId: string) => {
    return userQueries.createSession(googleId);
  });
  ipcMain.handle('db:session-get', (_event, token: string) => {
    return userQueries.getSession(token);
  });
  ipcMain.handle('db:session-delete', (_event, token: string) => {
    userQueries.deleteSession(token);
  });
  ipcMain.handle('db:user-data-get', (_event, googleId: string, key: string) => {
    return userQueries.getUserData(googleId, key);
  });
  ipcMain.handle('db:user-data-set', (_event, googleId: string, key: string, value: string) => {
    userQueries.setUserData(googleId, key, value);
  });
  ipcMain.handle('db:users-list', (_event, limit?: number) => {
    return userQueries.listUsers(limit);
  });
  ipcMain.handle('db:users-search', (_event, query: string) => {
    return userQueries.searchUsers(query);
  });

  // Feeds
  ipcMain.handle('db:feed-items', (_event, sources: string[], limit?: number) => {
    return feedQueries.getFeedItems(sources, limit);
  });
  ipcMain.handle('db:feed-items-upsert', (_event, items: any[]) => {
    return feedQueries.upsertFeedItems(items);
  });
  // Social
  ipcMain.handle('db:direct-messages', (_event, googleId: string) => {
    return socialQueries.getDirectMessages(googleId);
  });
  ipcMain.handle('db:direct-message-send', (_event, fromGoogleId: string, toGoogleId: string, content: string) => {
    return socialQueries.sendDirectMessage(fromGoogleId, toGoogleId, content);
  });
  ipcMain.handle('db:reaction-toggle', (_event, messageId: string, googleId: string, emoji: string) => {
    return socialQueries.toggleReaction(messageId, googleId, emoji);
  });

  // ── Auth extensions ──
  ipcMain.handle('db:user-set-username', (_event, googleId: string, username: string) => {
    return userQueries.setUsername(googleId, username);
  });
  ipcMain.handle('db:user-delete', (_event, googleId: string) => {
    userQueries.deleteUser(googleId);
  });
  ipcMain.handle('db:user-set-status', (_event, googleId: string, emoji: string | null, text: string | null) => {
    userQueries.setUserStatus(googleId, emoji, text);
  });
  ipcMain.handle('db:user-set-privacy', (_event, googleId: string, isPrivate: boolean) => {
    userQueries.setUserPrivacy(googleId, isPrivate);
  });
  ipcMain.handle('db:user-update-picture', (_event, googleId: string, pictureUrl: string) => {
    userQueries.updateUserPicture(googleId, pictureUrl);
  });
  ipcMain.handle('db:user-update-bg', (_event, googleId: string, bgUrl: string) => {
    userQueries.updateUserProfileBg(googleId, bgUrl);
  });
  ipcMain.handle('db:user-sync', (_event, googleId: string, clientData: Record<string, any>) => {
    return userQueries.syncUserData(googleId, clientData);
  });
  ipcMain.handle('db:user-data-all', (_event, googleId: string) => {
    return userQueries.getAllUserData(googleId);
  });

  // ── Content: reference/author cache ──
  ipcMain.handle('db:ref-cache-get', (_event, arxivId: string) => {
    return contentQueries.getCachedReferences(arxivId);
  });
  ipcMain.handle('db:ref-cache-set', (_event, arxivId: string, refs: unknown[]) => {
    contentQueries.setCachedReferences(arxivId, refs);
  });
  ipcMain.handle('db:author-cache-get', (_event, query: string) => {
    return contentQueries.getCachedAuthor(query);
  });
  ipcMain.handle('db:author-cache-set', (_event, query: string, data: unknown) => {
    contentQueries.setCachedAuthor(query, data);
  });

  // ── Annotation feedback ──
  ipcMain.handle('db:ann-feedback-create', (_event, data: { url: string; pageTitle: string; quote: string; explanation: string; annType: string; rating: string }) => {
    contentQueries.storeAnnotationFeedback(data.url, data.pageTitle, data.quote, data.explanation, data.annType, data.rating);
  });
  ipcMain.handle('db:ann-feedback-list', (_event, rating?: string, limit?: number, offset?: number) => {
    return contentQueries.listAnnotationFeedback(rating, limit, offset);
  });
  ipcMain.handle('db:ann-feedback-update', (_event, feedbackId: number, rating: string) => {
    contentQueries.updateAnnotationFeedbackRating(feedbackId, rating);
  });
  ipcMain.handle('db:ann-feedback-delete', (_event, feedbackId: number) => {
    contentQueries.deleteAnnotationFeedback(feedbackId);
  });
  ipcMain.handle('db:ann-feedback-stats', () => {
    return contentQueries.getAnnotationFeedbackStats();
  });

  // ── Annotation categories ──
  ipcMain.handle('db:ann-categories-list', () => {
    return contentQueries.listAnnotationCategories();
  });
  ipcMain.handle('db:ann-category-add', (_event, key: string, name: string, description: string, color: string) => {
    contentQueries.addAnnotationCategory(key, name, description, color);
  });
  ipcMain.handle('db:ann-category-delete', (_event, key: string) => {
    contentQueries.deleteAnnotationCategory(key);
  });

  // ── Social extended: DM operations ──
  ipcMain.handle('db:dm-mark-read', (_event, googleId: string, messageId: string) => {
    socialExtQueries.markMessageRead(googleId, messageId);
  });
  ipcMain.handle('db:dm-delete', (_event, googleId: string, messageId: string) => {
    return socialExtQueries.deleteDirectMessage(googleId, messageId);
  });

  // ── Social extended: comments ──
  ipcMain.handle('db:comments-get', (_event, paperLink?: string) => {
    return socialExtQueries.getComments(paperLink);
  });
  ipcMain.handle('db:comment-create', (_event, googleId: string, data: { paperLink: string; content: string; author?: string; parentId?: string }) => {
    return socialExtQueries.createComment(googleId, data);
  });
  ipcMain.handle('db:comment-delete', (_event, googleId: string, commentId: string) => {
    return socialExtQueries.deleteComment(googleId, commentId);
  });

  // ── Social extended: reposts ──
  ipcMain.handle('db:repost-create', (_event, googleId: string, username: string, paperLink: string, paperTitle: string) => {
    return socialExtQueries.createRepost(googleId, username, paperLink, paperTitle);
  });
  ipcMain.handle('db:repost-delete', (_event, googleId: string, paperLink: string) => {
    socialExtQueries.deleteRepost(googleId, paperLink);
  });
  ipcMain.handle('db:user-reposts', (_event, googleId: string, limit?: number) => {
    return socialExtQueries.getUserReposts(googleId, limit);
  });

  // ── Social extended: achievements ──
  ipcMain.handle('db:achievements', (_event, googleId: string) => {
    return socialExtQueries.getUserAchievements(googleId);
  });
  ipcMain.handle('db:achievement-grant', (_event, googleId: string, achievementId: string) => {
    return socialExtQueries.grantAchievement(googleId, achievementId);
  });

  // ── Social extended: user profiles ──
  ipcMain.handle('db:public-user-info', (_event, username: string) => {
    return socialExtQueries.getPublicUserInfo(username);
  });
  ipcMain.handle('db:user-public-stats', (_event, googleId: string) => {
    return socialExtQueries.getUserPublicStats(googleId);
  });
  ipcMain.handle('db:user-recent-comments', (_event, googleId: string, limit?: number) => {
    return socialExtQueries.getUserRecentComments(googleId, limit);
  });
  ipcMain.handle('db:user-feed-sources', (_event, googleId: string) => {
    return socialExtQueries.getUserFeedSources(googleId);
  });
  ipcMain.handle('db:user-accent-color', (_event, googleId: string) => {
    return socialExtQueries.getUserAccentColor(googleId);
  });

  // ── Feed extensions ──
  ipcMain.handle('db:blocked-titles-get', () => {
    return feedQueries.getBlockedTitles();
  });
  ipcMain.handle('db:blocked-titles-set', (_event, titles: string[]) => {
    feedQueries.setBlockedTitles(titles);
  });
  // ── Auth: Google login ──
  ipcMain.handle('db:auth-google', async (_event, credential: string) => {
    if (!credential) return { error: 'Missing credential' };
    try {
      const verifyUrl = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential);
      const resp = await fetch(verifyUrl, { signal: AbortSignal.timeout(10_000) });
      const tokenInfo = await resp.json() as any;
      if (tokenInfo.aud !== GOOGLE_CLIENT_ID) return { error: 'Invalid token audience' };
      const parts = credential.split('.');
      const padded = parts[1] + '='.repeat((4 - parts[1].length % 4) % 4);
      const jwtPayload = JSON.parse(Buffer.from(padded, 'base64url').toString());
      const googleId = tokenInfo.sub;
      const email = tokenInfo.email ?? '';
      const name = tokenInfo.name ?? jwtPayload.name ?? '';
      const picture = tokenInfo.picture ?? jwtPayload.picture ?? '';
      if (!googleId) return { error: 'Invalid token' };
      userQueries.upsertUser({ google_id: googleId, email, name, picture });
      const token = userQueries.createSession(googleId);
      const info = userQueries.getUser(googleId);
      const username = info?.username ?? null;
      return { token, email, name, username, picture, google_id: googleId };
    } catch (e: any) {
      return { error: `Token verification failed: ${e.message ?? e}` };
    }
  });
}
