import type Database from 'better-sqlite3';
import { createLogger } from './logger';
import { resolveMinimumScraperIntervalMs } from './scraper-jobs.js';

const log = createLogger("Scraper");

let scraperInterval: ReturnType<typeof setInterval> | null = null;

export function startScraperCron(database: Database.Database, onTick: () => void) {
  if (scraperInterval) {
    clearInterval(scraperInterval);
    scraperInterval = null;
  }

  let intervalHours = 6;
  try {
    const enabled = database.prepare('SELECT value FROM settings WHERE key = ?').get('scraper_enabled') as { value?: string } | undefined;
    if (enabled?.value === 'false') {
      log.info("Scraper", "Scheduled scraping is disabled.");
      return;
    }

    const row = database.prepare('SELECT value FROM settings WHERE key = ?').get('scraper_interval_hours') as { value?: string } | undefined;
    if (row?.value) {
      const parsed = parseFloat(row.value);
      if (!Number.isNaN(parsed) && parsed > 0) {
        intervalHours = parsed;
      }
    }
  } catch (error) {
    log.error("Scraper", "Failed to read interval settings", error);
  }

  const configuredIntervalMs = intervalHours * 60 * 60 * 1000;
  const intervalMs = Math.max(configuredIntervalMs, resolveMinimumScraperIntervalMs());
  log.info("Scraper", `Starting cron job with interval of ${intervalMs / (60 * 60 * 1000)} hours.`);
  scraperInterval = setInterval(onTick, intervalMs);
}
