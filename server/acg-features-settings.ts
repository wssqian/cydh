/**
 * ACG proxy settings module
 * Supports two proxy modes:
 * 1. HTTP proxy (e.g. http://127.0.0.1:7890) via undici ProxyAgent
 * 2. Worker URL reverse proxy (e.g. https://acg-proxy.xxx.workers.dev) via URL rewriting
 */

import type Database from "better-sqlite3";
import { execFileSync } from "node:child_process";

export interface AcgFeaturesSettings {
  acg_proxy_enabled: boolean;
  acg_proxy_url: string;
  gal_search_enabled: boolean;
}

export type AcgProxyMode = "worker" | "auto";

export interface ResolvedAcgProxyConfig {
  proxyUrl: string | undefined;
  mode: AcgProxyMode;
  isWorker: boolean;
  source: "env" | "settings" | "system" | "none";
}

const DEFAULT_SETTINGS: AcgFeaturesSettings = {
  acg_proxy_enabled: false,
  acg_proxy_url: "",
  gal_search_enabled: false,
};

const SETTINGS_KEYS = ["acg_proxy_enabled", "acg_proxy_url", "gal_search_enabled"] as const;

export function readAcgFeaturesSettings(database: Database.Database): AcgFeaturesSettings {
  const rows = database
    .prepare(`SELECT key, value FROM settings WHERE key IN (${SETTINGS_KEYS.map(() => "?").join(",")})`)
    .all(...SETTINGS_KEYS) as Array<{ key: string; value: string }>;

  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    acg_proxy_enabled: map.get("acg_proxy_enabled") === "true",
    acg_proxy_url: map.get("acg_proxy_url") || "",
    gal_search_enabled: map.get("gal_search_enabled") === "true",
  };
}

export function resolveAcgProxyUrl(database: Database.Database): string | undefined {
  const envProxy = process.env.ACG_PROXY_URL?.trim();
  if (envProxy && process.env.ACG_PROXY_ENABLED !== "false") {
    return envProxy;
  }

  const settings = readAcgFeaturesSettings(database);
  if (!settings.acg_proxy_enabled || !settings.acg_proxy_url.trim()) {
    return undefined;
  }
  return settings.acg_proxy_url.trim();
}

function withHttpScheme(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^socks/i.test(trimmed)) {
    return undefined;
  }
  return `http://${trimmed}`;
}

function parseProxyServerValue(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const segments = trimmed.split(";").map((segment) => segment.trim()).filter(Boolean);
  const keyed = new Map<string, string>();
  for (const segment of segments) {
    const index = segment.indexOf("=");
    if (index > 0) {
      keyed.set(segment.slice(0, index).toLowerCase(), segment.slice(index + 1));
    }
  }

  return withHttpScheme(keyed.get("https") || keyed.get("http") || (keyed.size === 0 ? trimmed : ""));
}

function parseRegQueryValue(output: string, valueName: string): string | undefined {
  const line = output.split(/\r?\n/).find((entry) => entry.trim().toLowerCase().startsWith(valueName.toLowerCase()));
  if (!line) {
    return undefined;
  }
  const match = line.match(/^\s*\S+\s+\S+\s+(.+?)\s*$/);
  return match?.[1]?.trim();
}

function readWindowsSystemProxyUrl(): string | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }
  try {
    const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
    const enableOutput = execFileSync("reg", ["query", key, "/v", "ProxyEnable"], {
      encoding: "utf8",
      timeout: 1000,
      windowsHide: true,
    });
    const enabled = parseRegQueryValue(enableOutput, "ProxyEnable");
    if (!enabled || !/^0x1$/i.test(enabled)) {
      return undefined;
    }

    const serverOutput = execFileSync("reg", ["query", key, "/v", "ProxyServer"], {
      encoding: "utf8",
      timeout: 1000,
      windowsHide: true,
    });
    const proxyServer = parseRegQueryValue(serverOutput, "ProxyServer");
    return proxyServer ? parseProxyServerValue(proxyServer) : undefined;
  } catch {
    return undefined;
  }
}

