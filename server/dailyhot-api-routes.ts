import type { Request, Response } from 'express';
import db from './db.js';
import { getAvailablePlatforms } from './dailyhot-api.js';
import {
  getDailyHotJobStatus,
  runDailyHotJob,
  getDailyHotStats,
  restartDailyHotCronFromSettings,
} from './dailyhot-jobs.js';
import { getCachedHotItems, setCachedHotItems, HOT_ITEMS_CACHE_TTL_MS } from './dailyhot-cache.js';
import { normalizeQueryText, parsePositiveLimit } from './public-query-utils.js';
import {
  parseSubmittedDailyHotEnabled,
  parseSubmittedDailyHotIntervalHours,
  readDailyHotCronSettings,
} from './dailyhot-settings.js';

// Public API endpoints

export function getPublicDailyHotItems(req: Request, res: Response) {
  try {
    const perPlatformLimit = parsePositiveLimit(req.query.limit, { defaultValue: 30, maxValue: 50 });
    const platform = normalizeQueryText(req.query.platform, 64);

    const cacheKey = platform ? `s:${platform}:${perPlatformLimit}` : `a:${perPlatformLimit}`;
    const cached = getCachedHotItems(cacheKey);
    if (cached) {
      const { expiresAt: _, ...response } = cached;
      // DailyHot 数据每 ~1 小时更新；边缘缓存 60 秒，后台回源最长 300 秒
      res.set('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
      res.set('Vary', 'Accept-Encoding');
      res.json(response);
      return;
    }

    let items: any[];

    if (platform) {
      // 单平台查询：直接 LIMIT
      items = db.prepare(`
        SELECT id, platform, title, description, cover, author, url, mobile_url, hot, timestamp, scraped_at
        FROM dailyhot_items
        WHERE platform = ?
        ORDER BY hot DESC, scraped_at DESC
        LIMIT ?
      `).all(platform, perPlatformLimit) as any[];
    } else {
      // 全平台查询：使用窗口函数按平台各取 N 条，避免全局 LIMIT 导致低热度平台被挤出
      items = db.prepare(`
        SELECT id, platform, title, description, cover, author, url, mobile_url, hot, timestamp, scraped_at
        FROM (
          SELECT id, platform, title, description, cover, author, url, mobile_url, hot, timestamp, scraped_at,
                 ROW_NUMBER() OVER (PARTITION BY platform ORDER BY hot DESC, scraped_at DESC) AS rn
          FROM dailyhot_items
        )
        WHERE rn <= ?
        ORDER BY hot DESC, scraped_at DESC
      `).all(perPlatformLimit) as any[];
    }

    // 按平台分组
    const grouped: Record<string, any[]> = {};
    for (const item of items) {
      if (!grouped[item.platform]) {
        grouped[item.platform] = [];
      }
      grouped[item.platform].push(item);
    }

    const result = {
      items: grouped,
      total: items.length,
      platforms: Object.keys(grouped).length,
      availablePlatforms: getAvailablePlatforms(),
    };
    setCachedHotItems(cacheKey, { ...result, expiresAt: Date.now() + HOT_ITEMS_CACHE_TTL_MS });

    // DailyHot 数据每 ~1 小时更新；边缘缓存 60 秒，后台回源最长 300 秒
    res.set('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    res.set('Vary', 'Accept-Encoding');
    res.json(result);
  } catch (error) {
    console.error('[DailyHot API] Error fetching items:', error);
    res.status(500).json({ error: 'Failed to fetch hot items' });
  }
}

export function getPublicDailyHotPlatforms(req: Request, res: Response) {
  try {
    // 获取数据库中的平台统计
    const stats = db.prepare(`
      SELECT platform, COUNT(*) as count, MAX(scraped_at) as last_update
      FROM dailyhot_items
      GROUP BY platform
      ORDER BY count DESC
    `).all();

    // 平台列表随数据同步变化；边缘缓存 60 秒减少重复聚合查询
    res.set('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    res.set('Vary', 'Accept-Encoding');
    res.json({
      platforms: stats,
      availablePlatforms: getAvailablePlatforms(),
    });
  } catch (error) {
    console.error('[DailyHot API] Error fetching platforms:', error);
    res.status(500).json({ error: 'Failed to fetch platforms' });
  }
}

// Admin API endpoints

export function getDailyHotSettings(req: Request, res: Response) {
  try {
    // 从 settings 表读取配置
    const config = readDailyHotCronSettings(db);
    const settings = {
      enabled: config.enabled,
      intervalHours: config.intervalHours,
      availablePlatforms: getAvailablePlatforms(),
    };

    res.json({ settings });
  } catch (error) {
    console.error('[DailyHot API] Error reading settings:', error);
    res.status(500).json({ error: 'Failed to read settings' });
  }
}

export function updateDailyHotSettings(req: Request, res: Response) {
  try {
    const { enabled, intervalHours } = req.body;
    let nextEnabled: boolean | undefined;
    let nextIntervalHours: number | undefined;

    if (enabled !== undefined) {
      nextEnabled = parseSubmittedDailyHotEnabled(enabled);
    }

    // 验证参数
    if (intervalHours !== undefined) {
      nextIntervalHours = parseSubmittedDailyHotIntervalHours(intervalHours);
    }

    // 保存设置
    const upsert = db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );

    if (nextEnabled !== undefined) {
      upsert.run('dailyhot_enabled', nextEnabled ? 'true' : 'false');
    }

    if (nextIntervalHours !== undefined) {
      upsert.run('dailyhot_interval_hours', String(nextIntervalHours));
    }

    // 重启定时任务
    restartDailyHotCronFromSettings();

    const config = readDailyHotCronSettings(db);
    res.json({
      success: true,
      settings: {
        enabled: config.enabled,
        intervalHours: config.intervalHours,
        availablePlatforms: getAvailablePlatforms(),
      },
    });
  } catch (error) {
    console.error('[DailyHot API] Error updating settings:', error);
    if (error instanceof Error && /Interval|Enabled/.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to update settings' });
  }
}

export async function runDailyHotManually(req: Request, res: Response) {
  try {
    const { platforms } = req.body;
    const job = await runDailyHotJob({ force: true, platforms });

    res.json({
      success: true,
      job: {
        id: job.id,
        state: job.state,
        result: job.result,
        syncResult: job.syncResult,
        durationMs: job.durationMs,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[DailyHot API] Error running job:', error);

    if (message.includes('already running')) {
      return res.status(429).json({ error: 'DailyHot job is already running.' });
    }

    if (message.includes('recently')) {
      return res.status(429).json({ error: message });
    }

    res.status(500).json({ error: 'Failed to run DailyHot job' });
  }
}

export function getDailyHotStatus(req: Request, res: Response) {
  try {
    const job = getDailyHotJobStatus();
    const stats = getDailyHotStats();

    res.json({
      job: job
        ? {
            id: job.id,
            state: job.state,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            result: job.result,
            syncResult: job.syncResult,
            error: job.error,
            durationMs: job.durationMs,
          }
        : null,
      isRunning: stats.isRunning,
      cooldownRemaining: stats.cooldownRemaining,
      availablePlatforms: stats.availablePlatforms,
    });
  } catch (error) {
    console.error('[DailyHot API] Error fetching status:', error);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
}

export function getDailyHotStatistics(req: Request, res: Response) {
  try {
    const stats = getDailyHotStats();

    // 获取数据统计
    const totalCount = db.prepare('SELECT COUNT(*) as count FROM dailyhot_items').get() as { count: number };

    // 获取平台分布
    const platformStats = db.prepare(`
      SELECT platform, COUNT(*) as count, MAX(scraped_at) as last_update
      FROM dailyhot_items
      GROUP BY platform
      ORDER BY count DESC
    `).all();

    // 获取最新爬取时间
    const latestItem = db.prepare('SELECT MAX(scraped_at) as scraped_at FROM dailyhot_items').get() as { scraped_at: string | null };

    res.json({
      totalItems: totalCount.count,
      platformStats,
      latestScrape: latestItem.scraped_at,
      lastJob: stats.lastJob,
      isRunning: stats.isRunning,
      cooldownRemaining: stats.cooldownRemaining,
      availablePlatforms: stats.availablePlatforms,
    });
  } catch (error) {
    console.error('[DailyHot API] Error fetching statistics:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
}
