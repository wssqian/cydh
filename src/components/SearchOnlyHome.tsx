import { ActionSheet, type ActionSheetItem } from "./ActionSheet";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { Search, Moon, Sun, Gamepad2, ChevronDown, Globe, Film, Download, BookOpen, Image, ScanSearch, Wrench, Star, Plus, X, ExternalLink, Trash2 } from "lucide-react";
import {
  buildSearchTargetUrl,
  DEFAULT_SEARCH_GROUP_ID,
  findSearchGroup,
  findSearchTarget,
  SEARCH_GROUPS,
  type SearchGroupId,
} from "../search-experience";
import { useGroup } from "../context";
import { WeatherCard } from "./WeatherCard";
import { HotContentSection } from "./HotContentSection";
import { readColorModePreference, saveColorModePreference } from "../ui-theme";
import { SearchProviderSheet } from "./SearchProviderSheet";
import { LazyResourceCard } from "./LazyResourceCard";
import { FAVORITES_GROUP_LABEL } from "../favorites";
import {
  type CustomBookmark,
  loadCustomBookmarks,
  addCustomBookmark,
  removeCustomBookmark,
  updateCustomBookmarkTitle,
  subscribeCustomBookmarksChanged,
  getFaviconUrl,
  normalizeUrl,
  isValidUrl,
} from "../custom-bookmarks";

// GAL 搜索面板 — 仅在用户主动开启 GAL 模式时才加载
const GalSearchPanel = lazy(() => import("./GalSearchPanel").then((m) => ({ default: m.GalSearchPanel })));

const GROUP_ICONS: Record<SearchGroupId, typeof Globe> = {
  web: Globe,
  anime: Film,
  download: Download,
  manga: BookOpen,
  image: Image,
  reverseImage: ScanSearch,
  tools: Wrench,
};

function openSearchResult(url: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.click();
}

// ─── 自定义收藏卡片 ───────────────────────────────────

