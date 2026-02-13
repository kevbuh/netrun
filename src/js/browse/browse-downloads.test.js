import { describe, it, expect, beforeEach } from 'vitest';

// ──────────────────────────────────────────────────────────
// Extract testable pure functions from browse-downloads.js
// ──────────────────────────────────────────────────────────

const DOWNLOAD_RETENTION_MS = 60 * 60 * 1000; // 1 hour

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (!bytes) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 10) / 10 + ' ' + sizes[i];
}

/**
 * Filter downloads older than retention period
 */
function filterRecentDownloads(downloads, nowMs = Date.now()) {
  const cutoff = nowMs - DOWNLOAD_RETENTION_MS;
  return downloads.filter(d => d.startTime > cutoff);
}

/**
 * Calculate download percentage
 */
function calculateDownloadProgress(receivedBytes, totalBytes) {
  if (totalBytes === 0 || !totalBytes) return 0;
  return Math.round((receivedBytes / totalBytes) * 100);
}

/**
 * Find max download ID from list
 */
function findMaxDownloadId(downloads) {
  let max = 0;
  downloads.forEach(d => {
    const num = parseInt(d.id.replace('dl-', ''));
    if (num > max) max = num;
  });
  return max;
}

/**
 * Format download badge text
 */
function formatDownloadBadge(newCount) {
  if (newCount === 0) return '';
  if (newCount > 99) return '99+';
  return newCount.toString();
}

/**
 * Calculate new downloads count
 */
function calculateNewDownloads(totalCount, lastSeenCount) {
  return Math.max(0, totalCount - lastSeenCount);
}

/**
 * Format download label for island
 */
function formatDownloadLabel(activeCount, completedCount, firstActivePct) {
  if (activeCount > 0) {
    return activeCount > 1 ? `${activeCount} downloading` : `${firstActivePct}%`;
  }
  const total = activeCount + completedCount;
  return total === 1 ? '1 download' : `${total} downloads`;
}

/**
 * Format download detail text
 */
function formatDownloadDetail(activeCount, completedCount, filename, pct) {
  if (activeCount > 0) {
    return activeCount > 1
      ? `${activeCount} downloading · ${completedCount} done`
      : `${filename} · ${pct}%`;
  }
  const total = activeCount + completedCount;
  return total === 1 ? filename : `${total} downloads complete`;
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('Download Retention', () => {
  it('should be 1 hour in milliseconds', () => {
    expect(DOWNLOAD_RETENTION_MS).toBe(60 * 60 * 1000);
    expect(DOWNLOAD_RETENTION_MS).toBe(3600000);
  });
});

describe('Bytes Formatting', () => {
  it('should format zero bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('should format bytes', () => {
    expect(formatBytes(100)).toBe('100 B');
    expect(formatBytes(1000)).toBe('1000 B');
  });

  it('should format kilobytes', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(5120)).toBe('5 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('should format megabytes', () => {
    expect(formatBytes(1048576)).toBe('1 MB');
    expect(formatBytes(5242880)).toBe('5 MB');
    expect(formatBytes(2621440)).toBe('2.5 MB');
  });

  it('should format gigabytes', () => {
    expect(formatBytes(1073741824)).toBe('1 GB');
    expect(formatBytes(2147483648)).toBe('2 GB');
  });

  it('should round to 1 decimal place', () => {
    expect(formatBytes(1638)).toBe('1.6 KB');
    expect(formatBytes(1587200)).toBe('1.5 MB');
  });

  it('should handle null/undefined', () => {
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(undefined)).toBe('');
  });
});

describe('Download Filtering', () => {
  it('should filter old downloads', () => {
    const now = Date.now();
    const downloads = [
      { id: 'dl-1', startTime: now - 30 * 60 * 1000 }, // 30 min ago - keep
      { id: 'dl-2', startTime: now - 90 * 60 * 1000 }, // 90 min ago - remove
      { id: 'dl-3', startTime: now - 10 * 60 * 1000 }, // 10 min ago - keep
    ];
    const result = filterRecentDownloads(downloads, now);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('dl-1');
    expect(result[1].id).toBe('dl-3');
  });

  it('should keep all recent downloads', () => {
    const now = Date.now();
    const downloads = [
      { id: 'dl-1', startTime: now - 5000 },
      { id: 'dl-2', startTime: now - 1000 },
    ];
    const result = filterRecentDownloads(downloads, now);
    expect(result).toHaveLength(2);
  });

  it('should remove all old downloads', () => {
    const now = Date.now();
    const downloads = [
      { id: 'dl-1', startTime: now - 2 * 60 * 60 * 1000 },
      { id: 'dl-2', startTime: now - 3 * 60 * 60 * 1000 },
    ];
    const result = filterRecentDownloads(downloads, now);
    expect(result).toHaveLength(0);
  });

  it('should handle edge case at exactly 1 hour', () => {
    const now = Date.now();
    const downloads = [
      { id: 'dl-1', startTime: now - DOWNLOAD_RETENTION_MS - 1 }, // just over - remove
      { id: 'dl-2', startTime: now - DOWNLOAD_RETENTION_MS + 1000 }, // just under - keep
    ];
    const result = filterRecentDownloads(downloads, now);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('dl-2');
  });

  it('should handle empty array', () => {
    expect(filterRecentDownloads([])).toEqual([]);
  });
});

