/**
 * 调度器模块：维护窗口判定、定时调度
 */

import type { UpdaterSettings } from './types.js';
import { fetchLatestRelease, fetchTags } from './github.js';
import { compareVersions, getLatestVersionFromTags } from './version.js';
import { readPackageVersion } from './source-update.js';
import { recordAudit } from './audit.js';
import { sendUpdateNotification } from './notifications.js';
import { readUpdaterConfig } from './config.js';
import type Database from 'better-sqlite3';

/**
 * 判断当前时间是否在维护窗口内
 */
export function isWithinMaintenanceWindow(
  startHour: number | null,
  endHour: number | null,
  timezone: string = 'Asia/Shanghai'
): boolean {
  if (startHour === null || endHour === null) {
    return true;
  }
  
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const currentHour = parseInt(formatter.format(now), 10);
    
    if (startHour <= endHour) {
      return currentHour >= startHour && currentHour < endHour;
    } else {
      return currentHour >= startHour || currentHour < endHour;
    }
  } catch {
    const currentHour = new Date().getHours();
    if (startHour <= endHour) {
      return currentHour >= startHour && currentHour < endHour;
    } else {
      return currentHour >= startHour || currentHour < endHour;
    }
  }
}

/**
 * 计算下一次维护窗口开始时间
 */
export function getNextMaintenanceWindowStart(
  startHour: number | null,
  endHour: number | null,
  timezone: string = 'Asia/Shanghai'
): Date | null {
  if (startHour === null || endHour === null) {
    return null;
  }
  
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  const currentHour = parseInt(formatter.format(now), 10);
  
  const nextStart = new Date(now);
  
  if (startHour <= endHour) {
    if (currentHour < startHour) {
      nextStart.setHours(startHour, 0, 0, 0);
    } else if (currentHour >= endHour) {
      nextStart.setDate(nextStart.getDate() + 1);
      nextStart.setHours(startHour, 0, 0, 0);
    } else {
      return now;
    }
  } else {
    if (currentHour >= startHour || currentHour < endHour) {
      return now;
    } else if (currentHour < startHour) {
      nextStart.setHours(startHour, 0, 0, 0);
    } else {
      nextStart.setDate(nextStart.getDate() + 1);
      nextStart.setHours(startHour, 0, 0, 0);
    }
  }
  
  return nextStart;
}

/**
 * 检查更新并记录审计日志
 */
export async function checkAndNotifyUpdates(
  database: Database.Database,
  settings: UpdaterSettings,
  triggeredBy: 'auto' | 'scheduled' = 'scheduled'
): Promise<void> {
  const startTime = Date.now();
  const currentVersion = readPackageVersion();
  
  let latestVersion: string | null = null;
  let hasRelease = false;
  let releaseBody: string | null = null;
  let publishedAt: string | null = null;
  let releaseUrl: string | null = null;
  
  try {
    if (settings.channel === 'nightly') {
      const tags = await fetchTags();
      latestVersion = getLatestVersionFromTags(tags);
    } else {
      const release = await fetchLatestRelease(settings.channel);
      if (release) {
        hasRelease = true;
        latestVersion = release.tag_name;
        releaseBody = release.body;
        publishedAt = release.published_at;
        releaseUrl = release.html_url;
      }
    }
  } catch (error: any) {
    console.error('[Updater] 自动检查更新失败:', error);
    await recordAudit(database, {
      timestamp: new Date().toISOString(),
      event: 'check',
      channel: settings.channel,
      success: false,
      errorMessage: error.message,
      triggeredBy,
    });
    return;
  }
  
  const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;
  const durationMs = Date.now() - startTime;
  
  await recordAudit(database, {
    timestamp: new Date().toISOString(),
    event: 'check',
    channel: settings.channel,
    previousVersion: currentVersion,
    targetVersion: latestVersion || undefined,
    durationMs,
    success: true,
    metadata: JSON.stringify({
      hasRelease,
      releaseBody: releaseBody?.slice(0, 500),
      publishedAt,
      releaseUrl,
    }),
    triggeredBy,
  });
  
  if (hasUpdate) {
    await sendUpdateNotification(settings, {
      event: 'update_available',
      timestamp: new Date().toISOString(),
      channel: settings.channel,
      version: { previous: currentVersion, current: latestVersion! },
      details: { releaseUrl, publishedAt, hasRelease },
    });
    
    console.log(`[Updater] 发现新版本: ${currentVersion} → ${latestVersion} (通道: ${settings.channel})`);
  }
}

let autoCheckTimer: ReturnType<typeof setInterval> | null = null;

export function startAutoCheckCron(database: Database.Database): void {
  stopAutoCheckCron();
  
  const settings = readUpdaterConfig(database);
  if (!settings.auto_check_enabled) return;
  
  const intervalMs = settings.check_interval_hours * 60 * 60 * 1000;
  
  const initialDelay = setTimeout(() => {
    void checkAndNotifyUpdates(database, settings, 'scheduled');
  }, 30_000);
  
  autoCheckTimer = setInterval(() => {
    void checkAndNotifyUpdates(database, readUpdaterConfig(database), 'scheduled');
  }, intervalMs);
  
  initialDelay.unref?.();
  autoCheckTimer.unref?.();
  
  console.log(`[Updater] 自动检查已启用，间隔 ${settings.check_interval_hours} 小时，通道: ${settings.channel}`);
}

export function stopAutoCheckCron(): void {
  if (autoCheckTimer) {
    clearInterval(autoCheckTimer);
    autoCheckTimer = null;
  }
}

export function restartAutoCheckCron(database: Database.Database): void {
  startAutoCheckCron(database);
}

