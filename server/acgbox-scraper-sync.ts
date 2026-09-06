import type Database from 'better-sqlite3';
import type { HotRanking, PlatformHighlight, ACGBoxScraperResult } from './acgbox-scraper.js';

export interface SyncResult {
  rankingsInserted: number;
  rankingsUpdated: number;
  rankingsDeleted: number;
  highlightsInserted: number;
  highlightsUpdated: number;
  highlightsDeleted: number;
}

export function syncACGBoxData(
  database: Database.Database,
  data: ACGBoxScraperResult
): SyncResult {
  console.log('[ACGBox Sync] Starting data synchronization...');

  const result: SyncResult = {
    rankingsInserted: 0,
    rankingsUpdated: 0,
    rankingsDeleted: 0,
    highlightsInserted: 0,
    highlightsUpdated: 0,
    highlightsDeleted: 0,
  };

  const transaction = database.transaction(() => {
    // Sync rankings
    const rankingsResult = syncRankings(database, data.rankings);
    result.rankingsInserted = rankingsResult.inserted;
    result.rankingsUpdated = rankingsResult.updated;
    result.rankingsDeleted = rankingsResult.deleted;

    // Sync highlights
    const highlightsResult = syncHighlights(database, data.highlights);
    result.highlightsInserted = highlightsResult.inserted;
    result.highlightsUpdated = highlightsResult.updated;
    result.highlightsDeleted = highlightsResult.deleted;
  });

  transaction();

  console.log(
    `[ACGBox Sync] Completed. Rankings: +${result.rankingsInserted} ~${result.rankingsUpdated} -${result.rankingsDeleted}, ` +
    `Highlights: +${result.highlightsInserted} ~${result.highlightsUpdated} -${result.highlightsDeleted}`
  );

  return result;
}

