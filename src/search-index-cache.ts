/**
 * 搜索索引模块级缓存
 *
 * 与 hot-items-cache.ts 设计思路一致：
 * 首次加载后在会话期间复用，SearchModal 卸载重建时缓存不丢失。
 */

import Fuse from "fuse.js";
import type { SiteResponse } from "./types";

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 分钟

interface SearchIndexCache {
  fuse: Fuse<SiteResponse>;
  rawSites: SiteResponse[];
  expiresAt: number;
}

let cache: SearchIndexCache | null = null;

export function getCachedSearchIndex(): Fuse<SiteResponse> | null {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.fuse;
  }
  // 过期但仍可用（stale-while-revalidate 模式下可继续使用旧索引）
  return cache?.fuse ?? null;
}

export function isSearchIndexValid(): boolean {
  return cache !== null && cache.expiresAt > Date.now();
}

export function setSearchIndexCache(sites: SiteResponse[]): Fuse<SiteResponse> {
  const fuse = new Fuse(sites, {
    keys: ["name", "description", "tags", "category_name"],
    threshold: 0.3,
  });
  cache = {
    fuse,
    rawSites: sites,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  return fuse;
}

export function resetSearchIndexCache(): void {
  cache = null;
}
