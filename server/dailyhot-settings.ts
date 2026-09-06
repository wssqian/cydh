import type Database from 'better-sqlite3';

export interface DailyHotCronSettings {
  enabled: boolean;
  intervalHours: number;
  intervalMs: number;
}

export const DEFAULT_DAILYHOT_INTERVAL_HOURS = 1;
export const MIN_DAILYHOT_INTERVAL_HOURS = 0.1;
export const MAX_DAILYHOT_INTERVAL_HOURS = 24;

function parseStoredIntervalHours(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_DAILYHOT_INTERVAL_HOURS || parsed > MAX_DAILYHOT_INTERVAL_HOURS) {
    return DEFAULT_DAILYHOT_INTERVAL_HOURS;
  }
  return parsed;
}

export function readDailyHotCronSettings(database: Database.Database): DailyHotCronSettings {
  const rows = database
    .prepare("SELECT key, value FROM settings WHERE key IN ('dailyhot_enabled', 'dailyhot_interval_hours')")
    .all() as Array<{ key: string; value: string }>;
  const values = rows.reduce<Record<string, string>>((settings, row) => {
    settings[row.key] = row.value;
    return settings;
  }, {});
  const intervalHours = parseStoredIntervalHours(values.dailyhot_interval_hours);

  return {
    enabled: values.dailyhot_enabled !== 'false',
    intervalHours,
    intervalMs: intervalHours * 60 * 60 * 1000,
  };
}

export function parseSubmittedDailyHotIntervalHours(value: unknown): number {
  const intervalHours = Number(value);
  if (
    !Number.isFinite(intervalHours)
    || intervalHours < MIN_DAILYHOT_INTERVAL_HOURS
    || intervalHours > MAX_DAILYHOT_INTERVAL_HOURS
  ) {
    throw new Error(
      `Interval must be between ${MIN_DAILYHOT_INTERVAL_HOURS} and ${MAX_DAILYHOT_INTERVAL_HOURS} hours`,
    );
  }
  return intervalHours;
}

export function parseSubmittedDailyHotEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error('Enabled must be a boolean');
}
