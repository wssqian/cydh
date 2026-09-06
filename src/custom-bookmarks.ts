/**
 * 自定义收藏网址模块
 *
 * 零服务器依赖，纯 localStorage 存储。
 * 用户自行添加任意网址，自动识别网站 favicon 作为图标。
 */

export interface CustomBookmark {
  id: string;
  url: string;
  title: string;
  iconUrl: string;
  createdAt: number;
}

const STORAGE_KEY = "customBookmarks";
const CHANGED_EVENT = "customBookmarksChanged";

/** 生成简短唯一 ID */
function generateId(): string {
  return `cb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 根据 URL 提取域名作为默认标题 */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    // 移除 www. 前缀
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** 根据 URL 生成 favicon 图标 URL（Google Favicons 服务） */
export function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  } catch {
    return "https://placehold.co/48x48/png?text=Link";
  }
}

/** 标准化 URL（补全协议） */
export function normalizeUrl(url: string): string {
  url = url.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }
  return url;
}

/** 校验 URL 是否合法 */
export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** 从 localStorage 加载所有自定义收藏 */
export function loadCustomBookmarks(): CustomBookmark[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is CustomBookmark => {
      return (
        item &&
        typeof item.id === "string" &&
        typeof item.url === "string" &&
        typeof item.title === "string"
      );
    });
  } catch {
    return [];
  }
}

/** 保存自定义收藏到 localStorage */
export function saveCustomBookmarks(bookmarks: CustomBookmark[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
  } catch { /* ignore quota errors */ }
}

/** 添加一条自定义收藏 */
export function addCustomBookmark(url: string, title?: string): CustomBookmark {
  const normalizedUrl = normalizeUrl(url);
  const bookmark: CustomBookmark = {
    id: generateId(),
    url: normalizedUrl,
    title: title || extractDomain(normalizedUrl),
    iconUrl: getFaviconUrl(normalizedUrl),
    createdAt: Date.now(),
  };
  const bookmarks = loadCustomBookmarks();
  bookmarks.push(bookmark);
  saveCustomBookmarks(bookmarks);
  window.dispatchEvent(new Event(CHANGED_EVENT));
  return bookmark;
}

/** 删除一条自定义收藏 */
export function removeCustomBookmark(id: string): void {
  const bookmarks = loadCustomBookmarks();
  const filtered = bookmarks.filter((b) => b.id !== id);
  if (filtered.length !== bookmarks.length) {
    saveCustomBookmarks(filtered);
    window.dispatchEvent(new Event(CHANGED_EVENT));
  }
}

/** 更新自定义收藏的标题 */
export function updateCustomBookmarkTitle(id: string, title: string): void {
  const bookmarks = loadCustomBookmarks();
  const bookmark = bookmarks.find((b) => b.id === id);
  if (bookmark) {
    bookmark.title = title;
    saveCustomBookmarks(bookmarks);
    window.dispatchEvent(new Event(CHANGED_EVENT));
  }
}

/** 订阅自定义收藏变化（同页自定义事件 + 跨标签页 storage） */
export function subscribeCustomBookmarksChanged(callback: () => void): () => void {
  const handle = () => callback();
  window.addEventListener(CHANGED_EVENT, handle);
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) callback();
  });
  return () => {
    window.removeEventListener(CHANGED_EVENT, handle);
    window.removeEventListener("storage", handle);
  };
}
