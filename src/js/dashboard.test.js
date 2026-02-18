import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────────────────
// Extract testable pure functions from dashboard.js logic
// ──────────────────────────────────────────────────────────

/**
 * Calculate reading streak from activity items
 * Extracted from dashboard.js _dashReadingStreak()
 */
function _dashReadingStreak(activityItems, now = new Date()) {
  const todayKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  let streak = 0;
  const graceToday = now.getHours() < 9;
  const d = new Date(now);
  if (graceToday && !(activityItems[todayKey] || []).length) {
    d.setDate(d.getDate() - 1);
  }
  for (let i = 0; i < 365; i++) {
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if ((activityItems[key] || []).length > 0) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

/**
 * Calculate trending score for a paper
 * Extracted from dashboard.js _dashTrending()
 */
function trendingScore(paper, now = Date.now()) {
  const engagement = (paper.points || 0) + (paper.citations || 0);
  const ageH = (now - (paper.pubDate || now)) / 3600000;
  const recency = Math.max(0, 1 - ageH / 72);
  return engagement * 2 * (0.3 + recency * 0.7);
}

/**
 * Sort and filter trending papers
 * Extracted from dashboard.js _dashTrending()
 */
function getTrending(papers, limit = 5, now = Date.now()) {
  return papers.map(p => {
    const score = trendingScore(p, now);
    return { ...p, _trendScore: score };
  }).filter(p => p._trendScore > 0).sort((a, b) => b._trendScore - a._trendScore).slice(0, limit);
}

/**
 * Heatmap level function (1-10 scale)
 * Extracted from dashboard.js renderDashboard() heatmap section
 */
function heatmapLevel(count) {
  return Math.min(count, 10);
}

/**
 * Detect heatmap theme from date
 * Extracted from dashboard.js renderDashboard() heatmap section
 */
function detectHeatmapTheme(month, day) {
  if (month === 9 && day >= 25 && day <= 31) return 'halloween';
  if (month === 11 && day >= 20 && day <= 31) return 'christmas';
  if (month === 1 && day === 14) return 'valentine';
  if (month === 2 && day === 17) return 'stpatricks';
  if (month === 6 && day === 4) return 'july4';
  if (month === 0 && day === 1) return 'newyear';
  return 'default';
}

/**
 * Relative time formatting
 * Extracted from dashboard.js _devRelativeTime()
 */
function relativeTime(date, now = Date.now()) {
  const s = Math.floor((now - date.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return date.toLocaleDateString();
}

/**
 * Format time as AM/PM
 * Extracted from dashboard.js renderDashboard() _fmtTime helper
 */
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Calendar month navigation
 * Extracted from dashboard.js dashCalNav()
 */
function calNav(month, year, dir) {
  let m = month + dir;
  let y = year;
  if (m > 11) { m = 0; y++; }
  if (m < 0) { m = 11; y--; }
  return { month: m, year: y };
}

/**
 * Build heatmap cells for a year
 * Extracted from dashboard.js renderDashboard() heatmap cell generation
 */
function buildHeatmapCells(heatYear, activityItems, today) {
  const jan1 = new Date(heatYear, 0, 1);
  const dec31 = new Date(heatYear, 11, 31);
  const startDow = jan1.getDay();
  const totalDays = Math.ceil((dec31 - jan1) / 86400000) + 1;

  const cells = [];
  for (let day = 0; day < totalDays; day++) {
    const d = new Date(heatYear, 0, 1 + day);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const count = (activityItems[key] || []).length;
    const isToday = d.getTime() === today.getTime();
    const isFuture = d > today;
    const dow = d.getDay();
    const col = Math.floor((startDow + day) / 7);
    cells.push({ key, count, isToday, isFuture, col, row: dow, month: d.getMonth(), date: d.getDate() });
  }
  return cells;
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('Reading Streak', () => {
  it('should return 0 for no activity', () => {
    const now = new Date('2026-02-11T14:00:00');
    expect(_dashReadingStreak({}, now)).toBe(0);
  });

  it('should count consecutive days', () => {
    const now = new Date('2026-02-11T14:00:00');
    const items = {
      '2026-02-11': [{ type: 'saved' }],
      '2026-02-10': [{ type: 'saved' }],
      '2026-02-09': [{ type: 'saved' }],
    };
    expect(_dashReadingStreak(items, now)).toBe(3);
  });

  it('should break streak on gap', () => {
    const now = new Date('2026-02-11T14:00:00');
    const items = {
      '2026-02-11': [{ type: 'saved' }],
      '2026-02-10': [{ type: 'saved' }],
      // gap on Feb 9
      '2026-02-08': [{ type: 'saved' }],
    };
    expect(_dashReadingStreak(items, now)).toBe(2);
  });

  it('should apply grace period before 9am', () => {
    const now = new Date('2026-02-11T07:00:00'); // 7am, before 9am grace
    const items = {
      // no activity today
      '2026-02-10': [{ type: 'saved' }],
      '2026-02-09': [{ type: 'saved' }],
    };
    // Grace period: should start counting from yesterday
    expect(_dashReadingStreak(items, now)).toBe(2);
  });

  it('should not apply grace period after 9am', () => {
    const now = new Date('2026-02-11T10:00:00'); // 10am, no grace
    const items = {
      // no activity today
      '2026-02-10': [{ type: 'saved' }],
      '2026-02-09': [{ type: 'saved' }],
    };
    // No grace: today has no activity, streak is 0
    expect(_dashReadingStreak(items, now)).toBe(0);
  });

  it('should count single day streak', () => {
    const now = new Date('2026-02-11T14:00:00');
    const items = {
      '2026-02-11': [{ type: 'event' }],
    };
    expect(_dashReadingStreak(items, now)).toBe(1);
  });
});

describe('Trending Score', () => {
  it('should return 0 for paper with no engagement or quality', () => {
    const now = Date.now();
    const paper = { pubDate: now };
    expect(trendingScore(paper, now)).toBe(0);
  });

  it('should increase with engagement', () => {
    const now = Date.now();
    const low = trendingScore({ points: 10, citations: 0, pubDate: now }, now);
    const high = trendingScore({ points: 100, citations: 0, pubDate: now }, now);
    expect(high).toBeGreaterThan(low);
  });

  it('should decrease with age', () => {
    const now = Date.now();
    const recent = trendingScore({ points: 50, pubDate: now }, now);
    const old = trendingScore({ points: 50, pubDate: now - 48 * 3600000 }, now); // 48h old
    expect(recent).toBeGreaterThan(old);
  });

  it('should be 0 for very old papers with no engagement', () => {
    const now = Date.now();
    const score = trendingScore({ points: 0, citations: 0, pubDate: now - 100 * 3600000 }, now);
    expect(score).toBe(0);
  });
});

describe('Get Trending', () => {
  it('should return empty for empty input', () => {
    expect(getTrending([])).toEqual([]);
  });

  it('should limit results', () => {
    const now = Date.now();
    const papers = Array.from({ length: 20 }, (_, i) => ({
      title: `Paper ${i}`,
      points: 10 + i,
      pubDate: now,
    }));
    expect(getTrending(papers, 5, now)).toHaveLength(5);
  });

  it('should sort by trending score descending', () => {
    const now = Date.now();
    const papers = [
      { title: 'Low', points: 5, pubDate: now },
      { title: 'High', points: 100, pubDate: now },
      { title: 'Mid', points: 50, pubDate: now },
    ];
    const result = getTrending(papers, 3, now);
    expect(result[0].title).toBe('High');
    expect(result[1].title).toBe('Mid');
    expect(result[2].title).toBe('Low');
  });

  it('should filter out papers with zero score', () => {
    const now = Date.now();
    const papers = [
      { title: 'Active', points: 50, pubDate: now },
      { title: 'Dead', points: 0, citations: 0, pubDate: now },
    ];
    const result = getTrending(papers, 10, now);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Active');
  });
});

describe('Heatmap Level', () => {
  it('should return 0 for count 0', () => {
    expect(heatmapLevel(0)).toBe(0);
  });

  it('should return count directly for 1-10', () => {
    for (let i = 1; i <= 10; i++) {
      expect(heatmapLevel(i)).toBe(i);
    }
  });

  it('should cap at 10', () => {
    expect(heatmapLevel(11)).toBe(10);
    expect(heatmapLevel(50)).toBe(10);
    expect(heatmapLevel(100)).toBe(10);
  });
});

describe('Heatmap Theme Detection', () => {
  it('should detect halloween (Oct 25-31)', () => {
    expect(detectHeatmapTheme(9, 25)).toBe('halloween');
    expect(detectHeatmapTheme(9, 31)).toBe('halloween');
    expect(detectHeatmapTheme(9, 24)).toBe('default');
  });

  it('should detect christmas (Dec 20-31)', () => {
    expect(detectHeatmapTheme(11, 20)).toBe('christmas');
    expect(detectHeatmapTheme(11, 25)).toBe('christmas');
    expect(detectHeatmapTheme(11, 31)).toBe('christmas');
    expect(detectHeatmapTheme(11, 19)).toBe('default');
  });

  it('should detect valentine (Feb 14)', () => {
    expect(detectHeatmapTheme(1, 14)).toBe('valentine');
    expect(detectHeatmapTheme(1, 13)).toBe('default');
  });

  it('should detect st patricks (Mar 17)', () => {
    expect(detectHeatmapTheme(2, 17)).toBe('stpatricks');
    expect(detectHeatmapTheme(2, 16)).toBe('default');
  });

  it('should detect july 4th', () => {
    expect(detectHeatmapTheme(6, 4)).toBe('july4');
    expect(detectHeatmapTheme(6, 3)).toBe('default');
  });

  it('should detect new year (Jan 1)', () => {
    expect(detectHeatmapTheme(0, 1)).toBe('newyear');
    expect(detectHeatmapTheme(0, 2)).toBe('default');
  });

  it('should return default for regular days', () => {
    expect(detectHeatmapTheme(3, 15)).toBe('default');
    expect(detectHeatmapTheme(7, 10)).toBe('default');
  });
});

describe('Relative Time', () => {
  const base = new Date('2026-02-11T12:00:00').getTime();

  it('should show just now for < 60 seconds', () => {
    expect(relativeTime(new Date(base - 30000), base)).toBe('just now');
    expect(relativeTime(new Date(base - 59000), base)).toBe('just now');
  });

  it('should show minutes for < 1 hour', () => {
    expect(relativeTime(new Date(base - 5 * 60000), base)).toBe('5m ago');
    expect(relativeTime(new Date(base - 59 * 60000), base)).toBe('59m ago');
  });

  it('should show hours for < 1 day', () => {
    expect(relativeTime(new Date(base - 2 * 3600000), base)).toBe('2h ago');
    expect(relativeTime(new Date(base - 23 * 3600000), base)).toBe('23h ago');
  });

  it('should show days for < 1 week', () => {
    expect(relativeTime(new Date(base - 2 * 86400000), base)).toBe('2d ago');
    expect(relativeTime(new Date(base - 6 * 86400000), base)).toBe('6d ago');
  });

  it('should show date string for >= 1 week', () => {
    const oldDate = new Date(base - 14 * 86400000);
    const result = relativeTime(oldDate, base);
    // Should be a locale date string, not a relative time
    expect(result).not.toContain('ago');
    expect(result).not.toBe('just now');
  });
});

describe('Time Formatting', () => {
  it('should format morning time', () => {
    const ts = new Date('2026-02-11T09:05:00').getTime();
    expect(fmtTime(ts)).toBe('9:05 AM');
  });

  it('should format afternoon time', () => {
    const ts = new Date('2026-02-11T14:30:00').getTime();
    expect(fmtTime(ts)).toBe('2:30 PM');
  });

  it('should format midnight as 12:00 AM', () => {
    const ts = new Date('2026-02-11T00:00:00').getTime();
    expect(fmtTime(ts)).toBe('12:00 AM');
  });

  it('should format noon as 12:00 PM', () => {
    const ts = new Date('2026-02-11T12:00:00').getTime();
    expect(fmtTime(ts)).toBe('12:00 PM');
  });

  it('should return empty string for falsy input', () => {
    expect(fmtTime(0)).toBe('');
    expect(fmtTime(null)).toBe('');
    expect(fmtTime(undefined)).toBe('');
  });
});

describe('Calendar Navigation', () => {
  it('should go to next month', () => {
    expect(calNav(5, 2026, 1)).toEqual({ month: 6, year: 2026 });
  });

  it('should go to previous month', () => {
    expect(calNav(5, 2026, -1)).toEqual({ month: 4, year: 2026 });
  });

  it('should wrap to January on overflow', () => {
    expect(calNav(11, 2026, 1)).toEqual({ month: 0, year: 2027 });
  });

  it('should wrap to December on underflow', () => {
    expect(calNav(0, 2026, -1)).toEqual({ month: 11, year: 2025 });
  });
});

describe('Heatmap Cells', () => {
  it('should generate 365 or 366 cells for a year', () => {
    const today = new Date(2026, 1, 11);
    const cells = buildHeatmapCells(2026, {}, today);
    expect(cells.length).toBe(365);
  });

  it('should generate 366 cells for a leap year', () => {
    const today = new Date(2024, 1, 11);
    const cells = buildHeatmapCells(2024, {}, today);
    expect(cells.length).toBe(366);
  });

  it('should mark today correctly', () => {
    const today = new Date(2026, 1, 11); // Feb 11
    const cells = buildHeatmapCells(2026, {}, today);
    const todayCell = cells.find(c => c.isToday);
    expect(todayCell).toBeDefined();
    expect(todayCell.key).toBe('2026-02-11');
  });

  it('should mark future days', () => {
    const today = new Date(2026, 5, 15); // June 15
    const cells = buildHeatmapCells(2026, {}, today);
    const futureCells = cells.filter(c => c.isFuture);
    expect(futureCells.length).toBeGreaterThan(0);
    // All future cells should be after June 15
    futureCells.forEach(c => {
      expect(c.month > 5 || (c.month === 5 && c.date > 15)).toBe(true);
    });
  });

  it('should count activity items', () => {
    const today = new Date(2026, 1, 11);
    const items = {
      '2026-01-15': [{ type: 'saved' }, { type: 'comment' }],
      '2026-02-01': [{ type: 'event' }],
    };
    const cells = buildHeatmapCells(2026, items, today);
    const jan15 = cells.find(c => c.key === '2026-01-15');
    const feb1 = cells.find(c => c.key === '2026-02-01');
    const jan16 = cells.find(c => c.key === '2026-01-16');
    expect(jan15.count).toBe(2);
    expect(feb1.count).toBe(1);
    expect(jan16.count).toBe(0);
  });

  it('should assign correct row (day of week)', () => {
    const today = new Date(2026, 11, 31);
    const cells = buildHeatmapCells(2026, {}, today);
    // Jan 1, 2026 is a Thursday (row 4)
    expect(cells[0].row).toBe(4);
    expect(cells[0].key).toBe('2026-01-01');
  });
});
