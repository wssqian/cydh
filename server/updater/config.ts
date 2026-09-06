/**
 * 更新系统配置管理
 */

import type Database from 'better-sqlite3';
import type {
  UpdaterSettings,
  UpdateChannel,
  MaintenanceWindow,
  SignatureConfig,
} from './types.js';

const DEFAULT_SETTINGS: UpdaterSettings = {
  auto_check_enabled: false,
  check_interval_hours: 24,
  channel: 'stable',
  maintenance_window: {
    start_hour: null,
    end_hour: null,
    timezone: 'Asia/Shanghai',
  },
  signature: {
    public_key: null,
    allow_unsigned_dev: true,
  },
  notifications: {
    email_enabled: false,
    email_recipients: [],
    webhook_url: null,
    webhook_secret: null,
    events: [
      'update_available',
      'update_started',
      'update_succeeded',
      'update_failed',
      'rollback_triggered',
      'health_check_failed',
    ],
  },
};

const SETTING_KEYS = {
  auto_check_enabled: 'updater_auto_check_enabled',
  check_interval_hours: 'updater_check_interval_hours',
  channel: 'updater_channel',
  maintenance_window_start: 'updater_maintenance_window_start',
  maintenance_window_end: 'updater_maintenance_window_end',
  maintenance_window_timezone: 'updater_maintenance_window_timezone',
  signature_public_key: 'updater_signature_public_key',
  signature_allow_unsigned_dev: 'updater_signature_allow_unsigned_dev',
  notifications_email_enabled: 'updater_notifications_email_enabled',
  notifications_email_recipients: 'updater_notifications_email_recipients',
  notifications_webhook_url: 'updater_notifications_webhook_url',
  notifications_webhook_secret: 'updater_notifications_webhook_secret',
  notifications_events: 'updater_notifications_events',
} as const;

function validateChannel(value: unknown): UpdateChannel {
  if (value === 'stable' || value === 'beta' || value === 'nightly') {
    return value;
  }
  return 'stable';
}

function validateMaintenanceWindow(value: unknown): MaintenanceWindow {
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    return {
      start_hour: typeof obj.start_hour === 'number' && obj.start_hour >= 0 && obj.start_hour <= 23 ? obj.start_hour : null,
      end_hour: typeof obj.end_hour === 'number' && obj.end_hour >= 0 && obj.end_hour <= 23 ? obj.end_hour : null,
      timezone: typeof obj.timezone === 'string' && obj.timezone.length > 0 ? obj.timezone : 'Asia/Shanghai',
    };
  }
  return DEFAULT_SETTINGS.maintenance_window;
}

function validateSignatureConfig(value: unknown): SignatureConfig {
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    return {
      public_key: typeof obj.public_key === 'string' ? obj.public_key : null,
      allow_unsigned_dev: typeof obj.allow_unsigned_dev === 'boolean' ? obj.allow_unsigned_dev : true,
    };
  }
  return DEFAULT_SETTINGS.signature;
}

function validateNotifications(value: unknown): UpdaterSettings['notifications'] {
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    return {
      email_enabled: typeof obj.email_enabled === 'boolean' ? obj.email_enabled : false,
      email_recipients: Array.isArray(obj.email_recipients) ? obj.email_recipients.filter((v): v is string => typeof v === 'string') : [],
      webhook_url: typeof obj.webhook_url === 'string' ? obj.webhook_url : null,
      webhook_secret: typeof obj.webhook_secret === 'string' ? obj.webhook_secret : null,
      events: Array.isArray(obj.events) ? obj.events.filter((v): v is string => typeof v === 'string') : DEFAULT_SETTINGS.notifications.events,
    };
  }
  return DEFAULT_SETTINGS.notifications;
}

