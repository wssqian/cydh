/**
 * ACG external API fetch module.
 *
 * Data requests prefer official upstream APIs first, then fall back to the
 * configured HTTP proxy / Worker proxy. Secrets are read from environment
 * variables only and are never written to logs.
 */
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { rewriteUrlForProxy, resolveAcgProxyConfig, type ResolvedAcgProxyConfig } from "./acg-features-settings";
import { createLogger } from "./logger";
import db from "./db";

const log = createLogger("ACGProxy");
const TIMEOUT = 20_000;
type UndiciResponse = Awaited<ReturnType<typeof undiciFetch>>;
type AcgFetchSource = "direct" | "http-proxy" | "worker";
export type AcgFetchPolicy = "configured-first" | "configured-only" | "direct-only";

export interface AcgFetchAttemptRecord {
  source: AcgFetchSource;
  label: string;
  url: string;
  durationMs: number;
  ok: boolean;
  status?: number;
  error?: string;
}

interface FetchTarget {
  label: string;
  url: string;
  headers: Record<string, string>;
}

interface FetchAttempt {
  source: AcgFetchSource;
  target: FetchTarget;
  dispatcher?: ProxyAgent;
}

function trimToken(value: string | undefined): string | undefined {
  const token = value?.trim();
  return token || undefined;
}

function withPath(base: string, prefix: string, path: string) {
  return base + path.slice(prefix.length);
}

function resolveOfficialTarget(path: string, headers: Record<string, string>): FetchTarget | null {
  if (path.startsWith("/bangumi")) {
    const token = trimToken(process.env.BANGUMI_ACCESS_TOKEN || process.env.BANGUMI_TOKEN);
    return {
      label: "Bangumi",
      url: withPath("https://api.bgm.tv", "/bangumi", path),
      headers: token ? { ...headers, Authorization: `Bearer ${token}` } : headers,
    };
  }

  if (path.startsWith("/mangadex")) {
    return {
      label: "MangaDex",
      url: withPath("https://api.mangadex.org", "/mangadex", path),
      headers,
    };
  }

  if (path.startsWith("/vndb")) {
    const token = trimToken(process.env.VNDB_API_TOKEN || process.env.VNDB_TOKEN);
    return {
      label: "VNDB",
      url: withPath("https://api.vndb.org/kana", "/vndb", path),
      headers: token ? { ...headers, Authorization: `Token ${token}` } : headers,
    };
  }

  if (path.startsWith("/pixiv")) {
    return {
      label: "Pixiv",
      url: withPath("https://www.pixiv.net", "/pixiv", path),
      headers: {
        ...headers,
        Accept: "application/json,text/javascript,*/*;q=0.01",
        Referer: "https://www.pixiv.net/",
        "X-Requested-With": "XMLHttpRequest",
      },
    };
  }

  return null;
}

function workerUrl(path: string, workerBase: string) {
  return workerBase.replace(/\/+$/, "") + path;
}

function redactUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return url.split("?")[0];
  }
}

async function tryFetch(
  target: FetchTarget,
  opts: { method?: string; body?: string; timeoutMs: number },
  dispatcher?: ProxyAgent,
): Promise<UndiciResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    return await undiciFetch(target.url, {
      method: opts.method,
      body: opts.body,
      signal: ctrl.signal,
      headers: target.headers,
      dispatcher,
    });
  } finally {
    clearTimeout(timer);
  }
}

function configuredAttemptOrder(config: ResolvedAcgProxyConfig): AcgFetchSource[] {
  if (!config.proxyUrl) {
    return [];
  }

  if (config.mode === "worker") {
    return ["worker"];
  }

  try {
    const protocol = new URL(config.proxyUrl).protocol;
    return protocol === "http:" ? ["http-proxy", "worker"] : ["worker", "http-proxy"];
  } catch {
    return ["http-proxy", "worker"];
  }
}

