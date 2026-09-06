import type Database from 'better-sqlite3';

export interface ScraperSettings {
  scraper_url?: string;
  scraper_enabled?: string;
  scraper_proxy_enabled?: string;
  scraper_proxy_url?: string;
}

export function readScraperSettings(database: Database.Database): ScraperSettings {
  const rows = database
    .prepare('SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?)')
    .all('scraper_url', 'scraper_enabled', 'scraper_proxy_enabled', 'scraper_proxy_url') as Array<{ key: string; value: string }>;

  return rows.reduce<ScraperSettings>((settings, row) => {
    if (
      row.key === 'scraper_url'
      || row.key === 'scraper_enabled'
      || row.key === 'scraper_proxy_enabled'
      || row.key === 'scraper_proxy_url'
    ) {
      settings[row.key] = row.value;
    }
    return settings;
  }, {});
}

export function resolveScraperProxyUrl(settings: ScraperSettings) {
  const proxyUrl = settings.scraper_proxy_url?.trim();
  if (settings.scraper_proxy_enabled !== 'true' || !proxyUrl) {
    return undefined;
  }

  const parsed = new URL(proxyUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('代理 URL 仅支持 http:// 或 https://。');
  }

  return parsed.toString();
}

export function shouldSkipScraperRun(settings: ScraperSettings, force = false) {
  return settings.scraper_enabled === 'false' && !force;
}
