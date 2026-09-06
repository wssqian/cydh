import type { SearchGroupId } from "./search-experience";

export interface SearchHistoryEntry {
  /** 搜索关键词 */
  query: string;
  /** 搜索分组 ID */
  groupId: SearchGroupId;
  /** 搜索来源 ID */
  targetId: string;
  /** Unix 毫秒时间戳 */
  timestamp: number;
}

const STORAGE_KEY = "search_history";
const ENABLED_KEY = "search_history_enabled";
const PROMPT_SHOWN_KEY = "search_history_prompt_shown";
const MAX_ENTRIES = 50;

// ─── 相对时间格式化 ───

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "昨天";
  if (days < 30) return `${days}天前`;
  const months = Math.floor(days / 30);
  return `${months}个月前`;
}

// ─── 读取 ───

export function loadSearchHistory(): SearchHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 过滤无效条目
    return parsed.filter(
      (e: unknown) =>
        e &&
        typeof (e as SearchHistoryEntry).query === "string" &&
        typeof (e as SearchHistoryEntry).groupId === "string" &&
        typeof (e as SearchHistoryEntry).targetId === "string" &&
        typeof (e as SearchHistoryEntry).timestamp === "number"
    );
  } catch {
    return [];
  }
}

// ─── 写入（含去重 + 上限） ───

export function saveSearchEntry(entry: Omit<SearchHistoryEntry, "timestamp">): SearchHistoryEntry[] {
  const history = loadSearchHistory();

  // 去重：相同 (query + groupId + targetId) 的旧记录移至顶部并更新时间戳
  const dupIndex = history.findIndex(
    (e) => e.query === entry.query && e.groupId === entry.groupId && e.targetId === entry.targetId
  );
  if (dupIndex !== -1) {
    history.splice(dupIndex, 1);
  }

  // 追加到数组头部
  history.unshift({
    ...entry,
    timestamp: Date.now(),
  });

  // 上限裁剪
  const trimmed = history.slice(0, MAX_ENTRIES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  return trimmed;
}

// ─── 删除单条 ───

export function deleteSearchEntry(index: number): SearchHistoryEntry[] {
  const history = loadSearchHistory();
  if (index >= 0 && index < history.length) {
    history.splice(index, 1);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  }
  return history;
}

// ─── 清空全部 ───

export function clearSearchHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ─── 开关状态 ───

export function isSearchHistoryEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === "true";
}

export function setSearchHistoryEnabled(val: boolean): void {
  localStorage.setItem(ENABLED_KEY, val ? "true" : "false");
}

// ─── 首次提示标记 ───

export function isSearchHistoryPromptShown(): boolean {
  return localStorage.getItem(PROMPT_SHOWN_KEY) === "true";
}

export function markSearchHistoryPromptShown(): void {
  localStorage.setItem(PROMPT_SHOWN_KEY, "true");
}