export function readUpdaterConfig(database: Database.Database): UpdaterSettings {
  const rows = database
    .prepare(`SELECT key, value FROM settings WHERE key IN (${Object.values(SETTING_KEYS).map(() => '?').join(', ')})`)
    .all(...Object.values(SETTING_KEYS)) as Array<{ key: string; value: string }>;

  const map = new Map(rows.map((r) => [r.key, r.value]));

  const parseJson = <T>(key: string, fallback: T): T => {
    const val = map.get(key);
    if (!val) return fallback;
    try {
      return JSON.parse(val) as T;
    } catch {
      return fallback;
    }
  };

  return {
    auto_check_enabled: map.get(SETTING_KEYS.auto_check_enabled) === 'true',
    check_interval_hours: Math.max(1, Math.min(168, Number(map.get(SETTING_KEYS.check_interval_hours)) || 24)),
    channel: validateChannel(map.get(SETTING_KEYS.channel) || 'stable'),
    maintenance_window: validateMaintenanceWindow(
      readMaintenanceWindow(map),
    ),
    signature: validateSignatureConfig({
      public_key: map.get(SETTING_KEYS.signature_public_key) || null,
      allow_unsigned_dev: map.get(SETTING_KEYS.signature_allow_unsigned_dev) !== 'false',
    }),
    notifications: validateNotifications({
      email_enabled: map.get(SETTING_KEYS.notifications_email_enabled) === 'true',
      email_recipients: parseJson(SETTING_KEYS.notifications_email_recipients, []),
      webhook_url: map.get(SETTING_KEYS.notifications_webhook_url) || null,
      webhook_secret: map.get(SETTING_KEYS.notifications_webhook_secret) || null,
      events: parseJson(SETTING_KEYS.notifications_events, DEFAULT_SETTINGS.notifications.events),
    }),
  };
}

function readMaintenanceWindow(map: Map<string, string>): MaintenanceWindow {
  const startRaw = map.get(SETTING_KEYS.maintenance_window_start);
  const endRaw = map.get(SETTING_KEYS.maintenance_window_end);

  const parseHour = (raw: string | undefined): number | null => {
    if (raw === undefined || raw === '') return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
  };

  return {
    start_hour: parseHour(startRaw),
    end_hour: parseHour(endRaw),
    timezone: map.get(SETTING_KEYS.maintenance_window_timezone) || 'Asia/Shanghai',
  };
}

export function saveUpdaterConfig(database: Database.Database, settings: Partial<UpdaterSettings>) {
  const stmt = database.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const tx = database.transaction(() => {
    if (settings.auto_check_enabled !== undefined) {
      stmt.run(SETTING_KEYS.auto_check_enabled, settings.auto_check_enabled ? 'true' : 'false');
    }
    if (settings.check_interval_hours !== undefined) {
      const hours = Math.max(1, Math.min(168, Math.round(settings.check_interval_hours)));
      stmt.run(SETTING_KEYS.check_interval_hours, String(hours));
    }
    if (settings.channel !== undefined) {
      stmt.run(SETTING_KEYS.channel, settings.channel);
    }
    if (settings.maintenance_window !== undefined) {
      stmt.run(SETTING_KEYS.maintenance_window_start, settings.maintenance_window.start_hour !== null ? String(settings.maintenance_window.start_hour) : '');
      stmt.run(SETTING_KEYS.maintenance_window_end, settings.maintenance_window.end_hour !== null ? String(settings.maintenance_window.end_hour) : '');
      stmt.run(SETTING_KEYS.maintenance_window_timezone, settings.maintenance_window.timezone);
    }
    if (settings.signature !== undefined) {
      stmt.run(SETTING_KEYS.signature_public_key, settings.signature.public_key || '');
      stmt.run(SETTING_KEYS.signature_allow_unsigned_dev, settings.signature.allow_unsigned_dev ? 'true' : 'false');
    }
    if (settings.notifications !== undefined) {
      stmt.run(SETTING_KEYS.notifications_email_enabled, settings.notifications.email_enabled ? 'true' : 'false');
      stmt.run(SETTING_KEYS.notifications_email_recipients, JSON.stringify(settings.notifications.email_recipients));
      stmt.run(SETTING_KEYS.notifications_webhook_url, settings.notifications.webhook_url || '');
      stmt.run(SETTING_KEYS.notifications_webhook_secret, settings.notifications.webhook_secret || '');
      stmt.run(SETTING_KEYS.notifications_events, JSON.stringify(settings.notifications.events));
    }
  });
  tx();
}

export function getDefaultSettings(): UpdaterSettings {
  return { ...DEFAULT_SETTINGS };
}