import type { Request, Response } from 'express';
import db from './db.js';
import {
  readACGBoxScraperSettings,
  resolveACGBoxScraperConfig,
  saveACGBoxScraperSettings,
  type ACGBoxScraperSettings,
} from './acgbox-scraper-settings.js';
import {
  getACGBoxJobStatus,
  runACGBoxScraperJob,
  getACGBoxScraperStats,
  restartACGBoxScraperCron,
} from './acgbox-scraper-jobs.js';
import { normalizeQueryText, parsePositiveLimit } from './public-query-utils.js';

// Public API endpoints

export function getPublicHotRankings(req: Request, res: Response) {
  try {
    const limit = parsePositiveLimit(req.query.limit, { defaultValue: 50, maxValue: 200 });
    const category = normalizeQueryText(req.query.category, 120);
    const platform = normalizeQueryText(req.query.platform, 80);

    let query = `
      SELECT id, title, url, category, platform, cover_url, description, play_count, score,
             rank_position, hot_score, scraped_at
      FROM hot_rankings
      WHERE 1=1
    `;
    const params: any[] = [];

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    if (platform) {
      query += ' AND platform = ?';
      params.push(platform);
    }

    query += ' ORDER BY hot_score DESC, rank_position ASC LIMIT ?';
    params.push(limit);

    const rankings = db.prepare(query).all(...params) as any[];

    // ACGBox 数据每 ~1 小时更新；边缘缓存 5 分钟，后台回源最长 10 分钟
    res.set('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
    res.set('Vary', 'Accept-Encoding');
    res.json({
      rankings,
      total: rankings.length,
      scraped_at: rankings[0]?.scraped_at || null,
    });
  } catch (error) {
    console.error('[ACGBox API] Error fetching hot rankings:', error);
    res.status(500).json({ error: 'Failed to fetch hot rankings' });
  }
}

export function getPublicPlatformHighlights(req: Request, res: Response) {
  try {
    const limit = parsePositiveLimit(req.query.limit, { defaultValue: 50, maxValue: 200 });
    const platform = normalizeQueryText(req.query.platform, 80);

    let query = `
      SELECT id, platform, title, url, category, description, hot_value, cover_url, scraped_at
      FROM platform_highlights
      WHERE 1=1
    `;
    const params: any[] = [];

    if (platform) {
      query += ' AND platform = ?';
      params.push(platform);
    }

    query += ' ORDER BY hot_value DESC, scraped_at DESC LIMIT ?';
    params.push(limit);

    const highlights = db.prepare(query).all(...params) as any[];

    // Group by platform
    const grouped = highlights.reduce((acc: any, highlight: any) => {
      if (!acc[highlight.platform]) {
        acc[highlight.platform] = [];
      }
      acc[highlight.platform].push(highlight);
      return acc;
    }, {});

    // ACGBox 数据每 ~1 小时更新；边缘缓存 5 分钟，后台回源最长 10 分钟
    res.set('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
    res.set('Vary', 'Accept-Encoding');
    res.json({
      highlights: grouped,
      total: highlights.length,
      platforms: Object.keys(grouped).length,
      scraped_at: highlights[0]?.scraped_at || null,
    });
  } catch (error) {
    console.error('[ACGBox API] Error fetching platform highlights:', error);
    res.status(500).json({ error: 'Failed to fetch platform highlights' });
  }
}

// Admin API endpoints

export function getACGBoxScraperSettings(req: Request, res: Response) {
  try {
    const settings = readACGBoxScraperSettings(db);
    const config = resolveACGBoxScraperConfig(settings);

    res.json({
      settings,
      config,
    });
  } catch (error) {
    console.error('[ACGBox API] Error reading ACGBox scraper settings:', error);
    res.status(500).json({ error: 'Failed to read ACGBox scraper settings' });
  }
}

export function updateACGBoxScraperSettings(req: Request, res: Response) {
  try {
    const newSettings: ACGBoxScraperSettings = req.body;
    const oldConfig = resolveACGBoxScraperConfig(readACGBoxScraperSettings(db));

    // Validate settings
    if (newSettings.acgbox_scraper_proxy_url) {
      try {
        const url = new URL(newSettings.acgbox_scraper_proxy_url);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          return res.status(400).json({ error: '代理 URL 仅支持 http:// 或 https://。' });
        }
      } catch {
        return res.status(400).json({ error: '无效的代理 URL。' });
      }
    }

    if (newSettings.acgbox_scraper_interval_hours) {
      const hours = parseFloat(newSettings.acgbox_scraper_interval_hours);
      if (isNaN(hours) || hours < 0.1 || hours > 24) {
        return res.status(400).json({ error: '抓取间隔必须在 0.1 到 24 小时之间。' });
      }
    }

    if (newSettings.acgbox_scraper_max_concurrent) {
      const concurrent = parseInt(newSettings.acgbox_scraper_max_concurrent, 10);
      if (isNaN(concurrent) || concurrent < 1 || concurrent > 10) {
        return res.status(400).json({ error: '最大并发数必须在 1 到 10 之间。' });
      }
    }

    if (newSettings.acgbox_scraper_timeout_ms) {
      const timeout = parseInt(newSettings.acgbox_scraper_timeout_ms, 10);
      if (isNaN(timeout) || timeout < 5000 || timeout > 120000) {
        return res.status(400).json({ error: '超时时间必须在 5000 到 120000 毫秒之间。' });
      }
    }

    // Save settings
    saveACGBoxScraperSettings(db, newSettings);

    // Restart cron if interval or enabled status changed
    const savedSettings = readACGBoxScraperSettings(db);
    const newConfig = resolveACGBoxScraperConfig(savedSettings);

    if (
      oldConfig.intervalHours !== newConfig.intervalHours ||
      oldConfig.enabled !== newConfig.enabled
    ) {
      restartACGBoxScraperCron();
    }

    res.json({ success: true, settings: savedSettings });
  } catch (error) {
    console.error('[ACGBox API] Error updating ACGBox scraper settings:', error);
    res.status(500).json({ error: 'Failed to update ACGBox scraper settings' });
  }
}

export async function runACGBoxScraperManually(req: Request, res: Response) {
  try {
    const job = await runACGBoxScraperJob({ force: true });

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
    console.error('[ACGBox API] Error running ACGBox scraper:', error);

    if (message.includes('already running')) {
      return res.status(429).json({ error: 'ACGBox scraper job is already running.' });
    }

    if (message.includes('recently')) {
      return res.status(429).json({ error: message });
    }

    res.status(500).json({ error: 'Failed to run ACGBox scraper' });
  }
}

export function getACGBoxScraperStatus(req: Request, res: Response) {
  try {
    const job = getACGBoxJobStatus();
    const stats = getACGBoxScraperStats();

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
      nextRunIn: stats.nextRunIn,
    });
  } catch (error) {
    console.error('[ACGBox API] Error fetching ACGBox scraper status:', error);
    res.status(500).json({ error: 'Failed to fetch ACGBox scraper status' });
  }
}

