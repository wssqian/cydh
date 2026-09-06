import db from './db.js';
import { createLogger } from './logger.js';
import { fetchDailyHotData, getAvailablePlatforms } from './dailyhot-api.js';
import { syncDailyHotData, cleanupOldDailyHotData } from './dailyhot-sync.js';
import { clearDailyHotItemsCache } from './dailyhot-cache.js';
import { readDailyHotCronSettings } from './dailyhot-settings.js';

export type DailyHotJobState = 'idle' | 'running' | 'succeeded' | 'failed';

export interface DailyHotJob {
  id: string;
  state: DailyHotJobState;
  startedAt: Date;
  completedAt?: Date;
  result?: {
    totalItems: number;
    platformsSynced: number;
    errors: string[];
  };
  syncResult?: {
    itemsInserted: number;
    itemsUpdated: number;
    itemsDeleted: number;
    platformsSynced: number;
  };
  error?: string;
  durationMs?: number;
}

let currentJob: DailyHotJob | null = null;
let dailyhotCronInterval: ReturnType<typeof setInterval> | null = null;
let dailyhotInitialTimer: ReturnType<typeof setTimeout> | null = null;
let nextScheduledRunAt: number | null = null;
let lastSuccessfulJobTime: number = 0;

const log = createLogger("DailyHot");

const SUCCESS_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown after successful job
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function getSuccessCooldownRemainingMs(now: number = Date.now()): number {
  if (lastSuccessfulJobTime <= 0) {
    return 0;
  }

  return Math.max(0, SUCCESS_COOLDOWN_MS - (now - lastSuccessfulJobTime));
}

export function getDailyHotJobStatus(): DailyHotJob | null {
  return currentJob;
}

export async function runDailyHotJob(options: { force?: boolean; platforms?: string[] } = {}): Promise<DailyHotJob> {
  // Check if job is already running
  if (currentJob?.state === 'running') {
    throw new Error('DailyHot job is already running.');
  }

  // Check cooldown after successful job (5 minutes)
  const now = Date.now();
  const cooldownRemainingMs = getSuccessCooldownRemainingMs(now);
  if (!options.force && cooldownRemainingMs > 0) {
    const waitTime = Math.ceil(cooldownRemainingMs / 1000);
    throw new Error(`DailyHot job was successful recently. Please wait ${waitTime} seconds.`);
  }

  // Create new job
  const jobId = `dailyhot-${Date.now()}`;
  currentJob = {
    id: jobId,
    state: 'running',
    startedAt: new Date(),
  };

  log.info("DailyHot", `Starting job ${jobId}...`);

  try {
    // Fetch data from DailyHot API
    const result = await fetchDailyHotData(options.platforms);

    // Sync data to database
    const syncResult = syncDailyHotData(db, result);

    // Cleanup old data (older than 3 days)
    cleanupOldDailyHotData(db, 3);

    // Invalidate query cache so fresh data is returned
    clearDailyHotItemsCache();

    // Update job status
    currentJob = {
      ...currentJob,
      state: 'succeeded',
      completedAt: new Date(),
      result: {
        totalItems: result.totalItems,
        platformsSynced: result.platforms.length,
        errors: result.errors,
      },
      syncResult,
      durationMs: Date.now() - currentJob.startedAt.getTime(),
    };

    // Update last successful job time
    lastSuccessfulJobTime = Date.now();

    log.info("DailyHot", `Job ${jobId} completed in ${currentJob.durationMs}ms. ${result.totalItems} items from ${result.platforms.length} platforms.`);

    return currentJob;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    currentJob = {
      ...currentJob,
      state: 'failed',
      completedAt: new Date(),
      error: message,
      durationMs: Date.now() - currentJob.startedAt.getTime(),
    };

    log.error("DailyHot", `Job ${jobId} failed:`, message);

    throw error;
  }
}

export function startDailyHotCron(intervalMs?: number): void {
  stopDailyHotCron();

  const actualInterval = intervalMs && Number.isFinite(intervalMs) && intervalMs > 0
    ? intervalMs
    : DEFAULT_INTERVAL_MS;
  log.info("DailyHot", `Starting cron job with interval of ${actualInterval / (60 * 1000)} minutes.`);

  dailyhotCronInterval = setInterval(() => {
    nextScheduledRunAt = Date.now() + actualInterval;
    void runDailyHotJob().catch((error) => {
      log.error("DailyHot", "Scheduled job failed:", error);
    });
  }, actualInterval);
  nextScheduledRunAt = Date.now() + actualInterval;

  // Run initial job after a short delay
  dailyhotInitialTimer = setTimeout(() => {
    dailyhotInitialTimer = null;
    const cooldownRemainingMs = getSuccessCooldownRemainingMs();
    if (cooldownRemainingMs > 0) {
      log.info("DailyHot", `Initial job skipped because a job succeeded recently (cooldown ${Math.ceil(cooldownRemainingMs / 1000)}s).`);
      return;
    }

    void runDailyHotJob().catch((error) => {
      log.error("DailyHot", "Initial job failed:", error);
    });
  }, 10000);
}

export function stopDailyHotCron(): void {
  const wasRunning = dailyhotCronInterval !== null || dailyhotInitialTimer !== null;
  if (dailyhotCronInterval) {
    clearInterval(dailyhotCronInterval);
    dailyhotCronInterval = null;
  }
  if (dailyhotInitialTimer) {
    clearTimeout(dailyhotInitialTimer);
    dailyhotInitialTimer = null;
  }
  nextScheduledRunAt = null;
  if (wasRunning) {
    log.info("DailyHot", "Cron job stopped.");
  }
}

export function restartDailyHotCron(intervalMs?: number): void {
  stopDailyHotCron();
  startDailyHotCron(intervalMs);
}

export function restartDailyHotCronFromSettings(): void {
  const settings = readDailyHotCronSettings(db);
  if (!settings.enabled) {
    stopDailyHotCron();
    log.info("DailyHot", "Cron job is disabled.");
    return;
  }

  restartDailyHotCron(settings.intervalMs);
}

export function getDailyHotStats(): {
  lastJob: DailyHotJob | null;
  isRunning: boolean;
  nextRunIn: number | null;
  cooldownRemaining: number;
  availablePlatforms: string[];
} {
  const isRunning = currentJob?.state === 'running';

  let cooldownRemaining = 0;
  const cooldownRemainingMs = getSuccessCooldownRemainingMs();
  if (cooldownRemainingMs > 0) {
    cooldownRemaining = Math.ceil(cooldownRemainingMs / 1000);
  }

  return {
    lastJob: currentJob,
    isRunning,
    nextRunIn: nextScheduledRunAt ? Math.max(0, nextScheduledRunAt - Date.now()) : null,
    cooldownRemaining,
    availablePlatforms: getAvailablePlatforms(),
  };
}