function buildConfiguredAttempt(
  source: AcgFetchSource,
  config: ResolvedAcgProxyConfig,
  path: string,
  officialTarget: FetchTarget | null,
  fallbackHeaders: Record<string, string>,
): FetchAttempt | null {
  if (!config.proxyUrl) {
    return null;
  }

  if (source === "http-proxy") {
    if (!officialTarget) {
      return null;
    }
    return {
      source,
      target: {
        ...officialTarget,
        label: `${officialTarget.label} via HTTP proxy`,
      },
      dispatcher: new ProxyAgent(config.proxyUrl),
    };
  }

  if (source === "worker") {
    const rewrittenUrl = officialTarget
      ? rewriteUrlForProxy(officialTarget.url, config.proxyUrl)
      : workerUrl(path, config.proxyUrl);
    if (officialTarget && rewrittenUrl === officialTarget.url) {
      return null;
    }
    return {
      source,
      target: {
        label: officialTarget ? `${officialTarget.label} via Worker` : "Configured Worker",
        url: rewrittenUrl,
        headers: officialTarget?.headers ?? fallbackHeaders,
      },
    };
  }

  return null;
}

function buildConfiguredAttempts(
  config: ResolvedAcgProxyConfig,
  path: string,
  officialTarget: FetchTarget | null,
  fallbackHeaders: Record<string, string>,
): FetchAttempt[] {
  const seen = new Set<string>();
  const attempts: FetchAttempt[] = [];

  for (const source of configuredAttemptOrder(config)) {
    const attempt = buildConfiguredAttempt(source, config, path, officialTarget, fallbackHeaders);
    if (!attempt) {
      continue;
    }
    const key = `${attempt.source}:${attempt.target.url}`;
    if (!seen.has(key)) {
      seen.add(key);
      attempts.push(attempt);
    }
  }

  return attempts;
}

async function runAttempt(
  attempt: FetchAttempt,
  opts: { method?: string; body?: string; timeoutMs: number; onAttempt?: (attempt: AcgFetchAttemptRecord) => void },
): Promise<UndiciResponse> {
  const started = Date.now();
  try {
    log.info(`Fetch ${attempt.target.label}: ${redactUrl(attempt.target.url)}`);
    const res = await tryFetch(attempt.target, { method: opts.method, body: opts.body, timeoutMs: opts.timeoutMs }, attempt.dispatcher);
    opts.onAttempt?.({
      source: attempt.source,
      label: attempt.target.label,
      url: redactUrl(attempt.target.url),
      durationMs: Date.now() - started,
      ok: res.ok,
      status: res.status,
    });
    if (!res.ok) {
      log.warn(`${attempt.target.label} HTTP ${res.status}`);
    }
    return res;
  } catch (err: any) {
    const message = err.cause?.code || err.message || "Fetch failed";
    opts.onAttempt?.({
      source: attempt.source,
      label: attempt.target.label,
      url: redactUrl(attempt.target.url),
      durationMs: Date.now() - started,
      ok: false,
      error: message,
    });
    log.warn(`${attempt.target.label} failed: ${message}`);
    throw err;
  }
}

export async function acgFetch(
  path: string,
  opts?: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
    timeout?: number;
    policy?: AcgFetchPolicy;
    onAttempt?: (attempt: AcgFetchAttemptRecord) => void;
  }
): Promise<UndiciResponse> {
  const timeoutMs = opts?.timeout ?? TIMEOUT;
  const baseHeaders = {
    "User-Agent": process.env.ACG_USER_AGENT || "CiYuanNav/1.0 (+https://github.com/wssqian/guga-)",
    ...opts?.headers,
  };
  const config = resolveAcgProxyConfig(db);
  const officialTarget = resolveOfficialTarget(path, baseHeaders);
  if (!officialTarget) {
    throw new Error(`Unsupported ACG upstream path: ${path.split("?")[0]}`);
  }
  const policy = opts?.policy ?? "configured-first";
  const configuredAttempts = policy === "direct-only"
    ? []
    : buildConfiguredAttempts(config, path, officialTarget, baseHeaders);
  const directAttempt: FetchAttempt = { source: "direct", target: officialTarget };
  const attempts = policy === "configured-only"
    ? configuredAttempts
    : policy === "direct-only"
      ? [directAttempt]
      : [...configuredAttempts, directAttempt];
  let lastResponse: UndiciResponse | null = null;

  if (attempts.length === 0) {
    throw new Error("ACG proxy is not configured");
  }

  for (const attempt of attempts) {
    try {
      const res = await runAttempt(attempt, {
        method: opts?.method,
        body: opts?.body,
        timeoutMs,
        onAttempt: opts?.onAttempt,
      });
      if (res.ok) {
        return res;
      }
      lastResponse = res;
    } catch {
      // Try the next configured route or direct fallback.
    }
  }

  if (lastResponse) return lastResponse;
  throw new Error("All ACG upstream fetch attempts failed");
}