export function getACGBoxScraperStatistics(req: Request, res: Response) {
  try {
    const stats = getACGBoxScraperStats();

    // Get data counts
    const rankingsCount = db.prepare('SELECT COUNT(*) as count FROM hot_rankings').get() as { count: number };
    const highlightsCount = db.prepare('SELECT COUNT(*) as count FROM platform_highlights').get() as { count: number };

    // Get latest scrape time
    const latestRanking = db.prepare('SELECT MAX(scraped_at) as scraped_at FROM hot_rankings').get() as { scraped_at: string | null };
    const latestHighlight = db.prepare('SELECT MAX(scraped_at) as scraped_at FROM platform_highlights').get() as { scraped_at: string | null };

    // Get platform breakdown
    const platformBreakdown = db.prepare(`
      SELECT platform, COUNT(*) as count
      FROM platform_highlights
      GROUP BY platform
      ORDER BY count DESC
    `).all();

    res.json({
      rankingsCount: rankingsCount.count,
      highlightsCount: highlightsCount.count,
      latestScrape: latestRanking.scraped_at || latestHighlight.scraped_at,
      platformBreakdown,
      lastJob: stats.lastJob,
      isRunning: stats.isRunning,
      nextRunIn: stats.nextRunIn,
      cooldownRemaining: stats.cooldownRemaining,
    });
  } catch (error) {
    console.error('[ACGBox API] Error fetching ACGBox scraper statistics:', error);
    res.status(500).json({ error: 'Failed to fetch ACGBox scraper statistics' });
  }
}
