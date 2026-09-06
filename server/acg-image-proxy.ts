import type { RequestHandler } from "express";
import { rewriteUrlForProxy, resolveAcgProxyConfig } from "./acg-features-settings";
import db from "./db";

type AcgImageKind = "bangumi" | "manga" | "gal" | "pixiv";

interface AcgImageSpec {
  label: string;
  allowedHosts: Set<string>;
  preferWorker: boolean;
}

const IMAGE_CACHE_CONTROL = "public, max-age=86400";
const FAILURE_CACHE_CONTROL = "no-store";

const IMAGE_SPECS: Record<AcgImageKind, AcgImageSpec> = {
  bangumi: {
    label: "Bangumi cover",
    allowedHosts: new Set(["lain.bgm.tv"]),
    preferWorker: true,
  },
  manga: {
    label: "MangaDex cover",
    allowedHosts: new Set(["uploads.mangadex.org"]),
    preferWorker: false,
  },
  gal: {
    label: "VNDB cover",
    allowedHosts: new Set(["t.vndb.org", "s2.vndb.org", "vndb.org"]),
    preferWorker: false,
  },
  pixiv: {
    label: "Pixiv image",
    allowedHosts: new Set(["i.pximg.net", "i.pximg.org", "s.pximg.net"]),
    preferWorker: true,
  },
};

function withImageCdn(targetUrl: string, kind: AcgImageKind): string | null {
  // i0.wp.com CDN confirmed broken for Pixiv original images (always 404).
  // Return i.pximg.net directly, letting user's Clash route the request.
  if (kind === "pixiv" && targetUrl.includes("/img-original/")) {
    return targetUrl;
  }
  const parsed = new URL(targetUrl);
  const host = kind === "pixiv" && parsed.hostname.toLowerCase() === "i.pximg.net"
    ? "i.pximg.org"
    : parsed.hostname.toLowerCase();
  const cdnUrl = new URL(`https://i0.wp.com/${host}${parsed.pathname}`);
  cdnUrl.search = parsed.search;

  if (kind === "bangumi") {
    cdnUrl.searchParams.set("ssl", "1");
  }

  return cdnUrl.toString();
}

function pixivWorkerImageUrl(targetUrl: string): string | null {
  if (!process.env.PIXIV_IMAGE_PROXY_BASE) {
    return null;
  }
  const parsed = new URL(targetUrl);
  const base = process.env.PIXIV_IMAGE_PROXY_BASE.replace(/\/+$/, "");
  return `${base}/pixiv-img${parsed.pathname}${parsed.search}`;
}

function canUseConfiguredWorker(proxyUrl: string | undefined, mode: string): boolean {
  if (!proxyUrl) {
    return false;
  }
  if (mode === "worker") {
    return true;
  }
  try {
    return new URL(proxyUrl).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeTargetUrl(value: unknown, spec: AcgImageSpec): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return null;
  }

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !spec.allowedHosts.has(host)) {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }

    parsed.protocol = "https:";
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * 把目标 URL 按 Worker / CF CDN 策略解析为浏览器可直接 fetch 的最终 URL。
 * Pixiv 优先用显式 `PIXIV_IMAGE_PROXY_BASE` Worker；其次按配置走 Worker 反代；
 * 都不适用时用 CF CDN 镜像（i0.wp.com）。
 */
function resolveBrowserImageUrl(targetUrl: string, kind: AcgImageKind, spec: AcgImageSpec): string {
  const config = resolveAcgProxyConfig(db);

  // Pixiv 单独优先：显式 `PIXIV_IMAGE_PROXY_BASE` 环境变量（专用图床 Worker）最高优先级
  if (kind === "pixiv") {
    const explicitPixivWorker = pixivWorkerImageUrl(targetUrl);
    if (explicitPixivWorker) {
      return explicitPixivWorker;
    }
  }

  // 已配 Worker 反代且该 kind 允许走 Worker（preferWorker）→ 改写为 Worker URL
  if (spec.preferWorker && canUseConfiguredWorker(config.proxyUrl, config.mode)) {
    const rewritten = rewriteUrlForProxy(targetUrl, config.proxyUrl!);
    if (rewritten !== targetUrl) {
      return rewritten;
    }
  }

  // 未配 Worker / 该 kind 不走 Worker → CF CDN（i0.wp.com 镜像）
  const cdnUrl = withImageCdn(targetUrl, kind);
  if (cdnUrl) {
    return cdnUrl;
  }

  return targetUrl;
}

export function createAcgImageRedirectHandler(kind: AcgImageKind): RequestHandler {
  const spec = IMAGE_SPECS[kind];

  return (req, res) => {
    const targetUrl = normalizeTargetUrl(req.query.url, spec);
    if (!targetUrl) {
      res.set("Cache-Control", FAILURE_CACHE_CONTROL);
      res.status(400).json({ error: `Invalid ${spec.label} URL` });
      return;
    }

    const browserUrl = resolveBrowserImageUrl(targetUrl, kind, spec);
    res.set("Cache-Control", IMAGE_CACHE_CONTROL);
    res.redirect(302, browserUrl);
  };
}
