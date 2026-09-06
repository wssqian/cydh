import type Database from "better-sqlite3";
import { fetch as undiciFetch } from "undici";
import { createLogger } from "./logger";

export interface SiteCheckResult {
  siteId: number;
  siteName: string;
  siteUrl: string;
  statusCode: number | null;
  finalUrl: string | null;
  responseTimeMs: number;
  errorMessage: string | null;
  checkedAt: string;
}

export interface SiteCheckJob {
  id: string;
  state: "running" | "succeeded" | "failed";
  startedAt: number;
  completedAt?: number;
  total: number;
  checked: number;
  results: SiteCheckResult[];
  error?: string;
}

const log = createLogger("HealthCheck");

const CHECK_TIMEOUT_MS = 10_000;
const CHECK_CONCURRENCY = 4;
const CHECK_USER_AGENT = "Mozilla/5.0 (compatible; CiyuanNavHealthCheck/1.0)";

let currentJob: SiteCheckJob | null = null;

export function getSiteCheckJobStatus(): SiteCheckJob | null {
  return currentJob;
}

export function runSiteChecks(database: Database.Database): SiteCheckJob {
  if (currentJob?.state === "running") {
    return currentJob;
  }

  const sites = database.prepare(`
    SELECT id, name, url FROM sites WHERE is_hidden = 0
  `).all() as Array<{ id: number; name: string; url: string }>;

  const jobId = `check-${Date.now()}`;
  const job: SiteCheckJob = {
    id: jobId,
    state: "running",
    startedAt: Date.now(),
    total: sites.length,
    checked: 0,
    results: [],
  };
  currentJob = job;

  void (async () => {
    const insertStmt = database.prepare(`
      INSERT INTO site_checks (site_id, status_code, final_url, response_time, error_message)
      VALUES (?, ?, ?, ?, ?)
    `);

    let nextIndex = 0;
    const checkOne = async (site: { id: number; name: string; url: string }) => {
      const start = Date.now();
      let statusCode: number | null = null;
      let finalUrl: string | null = null;
      let errorMessage: string | null = null;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
        try {
          const response = await undiciFetch(site.url, {
            method: "HEAD",
            signal: controller.signal,
            headers: { "User-Agent": CHECK_USER_AGENT },
            redirect: "follow",
          });
          statusCode = response.status;
          finalUrl = response.url !== site.url ? response.url : null;
        } finally {
          clearTimeout(timer);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errorMessage = msg.includes("abort") ? "请求超时" : msg.slice(0, 200);
      }

      const responseTimeMs = Date.now() - start;
      const checkedAt = new Date().toISOString();

      try {
        insertStmt.run(site.id, statusCode, finalUrl, responseTimeMs, errorMessage);
      } catch {
        // ignore insert errors
      }

      job.results.push({
        siteId: site.id,
        siteName: site.name,
        siteUrl: site.url,
        statusCode,
        finalUrl,
        responseTimeMs,
        errorMessage,
        checkedAt,
      });
      job.checked += 1;
    };

    const worker = async () => {
      while (nextIndex < sites.length) {
        const site = sites[nextIndex];
        nextIndex += 1;
        await checkOne(site);
      }
    };

    try {
      await Promise.all(
        Array.from({ length: Math.min(CHECK_CONCURRENCY, sites.length) }, () => worker()),
      );
      job.state = "succeeded";
      job.completedAt = Date.now();
      log.info("HealthCheck", `Completed ${job.checked}/${job.total} checks in ${job.completedAt - job.startedAt}ms`);
    } catch (err) {
      job.state = "failed";
      job.completedAt = Date.now();
      job.error = err instanceof Error ? err.message : String(err);
      log.error("HealthCheck", " Job failed:", job.error);
    }
  })();

  return job;
}

export function readLatestCheckResults(database: Database.Database): SiteCheckResult[] {
  const rows = database.prepare(`
    SELECT
      sc.site_id AS siteId,
      s.name AS siteName,
      s.url AS siteUrl,
      sc.status_code AS statusCode,
      sc.final_url AS finalUrl,
      sc.response_time AS responseTimeMs,
      sc.error_message AS errorMessage,
      sc.checked_at AS checkedAt
    FROM site_checks sc
    INNER JOIN sites s ON s.id = sc.site_id
    WHERE sc.id IN (
      SELECT MAX(id) FROM site_checks GROUP BY site_id
    )
    ORDER BY sc.response_time DESC
  `).all() as SiteCheckResult[];

  return rows;
}
