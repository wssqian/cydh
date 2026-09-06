import type Database from 'better-sqlite3';
import db from './db.js';
import { runACGBoxScraper, type ACGBoxScraperResult } from './acgbox-scraper.js';
import { syncACGBoxData, cleanupOldACGBoxData } from './acgbox-scraper-sync.js';
import {
  readACGBoxScraperSettings,
  resolveACGBoxScraperConfig,
  resolveACGBoxScraperIntervalMs,
} from './acgbox-scraper-settings.js';
import { acgboxPerformanceMonitor } from './acgbox-scraper-monitor.js';

export type ACGBoxJobState = 'idle' | 'running' | 'succeeded' | 'failed';

export interface ACGBoxJob {
  id: string;
  state: ACGBoxJobState;
  startedAt: Date;
  completedAt?: Date;
  result?: ACGBoxScraperResult;
  syncResult?: {
    rankingsInserted: number;
    rankingsUpdated: number;
    rankingsDeleted: number;
    highlightsInserted: number;
    highlightsUpdated: number;
    highlightsDeleted: number;
  };
  error?: string;
  durationMs?: number;
}

let currentJob: ACGBoxJob | null = null;
let acgboxCronInterval: ReturnType<typeof setInterval> | null = null;
let acgboxInitialTimer: ReturnType<typeof setTimeout> | null = null;
let lastSuccessfulJobTime: number = 0; // Only track successful jobs

const SUCCESS_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown after successful job

export function getACGBoxJobStatus(): ACGBoxJob | null {
  return currentJob;
}

export async function runACGBoxScraperJob(options: { force?: boolean } = {}): Promise<ACGBoxJob> {
  // Check if job is already running
  if (currentJob?.state === 'running') {
    throw new Error('ACGBox scraper job is already running.');
  }

  // Check cooldown after successful job (5 minutes)
  const now = Date.now();
  if (!options.force && lastSuccessfulJobTime > 0 && now - lastSuccessfulJobTime < SUCCESS_COOLDOWN_MS) {
    const waitTime = Math.ceil((SUCCESS_COOLDOWN_MS - (now - lastSuccessfulJobTime)) / 1000);
    throw new Error(`ACGBox scraper job was successful recently. Please wait ${waitTime} seconds.`);
  }

  // Create new job
  const jobId = `acgbox-${Date.now()}`;
  currentJob = {
    id: jobId,
    state: 'running',
    startedAt: new Date(),
  };

  console.log(`[ACGBox Jobs] Starting job ${jobId}...`);

  acgboxPerformanceMonitor.startMonitoring(30000);

  try {
    // Run scraper
    const result = await runACGBoxScraper({ force: options.force });

    // Sync data to database
    const syncResult = syncACGBoxData(db, result);

    // Cleanup old data (older than 7 days)
    cleanupOldACGBoxData(db, 7);

    // Update job status - mark as succeeded
    currentJob = {
      ...currentJob,
      state: 'succeeded',
      completedAt: new Date(),
      result,
      syncResult,
      durationMs: Date.now() - currentJob.startedAt.getTime(),
    };

    // Only update last successful job time on success
    lastSuccessfulJobTime = Date.now();

    acgboxPerformanceMonitor.collectMetrics({
      jobDurationMs: currentJob.durationMs!,
      rankingsProcessed: result.rankingsCount,
      highlightsProcessed: result.highlightsCount,
      pagesProcessed: result.pagesProcessed,
      errorsCount: result.errors.length,
    });
    acgboxPerformanceMonitor.stopMonitoring();

    console.log(
      `[ACGBox Jobs] Job ${jobId} completed successfully in ${currentJob.durationMs}ms. ` +
      `Scraped ${result.rankingsCount} rankings and ${result.highlightsCount} highlights.`
    );

    return currentJob;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Mark job as failed - do NOT update lastSuccessfulJobTime
    currentJob = {
      ...currentJob,
      state: 'failed',
      completedAt: new Date(),
      error: message,
      durationMs: Date.now() - currentJob.startedAt.getTime(),
    };

    console.error(`[ACGBox Jobs] Job ${jobId} failed:`, message);

    acgboxPerformanceMonitor.stopMonitoring();

    throw error;
  }
}

export function startACGBoxScraperCron(): void {
  stopACGBoxScraperCron();

  // Read settings
  const settings = readACGBoxScraperSettings(db);
  const config = resolveACGBoxScraperConfig(settings);

  if (!config.enabled) {
    console.log('[ACGBox Jobs] ACGBox scraper cron is disabled.');
    return;
  }

  const intervalMs = resolveACGBoxScraperIntervalMs(config);
  console.log(`[ACGBox Jobs] Starting ACGBox scraper cron with interval of ${intervalMs / (60 * 1000)} minutes.`);

  acgboxCronInterval = setInterval(() => {
    void runACGBoxScraperJob().catch((error) => {
      console.error('[ACGBox Jobs] Scheduled ACGBox scraper job failed:', error);
    });
  }, intervalMs);

  // Run initial job after a short delay
  acgboxInitialTimer = setTimeout(() => {
    acgboxInitialTimer = null;
    void runACGBoxScraperJob().catch((error) => {
      console.error('[ACGBox Jobs] Initial ACGBox scraper job failed:', error);
    });
  }, 10000); // 10 seconds delay
}

export function stopACGBoxScraperCron(): void {
  const wasRunning = acgboxCronInterval !== null || acgboxInitialTimer !== null;
  if (acgboxCronInterval) {
    clearInterval(acgboxCronInterval);
    acgboxCronInterval = null;
  }
  if (acgboxInitialTimer) {
    clearTimeout(acgboxInitialTimer);
    acgboxInitialTimer = null;
  }
  if (wasRunning) {
    console.log('[ACGBox Jobs] ACGBox scraper cron stopped.');
  }
}

export function restartACGBoxScraperCron(): void {
  stopACGBoxScraperCron();
  startACGBoxScraperCron();
}

// Performance monitoring
export function getACGBoxScraperStats(): {
  lastJob: ACGBoxJob | null;
  isRunning: boolean;
  nextRunIn: number | null;
  cooldownRemaining: number;
} {
  const isRunning = currentJob?.state === 'running';

  let nextRunIn: number | null = null;
  if (acgboxCronInterval) {
    const settings = readACGBoxScraperSettings(db);
    const config = resolveACGBoxScraperConfig(settings);
    const intervalMs = resolveACGBoxScraperIntervalMs(config);
    const timeSinceLastSuccess = Date.now() - lastSuccessfulJobTime;
    nextRunIn = Math.max(0, intervalMs - timeSinceLastSuccess);
  }

  // Calculate cooldown remaining
  let cooldownRemaining = 0;
  if (lastSuccessfulJobTime > 0) {
    const elapsed = Date.now() - lastSuccessfulJobTime;
    if (elapsed < SUCCESS_COOLDOWN_MS) {
      cooldownRemaining = Math.ceil((SUCCESS_COOLDOWN_MS - elapsed) / 1000);
    }
  }

  return {
    lastJob: currentJob,
    isRunning,
    nextRunIn,
    cooldownRemaining,
  };
}
