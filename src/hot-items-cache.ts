/**
 * 热点内容模块级缓存工具
 *
 * 设计意图：模仿导航界面的缓存机制——加载一次后在会话期间复用，
 * 切换搜索/导航模式时组件卸载重建但缓存不丢失，用户无需等待网络请求。
 *
 * 采用 stale-while-revalidate 策略：
 *   - 缓存有效 → 直接使用旧数据，无 loading，不发网络请求
 *   - 缓存过期 → 同样先展示旧数据（如有），同时发起网络请求
 *   - 无缓存 → 正常 loading → fetch → 写入缓存
 */

export interface HotItemsCache {
  items: Record<string, unknown[]>;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 分钟（服务端每小时更新一次）

let cache: HotItemsCache | null = null;

/** 重置缓存（测试用） */
export function resetHotItemsCache(): void {
  cache = null;
}

/** 获取当前缓存；无缓存时返回 null，过期仍返回旧数据供 stale-while-revalidate 使用 */
export function getHotItemsCache(): HotItemsCache | null {
  return cache;
}

/** 判断缓存是否在 TTL 内有效 */
export function isHotItemsCacheValid(ttlMs = DEFAULT_TTL_MS): boolean {
  return cache !== null && cache.expiresAt > Date.now();
}

/** 判断当前是否需要请求热点接口；有效缓存命中时不请求 */
export function shouldFetchHotItems(ttlMs = DEFAULT_TTL_MS): boolean {
  return !isHotItemsCacheValid(ttlMs);
}

/** 写入 / 更新缓存 */
export function setHotItemsCache(
  items: Record<string, unknown[]>,
  ttlMs = DEFAULT_TTL_MS,
): void {
  cache = { items, expiresAt: Date.now() + ttlMs };
}
