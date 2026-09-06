import { useEffect, useState, useMemo, useRef, useCallback, memo } from "react";
import { Flame, Eye, EyeOff, RefreshCw, LayoutGrid, CalendarDays, Inbox, Bell, BellRing, X } from "lucide-react";
import {
  getHotItemsCache,
  setHotItemsCache,
  shouldFetchHotItems,
} from "../hot-items-cache";
import { DesktopHotContent } from "./DesktopHotContent";
import { MobileHotFeed } from "./MobileHotFeed";
import { DropdownMenu, type DropdownMenuItem } from "./DropdownMenu";

interface DailyHotItem {
  id: string;
  platform: string;
  title: string;
  description: string | null;
  cover: string | null;
  author: string | null;
  url: string;
  mobile_url: string | null;
  hot: number;
  timestamp: number | null;
  scraped_at: string;
}

interface HotItemsData {
  items: Record<string, DailyHotItem[]>;
  total: number;
  platforms: number;
  availablePlatforms: string[];
}

type ViewMode = "cards" | "animeCalendar";

// 平台显示配置
const PLATFORM_CONFIG: Record<string, { name: string; emoji: string; color: string; tagBg: string; tagText: string }> = {
  bilibili:   { name: "B站",     emoji: "📺", color: "from-pink-500 to-red-500",      tagBg: "bg-pink-100 dark:bg-pink-900/30",    tagText: "text-pink-600 dark:text-pink-400" },
  weibo:      { name: "微博",    emoji: "💬", color: "from-orange-500 to-yellow-500",  tagBg: "bg-orange-100 dark:bg-orange-900/30", tagText: "text-orange-600 dark:text-orange-400" },
  zhihu:      { name: "知乎",    emoji: "❓", color: "from-blue-500 to-cyan-500",     tagBg: "bg-blue-100 dark:bg-blue-900/30",    tagText: "text-blue-600 dark:text-blue-400" },
  douyin:     { name: "抖音",    emoji: "🎵", color: "from-purple-500 to-pink-500",   tagBg: "bg-purple-100 dark:bg-purple-900/30", tagText: "text-purple-600 dark:text-purple-400" },
  toutiao:    { name: "头条",    emoji: "📰", color: "from-red-500 to-orange-500",    tagBg: "bg-red-100 dark:bg-red-900/30",      tagText: "text-red-600 dark:text-red-400" },
  baidu:      { name: "百度",    emoji: "🔍", color: "from-blue-600 to-blue-400",     tagBg: "bg-sky-100 dark:bg-sky-900/30",      tagText: "text-sky-600 dark:text-sky-400" },
  "qq-news":  { name: "QQ新闻", emoji: "📋", color: "from-blue-500 to-purple-500",   tagBg: "bg-indigo-100 dark:bg-indigo-900/30", tagText: "text-indigo-600 dark:text-indigo-400" },
  "sina-news":{ name: "新浪",    emoji: "📰", color: "from-red-600 to-red-400",       tagBg: "bg-rose-100 dark:bg-rose-900/30",    tagText: "text-rose-600 dark:text-rose-400" },
};

// ═══════════════════════════════════════════════════════════
// 番剧日程 — 类型 & 本地缓存（按天）
// ═══════════════════════════════════════════════════════════

interface AnimeScheduleItem {
  title: string;
  cover: string;
  link: string;
  update_date: string;
}

type AnimeScheduleData = Record<string, AnimeScheduleItem[]>;

const ANIME_CACHE_STORAGE_KEY = "animeScheduleCacheV2";

interface AnimeCacheEntry {
  data: AnimeScheduleData;
  fetchDate: string; // YYYY-MM-DD，表示上次成功获取的日期
}

