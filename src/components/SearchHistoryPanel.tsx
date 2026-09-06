import { Search, Trash2, X, ChevronDown, ChevronUp, Globe, Film, Download, BookOpen, Image, ScanSearch, Wrench } from "lucide-react";
import { useState, useCallback } from "react";
import {
  loadSearchHistory,
  deleteSearchEntry,
  clearSearchHistory,
  formatRelativeTime,
  type SearchHistoryEntry,
} from "../search-history";
import {
  findSearchGroup,
  findSearchTarget,
  SEARCH_GROUP_ICON_NAMES,
} from "../search-experience";

// 搜索分组图标映射（与 UnifiedSearchView 保持一致的常量）
const GROUP_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Globe, Film, Download, BookOpen, Image, ScanSearch, Wrench,
};

interface SearchHistoryPanelProps {
  /** 当前搜索框中的文字，用于匹配高亮 */
  currentQuery?: string;
  /** 点击历史记录时回调：填充关键词、分组、来源，并可选自动搜索 */
  onReuse: (entry: SearchHistoryEntry, autoSearch: boolean) => void;
  /** 刷新信号：外部删除/清空后通知父组件更新状态 */
  onRefreshNeeded?: () => void;
}

export function SearchHistoryPanel({
  currentQuery = "",
  onReuse,
  onRefreshNeeded,
}: SearchHistoryPanelProps) {
  const [history, setHistory] = useState<SearchHistoryEntry[]>(() => loadSearchHistory());
  const [collapsed, setCollapsed] = useState(true);

  const refresh = useCallback(() => {
    setHistory(loadSearchHistory());
    onRefreshNeeded?.();
  }, [onRefreshNeeded]);

  const handleDelete = (timestamp: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const history = loadSearchHistory();
    const idx = history.findIndex((e) => e.timestamp === timestamp);
    if (idx !== -1) deleteSearchEntry(idx);
    refresh();
  };

  const handleClearAll = () => {
    clearSearchHistory();
    refresh();
  };

  const handleItemClick = (entry: SearchHistoryEntry) => {
    onReuse(entry, true);
  };

  const handleTextClick = (entry: SearchHistoryEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    onReuse(entry, false);
  };

  // 过滤：当有搜索框输入时，仅显示匹配关键词的记录
  const filtered = currentQuery.trim()
    ? history.filter((e) => e.query.toLowerCase().includes(currentQuery.trim().toLowerCase()))
    : history;

  if (history.length === 0) return null;

  return (
    <div className="search-history-section">
      {/* 移动端折叠切换按钮 */}
      <div className="search-history-collapse-toggle lg:hidden">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1.5 rounded-full glass-card glass-hover px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 transition-colors"
        >
          <Search className="h-3.5 w-3.5" />
          <span>搜索历史</span>
          <span className="text-pink-500 dark:text-pink-400">{history.length}</span>
          {collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </button>
      </div>

      {/* 面板主体 */}
      <div className={`search-history-panel ${collapsed ? "hidden lg:block" : "block"} mt-2 lg:mt-3`}>
        {/* 桌面端标题栏 */}
        <div className="search-history-header mb-2 hidden items-center justify-between px-1 lg:flex">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            <Search className="h-3.5 w-3.5" />
            <span>搜索历史</span>
            <span className="text-pink-500 dark:text-pink-400">{history.length}</span>
          </div>
          <button
            type="button"
            onClick={handleClearAll}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            <span>清空全部</span>
          </button>
        </div>

        {/* 记录列表 */}
        {filtered.length === 0 ? (
          <div className="search-history-empty py-4 text-center text-xs text-slate-400 dark:text-slate-500">
            {currentQuery.trim() ? "无匹配的搜索记录" : "暂无搜索历史"}
          </div>
        ) : (
          <div className="search-history-list flex flex-col gap-1">
            {filtered.map((entry, index) => {
              const group = findSearchGroup(entry.groupId);
              const target = findSearchTarget(entry.groupId, entry.targetId);
              const GroupIcon = GROUP_ICON_MAP[SEARCH_GROUP_ICON_NAMES[entry.groupId]] || Globe;
              const isMatch = currentQuery.trim() !== "";

              return (
                <div
                  key={`${entry.timestamp}-${index}`}
                  className={`search-history-item group flex items-center gap-3 rounded-xl px-3 py-2.5 cursor-pointer transition-all duration-200 glass-card glass-hover ${
                    isMatch ? "ring-1 ring-pink-400/30 dark:ring-pink-500/20" : ""
                  }`}
                  onClick={() => handleItemClick(entry)}
                  title={`${group.label} → ${target.label}: ${entry.query}`}
                >
                  {/* 分组图标 */}
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-300">
                    <GroupIcon className="h-3.5 w-3.5" />
                  </span>

                  {/* 关键词 + 来源信息 */}
                  <div className="flex min-w-0 flex-1 flex-col" onClick={(e) => handleTextClick(entry, e)}>
                    <span className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                      {entry.query}
                    </span>
                    <span className="truncate text-xs text-slate-400 dark:text-slate-500">
                      {group.label} · {target.label} · {formatRelativeTime(entry.timestamp)}
                    </span>
                  </div>

                  {/* 删除按钮 */}
                  <button
                    type="button"
                    onClick={(e) => handleDelete(entry.timestamp, e)}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                    aria-label="删除此条搜索记录"
                    title="删除"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* 移动端清空按钮（仅在展开时显示） */}
        <div className="search-history-mobile-clear mt-2 flex lg:hidden justify-center">
          <button
            type="button"
            onClick={handleClearAll}
            className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            <span>清空全部</span>
          </button>
        </div>
      </div>
    </div>
  );
}