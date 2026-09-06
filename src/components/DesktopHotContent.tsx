import { useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Flame, ChevronDown } from "lucide-react";
import { useContainerColumns, distributeToColumns } from "../hooks/useContainerColumns";
import { useViewportClippedItems } from "../hooks/useViewportClippedItems";

// ===============================
// Types
// ===============================

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

interface DesktopHotContentProps {
  hotItems: Record<string, DailyHotItem[]>;
  availablePlatforms: string[];
  hiddenItems: Set<string>;
  onToggleVisibility: (itemId: string) => void;
  loading?: boolean;
  error?: string | null;
}

// ===============================
// 平台配置
// ===============================

const PLATFORM_CONFIG: Record<string, { name: string; emoji: string; color: string }> = {
  bilibili:   { name: "B站",     emoji: "📺", color: "from-pink-500 to-red-500" },
  weibo:      { name: "微博",    emoji: "💬", color: "from-orange-500 to-yellow-500" },
  zhihu:      { name: "知乎",    emoji: "❓", color: "from-blue-500 to-cyan-500" },
  douyin:     { name: "抖音",    emoji: "🎵", color: "from-purple-500 to-pink-500" },
  toutiao:    { name: "头条",    emoji: "📰", color: "from-red-500 to-orange-500" },
  baidu:      { name: "百度",    emoji: "🔍", color: "from-blue-600 to-blue-400" },
  "qq-news":  { name: "QQ新闻",  emoji: "📋", color: "from-blue-500 to-purple-500" },
  "sina-news":{ name: "新浪",    emoji: "📰", color: "from-red-600 to-red-400" },
};

// 左侧装饰条颜色映射
const PLATFORM_BAR_COLORS: Record<string, string> = {
  bilibili:   "from-pink-500 via-red-400 to-pink-300",
  weibo:      "from-orange-500 via-yellow-400 to-orange-300",
  zhihu:      "from-blue-500 via-cyan-400 to-blue-300",
  douyin:     "from-purple-500 via-pink-400 to-purple-300",
  toutiao:    "from-red-500 via-orange-400 to-red-300",
  baidu:      "from-blue-600 via-sky-400 to-blue-300",
  "qq-news":  "from-blue-500 via-indigo-400 to-purple-300",
  "sina-news":"from-red-600 via-rose-400 to-red-300",
};

function getPlatformConfig(platform: string) {
  return PLATFORM_CONFIG[platform] || {
    name: platform,
    emoji: "📌",
    color: "from-gray-500 to-gray-400",
  };
}

function getPlatformBarColor(platform: string): string {
  return PLATFORM_BAR_COLORS[platform] || "from-gray-400 via-gray-300 to-gray-200";
}

// ===============================
// 工具函数
// ===============================

function formatHot(hot: number): string {
  if (hot >= 100_000_000) return (hot / 100_000_000).toFixed(1) + "亿";
  if (hot >= 10_000) return (hot / 10_000).toFixed(1) + "万";
  if (hot >= 1_000) return (hot / 1_000).toFixed(1) + "k";
  return String(hot);
}

// ===============================
// HotWaterfallCard — 瀑布流紧凑卡片
// ===============================

