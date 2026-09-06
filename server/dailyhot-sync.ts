import type Database from 'better-sqlite3';
import type { DailyHotResult, DailyHotPlatform, DailyHotItem } from './dailyhot-api.js';

export interface SyncResult {
  itemsInserted: number;
  itemsUpdated: number;
  itemsDeleted: number;
  platformsSynced: number;
}

export function syncDailyHotData(
  database: Database.Database,
  data: DailyHotResult
): SyncResult {
  console.log('[DailyHot Sync] Starting data synchronization...');

  const result: SyncResult = {
    itemsInserted: 0,
    itemsUpdated: 0,
    itemsDeleted: 0,
    platformsSynced: 0,
  };

  const transaction = database.transaction(() => {
    for (const platform of data.platforms) {
      const platformResult = syncPlatformData(database, platform);
      result.itemsInserted += platformResult.inserted;
      result.itemsUpdated += platformResult.updated;
      result.itemsDeleted += platformResult.deleted;
      result.platformsSynced++;
    }
  });

  transaction();

  console.log(
    `[DailyHot Sync] Completed. Platforms: ${result.platformsSynced}, ` +
    `Inserted: ${result.itemsInserted}, Updated: ${result.itemsUpdated}, Deleted: ${result.itemsDeleted}`
  );

  return result;
}

function syncPlatformData(
  database: Database.Database,
  platform: DailyHotPlatform
): { inserted: number; updated: number; deleted: number } {
  const result = { inserted: 0, updated: 0, deleted: 0 };

  // 准备语句 - 使用 INSERT OR REPLACE 处理重复数据
  const upsertStmt = database.prepare(`
    INSERT OR REPLACE INTO dailyhot_items (id, platform, title, description, cover, author, url, mobile_url, hot, timestamp, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const processedIds = new Set<string>();

  // 处理每个项目
  for (const item of platform.data) {
    // 验证必要字段
    if (!item.id || !item.title || !item.url) {
      console.warn(`[DailyHot Sync] Skipping item with missing required fields: id=${item.id}, title=${item.title}, url=${item.url}`);
      continue;
    }

    // 跳过同一批次中已处理的重复ID
    if (processedIds.has(item.id)) {
      console.warn(`[DailyHot Sync] Skipping duplicate item id=${item.id} in same batch`);
      continue;
    }

    processedIds.add(item.id);

    // 使用 INSERT OR REPLACE 自动处理新增和更新
    upsertStmt.run(
      item.id,
      platform.name,
      item.title,
      item.desc || null,
      item.cover || null,
      item.author || null,
      item.url,
      item.mobileUrl || null,
      item.hot || 0,
      item.timestamp || null
    );
    result.inserted++;
  }

  // 删除旧数据（保留最近24小时的数据）
  const deleteStmt = database.prepare(
    "DELETE FROM dailyhot_items WHERE platform = ? AND id NOT IN (SELECT value FROM json_each(?)) AND scraped_at < datetime('now', '-24 hours')"
  );
  const idsJson = JSON.stringify(Array.from(processedIds));
  const deleted = deleteStmt.run(platform.name, idsJson);
  result.deleted = deleted.changes;

  return result;
}

export function cleanupOldDailyHotData(database: Database.Database, retentionDays: number = 3): void {
  console.log(`[DailyHot Sync] Cleaning up data older than ${retentionDays} days...`);

  const deleteOld = database.prepare(
    "DELETE FROM dailyhot_items WHERE scraped_at < datetime('now', ?)"
  );

  const deleted = deleteOld.run(`-${retentionDays} days`);

  console.log(`[DailyHot Sync] Cleanup completed. Deleted ${deleted.changes} old items.`);
}