/** 返回今天的日期字符串 YYYY-MM-DD */
function getTodayString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 从 localStorage 读取缓存；若 fetchDate 不是今天则视为过期 */
function readAnimeCache(): AnimeScheduleData | null {
  try {
    const raw = localStorage.getItem(ANIME_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const entry: AnimeCacheEntry = JSON.parse(raw);
    if (entry.fetchDate !== getTodayString()) return null; // 过期：不是今天
    return entry.data;
  } catch {
    return null;
  }
}

/** 写入 localStorage 缓存，附带今天的日期 */
function writeAnimeCache(data: AnimeScheduleData): void {
  try {
    const entry: AnimeCacheEntry = { data, fetchDate: getTodayString() };
    localStorage.setItem(ANIME_CACHE_STORAGE_KEY, JSON.stringify(entry));
  } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════
// 番剧订阅 — 类型 & localStorage（零服务器依赖）
// ═══════════════════════════════════════════════════════════

interface AnimeSubscription {
  title: string;
  day: string;         // 更新日，如 "周一"
  lastNotified: string; // YYYY-MM-DD，上次通知日期
  link: string;
  cover: string;
}

const ANIME_SUB_STORAGE_KEY = "animeSubscriptions";

function loadSubscriptions(): Record<string, AnimeSubscription> {
  try {
    const raw = localStorage.getItem(ANIME_SUB_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSubscriptions(subs: Record<string, AnimeSubscription>): void {
  try {
    localStorage.setItem(ANIME_SUB_STORAGE_KEY, JSON.stringify(subs));
  } catch { /* ignore */ }
}

function toggleSubscription(
  subs: Record<string, AnimeSubscription>,
  anime: AnimeScheduleItem
): Record<string, AnimeSubscription> {
  const next = { ...subs };
  if (next[anime.title]) {
    delete next[anime.title];
  } else {
    next[anime.title] = {
      title: anime.title,
      day: anime.update_date,
      lastNotified: "",
      link: anime.link,
      cover: anime.cover,
    };
  }
  return next;
}

/** 计算今天的星期名（"周一" ~ "周日"） */
function getTodayDayName(): string {
  const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return days[new Date().getDay()];
}

// ═══════════════════════════════════════════════════════════
// 通知 Toast 组件
// ═══════════════════════════════════════════════════════════

function AnimeNotificationToast({
  notifications,
  onDismiss,
}: {
  notifications: Array<{ title: string; cover: string; link: string }>;
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 400);
    }, 8000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      className={`anime-toast-container ${visible ? "anime-toast-enter" : "anime-toast-exit"}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="liquid-panel rounded-2xl p-4 max-w-xs shadow-2xl">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center shrink-0">
              <BellRing className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              番剧更新提醒
            </span>
          </div>
          <button
            onClick={() => {
              setVisible(false);
              setTimeout(onDismiss, 400);
            }}
            className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="space-y-1.5">
          {notifications.map((n) => (
            <a
              key={n.title}
              href={n.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
            >
              <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0">
                <img
                  src={`/api/public/anime-schedule/cover?url=${encodeURIComponent(n.cover)}`}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
              <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
                {n.title}
              </span>
            </a>
          ))}
        </div>
        <div className="mt-2 pt-2 border-t border-slate-200/50 dark:border-slate-700/50">
          <span className="text-[10px] text-slate-400 dark:text-slate-500">
            今日有 {notifications.length} 部订阅番剧更新
          </span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 其他 localStorage 工具
// ═══════════════════════════════════════════════════════════

const HOT_PLATFORMS_STORAGE_KEY = "selectedHotPlatforms";
const HIDDEN_ITEMS_STORAGE_KEY = "hiddenDailyHotItems";
const VIEW_MODE_STORAGE_KEY = "hotContentViewMode";

function loadSelectedPlatforms(): string[] {
  try {
    const saved = localStorage.getItem(HOT_PLATFORMS_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return ["bilibili", "weibo", "zhihu", "douyin", "toutiao"];
}

function loadHiddenItems(): Set<string> {
  try {
    const saved = localStorage.getItem(HIDDEN_ITEMS_STORAGE_KEY);
    return saved ? new Set(JSON.parse(saved)) : new Set();
  } catch {
    return new Set();
  }
}

function saveHiddenItems(hidden: Set<string>): void {
  try {
    localStorage.setItem(HIDDEN_ITEMS_STORAGE_KEY, JSON.stringify(Array.from(hidden)));
  } catch { /* ignore */ }
}

function loadViewMode(): ViewMode {
  try {
    const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (saved === "animeCalendar" || saved === "cards") return saved;
  } catch { /* ignore */ }
  return "cards";
}

function getPlatformConfig(platform: string) {
  return PLATFORM_CONFIG[platform] || {
    name: platform,
    emoji: "📌",
    color: "from-gray-500 to-gray-400",
    tagBg: "bg-gray-100 dark:bg-gray-800",
    tagText: "text-gray-600 dark:text-gray-400",
  };
}

// ─── 主组件 ────────────────────────────────────────────────

export function HotContentSection({ communityUnlocked, showAnimeCalendar = true }: { communityUnlocked?: boolean; showAnimeCalendar?: boolean }) {
  const cachedItems = getHotItemsCache()?.items as Record<string, DailyHotItem[]> | undefined;
  const [hotItems, setHotItems] = useState<Record<string, DailyHotItem[]>>(
    cachedItems ?? {}
  );
  const [loading, setLoading] = useState(!cachedItems);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(loadSelectedPlatforms);
  const [hiddenItems, setHiddenItems] = useState<Set<string>>(loadHiddenItems);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    // 如果口令未解锁，强制卡片视图
    const saved = loadViewMode();
    if (saved === "animeCalendar" && !communityUnlocked) return "cards";
    return saved;
  });

  // 番剧日程状态
  const [animeSchedule, setAnimeSchedule] = useState<AnimeScheduleData | null>(null);
  const [animeLoading, setAnimeLoading] = useState(false);
  const [animeError, setAnimeError] = useState<string | null>(null);
  const [animeFetched, setAnimeFetched] = useState(false); // 本次会话是否已发起过请求
  const [selectedDay, setSelectedDay] = useState<string>(() => {
    const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return days[new Date().getDay()];
  });

  // 番剧订阅状态（纯客户端，零服务器依赖）
  const [subscriptions, setSubscriptions] = useState<Record<string, AnimeSubscription>>(loadSubscriptions);
  const [animeNotifications, setAnimeNotifications] = useState<Array<{ title: string; cover: string; link: string }>>([]);

  // 4.2: 稳定引用的订阅切换回调，供 memo 化 AnimeCard 比较，避免每次渲染新引用触发整网格重渲染
  const handleToggleSub = useCallback((anime: AnimeScheduleItem) => {
    setSubscriptions((prev) => toggleSubscription(prev, anime));
  }, []);

  useEffect(() => {
    saveSubscriptions(subscriptions);
  }, [subscriptions]);

  // 订阅通知检查：番剧数据加载完成后，检查今日是否有订阅番剧更新
  const notificationCheckedRef = useRef(false);
  const subscriptionsRef = useRef(subscriptions);
  subscriptionsRef.current = subscriptions;
  useEffect(() => {
    if (!animeSchedule || notificationCheckedRef.current) return;
    notificationCheckedRef.current = true;

    const today = getTodayString();
    const todayDay = getTodayDayName();
    const todayAnime = animeSchedule[todayDay] || [];
    const subs = subscriptionsRef.current;
    const pending: Array<{ title: string; cover: string; link: string }> = [];

    for (const anime of todayAnime) {
      const sub = subs[anime.title];
      if (sub && sub.lastNotified !== today) {
        pending.push({ title: anime.title, cover: anime.cover, link: anime.link });
      }
    }

    if (pending.length > 0) {
      setAnimeNotifications(pending);
      // 标记为已通知
      setSubscriptions((prev) => {
        const updated = { ...prev };
        for (const p of pending) {
          if (updated[p.title]) {
            updated[p.title] = { ...updated[p.title], lastNotified: today };
          }
        }
        return updated;
      });
    }
  }, [animeSchedule]);

  useEffect(() => {
    const handler = () => setSelectedPlatforms(loadSelectedPlatforms());
    window.addEventListener("hotPlatformsChanged", handler);
    return () => window.removeEventListener("hotPlatformsChanged", handler);
  }, []);

  useEffect(() => { saveHiddenItems(hiddenItems); }, [hiddenItems]);

  useEffect(() => {
    try { localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode); } catch { /* ignore */ }
  }, [viewMode]);

  // ─── 获取番剧日程数据（同源代理）───
  const fetchAnimeSchedule = useCallback(async (forceRefresh = false, signal?: AbortSignal) => {
    // 非强制刷新时先检查本地缓存
    if (!forceRefresh) {
      const cached = readAnimeCache();
      if (cached) {
        setAnimeSchedule(cached);
        setAnimeFetched(true);
        return;
      }
    }

    setAnimeLoading(true);
    setAnimeError(null);
    try {
      const res = await fetch("/api/public/anime-schedule", { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.code !== 0 || !json.data) throw new Error(json.error || "API error");
      const data = json.data as AnimeScheduleData;
      writeAnimeCache(data);
      setAnimeSchedule(data);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      setAnimeError(err instanceof Error ? err.message : "Failed to load");
      console.error("[anime-schedule] fetch error:", err);
      // 请求失败但有旧缓存（可能过期），降级使用
      try {
        const raw = localStorage.getItem(ANIME_CACHE_STORAGE_KEY);
        if (raw) {
          const entry: AnimeCacheEntry = JSON.parse(raw);
          if (entry.data) setAnimeSchedule(entry.data);
        }
      } catch { /* ignore */ }
    } finally {
      if (!signal?.aborted) {
        setAnimeLoading(false);
        setAnimeFetched(true);
      }
    }
  }, []);

  // 切换到番剧日历视图时：仅在首次点击时加载
  useEffect(() => {
    if (viewMode === "animeCalendar" && !animeFetched) {
      // 先尝试读缓存（可能今天已获取过）
      const cached = readAnimeCache();
      if (cached) {
        setAnimeSchedule(cached);
        setAnimeFetched(true);
      } else {
        const controller = new AbortController();
        fetchAnimeSchedule(false, controller.signal);
        return () => controller.abort();
      }
    }
  }, [viewMode, animeFetched, fetchAnimeSchedule]);

  const fetchHotItems = async (forceLoading = false, signal?: AbortSignal) => {
    if (!forceLoading && !shouldFetchHotItems()) {
      const cached = getHotItemsCache();
      if (cached) {
        setHotItems(cached.items as Record<string, DailyHotItem[]>);
        setLoading(false);
        setError(null);
      }
      return;
    }

    if (forceLoading || !getHotItemsCache()) setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/public/hot-items?limit=50", { signal });
      if (!res.ok) throw new Error("Failed to fetch hot items");
      const data: HotItemsData = await res.json();
      const items = data.items || {};
      setHotItemsCache(items);
      setHotItems(items);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      if (!getHotItemsCache()) {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
      console.error("Error fetching hot items:", err);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchHotItems(false, controller.signal);
    return () => controller.abort();
  }, []);

  const toggleItemVisibility = useCallback((itemId: string) => {
    setHiddenItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const visiblePlatforms = useMemo(() => {
    const result: Array<{ platform: string; items: DailyHotItem[] }> = [];
    for (const platform of selectedPlatforms) {
      const items = hotItems[platform];
      if (!items || items.length === 0) continue;
      const filtered = items.filter((it) => !hiddenItems.has(`${platform}-${it.id}`));
      if (filtered.length > 0) result.push({ platform, items: filtered });
    }
    return result;
  }, [hotItems, selectedPlatforms, hiddenItems]);

  // 禁用番剧日历视图时强制切回卡片
  useEffect(() => {
    if (!showAnimeCalendar) {
      setViewMode(prev => prev === "animeCalendar" ? "cards" : prev);
    }
  }, [showAnimeCalendar]);

  const showAnimeButton = showAnimeCalendar && !!communityUnlocked;

  // Loading 状态
  if (loading && Object.keys(hotItems).length === 0 && viewMode !== "animeCalendar") {
    return (
      <div className="w-full h-full px-2 sm:px-4 lg:px-6 flex flex-col">
        <div className="liquid-panel rounded-2xl p-6">
          <div className="flex items-center justify-center gap-2 text-slate-500">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>加载热点内容中...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error && viewMode !== "animeCalendar") return null;

  const hasCards = visiblePlatforms.length > 0;
  if (!hasCards && viewMode !== "animeCalendar") return null;

  const animeTotalCount = animeSchedule ? Object.values(animeSchedule).flat().length : 0;

  return (
    <>
    <div className="glass-panel-fill w-full h-full p-0 flex flex-col">
      {/* 标题栏 */}
      <div className="relative flex items-center justify-center mb-5 shrink-0 px-2 sm:px-4 lg:px-6">
        <div className="flex items-center gap-2">
          <Flame className="w-5 h-5 text-orange-500" />
          <h3 className="font-semibold text-slate-700 dark:text-slate-200">
            {viewMode === "animeCalendar" ? "番剧日历" : "实时热点"}
          </h3>
          <span className="liquid-chip text-xs px-2 py-0.5 rounded-full">
            {viewMode === "cards"
              ? `${visiblePlatforms.length} 个平台`
              : animeTotalCount > 0
                ? `${animeTotalCount} 部番剧`
                : "加载中…"}
          </span>
        </div>

        {/* 视图切换 */}
        <div className="absolute right-0 flex items-center gap-1">
          <DropdownMenu
            items={viewModeItems(showAnimeButton)}
            onSelect={(value) => setViewMode(value as ViewMode)}
            renderTrigger={({ isOpen, triggerRef }) => (
              <button
                ref={triggerRef}
                type="button"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl liquid-chip text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-pink-500 transition-all"
              >
                {viewMode === "cards" ? (
                  <LayoutGrid className="w-3.5 h-3.5" />
                ) : (
                  <CalendarDays className="w-3.5 h-3.5" />
                )}
                <span>{viewMode === "cards" ? "卡片" : "番剧日历"}</span>
              </button>
            )}
          />
        </div>
      </div>

      {/* 视图内容 */}
      {viewMode === "cards" ? (
        <>
          {/* 桌面端：平台 Tab + 虚拟滚动列表 */}
          <div className="hidden min-h-0 flex-1 overflow-hidden lg:flex">
            <DesktopHotContent
              hotItems={hotItems}
              availablePlatforms={selectedPlatforms}
              hiddenItems={hiddenItems}
              onToggleVisibility={toggleItemVisibility}
              loading={loading}
              error={error}
            />
          </div>
          {/* 移动端：优化单列信息流 */}
          <div className="flex min-h-0 flex-1 overflow-hidden lg:hidden">
            <MobileHotFeed
              hotItems={hotItems}
              availablePlatforms={selectedPlatforms}
              hiddenItems={hiddenItems}
              onToggleVisibility={toggleItemVisibility}
              loading={loading}
              error={error}
              onRetry={() => fetchHotItems(true)}
            />
          </div>
        </>
      ) : (
        <AnimeCalendarView
          schedule={animeSchedule}
          loading={animeLoading}
          error={animeError}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          onRetry={() => fetchAnimeSchedule(true)}
          subscriptions={subscriptions}
          onToggleSub={handleToggleSub}
        />
      )}
    </div>

    {/* 番剧更新通知 Toast */}
    {animeNotifications.length > 0 && (
      <AnimeNotificationToast
        notifications={animeNotifications}
        onDismiss={() => setAnimeNotifications([])}
      />
    )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// 番剧日历视图
// ═══════════════════════════════════════════════════════════

function AnimeCalendarView({
  schedule,
  loading,
  error,
  selectedDay,
  onSelectDay,
  onRetry,
  subscriptions,
  onToggleSub,
}: {
  schedule: AnimeScheduleData | null;
  loading: boolean;
  error: string | null;
  selectedDay: string;
  onSelectDay: (day: string) => void;
  onRetry: () => void;
  subscriptions: Record<string, AnimeSubscription>;
  onToggleSub: (anime: AnimeScheduleItem) => void;
}) {
  const days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const todayIndex = new Date().getDay(); // 0=周日
  const todayDay = days[todayIndex === 0 ? 6 : todayIndex - 1];

  // 切换星期时的过渡 key
  const [gridKey, setGridKey] = useState(0);
  useEffect(() => { setGridKey((k) => k + 1); }, [selectedDay]);

  // Loading 状态：骨架屏
  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center gap-1.5 mb-4 px-1 shrink-0">
          {days.map((d) => (
            <div key={d} className="h-14 w-16 rounded-xl bg-slate-200/50 dark:bg-slate-700/30 animate-pulse shrink-0" />
          ))}
        </div>
        <div className="flex-1 min-h-0 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 px-1">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-10 rounded-xl bg-slate-200/40 dark:bg-slate-700/20 animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center mb-1">
          <Inbox className="w-6 h-6 text-red-400" />
        </div>
        <div className="text-red-500 text-sm font-medium">{error}</div>
        <button
          onClick={onRetry}
          className="liquid-button px-5 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-pink-500 transition-colors rounded-xl"
        >
          重新加载
        </button>
      </div>
    );
  }

  if (!schedule) return null;

  const todayAnime = schedule[selectedDay] || [];

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* ─── 星期选择器：液态玻璃按钮，居中 ─── */}
      <div className="shrink-0 mb-3 flex justify-center">
        <div className="flex items-center gap-1.5">
          {days.map((day) => {
            const isActive = day === selectedDay;
            const isToday = day === todayDay;
            const animeCount = schedule[day]?.length || 0;
            return (
              <button
                key={day}
                onClick={() => onSelectDay(day)}
                className={`anime-day-btn shrink-0 flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  isActive
                    ? "liquid-button-primary text-white shadow-md"
                    : "liquid-button glass-hover text-slate-600 hover:text-pink-500 dark:text-slate-300"
                }`}
              >
                <div className="flex items-center gap-1">
                  <span className="text-[11px] font-semibold leading-none">{day}</span>
                  {isToday && !isActive && (
                    <span className="anime-today-dot w-1.5 h-1.5 rounded-full bg-pink-500" />
                  )}
                </div>
                <span className={`text-[9px] tabular-nums leading-none ${isActive ? "text-white/80" : "text-slate-400 dark:text-slate-500"}`}>
                  {animeCount}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── 番剧列表（滚动区域建立层叠上下文裁剪展开卡片）─── */}
      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        {todayAnime.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-400 dark:text-slate-500">
            <CalendarDays className="w-8 h-8 opacity-40" />
            <span className="text-sm">{selectedDay}没有更新的番剧</span>
          </div>
        ) : (
          <div
            key={gridKey}
            className="anime-grid-fade-enter anime-grid grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8"
          >
            {todayAnime.map((anime, index) => (
              <AnimeCard
                key={`${anime.title}-${index}`}
                anime={anime}
                index={index}
                isSubscribed={!!subscriptions[anime.title]}
                onToggleSub={onToggleSub}
              />
            ))}
          </div>
        )}
      </div>

      {/* ─── 底部统计 ─── */}
      {todayAnime.length > 0 && (
        <div className="shrink-0 mt-2 pt-2.5 flex items-center justify-center">
          <span className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums px-3">
            {selectedDay} · {todayAnime.length} 部番剧更新
          </span>
        </div>
      )}
    </div>
  );
}

// 4.1: AnimeCard memo 化 —— props 中 anime/index 稳定、isSubscribed 为布尔、onToggleSub 为父级 useCallback 稳定引用，仅订阅状态变化才重渲染对应卡片
const AnimeCard = memo(function AnimeCard({ anime, index, isSubscribed, onToggleSub }: { anime: AnimeScheduleItem; index: number; isSubscribed: boolean; onToggleSub: (anime: AnimeScheduleItem) => void }) {
  const coverUrl = `/api/public/anime-schedule/cover?url=${encodeURIComponent(anime.cover)}`;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hoveredRef = useRef(false);
  const expandedRef = useRef(false);
  const collapsingRef = useRef(false);
  const collapseCleanupRef = useRef<(() => void) | null>(null);
  const rafRef = useRef<number>(0);

  // 3D 倾斜 + 展开/收起管理：JS 统一控制，避免 CSS transition 与 inline transform 冲突
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const getExpanded = () => wrapper.querySelector(".anime-card-expanded") as HTMLElement | null;
    const getInner = () => wrapper.querySelector(".anime-card-inner") as HTMLElement | null;

    // 计算 3D 倾斜角度
    const applyTilt = (e: MouseEvent) => {
      cancelAnimationFrame(rafRef.current);
      // prefers-reduced-motion：禁用 3D 视差倾斜，避免触发非必要动画
      if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      rafRef.current = requestAnimationFrame(() => {
        const expanded = getExpanded();
        const inner = getInner();
        if (!inner) return;

        if (expandedRef.current && expanded) {
          // 展开态：对 expanded 卡片做 3D 倾斜
          const rect = expanded.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const dx = (e.clientX - cx) / (rect.width / 2);
          const dy = (e.clientY - cy) / (rect.height / 2);
          // 4.4: 用整数四舍五入替代每帧 toFixed(2) 字符串分配
          const rx = Math.round(dy * -6);
          const ry = Math.round(dx * 6);
          expanded.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) scaleY(1) scaleX(1)`;
          const ix = Math.round(dy * -2);
          const iy = Math.round(dx * 2);
          inner.style.transform = `rotateX(${ix}deg) rotateY(${iy}deg)`;
        } else {
          // compact 态：轻微倾斜
          const rect = wrapper.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const dx = (e.clientX - cx) / (rect.width / 2);
          const dy = (e.clientY - cy) / (rect.height / 2);
          // 4.4: 用整数四舍五入替代每帧 toFixed(2) 字符串分配
          const ix = Math.round(dy * -4);
          const iy = Math.round(dx * 4);
          inner.style.transform = `rotateX(${ix}deg) rotateY(${iy}deg)`;
        }
      });
    };

    const onEnter = () => {
      hoveredRef.current = true;
      wrapper.style.zIndex = "40";

      // 若正在收起动画中，立即中断并重新展开
      if (collapsingRef.current) {
        collapsingRef.current = false;
        wrapper.classList.remove("anime-card-collapsing");
        if (collapseCleanupRef.current) {
          collapseCleanupRef.current();
          collapseCleanupRef.current = null;
        }
        const expanded = getExpanded();
        if (expanded) expanded.style.animation = "none";
      }

      const expanded = getExpanded();
      if (expanded && !expandedRef.current) {
        expandedRef.current = true;
        // 用 inline style 立即展开，禁用 transition 避免与 3D tilt 冲突
        expanded.style.transition = "none";
        expanded.style.opacity = "1";
        expanded.style.transform = "scaleY(1) scaleX(1)";
        expanded.style.pointerEvents = "auto";
        expanded.style.boxShadow = "0 12px 40px rgba(0, 0, 0, 0.18), 0 4px 12px rgba(236, 72, 153, 0.12)";
      }
    };

    const onMove = (e: MouseEvent) => {
      if (!hoveredRef.current) return;
      applyTilt(e);
    };

    const onLeave = () => {
      hoveredRef.current = false;
      wrapper.style.zIndex = "1";
      cancelAnimationFrame(rafRef.current);

      const inner = getInner();
      const expanded = getExpanded();

      // 清除 compact 态的 3D 倾斜
      if (inner) inner.style.transform = "";

      if (expanded && expandedRef.current) {
        expandedRef.current = false;

        // 清除展开态的 inline style，恢复 CSS transition 接管
        expanded.style.transition = "";
        expanded.style.opacity = "";
        expanded.style.transform = "";
        expanded.style.pointerEvents = "";
        expanded.style.boxShadow = "";
        expanded.style.animation = "";

        // 启动收起动画
        collapsingRef.current = true;
        wrapper.classList.add("anime-card-collapsing");

        const onAnimEnd = (ev: AnimationEvent) => {
          if (ev.target !== expanded) return;
          wrapper.classList.remove("anime-card-collapsing");
          collapsingRef.current = false;
          collapseCleanupRef.current = null;
          expanded.removeEventListener("animationend", onAnimEnd);
        };
        collapseCleanupRef.current = () => {
          expanded.removeEventListener("animationend", onAnimEnd);
        };
        expanded.addEventListener("animationend", onAnimEnd);
      }
    };

    wrapper.addEventListener("mouseenter", onEnter);
    wrapper.addEventListener("mouseleave", onLeave);
    wrapper.addEventListener("mousemove", onMove);
    return () => {
      wrapper.removeEventListener("mouseenter", onEnter);
      wrapper.removeEventListener("mouseleave", onLeave);
      wrapper.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(rafRef.current);
      if (collapseCleanupRef.current) collapseCleanupRef.current();
    };
  }, []);

  const isTop3 = index < 3;

  return (
    <div
      ref={wrapperRef}
      className="anime-card-wrapper anime-card-enter"
      style={{
        perspective: "800px",
        zIndex: 1,
        animationDelay: `${Math.min(index, 20) * 30}ms`,
      }}
    >
      {/* ── 紧凑态 ── */}
      <div className="anime-card-inner liquid-panel rounded-xl">
        <a
          href={anime.link}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 px-3 py-0 h-full"
        >
          <div className="relative w-9 h-9 rounded-lg overflow-hidden shrink-0">
            <img
              src={coverUrl}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover"
              onError={(e) => {
                const t = e.target as HTMLImageElement;
                t.style.display = "none";
                t.parentElement!.classList.add("bg-gradient-to-br", "from-pink-200", "to-purple-200", "dark:from-pink-800/40", "dark:to-purple-800/40");
              }}
            />
            {isTop3 && (
              <div className="absolute -top-0.5 -left-0.5 w-4 h-4 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center shadow">
                <span className="text-[8px] font-bold text-white leading-none">{index + 1}</span>
              </div>
            )}
          </div>
          <span className="anime-card-compact-title text-xs font-medium text-slate-700 dark:text-slate-200 truncate flex-1 min-w-0 leading-snug">
            {anime.title}
          </span>
        </a>
      </div>

      {/* ── 展开态：始终渲染，JS inline style 控制展开，CSS transition 驱动收起动画 ── */}
      <div className="anime-card-expanded liquid-panel">
        <a
          href={anime.link}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full h-full overflow-hidden rounded-[6px]"
        >
          <div className="relative w-full h-full overflow-hidden">
            <img
              src={coverUrl}
              alt={anime.title}
              className="anime-expand-cover w-full h-full object-cover"
              onError={(e) => {
                const t = e.target as HTMLImageElement;
                t.style.display = "none";
                t.parentElement!.classList.add("bg-gradient-to-br", "from-pink-100", "to-purple-100", "dark:from-pink-900/30", "dark:to-purple-900/30");
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

            {/* 订阅按钮 */}
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleSub(anime);
              }}
              className={`anime-subscribe-btn absolute top-1.5 right-1.5 z-10 w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                isSubscribed
                  ? "bg-pink-500 text-white shadow-lg shadow-pink-500/30"
                  : "bg-black/30 text-white/70 backdrop-blur-sm hover:bg-black/50 hover:text-white"
              }`}
              title={isSubscribed ? "取消订阅" : "订阅更新提醒"}
            >
              {isSubscribed ? (
                <BellRing className="w-3.5 h-3.5" />
              ) : (
                <Bell className="w-3.5 h-3.5" />
              )}
            </button>

            {isTop3 && (
              <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center shadow-lg">
                <span className="text-[10px] font-bold text-white">{index + 1}</span>
              </div>
            )}

            <div className="absolute bottom-0 left-0 right-0 p-3">
              <h4 className="text-xs font-bold text-white leading-snug line-clamp-2 drop-shadow-md mb-1.5">
                {anime.title}
              </h4>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-white/60 tabular-nums">{anime.update_date}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/15 text-white/90 backdrop-blur-sm border border-white/10 whitespace-nowrap">
                  去看看 →
                </span>
              </div>
            </div>
          </div>
        </a>
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════
// 卡片视图
// ═══════════════════════════════════════════════════════════

function CardsView({
  platforms,
  hiddenItems,
  onToggleVisibility,
}: {
  platforms: Array<{ platform: string; items: DailyHotItem[] }>;
  hiddenItems: Set<string>;
  onToggleVisibility: (id: string) => void;
}) {
  return (
    <div className="flex-1 min-h-0">
      <div
        className="h-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-4"
        style={{ gridTemplateRows: "repeat(auto-fill, minmax(150px, 1fr))" }}
      >
        {platforms.map(({ platform, items }) => (
          <PlatformCard
            key={platform}
            platform={platform}
            items={items}
            hiddenItems={hiddenItems}
            onToggleVisibility={onToggleVisibility}
          />
        ))}
      </div>
    </div>
  );
}

// 4.1: PlatformCard memo 化 —— props 稳定依赖 useCallback 后不再每帧父级渲染重渲染
const PlatformCard = memo(function PlatformCard({
  platform,
  items,
  hiddenItems,
  onToggleVisibility,
}: {
  platform: string;
  items: DailyHotItem[];
  hiddenItems: Set<string>;
  onToggleVisibility: (id: string) => void;
}) {
  const config = getPlatformConfig(platform);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showTopFade, setShowTopFade] = useState(false);
  const [showBottomFade, setShowBottomFade] = useState(false);
  // 4.3: 滚动 fade 仅在 boolean 翻转时 setState，并用 rAF 合并高频滚动，避免每帧 setState 与强制布局
  const rafScrollRef = useRef<number>(0);
  const fadeStateRef = useRef({ top: false, bottom: false });

  const checkScroll = () => {
    if (rafScrollRef.current) return;
    rafScrollRef.current = window.requestAnimationFrame(() => {
      rafScrollRef.current = 0;
      const el = scrollRef.current;
      if (!el) return;
      const nextTop = el.scrollTop > 0;
      const nextBottom = el.scrollTop < el.scrollHeight - el.clientHeight - 1;
      if (nextTop !== fadeStateRef.current.top) {
        fadeStateRef.current.top = nextTop;
        setShowTopFade(nextTop);
      }
      if (nextBottom !== fadeStateRef.current.bottom) {
        fadeStateRef.current.bottom = nextBottom;
        setShowBottomFade(nextBottom);
      }
    });
  };

  useEffect(() => {
    // items 变化时同步重算一次（非滚动路径，直接调度 rAF）
    checkScroll();
  }, [items]);

  useEffect(() => {
    return () => {
      if (rafScrollRef.current) cancelAnimationFrame(rafScrollRef.current);
    };
  }, []);

  return (
    <div className="liquid-panel hot-card-container rounded-2xl overflow-hidden flex flex-col h-full relative">
      <div data-role="platform-card-header" className={`bg-gradient-to-r ${config.color} px-4 py-2.5 flex items-center justify-between shrink-0`}>
        <div className="flex items-center gap-2">
          <span className="text-base">{config.emoji}</span>
          <h4 className="font-bold text-white text-sm">{config.name}</h4>
        </div>
        <span className="text-white/70 text-xs tabular-nums">{items.length} 条</span>
      </div>

      <div className="relative flex-1 min-h-0">
        {showTopFade && (
          <div className="absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-white/60 dark:from-slate-900/60 to-transparent pointer-events-none z-10" />
        )}

        <div
          ref={scrollRef}
          className="h-full overflow-y-auto scrollbar-hide px-2 py-1.5"
          onScroll={checkScroll}
        >
          {items.map((item, index) => {
            const key = `${platform}-${item.id}`;
            const hidden = hiddenItems.has(key);
            return (
              <div
                key={key}
                className={`hot-card-item group flex items-start px-2 rounded-lg hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors ${
                  hidden ? "opacity-35" : ""
                }`}
              >
                <span
                  className={`hot-card-item-meta text-xs font-bold w-5 text-center shrink-0 mt-px tabular-nums ${
                    index < 3 ? "text-orange-500" : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  {index + 1}
                </span>

                {item.cover && (
                  <img
                    src={item.cover}
                    alt=""
                    loading="lazy"
                    className="hot-card-item-cover rounded-lg object-cover shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                )}

                <div className="flex-1 min-w-0">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hot-card-item-title font-medium text-slate-700 dark:text-slate-200 hover:text-pink-500 dark:hover:text-pink-400 line-clamp-2 leading-snug"
                  >
                    {item.title}
                  </a>
                  <div className="flex items-center gap-2 mt-1">
                    {item.hot > 0 && (
                      <span className="hot-card-item-meta text-orange-500 font-medium tabular-nums">
                        🔥 {formatHot(item.hot)}
                      </span>
                    )}
                    {item.author && (
                      <span className="hot-card-item-meta text-slate-400 dark:text-slate-500 truncate max-w-[8rem]">
                        {item.author}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  onClick={(e) => { e.stopPropagation(); onToggleVisibility(key); }}
                  className="opacity-0 group-hover:opacity-100 shrink-0 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-opacity"
                  title={hidden ? "显示" : "隐藏"}
                >
                  {hidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
              </div>
            );
          })}
        </div>

        {showBottomFade && (
          <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white/60 dark:from-slate-900/60 to-transparent pointer-events-none z-10" />
        )}
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════
// DropdownMenu 辅助函数
// ═══════════════════════════════════════════════════════════

function viewModeItems(showAnime: boolean): DropdownMenuItem[] {
  const base: DropdownMenuItem[] = [
    {
      value: "cards",
      label: "卡片视图",
      icon: <LayoutGrid className="h-4 w-4" />,
    },
  ];
  if (showAnime) {
    base.push({
      value: "animeCalendar",
      label: "番剧日历",
      icon: <CalendarDays className="h-4 w-4" />,
    });
  }
  return base;
}

// ═══════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════

function formatHot(hot: number): string {
  if (hot >= 100_000_000) return (hot / 100_000_000).toFixed(1) + "亿";
  if (hot >= 10_000) return (hot / 10_000).toFixed(1) + "万";
  if (hot >= 1_000) return (hot / 1_000).toFixed(1) + "k";
  return String(hot);
}