function CustomBookmarkCard({ bookmark, onRemove }: { bookmark: CustomBookmark; onRemove: (id: string) => void }) {
  return (
    <div className="group relative">
      <a
        href={bookmark.url}
        target="_blank"
        rel="noopener noreferrer"
        className="resource-card interactive-card flex flex-row items-center gap-3 overflow-hidden rounded-2xl p-3.5 glass-card transition-all hover:-translate-y-0.5"
      >
        <img
          src={bookmark.iconUrl}
          alt={bookmark.title}
          className="resource-card-icon liquid-chip w-9 h-9 rounded-full object-cover shrink-0 p-0.5"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).src = "https://placehold.co/48x48/png?text=Link";
          }}
        />
        <div className="flex-1 min-w-0">
          <h3 className="resource-card-title text-sm font-bold text-slate-800 dark:text-slate-100 truncate group-hover:text-pink-500 transition-colors">
            {bookmark.title}
          </h3>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
            {bookmark.url}
          </p>
        </div>
        <div className="resource-card-chevron text-slate-300 dark:text-slate-600 group-hover:text-pink-400 transition-colors shrink-0">
          <ExternalLink className="w-3.5 h-3.5" />
        </div>
      </a>
      {/* 删除按钮：hover 显示 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(bookmark.id);
        }}
        className="absolute -top-1.5 -right-1.5 z-10 w-6 h-6 rounded-full bg-red-500 text-white shadow-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
        title="删除"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

export function SearchOnlyHome() {
  const [activeGroupId, setActiveGroupId] = useState<SearchGroupId>(DEFAULT_SEARCH_GROUP_ID);
  const [activeTargetId, setActiveTargetId] = useState(findSearchGroup(DEFAULT_SEARCH_GROUP_ID).targets[0].id);
  const [query, setQuery] = useState("");
  const [isDark, setIsDark] = useState(() => readColorModePreference() === "dark");
  const [galMode, setGalMode] = useState(false);
  const [providerSheetOpen, setProviderSheetOpen] = useState(false);
  const [groupSheetOpen, setGroupSheetOpen] = useState(false);
  const { onHotContentTopChange, communityUnlocked, siteSettings, sites, favorites, onToggleFavorite } = useGroup();
  const [bottomMode, setBottomMode] = useState<"favorites" | "hot">(() => {
    try {
      const saved = localStorage.getItem("searchBottomMode");
      return saved === "hot" || saved === "favorites" ? saved : "favorites";
    } catch {
      return "favorites";
    }
  });
  const [customBookmarks, setCustomBookmarks] = useState<CustomBookmark[]>(loadCustomBookmarks);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newUrlError, setNewUrlError] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);
  const hotContentRef = useRef<HTMLDivElement>(null);

  // 收藏的网址列表（系统收藏 + 自定义收藏）
  const favoriteSites = sites.filter((site) => favorites.has(site.id));
  const hasAnyFavorites = favoriteSites.length > 0 || customBookmarks.length > 0;
  const searchBtnRef = useRef<HTMLButtonElement>(null);
  const animatingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const galSearchAvailable = communityUnlocked && siteSettings.gal_search_enabled;

  // 持久化底部区域切换模式
  useEffect(() => {
    localStorage.setItem("searchBottomMode", bottomMode);
  }, [bottomMode]);

  // 订阅自定义收藏变化
  useEffect(() => {
    return subscribeCustomBookmarksChanged(() => {
      setCustomBookmarks(loadCustomBookmarks());
    });
  }, []);

  // 展开添加表单时自动聚焦输入框
  useEffect(() => {
    if (showAddForm && addInputRef.current) {
      addInputRef.current.focus();
    }
  }, [showAddForm]);

  useEffect(() => {
    if (!galSearchAvailable) setGalMode(false);
  }, [galSearchAvailable]);

  const activeGroup = findSearchGroup(activeGroupId);
  const activeTarget = findSearchTarget(activeGroupId, activeTargetId);
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;

  // 缓存搜索分类/来源标签，避免输入框每次输入都重建整组按钮
  const desktopGroupTabs = useMemo(
    () =>
      SEARCH_GROUPS.map((group) => (
        <button
          key={group.id}
          type="button"
          onClick={() => setActiveGroupId(group.id)}
          className={`search-tab shrink-0 whitespace-nowrap px-5 py-2.5 text-base font-medium sm:px-6 sm:text-lg transition-[color,transform,opacity] ${
            activeGroupId === group.id
              ? "liquid-button-primary search-tab-active"
              : "liquid-button glass-hover text-slate-600 hover:text-pink-500 dark:text-slate-300"
          }`}
        >
          {group.label}
        </button>
      )),
    [activeGroupId],
  );

  const providerTabs = useMemo(
    () =>
      activeGroup.targets.map((target) => (
        <button
          key={target.id}
          type="button"
          onClick={() => setActiveTargetId(target.id)}
          className={`search-provider shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium sm:px-5 sm:text-base transition-[color,transform,opacity] ${
            activeTarget.id === target.id
              ? "liquid-button-primary search-provider-active"
              : "liquid-button glass-hover text-slate-600 hover:text-pink-500 dark:text-slate-300"
          }`}
        >
          {target.label}
        </button>
      )),
    [activeGroup, activeTarget],
  );

  const mobileGroupLabel = activeGroup.mobileLabel || activeGroup.label;
  const MobileGroupIcon = GROUP_ICONS[activeGroupId] || Globe;

  useEffect(() => {
    const firstTarget = findSearchGroup(activeGroupId).targets[0];
    setActiveTargetId(firstTarget.id);
  }, [activeGroupId]);

  // 测量第一个平台卡片头部的顶部位置，供看板娘精确贴合
  useEffect(() => {
    if (!onHotContentTopChange) return;
    const container = hotContentRef.current;
    if (!container || trimmedQuery) {
      onHotContentTopChange(null);
      return;
    }
    const MAX_RETRIES = 10;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let rafHandle: number | null = null;
    const measure = () => {
      rafHandle = null;
      const header = container.querySelector<HTMLElement>('[data-role="platform-card-header"]');
      if (header) {
        onHotContentTopChange(header.getBoundingClientRect().top);
        return true;
      }
      return false;
    };
    let retries = 0;
    // 5.1: getBoundingClientRect 经 rAF 调度，避免同步强制布局
    const report = () => {
      if (rafHandle !== null) return;
      rafHandle = window.requestAnimationFrame(measureForRetry);
    };
    function measureForRetry() {
      const found = measure();
      if (!found) {
        // 5.2: 重试有上限，定位成功后停止轮询
        if (retries < MAX_RETRIES) {
          retries += 1;
          retryTimer = setTimeout(report, 500);
        }
      }
    }
    report();
    const observer = new ResizeObserver(report);
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
      if (retryTimer) clearTimeout(retryTimer);
      onHotContentTopChange(null);
    };
  }, [trimmedQuery, onHotContentTopChange]);

  // hasQuery 状态切换时为按钮叠加合成层提示，动效结束后复位 will-change
  useEffect(() => {
    const btn = searchBtnRef.current;
    if (!btn) return;
    btn.classList.add("is-animating");
    if (animatingTimer.current) clearTimeout(animatingTimer.current);
    // 兜底取最长动画尾部（回收 width/flex-basis 0.5s + delay 0.06s ≈ 0.56s）后复位 will-change
    animatingTimer.current = setTimeout(() => {
      btn.classList.remove("is-animating");
    }, 600);
    return () => {
      if (animatingTimer.current) clearTimeout(animatingTimer.current);
    };
  }, [hasQuery]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmedQuery) {
      return;
    }

    const targetUrl = buildSearchTargetUrl(activeTarget, trimmedQuery);
    if (targetUrl) {
      openSearchResult(targetUrl);
    }
  };

  const toggleTheme = () => {
    const nextMode = isDark ? "light" : "dark";
    saveColorModePreference(nextMode);
    setIsDark(nextMode === "dark");
  };

  const handleAddBookmark = () => {
    const url = normalizeUrl(newUrl);
    if (!url) {
      setNewUrlError("请输入网址");
      return;
    }
    if (!isValidUrl(url)) {
      setNewUrlError("请输入有效的网址（如 example.com）");
      return;
    }
    addCustomBookmark(url);
    setNewUrl("");
    setNewUrlError("");
    setShowAddForm(false);
  };

  const handleAddFormKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddBookmark();
    }
    if (e.key === "Escape") {
      setShowAddForm(false);
      setNewUrl("");
      setNewUrlError("");
    }
  };

  const handleRemoveBookmark = (id: string) => {
    removeCustomBookmark(id);
    setCustomBookmarks(loadCustomBookmarks());
  };

  return (
    <section className="search-only-section px-2 pb-4 pt-20 sm:px-4 sm:pt-20 lg:pt-0 lg:pb-0">
      <div className="search-only-inner mx-auto w-full max-w-[1920px] items-center">
        <div className="mb-3 flex justify-center"><WeatherCard /></div>

        {/* 搜索分组：桌面端标签栏 / 手机端 ActionSheet trigger */}
        <nav className="search-tabs scrollbar-hide flex w-full max-w-5xl items-center justify-start gap-3 overflow-x-auto px-2 py-2 sm:justify-center sm:gap-4" aria-label="Search categories">
          {/* 桌面端：标签栏 */}
          <div className="hidden sm:flex items-center gap-3 sm:justify-center">
            {desktopGroupTabs}
          </div>
          {/* 手机端：ActionSheet trigger */}
          <div className="flex sm:hidden items-center gap-2">
            <button
              type="button"
              onClick={() => setGroupSheetOpen(true)}
              className="search-select-trigger flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 glass-hover transition-[color,transform,opacity]"
            >
              <MobileGroupIcon className="h-3.5 w-3.5 text-pink-500 dark:text-pink-400 shrink-0" />
              <span>{mobileGroupLabel}</span>
              <ChevronDown className="h-3 w-3 text-slate-400" />
            </button>
            {/* 搜索来源选择 trigger */}
            <button
              type="button"
              onClick={() => setProviderSheetOpen(true)}
              className="search-select-trigger flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 glass-hover transition-[color,transform,opacity]"
            >
              <span className="text-pink-500 dark:text-pink-400">
                {activeGroup.targets.find((t) => t.id === activeTargetId)?.label || activeGroup.label}
              </span>
              <ChevronDown className="h-3 w-3 text-slate-400" />
            </button>
          </div>
        </nav>

        <div className="search-area w-full flex-col items-center justify-center pb-4 pt-4 sm:pb-6 sm:pt-5">
          <form
            onSubmit={submitSearch}
            className={`search-form flex w-full max-w-5xl items-stretch gap-3${hasQuery ? " search-form--has-query" : ""}`}
          >
            <input
              type="search"
              name="q"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
              placeholder={activeTarget.placeholder}
              className="search-hub-input glass liquid-input min-w-0 flex-1 rounded-full px-6 py-4 text-xl text-slate-700 placeholder:text-slate-400 sm:px-10 sm:py-5 sm:text-3xl dark:text-slate-100 dark:placeholder:text-slate-400"
            />
            <button
              ref={searchBtnRef}
              type="submit"
              className="glass-search-btn flex w-16 shrink-0 items-center justify-center rounded-full sm:w-20"
              aria-label="Search"
              aria-hidden={!hasQuery}
              tabIndex={hasQuery ? 0 : -1}
            >
              <Search className="h-7 w-7 stroke-[2.75] sm:h-9 sm:w-9 text-slate-600 dark:text-slate-200" />
            </button>
          </form>

          {/* 桌面端：来源标签栏 */}
          <div className="hidden sm:flex search-provider-row w-full max-w-5xl items-center justify-start gap-3 px-3 pt-4 sm:justify-center sm:gap-4">
            {providerTabs}
          </div>
        </div>

        {/* 底部切换栏：收藏的网址 / 热门信息 */}
        {!trimmedQuery && (
          <div className="w-full max-w-5xl mx-auto mt-4 lg:mt-2">
            {/* 切换标签 */}
            <div className="flex items-center justify-center gap-1 mb-3">
              <button
                type="button"
                onClick={() => setBottomMode("favorites")}
                className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-full transition-all ${
                  bottomMode === "favorites"
                    ? "liquid-button-primary text-white shadow-md"
                    : "liquid-button glass-hover text-slate-600 hover:text-pink-500 dark:text-slate-300"
                }`}
              >
                <Star className={`w-3.5 h-3.5 ${bottomMode === "favorites" ? "fill-white/80" : ""}`} />
                收藏的网址
                {favoriteSites.length > 0 && (
                  <span className={`text-[10px] tabular-nums ${bottomMode === "favorites" ? "text-white/80" : "text-slate-400 dark:text-slate-500"}`}>
                    {favoriteSites.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setBottomMode("hot")}
                className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-full transition-all ${
                  bottomMode === "hot"
                    ? "liquid-button-primary text-white shadow-md"
                    : "liquid-button glass-hover text-slate-600 hover:text-pink-500 dark:text-slate-300"
                }`}
              >
                热门信息
              </button>
            </div>

            {/* 内容区域 */}
            {bottomMode === "favorites" ? (
              <div ref={hotContentRef} className="w-full">
                {/* 添加网址按钮 / 表单 */}
                <div className="mb-4 flex items-center justify-center">
                  {showAddForm ? (
                    <div className="flex w-full max-w-lg items-center gap-2 glass rounded-2xl p-2">
                      <input
                        ref={addInputRef}
                        type="text"
                        value={newUrl}
                        onChange={(e) => {
                          setNewUrl(e.target.value);
                          setNewUrlError("");
                        }}
                        onKeyDown={handleAddFormKeyDown}
                        placeholder="输入网址，如 example.com 或 https://..."
                        className="flex-1 min-w-0 bg-transparent px-3 py-2 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleAddBookmark}
                        className="flex items-center gap-1 shrink-0 px-3 py-1.5 rounded-xl liquid-button-primary text-xs font-medium text-white"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        添加
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddForm(false);
                          setNewUrl("");
                          setNewUrlError("");
                        }}
                        className="shrink-0 p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowAddForm(true)}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium text-slate-600 dark:text-slate-300 glass-hover hover:text-pink-500 transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      添加网址
                    </button>
                  )}
                </div>
                {newUrlError && (
                  <div className="mb-3 text-center text-xs text-red-500">{newUrlError}</div>
                )}

                {/* 自定义收藏列表 */}
                {customBookmarks.length > 0 && (
                  <div className="mb-6">
                    <h4 className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2.5 px-1">
                      <ExternalLink className="w-3 h-3" />
                      自定义收藏
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">{customBookmarks.length}</span>
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                      {customBookmarks.map((bm) => (
                        <CustomBookmarkCard
                          key={bm.id}
                          bookmark={bm}
                          onRemove={handleRemoveBookmark}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* 系统收藏的站点 */}
                {favoriteSites.length > 0 && (
                  <div>
                    {customBookmarks.length > 0 && (
                      <h4 className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2.5 px-1">
                        <Star className="w-3 h-3" />
                        导航收藏
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">{favoriteSites.length}</span>
                      </h4>
                    )}
                    <div className="mobile-feed-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {favoriteSites.map((site, index) => (
                        <LazyResourceCard
                          key={site.id}
                          site={site}
                          isFavorited
                          onToggleFavorite={onToggleFavorite}
                          gridStagger={index}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* 没有任何收藏时的空状态 */}
                {!hasAnyFavorites && (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500 glass rounded-2xl">
                    <Star className="w-10 h-10 mb-3 text-slate-300 dark:text-slate-600" />
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-300">暂无收藏的网址</p>
                    <p className="text-xs mt-1">点击上方「添加网址」手动添加，或在导航模式下收藏站点</p>
                    <button
                      type="button"
                      onClick={() => setShowAddForm(true)}
                      className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-full liquid-button-primary text-xs font-medium text-white transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      添加第一个网址
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div ref={hotContentRef} className="w-full">
                <HotContentSection communityUnlocked={communityUnlocked} showAnimeCalendar={false} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Theme toggle button - bottom right corner */}
      <div className="fixed bottom-4 right-4 z-50 sm:bottom-6 sm:right-6">
        <button
          onClick={toggleTheme}
          className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full glass-card glass-hover text-slate-600 dark:text-slate-300 hover:text-pink-500 shadow-lg transition-all"
          aria-label="切换主题"
          title={isDark ? "切换到白天模式" : "切换到黑夜模式"}
        >
          {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
      </div>

      {/* 手机端：分组选择 ActionSheet */}
      <ActionSheet
        open={groupSheetOpen}
        onOpenChange={setGroupSheetOpen}
        title="选择搜索分类"
        items={SEARCH_GROUPS.map((g) => {
          const GIcon = GROUP_ICONS[g.id] || Globe;
          return {
            value: g.id,
            label: g.label,
            icon: <GIcon className="h-4 w-4" />,
          };
        })}
        selectedValues={activeGroupId}
        onSelect={(val) => setActiveGroupId(val as SearchGroupId)}
      />
      {/* 手机端：来源选择 Sheet */}
      <SearchProviderSheet
        open={providerSheetOpen}
        onClose={() => setProviderSheetOpen(false)}
        groupId={activeGroupId}
        activeTargetId={activeTargetId}
        onTargetChange={setActiveTargetId}
      />
    </section>
  );
}