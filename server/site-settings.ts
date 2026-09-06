import type Database from 'better-sqlite3';

export const SITE_SETTING_DEFAULTS = {
  site_name: '次元导航',
  footer_text: '次元导航',
  search_mode_label: '纯搜索',
  navigation_search_placeholder: '🔍 搜索海量资源...',
  resource_search_placeholder: '搜索动漫、游戏、漫画...',
} as const;

export type SiteSettingKey = keyof typeof SITE_SETTING_DEFAULTS;
export type SiteSettings = Record<SiteSettingKey, string>;

const siteSettingKeys = Object.keys(SITE_SETTING_DEFAULTS) as SiteSettingKey[];
export const SITE_SETTING_KEYS = new Set<string>(siteSettingKeys);

const textSettingLimits: Partial<Record<SiteSettingKey, number>> = {
  site_name: 40,
  footer_text: 80,
  search_mode_label: 20,
  navigation_search_placeholder: 80,
  resource_search_placeholder: 80,
};

export function readSiteSettings(database: Database.Database): SiteSettings {
  const rows = database
    .prepare(`SELECT key, value FROM settings WHERE key IN (${siteSettingKeys.map(() => '?').join(', ')})`)
    .all(...siteSettingKeys) as Array<{ key: SiteSettingKey; value: string }>;

  return rows.reduce<SiteSettings>((settings, row) => {
    if (SITE_SETTING_KEYS.has(row.key)) {
      settings[row.key] = row.value;
    }
    return settings;
  }, { ...SITE_SETTING_DEFAULTS });
}

export function normalizeSiteSetting(key: string, value: unknown) {
  if (!SITE_SETTING_KEYS.has(key)) {
    return undefined;
  }

  const settingKey = key as SiteSettingKey;
  const normalized = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  const limit = textSettingLimits[settingKey] || 80;
  if (normalized.length > limit) {
    throw new Error('站点展示设置过长。');
  }
  return normalized || SITE_SETTING_DEFAULTS[settingKey];
}
