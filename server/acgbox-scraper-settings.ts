import type Database from 'better-sqlite3';

export interface ACGBoxScraperSettings {
  acgbox_scraper_enabled?: string;
  acgbox_scraper_interval_hours?: string;
  acgbox_scraper_proxy_enabled?: string;
  acgbox_scraper_proxy_url?: string;
  acgbox_scraper_max_concurrent?: string;
  acgbox_scraper_timeout_ms?: string;
  acgbox_scraper_retry_count?: string;
}

export interface ACGBoxScraperConfig {
  enabled: boolean;
  intervalHours: number;
  proxyEnabled: boolean;
  proxyUrl: string | undefined;
  maxConcurrent: number;
  timeoutMs: number;
  retryCount: number;
}

const DEFAULT_CONFIG: ACGBoxScraperConfig = {
  enabled: true,
  intervalHours: 1,
  proxyEnabled: false,
  proxyUrl: undefined,
  maxConcurrent: 2,
  timeoutMs: 30000,
  retryCount: 3,
};

export function readACGBoxScraperSettings(database: Database.Database): ACGBoxScraperSettings {
  const rows = database
    .prepare('SELECT key, value FROM acgbox_scraper_settings')
    .all() as Array<{ key: string; value: string }>;

  return rows.reduce<ACGBoxScraperSettings>((settings, row) => {
    settings[row.key as keyof ACGBoxScraperSettings] = row.value;
    return settings;
  }, {});
}

export function resolveACGBoxScraperConfig(settings: ACGBoxScraperSettings): ACGBoxScraperConfig {
  return {
    enabled: settings.acgbox_scraper_enabled !== 'false',
    intervalHours: parsePositiveNumber(settings.acgbox_scraper_interval_hours, DEFAULT_CONFIG.intervalHours),
    proxyEnabled: settings.acgbox_scraper_proxy_enabled === 'true',
    proxyUrl: resolveProxyUrl(settings.acgbox_scraper_proxy_url, settings.acgbox_scraper_proxy_enabled === 'true'),
    maxConcurrent: parsePositiveInteger(settings.acgbox_scraper_max_concurrent, DEFAULT_CONFIG.maxConcurrent),
    timeoutMs: parsePositiveNumber(settings.acgbox_scraper_timeout_ms, DEFAULT_CONFIG.timeoutMs),
    retryCount: parseNonNegativeInteger(settings.acgbox_scraper_retry_count, DEFAULT_CONFIG.retryCount),
  };
}

export function saveACGBoxScraperSettings(database: Database.Database, settings: ACGBoxScraperSettings): void {
  const upsert = database.prepare(
    'INSERT OR REPLACE INTO acgbox_scraper_settings (key, value) VALUES (?, ?)'
  );

  const transaction = database.transaction(() => {
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined) {
        upsert.run(key, value);
      }
    }
  });

  transaction();
}

export function shouldSkipACGBoxScraperRun(config: ACGBoxScraperConfig, force = false): boolean {
  return !config.enabled && !force;
}

export function resolveACGBoxScraperIntervalMs(config: ACGBoxScraperConfig): number {
  const intervalMs = config.intervalHours * 60 * 60 * 1000;
  // Minimum interval: 5 minutes
  return Math.max(intervalMs, 5 * 60 * 1000);
}

function resolveProxyUrl(proxyUrl: string | undefined, proxyEnabled: boolean): string | undefined {
  if (!proxyEnabled || !proxyUrl?.trim()) {
    return undefined;
  }

  const parsed = new URL(proxyUrl.trim());
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('代理 URL 仅支持 http:// 或 https://。');
  }

  return parsed.toString();
}

function parsePositiveNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function parsePositiveInteger(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

function parseNonNegativeInteger(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : defaultValue;
}
