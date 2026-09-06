import { useMemo, useState } from "react";
import { ChevronDown, Eye, EyeOff, Flame } from "lucide-react";
import { useViewportClippedItems } from "../hooks/useViewportClippedItems";

// ─── 类型 ─────────────────────────────────────────────

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

interface MobileHotFeedProps {
  hotItems: Record<string, DailyHotItem[]>;
  availablePlatforms: string[];
  hiddenItems: Set<string>;
  onToggleVisibility: (itemId: string) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

// ─── 平台配置（精简版，仅手机端需要） ────────────────

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

const PLATFORM_CONFIG: Record<string, { name: string; emoji: string }> = {
  bilibili:   { name: "B站",     emoji: "📺" },
  weibo:      { name: "微博",    emoji: "💬" },
  zhihu:      { name: "知乎",    emoji: "❓" },
  douyin:     { name: "抖音",    emoji: "🎵" },
  toutiao:    { name: "头条",    emoji: "📰" },
  baidu:      { name: "百度",    emoji: "🔍" },
  "qq-news":  { name: "QQ新闻", emoji: "📋" },
  "sina-news":{ name: "新浪",    emoji: "📰" },
};

function getPlatformConfig(platform: string) {
  return PLATFORM_CONFIG[platform] || { name: platform, emoji: "📌" };
}

function getPlatformBarColor(platform: string): string {
  return PLATFORM_BAR_COLORS[platform] || "from-gray-400 via-gray-300 to-gray-200";
}

function formatHot(hot: number): string {
  if (hot >= 100_000_000) return (hot / 100_000_000).toFixed(1) + "亿";
  if (hot >= 10_000) return (hot / 10_000).toFixed(1) + "万";
  if (hot >= 1_000) return (hot / 1_000).toFixed(1) + "k";
  return String(hot);
}

// ─── 骨架屏 ──────────────────────────────────────────

function MobileHotFeedSkeleton() {
  return (
    <div className="mobile-hot-feed flex flex-col gap-3 px-2 pt-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="mobile-hot-feed-card-skeleton rounded-2xl skeleton-shimmer"
          style={{ height: "220px", animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  );
}

// ─── 空状态 ──────────────────────────────────────────

function MobileHotFeedEmpty() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400 dark:text-slate-500 py-16">
      <Flame className="h-10 w-10 opacity-40" />
      <span className="text-sm font-medium">暂无热点内容</span>
    </div>
  );
}

// ─── 错误/重试 ───────────────────────────────────────

function MobileHotFeedError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
      <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
        <Flame className="h-6 w-6 text-red-400" />
      </div>
      <span className="text-sm font-medium text-red-500">{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-5 py-2 text-sm font-medium rounded-xl liquid-button glass-hover text-slate-600 dark:text-slate-300 hover:text-pink-500 transition-colors"
        >
          重新加载
        </button>
      )}
    </div>
  );
}

// ─── 单条卡片 ────────────────────────────────────────

