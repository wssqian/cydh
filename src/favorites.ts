/**
 * 资源收藏夹模块
 *
 * 零服务器依赖，纯 localStorage 存储。
 * 设计模式与番剧订阅（animeSubscriptions）一致。
 *
 * - 收藏以 site ID（number）为键
 * - 跨标签页同步：监听 storage 事件
 * - 自定义事件 favoritesChanged 用于同页内即时更新
 */

export const FAVORITES_STORAGE_KEY = "favoriteSites";
export const FAVORITES_CHANGED_EVENT = "favoritesChanged";
export const FAVORITES_GROUP_LABEL = "我的收藏";

export function loadFavorites(): Set<number> {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return new Set();
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((v): v is number => typeof v === "number"));
  } catch {
    return new Set();
  }
}

export function saveFavorites(ids: Set<number>): void {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch { /* ignore quota errors */ }
}

export function isFavorite(ids: Set<number>, siteId: number): boolean {
  return ids.has(siteId);
}

export function toggleFavorite(current: Set<number>, siteId: number): Set<number> {
  const next = new Set(current);
  if (next.has(siteId)) {
    next.delete(siteId);
  } else {
    next.add(siteId);
  }
  saveFavorites(next);
  window.dispatchEvent(new Event(FAVORITES_CHANGED_EVENT));
  return next;
}

/** 订阅收藏变化（同页自定义事件 + 跨标签页 storage 事件） */
export function subscribeFavoritesChanged(callback: () => void): () => void {
  const handle = () => callback();
  window.addEventListener(FAVORITES_CHANGED_EVENT, handle);
  window.addEventListener("storage", handle);
  return () => {
    window.removeEventListener(FAVORITES_CHANGED_EVENT, handle);
    window.removeEventListener("storage", handle);
  };
}
