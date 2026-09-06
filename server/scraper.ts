import db from './db.js';
import { buildScraperTargets, DEFAULT_SCRAPER_URL, probeScraperTargetsSettled } from './scraper-source.js';
import { readScraperSettings, resolveScraperProxyUrl, shouldSkipScraperRun } from './scraper-settings.js';
import { syncScrapedCategories } from './scraper-sync.js';
import { resolveMinimumScraperIntervalMs } from './scraper-jobs.js';
import { cacheScrapedIcons } from './scraper-icons.js';

export async function runScraper(options: { force?: boolean } = {}) {
  console.log('[Scraper] Starting scraper run...');
  const settingsMap = readScraperSettings(db);
    
  if (shouldSkipScraperRun(settingsMap, options.force)) {
    console.log('[Scraper] Scraper is disabled in settings. Skipping.');
    return { processed: 0, skipped: true };
  }

  const targetUrl = process.env.SCRAPER_URL || settingsMap.scraper_url || DEFAULT_SCRAPER_URL;
  const proxyUrl = process.env.SCRAPER_PROXY_URL
    ? resolveScraperProxyUrl({
      scraper_proxy_enabled: 'true',
      scraper_proxy_url: process.env.SCRAPER_PROXY_URL,
    })
    : resolveScraperProxyUrl(settingsMap);
  const targets = buildScraperTargets(targetUrl);
  const { probes, failures } = await probeScraperTargetsSettled(targets, proxyUrl);
  if (probes.length === 0) {
    throw new Error(`全部抓取页面均失败：${failures.map((failure) => failure.targetUrl).join('、')}`);
  }
  const categories = probes.flatMap((probe) => probe.categories);
  if (categories.length === 0) {
    throw new Error('抓取成功但未解析到任何分类内容。');
  }

  const existingIconRows = db.prepare(
    'SELECT icon_url, local_icon_path FROM sites WHERE icon_url IS NOT NULL AND local_icon_path IS NOT NULL',
  ).all() as Array<{ icon_url: string; local_icon_path: string }>;
  const existingIcons = new Map(existingIconRows.map((row) => [row.icon_url, row.local_icon_path]));

  const icons = await cacheScrapedIcons(categories, { proxyUrl, existingIcons });
  const result = syncScrapedCategories(db, icons.categories);
  if (failures.length > 0) {
    console.warn(`[Scraper] ${failures.length} pages failed and retained their previously stored data: ${failures.map((failure) => failure.targetUrl).join(', ')}`);
  }
  console.log(`[Scraper] Synchronized ${result.processed} resources in ${result.categories} categories from ${probes.length}/${targets.length} pages${proxyUrl ? ' through proxy' : ''}; cached ${icons.cached} icons (${icons.skipped} skipped), ${icons.failed} failed.`);
  return {
    ...result,
    cachedIcons: icons.cached,
    failedIcons: icons.failed,
    pages: probes.length,
    requestedPages: targets.length,
    failedPages: failures.map((failure) => failure.targetUrl),
    skipped: false,
  };
}

let scraperInterval: ReturnType<typeof setInterval> | null = null;

export function startScraperCron(onTick: () => void = () => {
  void runScraper().catch((error) => console.error('[Scraper] Scheduled run failed:', error));
}) {
  if (scraperInterval) {
    clearInterval(scraperInterval);
    scraperInterval = null;
  }

  let intervalHours = 6;
  try {
    const enabled = db.prepare('SELECT value FROM settings WHERE key = ?').get('scraper_enabled') as { value?: string } | undefined;
    if (enabled?.value === 'false') {
      console.log('[Scraper] Scheduled scraping is disabled.');
      return;
    }

    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('scraper_interval_hours') as any;
    if (row && row.value) {
      const parsed = parseFloat(row.value);
      if (!isNaN(parsed) && parsed > 0) {
        intervalHours = parsed;
      }
    }
  } catch (e) {
    console.error('[Scraper] Failed to read interval settings', e);
  }

  const configuredIntervalMs = intervalHours * 60 * 60 * 1000;
  const intervalMs = Math.max(configuredIntervalMs, resolveMinimumScraperIntervalMs());
  console.log(`[Scraper] Starting cron job with interval of ${intervalMs / (60 * 60 * 1000)} hours.`);
  scraperInterval = setInterval(onTick, intervalMs);
}
