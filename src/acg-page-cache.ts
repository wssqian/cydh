interface AcgPageCacheEntry<T> {
  savedAt: number;
  data: T;
}

export function readAcgPageCache<T>(key: string, maxAgeMs: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as AcgPageCacheEntry<T>;
    if (!entry || typeof entry.savedAt !== "number") return null;
    if (Date.now() - entry.savedAt > maxAgeMs) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export function readStaleAcgPageCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as AcgPageCacheEntry<T>;
    return entry?.data ?? null;
  } catch {
    return null;
  }
}

export function readAcgPageCacheSWR<T>(key: string, maxAgeMs: number): { data: T; isStale: boolean } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as AcgPageCacheEntry<T>;
    if (!entry || typeof entry.savedAt !== "number" || !entry.data) return null;
    return { data: entry.data, isStale: Date.now() - entry.savedAt > maxAgeMs };
  } catch {
    return null;
  }
}

export function writeAcgPageCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {}
}

/**
 * 跨 mode 后台预缓存：在页面空闲时串行预取其余 mode 的数据并写入 SWR 缓存，
 * 让用户切换 Tab 时瞬时命中。
 *
 * 设计约束：
 * - 使用 `cache:'force-cache'` 优先命中浏览器 HTTP 缓存（服务端响应携带
 *   `Cache-Control: max-age=3600`），命中则不产生对上游的新调用、不新增服务端开销。
 * - 串行 + 间隔执行，避免弱网下抢占当前视图的图片带宽；页面隐藏时通过
 *   返回的 stop() 暂停，组件卸载时清理。
 * - `navigator.connection.saveData` 为真时由调用方决定是否调用本函数。
 *
 * @param cacheKeyFn 由 mode 派生缓存键，如 (m) => `pixivPage:v4:${m}`
 * @param modes 除 active mode 外需预取的 mode 列表
 * @param fetcher 由 mode 派生一次 fetch，返回解析后的 data（失败抛错即可）
 * @param intervalMs 两次预取间隔，默认 2000ms
 * @returns stop() 取消预取（隐藏 / 卸载时调用）
 */
export function prefetchAcgModes<T>(
  cacheKeyFn: (mode: string) => string,
  modes: string[],
  fetcher: (mode: string) => Promise<T>,
  intervalMs = 2000,
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const hasIdle =
    typeof window !== "undefined" && typeof window.requestIdleCallback === "function";
  // requestIdle 回调依靠 `cancelled` 标志短路即可，无需显式取消句柄。

  const runNext = (idx: number) => {
    if (cancelled || idx >= modes.length) return;
    const scheduleWork = () => {
      if (cancelled) return;
      const mode = modes[idx];
      fetcher(mode)
        .then((data) => {
          if (!cancelled) writeAcgPageCache(cacheKeyFn(mode), data);
        })
        .catch(() => {
          /* 单个 mode 失败静默，不影响后续 */
        })
        .finally(() => {
          if (!cancelled) timer = setTimeout(() => runNext(idx + 1), intervalMs);
        });
    };
    if (hasIdle) window.requestIdleCallback(() => scheduleWork());
    else setTimeout(scheduleWork, 0);
  };

  runNext(0);

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