export function resolveSystemProxyUrl(): string | undefined {
  const envProxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy;
  return (envProxy ? withHttpScheme(envProxy) : undefined) || readWindowsSystemProxyUrl();
}

export function resolveAcgProxyConfig(database: Database.Database): ResolvedAcgProxyConfig {
  const envProxy = process.env.ACG_PROXY_URL?.trim();
  if (envProxy && process.env.ACG_PROXY_ENABLED !== "false") {
    const mode = classifyAcgProxyUrl(envProxy);
    return { proxyUrl: envProxy, mode, isWorker: mode === "worker", source: "env" };
  }

  const settings = readAcgFeaturesSettings(database);
  if (!settings.acg_proxy_enabled) {
    return { proxyUrl: undefined, mode: "auto", isWorker: false, source: "none" };
  }

  const settingsProxy = settings.acg_proxy_url.trim();
  if (settingsProxy) {
    const mode = classifyAcgProxyUrl(settingsProxy);
    return { proxyUrl: settingsProxy, mode, isWorker: mode === "worker", source: "settings" };
  }

  const systemProxy = resolveSystemProxyUrl();
  if (!systemProxy) {
    return { proxyUrl: undefined, mode: "auto", isWorker: false, source: "none" };
  }
  return { proxyUrl: systemProxy, mode: "auto", isWorker: false, source: "system" };
}

export function validateAcgProxyUrl(proxyUrl: string): void {
  const parsed = new URL(proxyUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("ACG proxy URL must use http or https");
  }
}

/** Detect URLs that are explicitly Cloudflare Worker reverse proxies. */
export function classifyAcgProxyUrl(proxyUrl: string): AcgProxyMode {
  try {
    const parsed = new URL(proxyUrl);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (parsed.hostname.toLowerCase().endsWith(".workers.dev") || pathname.length > 0) {
      return "worker";
    }
    return "auto";
  } catch {
    return "auto";
  }
}

/** Rewrite external API URL to go through Worker proxy */
export function rewriteUrlForProxy(originalUrl: string, proxyBaseUrl: string): string {
  const base = proxyBaseUrl.replace(/\/+$/, "");

  if (originalUrl.startsWith("https://api.bgm.tv")) {
    return base + "/bangumi" + originalUrl.slice("https://api.bgm.tv".length);
  }
  if (originalUrl.startsWith("https://api.mangadex.org")) {
    return base + "/mangadex" + originalUrl.slice("https://api.mangadex.org".length);
  }
  if (originalUrl.startsWith("https://uploads.mangadex.org")) {
    return base + "/mangadex-cover" + originalUrl.slice("https://uploads.mangadex.org".length);
  }
  if (originalUrl.startsWith("https://lain.bgm.tv")) {
    return base + "/bangumi-cover" + originalUrl.slice("https://lain.bgm.tv".length);
  }
  if (originalUrl.startsWith("https://api.vndb.org")) {
    return base + "/vndb" + originalUrl.slice("https://api.vndb.org".length);
  }
  if (originalUrl.startsWith("https://www.pixiv.net")) {
    return base + "/pixiv" + originalUrl.slice("https://www.pixiv.net".length);
  }
  if (originalUrl.startsWith("https://i.pximg.net") || originalUrl.startsWith("https://i.pximg.org")) {
    const parsed = new URL(originalUrl);
    return base + "/pixiv-img" + parsed.pathname + parsed.search;
  }
  if (originalUrl.startsWith("https://t.vndb.org")) {
    return base + "/vndb-img" + new URL(originalUrl).pathname;
  }
  if (originalUrl.startsWith("https://s2.vndb.org") || originalUrl.startsWith("https://vndb.org")) {
    return base + "/vndb-cover" + new URL(originalUrl).pathname;
  }

  return originalUrl;
}