describe('Download Progress Calculation', () => {
  it('should calculate percentage correctly', () => {
    expect(calculateDownloadProgress(50, 100)).toBe(50);
    expect(calculateDownloadProgress(25, 100)).toBe(25);
    expect(calculateDownloadProgress(100, 100)).toBe(100);
  });

  it('should return 0 for zero total', () => {
    expect(calculateDownloadProgress(50, 0)).toBe(0);
    expect(calculateDownloadProgress(100, 0)).toBe(0);
  });

  it('should return 0 for null total', () => {
    expect(calculateDownloadProgress(50, null)).toBe(0);
    expect(calculateDownloadProgress(50, undefined)).toBe(0);
  });

  it('should round to nearest integer', () => {
    expect(calculateDownloadProgress(33, 100)).toBe(33);
    expect(calculateDownloadProgress(67, 100)).toBe(67);
  });

  it('should handle zero received', () => {
    expect(calculateDownloadProgress(0, 100)).toBe(0);
  });

  it('should handle partial downloads', () => {
    expect(calculateDownloadProgress(1536, 2048)).toBe(75);
    expect(calculateDownloadProgress(256, 1024)).toBe(25);
  });
});

describe('Max Download ID Finding', () => {
  it('should find maximum ID', () => {
    const downloads = [
      { id: 'dl-5' },
      { id: 'dl-12' },
      { id: 'dl-3' },
    ];
    expect(findMaxDownloadId(downloads)).toBe(12);
  });

  it('should return 0 for empty array', () => {
    expect(findMaxDownloadId([])).toBe(0);
  });

  it('should handle single download', () => {
    expect(findMaxDownloadId([{ id: 'dl-42' }])).toBe(42);
  });

  it('should handle non-sequential IDs', () => {
    const downloads = [
      { id: 'dl-1' },
      { id: 'dl-100' },
      { id: 'dl-50' },
    ];
    expect(findMaxDownloadId(downloads)).toBe(100);
  });
});

describe('Download Badge Formatting', () => {
  it('should return empty for zero', () => {
    expect(formatDownloadBadge(0)).toBe('');
  });

  it('should return number as string for 1-99', () => {
    expect(formatDownloadBadge(1)).toBe('1');
    expect(formatDownloadBadge(5)).toBe('5');
    expect(formatDownloadBadge(42)).toBe('42');
    expect(formatDownloadBadge(99)).toBe('99');
  });

  it('should return "99+" for 100 or more', () => {
    expect(formatDownloadBadge(100)).toBe('99+');
    expect(formatDownloadBadge(150)).toBe('99+');
    expect(formatDownloadBadge(1000)).toBe('99+');
  });
});

describe('New Downloads Calculation', () => {
  it('should calculate new downloads', () => {
    expect(calculateNewDownloads(10, 5)).toBe(5);
    expect(calculateNewDownloads(3, 0)).toBe(3);
    expect(calculateNewDownloads(10, 10)).toBe(0);
  });

  it('should not return negative numbers', () => {
    expect(calculateNewDownloads(5, 10)).toBe(0);
    expect(calculateNewDownloads(0, 5)).toBe(0);
  });

  it('should handle zero counts', () => {
    expect(calculateNewDownloads(0, 0)).toBe(0);
  });
});

describe('Download Label Formatting', () => {
  it('should show percentage for single active download', () => {
    const label = formatDownloadLabel(1, 0, 75);
    expect(label).toBe('75%');
  });

  it('should show count for multiple active', () => {
    const label = formatDownloadLabel(3, 0, 50);
    expect(label).toBe('3 downloading');
  });

  it('should show singular for one completed', () => {
    const label = formatDownloadLabel(0, 1, 0);
    expect(label).toBe('1 download');
  });

  it('should show plural for multiple completed', () => {
    const label = formatDownloadLabel(0, 5, 0);
    expect(label).toBe('5 downloads');
  });

  it('should prioritize active over completed', () => {
    const label = formatDownloadLabel(2, 3, 60);
    expect(label).toBe('2 downloading');
  });
});

describe('Download Detail Formatting', () => {
  it('should show filename and percentage for single active', () => {
    const detail = formatDownloadDetail(1, 0, 'document.pdf', 85);
    expect(detail).toBe('document.pdf · 85%');
  });

  it('should show counts for multiple active', () => {
    const detail = formatDownloadDetail(3, 2, 'file.zip', 50);
    expect(detail).toBe('3 downloading · 2 done');
  });

  it('should show filename for single completed', () => {
    const detail = formatDownloadDetail(0, 1, 'image.png', 0);
    expect(detail).toBe('image.png');
  });

  it('should show completion message for multiple', () => {
    const detail = formatDownloadDetail(0, 5, 'file.pdf', 0);
    expect(detail).toBe('5 downloads complete');
  });

  it('should prioritize active state', () => {
    const detail = formatDownloadDetail(1, 10, 'video.mp4', 30);
    expect(detail).toBe('video.mp4 · 30%');
  });
});
