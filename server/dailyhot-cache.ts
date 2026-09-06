/**
 * Short-lived cache for DailyHot hot-items queries.
 * Reduces repeated ROW_NUMBER() window-function scans under high traffic.
 */

export interface CachedHotItemsResult {
  items: Record<string, any[]>;
  total: number;
  platforms: number;
  availablePlatforms: string[];
  expiresAt: number;
}

const hotItemsCache = new Map<string, CachedHotItemsResult>();
export const HOT_ITEMS_CACHE_TTL_MS = 60_000; // 60 seconds
const HOT_ITEMS_CACHE_MAX_ENTRIES = 128;

function evictExpiredEntries(now = Date.now()) {
  for (const [key, entry] of hotItemsCache) {
    if (entry.expiresAt <= now) {
      hotItemsCache.delete(key);
    }
  }
}

export function getCachedHotItems(key: string): CachedHotItemsResult | undefined {
  const entry = hotItemsCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry;
  }
  if (entry) {
    hotItemsCache.delete(key);
  }
  return undefined;
}

export function setCachedHotItems(key: string, result: CachedHotItemsResult) {
  evictExpiredEntries();
  if (!hotItemsCache.has(key) && hotItemsCache.size >= HOT_ITEMS_CACHE_MAX_ENTRIES) {
    const oldestKey = hotItemsCache.keys().next().value;
    if (oldestKey !== undefined) {
      hotItemsCache.delete(oldestKey);
    }
  }
  hotItemsCache.set(key, result);
}

export function clearDailyHotItemsCache() {
  hotItemsCache.clear();
}