function syncRankings(
  database: Database.Database,
  rankings: HotRanking[]
): { inserted: number; updated: number; deleted: number } {
  const result = { inserted: 0, updated: 0, deleted: 0 };

  if (rankings.length === 0) {
    // If no rankings scraped, delete old ones
    const deleted = database.prepare('DELETE FROM hot_rankings WHERE scraped_at < datetime("now", "-2 hours")').run();
    result.deleted = deleted.changes;
    return result;
  }

  // Get existing rankings
  const existingRankings = database.prepare('SELECT id, url, hot_score FROM hot_rankings').all() as Array<{
    id: number;
    url: string;
    hot_score: number;
  }>;

  const existingUrlMap = new Map(existingRankings.map((r) => [r.url, r]));

  // Prepare statements
  const insertStmt = database.prepare(`
    INSERT INTO hot_rankings (title, url, category, platform, cover_url, description, play_count, score, update_time, rank_position, hot_score, source_page, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const updateStmt = database.prepare(`
    UPDATE hot_rankings
    SET title = ?, category = ?, platform = ?, cover_url = ?, description = ?, play_count = ?, score = ?, update_time = ?, rank_position = ?, hot_score = ?, source_page = ?, scraped_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE url = ?
  `);

  const processedUrls = new Set<string>();

  // Process each ranking
  for (const ranking of rankings) {
    processedUrls.add(ranking.url);
    const existing = existingUrlMap.get(ranking.url);

    if (existing) {
      // Update if hot score changed
      if (existing.hot_score !== ranking.hotScore) {
        updateStmt.run(
          ranking.title,
          ranking.category,
          ranking.platform,
          ranking.coverUrl,
          ranking.description,
          ranking.playCount,
          ranking.score,
          ranking.updateTime,
          ranking.rankPosition,
          ranking.hotScore,
          ranking.sourcePage,
          ranking.url
        );
        result.updated++;
      }
    } else {
      // Insert new ranking
      insertStmt.run(
        ranking.title,
        ranking.url,
        ranking.category,
        ranking.platform,
        ranking.coverUrl,
        ranking.description,
        ranking.playCount,
        ranking.score,
        ranking.updateTime,
        ranking.rankPosition,
        ranking.hotScore,
        ranking.sourcePage
      );
      result.inserted++;
    }
  }

  // Delete old rankings that weren't in the latest scrape
  const deleteStmt = database.prepare(
    'DELETE FROM hot_rankings WHERE url NOT IN (SELECT value FROM json_each(?)) AND scraped_at < datetime("now", "-2 hours")'
  );
  const urlsJson = JSON.stringify(Array.from(processedUrls));
  const deleted = deleteStmt.run(urlsJson);
  result.deleted = deleted.changes;

  return result;
}

function syncHighlights(
  database: Database.Database,
  highlights: PlatformHighlight[]
): { inserted: number; updated: number; deleted: number } {
  const result = { inserted: 0, updated: 0, deleted: 0 };

  if (highlights.length === 0) {
    // If no highlights scraped, delete old ones
    const deleted = database.prepare('DELETE FROM platform_highlights WHERE scraped_at < datetime("now", "-2 hours")').run();
    result.deleted = deleted.changes;
    return result;
  }

  // Get existing highlights
  const existingHighlights = database.prepare('SELECT id, platform, title, hot_value FROM platform_highlights').all() as Array<{
    id: number;
    platform: string;
    title: string;
    hot_value: number;
  }>;

  const existingKeyMap = new Map(existingHighlights.map((h) => [`${h.platform}:${h.title}`, h]));

  // Prepare statements
  const insertStmt = database.prepare(`
    INSERT INTO platform_highlights (platform, title, url, category, description, hot_value, cover_url, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const updateStmt = database.prepare(`
    UPDATE platform_highlights
    SET url = ?, category = ?, description = ?, hot_value = ?, cover_url = ?, scraped_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE platform = ? AND title = ?
  `);

  const processedKeys = new Set<string>();

  // Process each highlight
  for (const highlight of highlights) {
    const key = `${highlight.platform}:${highlight.title}`;
    processedKeys.add(key);
    const existing = existingKeyMap.get(key);

    if (existing) {
      // Update if hot value changed
      if (existing.hot_value !== highlight.hotValue) {
        updateStmt.run(
          highlight.url,
          highlight.category,
          highlight.description,
          highlight.hotValue,
          highlight.coverUrl,
          highlight.platform,
          highlight.title
        );
        result.updated++;
      }
    } else {
      // Insert new highlight
      insertStmt.run(
        highlight.platform,
        highlight.title,
        highlight.url,
        highlight.category,
        highlight.description,
        highlight.hotValue,
        highlight.coverUrl
      );
      result.inserted++;
    }
  }

  // Delete old highlights that weren't in the latest scrape
  const deleteStmt = database.prepare(
    'DELETE FROM platform_highlights WHERE (platform || ":" || title) NOT IN (SELECT value FROM json_each(?)) AND scraped_at < datetime("now", "-2 hours")'
  );
  const keysJson = JSON.stringify(Array.from(processedKeys));
  const deleted = deleteStmt.run(keysJson);
  result.deleted = deleted.changes;

  return result;
}

export function cleanupOldACGBoxData(database: Database.Database, retentionDays: number = 7): void {
  console.log(`[ACGBox Sync] Cleaning up data older than ${retentionDays} days...`);

  const deleteOldRankings = database.prepare(
    'DELETE FROM hot_rankings WHERE scraped_at < datetime("now", ?)'
  );
  const deleteOldHighlights = database.prepare(
    'DELETE FROM platform_highlights WHERE scraped_at < datetime("now", ?)'
  );

  const retentionParam = `-${retentionDays} days`;

  const rankingsDeleted = deleteOldRankings.run(retentionParam);
  const highlightsDeleted = deleteOldHighlights.run(retentionParam);

  console.log(
    `[ACGBox Sync] Cleanup completed. Deleted ${rankingsDeleted.changes} old rankings and ${highlightsDeleted.changes} old highlights.`
  );
}