function HotWaterfallCard({
  item,
  index,
  platform,
  hiddenItems,
  onToggleVisibility,
}: {
  item: DailyHotItem;
  index: number;
  platform: string;
  hiddenItems: Set<string>;
  onToggleVisibility: (key: string) => void;
}) {
  const key = `${platform}-${item.id}`;
  const hidden = hiddenItems.has(key);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const barColor = getPlatformBarColor(platform);
  const config = getPlatformConfig(platform);

  const isTop3 = index < 3;

  return (
    <article
      data-clip-card
      className={`anime-card-enter group relative overflow-hidden rounded-2xl bg-white/60 shadow-sm backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:bg-white/[0.07] ${
        hidden ? "opacity-35" : ""
      }`}
      style={{ animationDelay: `${Math.min(index, 20) * 30}ms` }}
    >
      {/* 左侧平台渐变装饰条 */}
      <div className={`absolute left-0 top-0 z-10 h-full w-[3px] bg-gradient-to-b ${barColor}`} />

      {/* 封面图片区域 */}
      {item.cover && !imgError ? (
        <div className="relative overflow-hidden bg-slate-200 dark:bg-slate-700" style={{ aspectRatio: "16 / 9" }}>
          {/* Loading shimmer */}
          {!imgLoaded && (
            <div className="image-loading-shimmer absolute inset-0" />
          )}
          <img
            src={item.cover}
            alt={item.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            className={`h-full w-full object-cover transition-all duration-300 group-hover:scale-105 ${
              imgLoaded ? "image-loaded" : "opacity-0"
            }`}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
          />

          {/* 梯度信息浮层 */}
          <div className="absolute bottom-0 left-0 right-0 z-10 px-3 pb-3 pt-10 bg-gradient-to-t from-black/75 via-black/30 to-transparent transition-opacity duration-200">
            {/* 排名 TOP 3 徽标 + 热度 */}
            <div className="mb-1 flex items-center justify-between gap-2">
              {isTop3 ? (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-400/90 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                  TOP {index + 1}
                </span>
              ) : (
                <span className="text-[10px] font-bold tabular-nums text-white/60">{index + 1}</span>
              )}
              {item.hot > 0 && (
                <span className="text-[10px] font-medium tabular-nums text-white/70">
                  🔥 {formatHot(item.hot)}
                </span>
              )}
            </div>

            {/* 标题 line-clamp-2 */}
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold leading-tight text-white line-clamp-2 group-hover:text-pink-300 transition-colors"
            >
              {item.title}
            </a>

            {/* 作者 + 平台标签 */}
            <div className="mt-0.5 flex items-center gap-2">
              {item.author && (
                <span className="truncate text-[10px] text-white/50">{item.author}</span>
              )}
              <span className="ml-auto shrink-0 truncate rounded-md bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white/60 backdrop-blur-sm">
                {config.emoji} {config.name}
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* 无封面或加载失败 → 纯文字降级 */
        <div className="relative flex min-h-[120px] items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 px-3 py-6 dark:from-slate-800 dark:to-slate-700">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="text-3xl">📄</span>
            <h4 className="text-xs font-bold leading-tight text-slate-600 line-clamp-2 dark:text-slate-300">
              {item.title}
            </h4>
            <div className="flex items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500">
              {item.hot > 0 && <span>🔥 {formatHot(item.hot)}</span>}
              {item.author && <span>{item.author}</span>}
              <span className="rounded-md bg-white/60 px-1.5 py-0.5 dark:bg-white/[0.06]">
                {config.emoji} {config.name}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 隐藏/显示按钮 — 右上角 absolute */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleVisibility(key);
        }}
        className={`absolute right-2 top-2 z-20 rounded-full p-1.5 text-white/80 backdrop-blur-sm opacity-0 transition-all hover:bg-white/20 hover:text-white group-hover:opacity-100 ${
          item.cover && !imgError ? "" : "text-slate-500 dark:text-slate-300"
        }`}
        title={hidden ? "显示" : "隐藏"}
      >
        {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </article>
  );
}

// ===============================
// HotWaterfallSkeleton — 瀑布流骨架屏
// ===============================

/** 骨架块候选高度（px），轮换取值模拟真实图片比例差异 */
const SKELETON_HEIGHTS = [140, 190, 120, 210, 160];

function HotWaterfallSkeleton({ cols }: { cols: number }) {
  return (
    <div className="flex gap-3 items-start pt-2">
      {Array.from({ length: cols }).map((_, colIdx) => (
        <div key={colIdx} className="flex-1 min-w-0 flex flex-col gap-3">
          {Array.from({ length: Math.max(2, Math.ceil(12 / cols)) }).map((_, i) => {
            const height = SKELETON_HEIGHTS[(colIdx * 3 + i) % SKELETON_HEIGHTS.length];
            return (
              <div
                key={i}
                className="rounded-2xl skeleton-shimmer"
                style={{
                  height: `${height}px`,
                  animationDelay: `${(colIdx * 3 + i) * 50}ms`,
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ===============================
// HotWaterfallView — 多列瀑布流容器
// ===============================

function HotWaterfallView({
  items,
  columnCount,
  waterfallContainerRef,
  hiddenItems,
  onToggleVisibility,
}: {
  items: Array<{ item: DailyHotItem; platform: string }>;
  columnCount: number;
  waterfallContainerRef: React.RefObject<HTMLDivElement | null>;
  hiddenItems: Set<string>;
  onToggleVisibility: (key: string) => void;
}) {
  // 虚拟滚动：随滚动动态扩展/收缩渲染区间
  const { clipRef, visibleStart, visibleEnd, visibleCount, isClipped } = useViewportClippedItems(items.length);

  const clippedItems = useMemo(
    () => items.slice(visibleStart, visibleEnd),
    [items, visibleStart, visibleEnd],
  );

  const columns = useMemo(
    () => distributeToColumns(clippedItems, columnCount),
    [clippedItems, columnCount],
  );

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400 dark:text-slate-500">
        <Flame className="h-8 w-8 opacity-40" />
        <span className="text-sm">暂无热点内容</span>
      </div>
    );
  }

  return (
    <div ref={waterfallContainerRef} className="hot-waterfall flex-1 min-h-0 overflow-y-auto scrollbar-hide pt-2 pb-4" style={{ pointerEvents: "auto" }}>
      <div ref={clipRef} className="flex gap-3 items-start">
        {columns.map((colItems, colIdx) => (
          <div key={colIdx} className="flex-1 min-w-0 flex flex-col gap-3">
            {colItems.map(({ item, platform }, itemIdx) => (
              <HotWaterfallCard
                key={`${platform}-${item.id}`}
                item={item}
                // 索引修正为全局位置（保留原排序热度名次）
                index={visibleStart + itemIdx * columnCount + colIdx}
                platform={platform}
                hiddenItems={hiddenItems}
                onToggleVisibility={onToggleVisibility}
              />
            ))}
          </div>
        ))}
      </div>
      {isClipped && (
        <div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
          <ChevronDown className="h-3 w-3 animate-bounce" />
          <span>滚动加载更多 · 已显示 {visibleCount} / {items.length}</span>
        </div>
      )}
    </div>
  );
}

// ===============================
// DesktopHotContent（主组件）
// ===============================

export function DesktopHotContent({
  hotItems,
  availablePlatforms,
  hiddenItems,
  onToggleVisibility,
  loading = false,
  error = null,
}: DesktopHotContentProps) {
  // 瀑布流容器宽度观测 ref，骨架屏和真实视图共享列数
  const waterfallContainerRef = useRef<HTMLDivElement | null>(null);
  const columnCount = useContainerColumns(waterfallContainerRef);

  // 所有平台热点条目混合并按热度排序
  const allItems = useMemo(() => {
    const result: Array<{ item: DailyHotItem; platform: string }> = [];

    for (const platform of availablePlatforms) {
      const items = hotItems[platform];
      if (!items || items.length === 0) continue;
      for (const item of items) {
        const key = `${platform}-${item.id}`;
        if (!hiddenItems.has(key)) {
          result.push({ item, platform });
        }
      }
    }

    result.sort((a, b) => (b.item.hot ?? 0) - (a.item.hot ?? 0));
    return result;
  }, [hotItems, availablePlatforms, hiddenItems]);

  // Loading 状态 — 瀑布流骨架屏
  if (loading && Object.keys(hotItems).length === 0) {
    return (
      <div className="flex h-full max-h-full min-h-0 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 px-1 pb-2">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            加载热点内容中...
          </span>
        </div>
        <div ref={waterfallContainerRef} className="hot-waterfall flex-1 min-h-0 overflow-y-auto scrollbar-hide">
          <HotWaterfallSkeleton cols={columnCount} />
        </div>
      </div>
    );
  }

  // Error 状态
  if (error) return null;

  return (
    <div
      className="flex min-h-0 flex-col overflow-hidden"
      style={{ height: "100%", maxHeight: "100%", minHeight: 0, boxSizing: "border-box" }}
    >
      {/* 顶部信息行 */}
      <div className="flex shrink-0 items-center gap-2 px-1 pb-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {availablePlatforms.length} 个平台 · {allItems.length} 条热点 · 按热度排序
        </span>
      </div>

      {/* 瀑布流 */}
      <HotWaterfallView
        items={allItems}
        columnCount={columnCount}
        waterfallContainerRef={waterfallContainerRef}
        hiddenItems={hiddenItems}
        onToggleVisibility={onToggleVisibility}
      />
    </div>
  );
}