function MobileHotFeedCard({
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
  const isFirst3 = index < 3;

  return (
    <article
      data-clip-card
      className={`mobile-hot-feed-card group relative overflow-hidden rounded-2xl bg-white/60 shadow-sm backdrop-blur-md transition-shadow dark:bg-white/[0.07] ${
        hidden ? "opacity-35" : ""
      }`}
    >
      {/* 左侧平台渐变装饰条 */}
      <div className={`absolute left-0 top-0 z-10 h-full w-[3px] bg-gradient-to-b ${barColor}`} />

      {/* 封面图区域 */}
      {item.cover && !imgError ? (
        <div className="relative overflow-hidden bg-slate-200 dark:bg-slate-700" style={{ aspectRatio: "16 / 9" }}>
          {!imgLoaded && <div className="image-loading-shimmer absolute inset-0" />}
          <img
            src={item.cover}
            alt={item.title}
            loading="lazy"
            decoding="async"
            fetchPriority={isFirst3 ? "high" : "low"}
            referrerPolicy="no-referrer"
            className={`h-full w-full object-cover transition-all duration-300 group-hover:scale-105 ${
              imgLoaded ? "image-loaded" : "opacity-0"
            }`}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
          />

          {/* 梯度浮层 */}
          <div className="absolute bottom-0 left-0 right-0 z-10 px-3 pb-3 pt-10 bg-gradient-to-t from-black/75 via-black/30 to-transparent">
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

            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold leading-tight text-white line-clamp-2 group-hover:text-pink-300 transition-colors"
            >
              {item.title}
            </a>

            <div className="mt-0.5 flex items-center gap-2">
              {item.author && (
                <span className="truncate text-[10px] text-white/50 max-w-[50%]">{item.author}</span>
              )}
              <span className="ml-auto shrink-0 truncate rounded-md bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white/60 backdrop-blur-sm">
                {config.emoji} {config.name}
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* 无封面降级 */
        <div className="relative flex min-h-[130px] items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 px-4 py-6 dark:from-slate-800 dark:to-slate-700">
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

      {/* 隐藏按钮 */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleVisibility(key); }}
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

// ─── 主组件 ──────────────────────────────────────────

/**
 * MobileHotFeed — 手机端热点信息流
 *
 * - 合并所有平台条目，按热度降序排列
 * - 单列卡片信息流，适合手机窄屏幕
 * - content-visibility: auto 降低离屏渲染开销
 * - 图片 loading="lazy" + decoding="async"
 * - 仅渲染可视区 ± buffer，浏览器原生跳过离屏
 */
export function MobileHotFeed({
  hotItems,
  availablePlatforms,
  hiddenItems,
  onToggleVisibility,
  loading = false,
  error = null,
  onRetry,
}: MobileHotFeedProps) {
  // 合并 + 排序 + 过滤
  const mergedItems = useMemo(() => {
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

  // 虚拟滚动：随滚动动态扩展/收缩渲染区间
  const { clipRef, visibleStart, visibleEnd, visibleCount, isClipped } = useViewportClippedItems(mergedItems.length);
  const clippedItems = useMemo(
    () => mergedItems.slice(visibleStart, visibleEnd),
    [mergedItems, visibleStart, visibleEnd],
  );

  // ── 加载态 ──
  if (loading && mergedItems.length === 0) {
    return <MobileHotFeedSkeleton />;
  }

  // ── 错误态（无缓存数据） ──
  if (error && mergedItems.length === 0) {
    return <MobileHotFeedError message={error} onRetry={onRetry} />;
  }

  // ── 空态 ──
  if (mergedItems.length === 0) {
    return <MobileHotFeedEmpty />;
  }

  // ── 正常渲染 ──
  return (
    <div className="mobile-hot-feed flex flex-col gap-3 px-0 pt-2 pb-4">
      {/* 辅助信息行 */}
      <div className="flex shrink-0 items-center gap-2 px-1">
        <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
          {availablePlatforms.length} 个平台 · {mergedItems.length} 条热点 · 按热度排序
        </span>
      </div>

      {/* 卡片列表 */}
      <div ref={clipRef} className="flex flex-col gap-3">
        {clippedItems.map(({ item, platform }, idx) => (
          <MobileHotFeedCard
            key={`${platform}-${item.id}`}
            item={item}
            index={visibleStart + idx}
            platform={platform}
            hiddenItems={hiddenItems}
            onToggleVisibility={onToggleVisibility}
          />
        ))}
      </div>

      {isClipped && (
        <div className="flex shrink-0 items-center justify-center gap-1.5 px-1 py-2 text-[10px] text-slate-400 dark:text-slate-500">
          <ChevronDown className="h-3 w-3 animate-bounce" />
          <span>滚动加载更多 · 已显示 {visibleCount} / {mergedItems.length}</span>
        </div>
      )}
    </div>
  );
}