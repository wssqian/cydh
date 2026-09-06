import { randomUUID } from 'node:crypto';

export type ScraperTrigger = 'manual' | 'scheduled';
export type ScraperJobState = 'running' | 'succeeded' | 'failed';

export interface ScraperJob<T extends object> {
  id: string;
  trigger: ScraperTrigger;
  state: ScraperJobState;
  startedAt: number;
  completedAt?: number;
  result?: T;
  error?: string;
}

export interface ScraperJobStart<T extends object> {
  accepted: boolean;
  reason?: 'running' | 'cooldown';
  retryAfterMs?: number;
  job?: ScraperJob<T>;
}

export const DEFAULT_MINIMUM_SCRAPER_INTERVAL_MS = 5 * 60 * 1000;

export function resolveMinimumScraperIntervalMs() {
  const requested = Number(process.env.SCRAPER_MIN_INTERVAL_MS || DEFAULT_MINIMUM_SCRAPER_INTERVAL_MS);
  return Number.isFinite(requested) && requested > 0
    ? requested
    : DEFAULT_MINIMUM_SCRAPER_INTERVAL_MS;
}

export class ScraperJobQueue<T extends object> {
  private currentJob?: ScraperJob<T>;
  private lastStartedAt?: number;

  constructor(
    private readonly run: (trigger: ScraperTrigger) => Promise<T>,
    private readonly options: { minimumIntervalMs?: number } = {},
  ) {}

  start(trigger: ScraperTrigger, now = Date.now()): ScraperJobStart<T> {
    if (this.currentJob?.state === 'running') {
      return { accepted: false, reason: 'running', job: this.currentJob };
    }

    const minimumIntervalMs = this.options.minimumIntervalMs ?? resolveMinimumScraperIntervalMs();
    if (this.lastStartedAt !== undefined) {
      const retryAfterMs = minimumIntervalMs - (now - this.lastStartedAt);
      if (retryAfterMs > 0) {
        return {
          accepted: false,
          reason: 'cooldown',
          retryAfterMs,
          job: this.currentJob,
        };
      }
    }

    const job: ScraperJob<T> = {
      id: randomUUID(),
      trigger,
      state: 'running',
      startedAt: now,
    };
    this.currentJob = job;
    this.lastStartedAt = now;

    void Promise.resolve()
      .then(() => this.run(trigger))
      .then((result) => {
        if (this.currentJob?.id === job.id) {
          this.currentJob = {
            ...job,
            state: 'succeeded',
            completedAt: Date.now(),
            result,
          };
        }
      })
      .catch((error) => {
        if (this.currentJob?.id === job.id) {
          this.currentJob = {
            ...job,
            state: 'failed',
            completedAt: Date.now(),
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });

    return { accepted: true, job };
  }

  status() {
    return this.currentJob;
  }
}
