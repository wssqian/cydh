import {
  FormEvent,
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
  type ReactNode,
} from "react";
import {
  Search,
  Moon,
  Sun,
  Gamepad2,
  Globe,
  Film,
  Download,
  BookOpen,
  Image,
  ScanSearch,
  Wrench,
  ChevronDown,
  X,
} from "lucide-react";
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
import {
  readColorModePreference,
  saveColorModePreference,
} from "../ui-theme";
import {
  isSearchHistoryEnabled,
  isSearchHistoryPromptShown,
  markSearchHistoryPromptShown,
  saveSearchEntry,
  setSearchHistoryEnabled,
  type SearchHistoryEntry,
} from "../search-history";
import { SearchHistoryPanel } from "./SearchHistoryPanel";
import { SearchProviderSheet } from "./SearchProviderSheet";
import { SearchGroupSelector } from "./SearchGroupSelector";

const HotContentSection = lazy(
  () =>
    import("./HotContentSection").then((m) => ({
      default: m.HotContentSection,
    }))
);

const GalSearchPanel = lazy(
  () =>
    import("./GalSearchPanel").then((m) => ({ default: m.GalSearchPanel }))
);

// ─── 搜索分组图标映射 ───
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

// ─── 主题切换按钮 ───
function ThemeToggle({ isDark, onToggle }: { isDark: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full glass-card glass-hover text-slate-500 hover:text-pink-500 dark:text-slate-400 transition-all"
      aria-label="切换主题"
      title={isDark ? "切换到白天模式" : "切换到黑夜模式"}
    >
      {isDark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  );
}

// ═══════════════════════════════════════════════════════
// 共享头部：天气 + 主题切换 + GAL 开关
// ═══════════════════════════════════════════════════════
function SearchHeader({
  isDark,
  onToggleTheme,
  galSearchAvailable,
  galMode,
  onToggleGal,
}: {
  isDark: boolean;
  onToggleTheme: () => void;
  galSearchAvailable: boolean;
  galMode: boolean;
  onToggleGal: () => void;
}) {
  return (
    <div className="search-header flex items-center justify-between gap-3 px-1">
      <div className="search-header-weather min-w-0 flex-1 lg:max-w-sm lg:flex-none">
        <WeatherCard />
      </div>
      <div className="search-header-controls relative z-10 flex shrink-0 items-center gap-2">
        {galSearchAvailable && (
          <button
            type="button"
            onClick={onToggleGal}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
              galMode
                ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md"
                : "liquid-button glass-hover text-slate-500 hover:text-amber-500 dark:text-slate-400"
            }`}
          >
            <Gamepad2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">GAL</span>
          </button>
        )}
        <ThemeToggle isDark={isDark} onToggle={onToggleTheme} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// 紧凑搜索输入框（移动端）
// ═══════════════════════════════════════════════════════
function SearchCompactBar({
  query, onChange, onSubmit, placeholder,
}: {
  query: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
  placeholder: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim()) onSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-stretch gap-2">
      <div className="relative flex flex-1 items-center">
        <Search className="pointer-events-none absolute left-4 h-4 w-4 text-slate-400" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
          placeholder={placeholder}
          className="search-hub-input-mobile w-full rounded-full bg-white/80 px-10 py-3 pl-10 text-base text-slate-700 placeholder:text-slate-400 shadow-inner outline-none transition-shadow duration-200 focus:shadow-[0_0_0_2px_rgba(236,72,153,0.3)] dark:bg-white/10 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
        {query && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-3 flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-slate-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <button type="submit" className="liquid-button-primary flex w-11 shrink-0 items-center justify-center rounded-full" aria-label="搜索">
        <Search className="h-5 w-5 stroke-[2.5]" />
      </button>
    </form>
  );
}

// ═══════════════════════════════════════════════════════
// 桌面端标签栏
// ═══════════════════════════════════════════════════════
function SearchTabBar({
  groups, activeGroupId, onSelect, panelLayout,
}: {
  groups: typeof SEARCH_GROUPS;
  activeGroupId: SearchGroupId;
  onSelect: (id: SearchGroupId) => void;
  panelLayout?: boolean;
}) {
  return (
    <nav role="tablist" aria-label="搜索分类" className={`search-tab-bar scrollbar-hide flex w-full items-center gap-2 overflow-x-auto py-2 ${panelLayout ? "justify-start" : "max-w-5xl justify-start px-1 sm:justify-center lg:gap-3"}`}>
      {groups.map((group) => {
        const Icon = GROUP_ICONS[group.id];
        const isActive = group.id === activeGroupId;
        return (
          <button
            key={group.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(group.id)}
            className={`search-tab group flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-medium transition-all duration-200 ${
              isActive
                ? "liquid-button-primary search-tab-active scale-[1.02] shadow-md"
                : "liquid-button glass-hover text-slate-600 hover:text-pink-500 dark:text-slate-300"
            }`}
          >
            <Icon className={`h-4 w-4 transition-transform duration-200 ${isActive ? "text-white/90" : "text-slate-400 group-hover:text-pink-400 dark:text-slate-500"}`} />
            <span>{group.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ═══════════════════════════════════════════════════════
// 桌面端大搜索框
// ═══════════════════════════════════════════════════════
function SearchLargeBar({
  query, onChange, onSubmit, placeholder,
}: {
  query: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
  placeholder: string;
}) {
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim()) onSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="flex w-full items-stretch gap-3">
      <div className="relative flex flex-1 items-center">
        <Search className="search-large-input-icon pointer-events-none absolute h-5 w-5 text-slate-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
          placeholder={placeholder}
          className="search-large-input search-hub-input glass w-full rounded-full bg-white/80 px-6 py-4 pl-14 text-xl text-slate-700 placeholder:text-slate-400 shadow-inner outline-none transition-all duration-200 focus:shadow-[0_0_0_3px_rgba(236,72,153,0.25),0_8px_24px_rgba(236,72,153,0.12)] dark:bg-white/10 dark:text-slate-100 dark:placeholder:text-slate-500 sm:py-5 sm:text-2xl"
        />
        {query && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-16 flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-slate-300 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <button type="submit" className="search-large-submit liquid-button-primary flex shrink-0 items-center justify-center rounded-full" aria-label="搜索">
        <Search className="h-7 w-7 stroke-[2.75] sm:h-9 sm:w-9" />
      </button>
    </form>
  );
}

// ═══════════════════════════════════════════════════════
// 桌面端来源芯片行
// ═══════════════════════════════════════════════════════
function SearchProviderRow({
  targets, activeTargetId, onSelect,
}: {
  targets: { id: string; label: string }[];
  activeTargetId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div role="tablist" aria-label="搜索来源" className="search-provider-row scrollbar-hide flex w-full items-center justify-start gap-2 overflow-x-auto sm:justify-center lg:gap-3">
      {targets.map((target) => {
        const isActive = target.id === activeTargetId;
        return (
          <button
            key={target.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(target.id)}
            className={`search-provider shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
              isActive
                ? "liquid-button-primary search-provider-active shadow-sm"
                : "liquid-button glass-hover text-slate-500 hover:text-pink-500 dark:text-slate-400"
            }`}
          >
            {target.label}
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// 热点内容骨架屏
// ═══════════════════════════════════════════════════════
function HotContentSkeleton() {
  return (
    <div className="glass-panel-fill flex h-full w-full flex-col px-2 sm:px-4 lg:px-6">
      <div className="liquid-panel flex min-h-0 flex-1 rounded-2xl p-6">
        <div className="mb-4 flex items-center justify-center gap-2 text-slate-400 dark:text-slate-500">
          <span className="h-5 w-5 rounded-full skeleton-shimmer" />
          <span className="h-4 w-20 rounded skeleton-shimmer" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="liquid-panel h-[200px] overflow-hidden rounded-2xl" style={{ animationDelay: `${i * 80}ms` }}>
              <div className="h-10 skeleton-shimmer" />
              <div className="flex flex-col gap-2 p-3">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="flex items-center gap-2">
                    <span className="h-4 w-4 shrink-0 rounded skeleton-shimmer" />
                    <span className="h-3 flex-1 rounded skeleton-shimmer" style={{ width: `${65 + (j % 3) * 12}%` }} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// 主组件：统一搜索视图（Container Query 驱动响应式）
// ═══════════════════════════════════════════════════════
export function UnifiedSearchView() {
  const [activeGroupId, setActiveGroupId] = useState<SearchGroupId>(DEFAULT_SEARCH_GROUP_ID);
  const [activeTargetId, setActiveTargetId] = useState(
    findSearchGroup(DEFAULT_SEARCH_GROUP_ID).targets[0].id
  );
  const [query, setQuery] = useState("");
  const [isDark, setIsDark] = useState(() => readColorModePreference() === "dark");
  const [galMode, setGalMode] = useState(false);
  const [historyEnabled, setHistoryEnabled] = useState(() => isSearchHistoryEnabled());
  const [showHistoryPrompt, setShowHistoryPrompt] = useState(false);
  const [pendingSearchEntry, setPendingSearchEntry] = useState<Omit<SearchHistoryEntry, "timestamp"> | null>(null);
  const { onHotContentTopChange, communityUnlocked, siteSettings } = useGroup();
  const hotContentRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const galSearchAvailable = communityUnlocked && siteSettings.gal_search_enabled;

  useEffect(() => {
    if (!galSearchAvailable) setGalMode(false);
  }, [galSearchAvailable]);

  const trimmedQuery = query.trim();

  // 热点区域位置测量
  useEffect(() => {
    if (!onHotContentTopChange) return;
    const container = hotContentRef.current;
    if (!container || trimmedQuery) {
      onHotContentTopChange(null);
      return;
    }
    const report = () => { onHotContentTopChange(container.getBoundingClientRect().top); };
    const rafId = requestAnimationFrame(report);
    const observer = new ResizeObserver(report);
    observer.observe(container);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      onHotContentTopChange(null);
    };
  }, [trimmedQuery, onHotContentTopChange]);

  const submitSearch = () => {
    const activeTarget = findSearchTarget(activeGroupId, activeTargetId);
    const targetUrl = buildSearchTargetUrl(activeTarget, trimmedQuery);
    if (!targetUrl) return;

    // 搜索历史记录逻辑 — 仅在非 GAL 模式下
    if (!galMode) {
      const entryData = { query: trimmedQuery, groupId: activeGroupId, targetId: activeTargetId };

      if (historyEnabled) {
        // 已开启：直接记录
        saveSearchEntry(entryData);
      } else if (!isSearchHistoryPromptShown()) {
        // 未开启且未提示过：弹出确认提示
        setPendingSearchEntry(entryData);
        setShowHistoryPrompt(true);
        return; // 暂不跳转，等用户选择
      }
      // 已提示过但未开启：不记录，直接跳转
    }

    openSearchResult(targetUrl);
  };

  const handleHistoryPromptAccept = () => {
    setHistoryEnabled(true);
    setSearchHistoryEnabled(true);
    markSearchHistoryPromptShown();
    // 保存 pending entry 并跳转
    if (pendingSearchEntry) {
      saveSearchEntry(pendingSearchEntry);
      const target = findSearchTarget(pendingSearchEntry.groupId, pendingSearchEntry.targetId);
      const targetUrl = buildSearchTargetUrl(target, pendingSearchEntry.query);
      if (targetUrl) openSearchResult(targetUrl);
      setPendingSearchEntry(null);
    }
    setShowHistoryPrompt(false);
  };

  const handleHistoryPromptDecline = () => {
    markSearchHistoryPromptShown();
    setPendingSearchEntry(null);
    setShowHistoryPrompt(false);
    // 跳转（不记录）
    const activeTarget = findSearchTarget(activeGroupId, activeTargetId);
    const targetUrl = buildSearchTargetUrl(activeTarget, trimmedQuery);
    if (targetUrl) openSearchResult(targetUrl);
  };

  const toggleTheme = () => {
    const nextMode = isDark ? "light" : "dark";
    saveColorModePreference(nextMode);
    setIsDark(nextMode === "dark");
  };

  // 分组切换时重置目标
  useEffect(() => {
    const group = findSearchGroup(activeGroupId);
    if (group.targets.length > 0) {
      setActiveTargetId(group.targets[0].id);
    }
  }, [activeGroupId]);

  const activeGroup = findSearchGroup(activeGroupId);

  // 历史记录复用回调
  const handleHistoryReuse = (entry: SearchHistoryEntry, autoSearch: boolean) => {
    setQuery(entry.query);
    setActiveGroupId(entry.groupId);
    setActiveTargetId(entry.targetId);
    if (autoSearch) {
      // 延迟执行以确保 state 更新完毕
      setTimeout(() => {
        const target = findSearchTarget(entry.groupId, entry.targetId);
        const targetUrl = buildSearchTargetUrl(target, entry.query);
        if (targetUrl) openSearchResult(targetUrl);
      }, 0);
    }
  };

  return (
    <div ref={containerRef} className="search-view-container">
      <section className="search-only-section px-2 pb-4 pt-4 sm:px-4 lg:px-6 lg:pb-0 lg:pt-0 lg:pr-6">
        <div className="search-only-inner mx-auto w-full max-w-[1920px] flex-shrink-0">
          {/* 共享头部 */}
          <SearchHeader
            isDark={isDark}
            onToggleTheme={toggleTheme}
            galSearchAvailable={galSearchAvailable}
            galMode={galMode}
            onToggleGal={() => setGalMode(!galMode)}
          />

          {/* GAL 搜索模式 */}
          {galMode ? (
            <div className="search-area flex w-full flex-col items-center justify-center pb-4 pt-4 sm:pb-6">
              <Suspense fallback={
                <div className="flex items-center justify-center gap-3 py-16 text-amber-500 dark:text-amber-400">
                  <Gamepad2 className="h-5 w-5 animate-pulse" />
                  <span className="text-sm">加载 GAL 搜索...</span>
                </div>
              }>
                <GalSearchPanel />
              </Suspense>
            </div>
          ) : (
            <div className="search-area flex w-full flex-col items-center">
              {/* 桌面端布局：标签栏 + 大搜索框 + 来源行 → 整合为搜索面板 */}
              <div className="search-layout-desktop">
                <div className="search-panel-container">
                  <SearchTabBar
                    groups={SEARCH_GROUPS}
                    activeGroupId={activeGroupId}
                    onSelect={(id) => setActiveGroupId(id)}
                    panelLayout
                  />
                  <SearchLargeBar
                    query={query}
                    onChange={setQuery}
                    onSubmit={submitSearch}
                    placeholder={activeGroup.targets.find(t => t.id === activeTargetId)?.placeholder || "搜索"}
                  />
                  {/* 搜索历史面板（桌面端：搜索框下方） */}
                  {historyEnabled && !galMode && (
                    <div className="mt-3">
                      <SearchHistoryPanel
                        currentQuery={query}
                        onReuse={handleHistoryReuse}
                      />
                    </div>
                  )}
                  <SearchProviderRow
                    targets={activeGroup.targets}
                    activeTargetId={activeTargetId}
                    onSelect={setActiveTargetId}
                  />
                </div>
              </div>

              {/* 移动端布局：分组选择器 + 紧凑搜索条 + 来源按钮（+ 底部 Sheet） */}
              <div className="search-layout-mobile w-full">
                <MobileSearchContent
                  activeGroupId={activeGroupId}
                  activeTargetId={activeTargetId}
                  query={query}
                  setQuery={setQuery}
                  onSubmit={submitSearch}
                  onGroupChange={(id) => setActiveGroupId(id)}
                  onTargetChange={setActiveTargetId}
                />
                {/* 搜索历史面板（移动端：搜索区域下方） */}
                {historyEnabled && !galMode && (
                  <div className="mt-2">
                    <SearchHistoryPanel
                      currentQuery={query}
                      onReuse={handleHistoryReuse}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 热点内容区域 */}
        {!galMode && !trimmedQuery && (
          <div ref={hotContentRef} className="hot-content-area mt-2 w-full min-h-0 lg:mt-1">
            <Suspense fallback={<HotContentSkeleton />}>
              <HotContentSection communityUnlocked={communityUnlocked} showAnimeCalendar={false} />
            </Suspense>
          </div>
        )}
      </section>

      {/* 首次搜索确认提示 Modal */}
      {showHistoryPrompt && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={handleHistoryPromptDecline} />
          <div className="fixed inset-x-4 top-1/3 z-50 mx-auto max-w-md -translate-y-1/4 rounded-2xl glass-card p-6 shadow-2xl">
            <div className="mb-3 flex items-center gap-2">
              <Search className="h-5 w-5 text-pink-500" />
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">开启搜索历史？</h3>
            </div>
            <p className="mb-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              搜索历史会记录您在纯搜索模式下搜索的关键词、搜索来源等信息，方便您快速复用。
            </p>
            <div className="mb-4 flex items-start gap-2 rounded-xl bg-green-50 dark:bg-green-900/20 px-3 py-2 text-xs text-green-700 dark:text-green-300">
              <span className="mt-0.5 shrink-0">🔒</span>
              <span>所有记录仅保存在您的浏览器本地，不会上传到服务器。您可随时在设置中关闭或清空。</span>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleHistoryPromptAccept}
                className="flex-1 rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-pink-500/25 hover:shadow-pink-500/40 transition-all"
              >
                开启
              </button>
              <button
                type="button"
                onClick={handleHistoryPromptDecline}
                className="flex-1 rounded-xl bg-slate-100 dark:bg-white/10 px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/15 transition-all"
              >
                暂不开启
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// 移动端搜索子组件（在 Container Query 窄模式下显示）
// ═══════════════════════════════════════════════════════
function MobileSearchContent({
  activeGroupId, activeTargetId, query, setQuery, onSubmit, onGroupChange, onTargetChange,
}: {
  activeGroupId: SearchGroupId;
  activeTargetId: string;
  query: string;
  setQuery: (val: string) => void;
  onSubmit: () => void;
  onGroupChange: (id: SearchGroupId) => void;
  onTargetChange: (id: string) => void;
}) {
  const [sourceSheetOpen, setSourceSheetOpen] = useState(false);
  const activeGroup = findSearchGroup(activeGroupId);

  return (
    <div className="flex w-full flex-col gap-3 pb-2 pt-2">
      <div className="flex items-center gap-2">
        <SearchGroupSelector activeGroupId={activeGroupId} onGroupChange={onGroupChange} />
      </div>
      <SearchCompactBar
        query={query}
        onChange={setQuery}
        onSubmit={onSubmit}
        placeholder={activeGroup.targets.find(t => t.id === activeTargetId)?.placeholder || "搜索"}
      />
      <button
        type="button"
        onClick={() => setSourceSheetOpen(true)}
        className="self-start rounded-full px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 glass-card glass-hover transition-colors flex items-center gap-1"
      >
        <span>来源：</span>
        <span className="text-pink-500 dark:text-pink-400">
          {activeGroup.targets.find(t => t.id === activeTargetId)?.label || activeGroup.label}
        </span>
        <ChevronDown className="h-3 w-3 text-slate-400" />
      </button>
      <SearchProviderSheet
        open={sourceSheetOpen}
        onClose={() => setSourceSheetOpen(false)}
        groupId={activeGroupId}
        activeTargetId={activeTargetId}
        onTargetChange={onTargetChange}
      />
    </div>
  );
}
