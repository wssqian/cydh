import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Image,
  Inbox,
  RefreshCw,
  Terminal,
  Trophy,
  UserRound,
  X,
} from "lucide-react";
import { toPixivImageUrl, downloadImageAsFile, buildDownloadCommand } from "../acg-images";
import { readAcgPageCacheSWR, writeAcgPageCache, prefetchAcgModes } from "../acg-page-cache";
import { useMasonryCols, distributeToColumns } from "../lib/masonry";
import { useGroup } from "../context";
import { CommunityGate } from "../components/CommunityGate";
import ZoomableImageViewer from "../components/ZoomableImageViewer";

interface PixivIllustItem {
  rank: number;
  title: string;
  author: string;
  illustId: string;
  coverUrl: string;
  originalUrl: string | null;
  description: string;
  tags: string[];
  viewCount: number;
  uploadDate: string | null;
  pageCount: number;
  width: number | null;
  height: number | null;
  pixivUrl: string;
}

type PixivMode = "daily" | "weekly" | "monthly" | "rookie";

const MODE_TABS: Array<{ mode: PixivMode; label: string; Icon: typeof CalendarDays }> = [
  { mode: "daily", label: "日榜", Icon: CalendarDays },
  { mode: "weekly", label: "周榜", Icon: BarChart3 },
  { mode: "monthly", label: "月榜", Icon: Trophy },
  { mode: "rookie", label: "新人榜", Icon: UserRound },
];
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const ALL_MODES: PixivMode[] = ["daily", "weekly", "monthly", "rookie"];
const pixivCacheKey = (m: PixivMode) => `pixivPage:v4:${m}`;
const PREFETCH_INTERVAL_MS = 2000;

/** 是否启用跨 mode 后台预缓存：节省流量模式下跳过。 */
function shouldPrefetch(): boolean {
  const conn = (typeof navigator !== "undefined" ? (navigator as any).connection : undefined) as
    | { saveData?: boolean } | undefined;
  return !conn?.saveData;
}

/* ─────────────────────────────────────────────
 * 主组件
 * ───────────────────────────────────────────── */
export default function PixivPage() {
  const [items, setItems] = useState<PixivIllustItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<PixivMode>("daily");
  const [selectedItem, setSelectedItem] = useState<PixivIllustItem | null>(null);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const changeSelection = useCallback(
    (next: number) => {
      setSelectedIndex(next);
      setSelectedItem(items[next] ?? null);
    },
    [items],
  );

  const cols = useMasonryCols();
  const columns = useMemo(() => distributeToColumns(items, cols), [items, cols]);
  const { communityUnlocked, communityChecking, unlockCommunity, markCommunityLocked } = useGroup();

  const fetchData = useCallback(
    async (m: PixivMode, force = false) => {
      const cacheKey = pixivCacheKey(m);
      if (!force) {
        const swr = readAcgPageCacheSWR<PixivIllustItem[]>(cacheKey, CACHE_TTL_MS);
        if (swr) {
          // 热缓存（含过期但存在）：先直出缓存数据，绝不进入骨架阻塞路径。
          setItems(swr.data);
          setLoading(false);
          setError(null);
          if (!swr.isStale) return;
          try {
            const res = await fetch(`/api/public/pixiv-ranking?mode=${m}`);
            if (res.status === 401) {
              markCommunityLocked();
              return;
            }
            if (!res.ok) return;
            const json = await res.json();
            if (json.code === 0 && json.data) {
              setItems(json.data);
              writeAcgPageCache(cacheKey, json.data);
            }
          } catch {
            /* 静默：保留缓存数据 */
          }
          return;
        }
      }

      // 冷缓存/强制刷新：显骨架再等待响应。
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/public/pixiv-ranking?mode=${m}`);
        if (res.status === 401) {
          markCommunityLocked();
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.code !== 0 || !json.data) throw new Error(json.error || "API error");
        setItems(json.data);
        writeAcgPageCache(cacheKey, json.data);
      } catch (err) {
        const swr = readAcgPageCacheSWR<PixivIllustItem[]>(cacheKey, Infinity);
        if (swr?.data?.length) setItems(swr.data);
        setError(err instanceof Error ? err.message : "加载失败");
        console.error("[pixiv] error:", err);
      } finally {
        setLoading(false);
      }
    },
    [markCommunityLocked],
  );

  useEffect(() => {
    fetchData(mode);
  }, [mode, fetchData]);

  /* 跨 mode 后台预缓存：活跃 mode 加载完成后，串行预取其余 mode 写入 SWR 缓存。
   * 预取请求走浏览器 HTTP 缓存（force-cache）+ 服务端内存缓存，不新增上游调用频次；
   * 页面隐藏暂停、卸载清理；节省流量模式跳过。 */
  useEffect(() => {
    if (!shouldPrefetch()) return;
    let stop: (() => void) | null = null;
    let cancelled = false;

    const arm = () => {
      if (cancelled) return;
      const others = ALL_MODES.filter((m) => m !== mode);
      stop = prefetchAcgModes<PixivIllustItem[]>(
        pixivCacheKey,
        others,
        async (m) => {
          const res = await fetch(`/api/public/pixiv-ranking?mode=${m}`, { cache: "force-cache" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          if (json.code !== 0 || !json.data) throw new Error(json.error || "API error");
          return json.data as PixivIllustItem[];
        },
        PREFETCH_INTERVAL_MS,
      );
    };

    // 仅在当前 mode 已存在缓存或加载完成后才启动预取，避免与首屏竞争。
    const curSwr = readAcgPageCacheSWR<PixivIllustItem[]>(pixivCacheKey(mode), CACHE_TTL_MS);
    if (curSwr) arm();
    else {
      // 首屏冷缓存：等首次 items 写入后再 arm（轮询轻量）。
      const t = setInterval(() => {
        const swr = readAcgPageCacheSWR<PixivIllustItem[]>(pixivCacheKey(mode), Infinity);
        if (swr || cancelled) {
          clearInterval(t);
          if (!cancelled) arm();
        }
      }, 800);
    }

    const onVisibility = () => {
      if (document.hidden) {
        stop?.();
        stop = null;
      } else if (!stop && !cancelled) {
        arm();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      stop?.();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mode]);

  return (
    <CommunityGate unlocked={communityUnlocked} checking={communityChecking} unlock={unlockCommunity} title="P站美图榜">
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-6 sm:py-10">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center">
            <Image className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white">P站美图榜</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Pixiv 插画排行榜</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!loading && items.length > 0 && (
            <span className="liquid-chip text-xs px-3 py-1 rounded-full">{items.length} 件作品</span>
          )}
          <button
            onClick={() => fetchData(mode, true)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl liquid-button text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-pink-500 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            刷新
          </button>
        </div>
      </div>

      {/* ── Mode Tabs ── */}
      <div className="flex justify-center mb-6">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide px-1">
          {MODE_TABS.map(({ mode: tabMode, label, Icon }) => (
            <button
              key={tabMode}
              onClick={() => {
                setMode(tabMode);
                setSelectedItem(null);
              }}
              className={`shrink-0 flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-full text-sm font-medium transition-all ${
                mode === tabMode
                  ? "liquid-button-primary text-white shadow-md"
                  : "liquid-button glass-hover text-slate-600 hover:text-pink-500 dark:text-slate-300"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      {loading && items.length === 0 ? (
        /* ── 瀑布流骨架屏 ── */
        <div className="flex gap-3 items-start">
          {Array.from({ length: Math.min(cols, 5) }).map((_, colIdx) => (
            <div key={colIdx} className="flex-1 flex flex-col gap-3 min-w-0">
              {Array.from({ length: Math.max(2, Math.ceil(15 / cols)) }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-2xl bg-slate-200/30 dark:bg-slate-700/20 skeleton-shimmer"
                  style={{
                    height: `${[140, 190, 120, 210, 160][(colIdx * 5 + i) % 5]}px`,
                    animationDelay: `${(colIdx * 3 + i) * 50}ms`,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      ) : error && items.length === 0 ? (
        /* ── 错误状态 ── */
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
            <Inbox className="w-7 h-7 text-red-400" />
          </div>
          <div className="text-red-500 text-sm font-medium">{error}</div>
          <button
            onClick={() => fetchData(mode, true)}
            className="liquid-button px-6 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-pink-500 rounded-xl"
          >
            重新加载
          </button>
        </div>
      ) : (
        /* ── 瀑布流展示 — 响应式列布局 ──
         * 不使用 key={mode}：让 React 按 illustId 复用卡片 DOM，避免切 mode 整列重挂载闪烁；
         * 同 mode 的 revalidate 更新也不重走缩略图 loading→loaded 动画。 */
        <div key="grid" className="flex gap-3 items-start">
          {columns.map((colItems, colIdx) => (
            <div key={colIdx} className="flex flex-col gap-3 flex-1 min-w-0">
              {colItems.map((item, itemIdx) => {
                /* 还原原始数组索引用于动画和排名徽标 */
                const originalIndex = itemIdx * cols + colIdx;
                return (
                  <PixivCard
                    key={item.illustId}
                    item={item}
                    index={originalIndex}
                    priority={originalIndex < cols}
                    onOpen={() => {
                      setSelectedIndex(originalIndex);
                      setSelectedItem(item);
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* ── Detail Modal ── */}
      {selectedItem && (
        <PixivDetailModal
          item={selectedItem}
          index={selectedIndex}
          total={items.length}
          allItems={items}
          onClose={() => setSelectedItem(null)}
          onPrev={() => changeSelection(selectedIndex - 1)}
          onNext={() => changeSelection(selectedIndex + 1)}
          onSelectIndex={changeSelection}
        />
      )}
    </div>
    </CommunityGate>
  );
}

/* ═══════════════════════════════════════════════
 * PixivCard ─ 瀑布流卡片（信息浮层 Overlay 版）
 * ═══════════════════════════════════════════════ */
function PixivCard({
  item,
  index,
  priority,
  onOpen,
}: {
  item: PixivIllustItem;
  index: number;
  priority?: boolean;
  onOpen: () => void;
}) {
  const [imageState, setImageState] = useState<"loading" | "loaded" | "error">("loading");
  const imageUrl = toPixivImageUrl(item.coverUrl);

  useEffect(() => {
    setImageState("loading");
  }, [item.coverUrl]);

  const handleImageLoad = () => setImageState("loaded");
  const handleImageError = () => setImageState("error");

  // 保留原始构图：contain 完整显示；仅当图片超宽（width/height > 2）时回退 cover 居中裁剪，
  // 避免横向大片空白。容器 aspect-ratio 由真实宽高比锁定，列高不受影响。
  const fitWideRatio =
    item.width != null && item.height != null && item.height > 0 && item.width / item.height > 2;
  const fitClass = fitWideRatio ? "object-cover" : "object-contain";

  return (
    <article
      role="button"
      tabIndex={0}
      className="anime-card-enter group acg-image-card rounded-2xl liquid-panel cursor-pointer transition-all duration-200 w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400/70 hover:shadow-xl hover:-translate-y-0.5"
      style={{ "--enter-delay": Math.min(index, 20) * 30 } as CSSProperties}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      {/* ── 图片容器（宽高比自适应） ── */}
      <div
        className="relative overflow-hidden bg-slate-200 dark:bg-slate-700"
        style={{
          aspectRatio:
            item.width && item.height ? `${item.width}/${item.height}` : "3/4",
        }}
      >
        {/* 骨架占位层 — 图片加载中 */}
        {(imageState === "loading" || !imageUrl) && (
          <div
            className={`absolute inset-0 z-10 ${
              imageState === "loading" && imageUrl ? "image-loading-shimmer" : ""
            }`}
          />
        )}

        {/* 图片层 — 加载完成后淡入，悬停缩放 */}
        {imageUrl && (
          <img
            src={imageUrl}
            alt={item.title}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            decoding="async"
            referrerPolicy="no-referrer"
            className={`w-full h-full ${fitClass} transition-all duration-300 group-hover:scale-105 ${
              imageState === "loaded" ? "image-loaded" : "opacity-0"
            }`}
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
        )}

        {/* 加载失败占位 — 图片出错时替代 */}
        {imageState === "error" && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 p-2 image-error bg-slate-200/50 dark:bg-slate-700/50">
            <Image className="w-6 h-6 text-slate-400" />
            <span className="text-xs text-slate-500 dark:text-slate-400 text-center line-clamp-2 leading-tight">
              {item.title}
            </span>
          </div>
        )}

        {/* ── 信息浮层（Gradient Overlay） ── */}
        {imageState !== "error" && imageUrl && (
          <div
            className={`absolute bottom-0 left-0 right-0 z-10 px-3 pb-3 pt-8 bg-gradient-to-t from-black/75 via-black/30 to-transparent transition-opacity duration-200 ${
              imageState === "loaded"
                ? "opacity-100"
                : "opacity-0"
            }`}
          >
            {/* 行 1：排名徽标 + 浏览量 */}
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-1 flex-wrap">
                {index < 3 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-amber-400/90 text-amber-900 text-[10px] font-bold shadow">
                    TOP {index + 1}
                  </span>
                )}
              </div>
              {item.viewCount > 0 && (
                <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] text-white/70">
                  <Eye className="w-3 h-3" />
                  {item.viewCount.toLocaleString()}
                </span>
              )}
            </div>

            {/* 行 2：标题 — 最多 2 行截断 */}
            <h4 className="text-xs font-bold text-white leading-tight line-clamp-2 group-hover:text-pink-300 transition-colors">
              {item.title}
            </h4>

            {/* 行 3：作者名 */}
            <p className="text-[10px] text-white/50 mt-0.5 truncate">{item.author}</p>
          </div>
        )}
      </div>
    </article>
  );
}

/* ═══════════════════════════════════════════════
 * PixivDetailModal — 作品详情弹窗（重设计版）
 * ═══════════════════════════════════════════════ */

function formatUploadDate(value: string | null): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, "0")}月${String(date.getDate()).padStart(2, "0")}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const THUMB_VISIBLE = 11; /* 前后各 5 + 当前 */

type ImageLoadState = "loading-original" | "retrying-proxy" | "original" | "cover" | "failed";

function PixivDetailModal({
  item,
  index,
  total,
  allItems,
  onClose,
  onPrev,
  onNext,
  onSelectIndex,
}: {
  item: PixivIllustItem;
  index: number;
  total: number;
  allItems: PixivIllustItem[];
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSelectIndex: (idx: number) => void;
}) {
  const [imageLoadState, setImageLoadState] = useState<ImageLoadState>("loading-original");
  const [downloadState, setDownloadState] = useState<"idle" | "loading" | "error">("idle");
  const [downloadHint, setDownloadHint] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  /** 从服务端返回的 i0.wp.com CDN 镜像 URL 推导出 i.pximg.net 直链，供终端下载命令和代理回退使用（Clash 代理会匹配 pximg.net 规则） */
  const pixivNetOriginalUrl = useMemo(() => {
    if (!item.originalUrl) return null;
    // https://i0.wp.com/i.pximg.org/{path} → https://i.pximg.net/{path}
    return item.originalUrl.replace("https://i0.wp.com/i.pximg.org", "https://i.pximg.net");
  }, [item.originalUrl]);

  const imageUrl =
    imageLoadState === "failed"
      ? ""
      : (imageLoadState === "loading-original" || imageLoadState === "original") && item.originalUrl
        ? item.originalUrl
        : imageLoadState === "retrying-proxy" && pixivNetOriginalUrl
          ? toPixivImageUrl(pixivNetOriginalUrl)
          : toPixivImageUrl(item.coverUrl);

  const downloadCommand = useMemo(
    () => (pixivNetOriginalUrl ? buildDownloadCommand(pixivNetOriginalUrl, `pixiv-${item.illustId}`) : null),
    [item.illustId, pixivNetOriginalUrl],
  );

  /* ── lifecycle ── */
  useEffect(() => {
    // If no originalUrl, skip original attempt and go directly to cover
    if (!item.originalUrl) {
      setImageLoadState("cover");
    } else {
      setImageLoadState("loading-original");
    }
    setCopied(false);
    setIsClosing(false);
  }, [item.illustId, item.originalUrl]);

  useEffect(() => {
    setDownloadState("idle");
    setDownloadHint(null);
  }, [item.illustId]);

  /* ── close animation ── */
  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => onClose(), 200);
  }, [onClose]);

  /* ── image fallback ── */
  const onImageError = useCallback(() => {
    setImageLoadState((current) => {
      if (current === "loading-original") return "retrying-proxy";
      if (current === "retrying-proxy") return "cover";
      if (current === "original") return "cover";
      if (current === "cover") return "failed";
      return current;
    });
  }, []);

  const onImageLoad = useCallback(() => {
    setImageLoadState((current) => {
      if (current === "loading-original") return "original";
      if (current === "retrying-proxy") return "original";
      return current;
    });
  }, []);

  const handleRetryOriginal = useCallback(() => {
    setImageLoadState("loading-original");
  }, []);

  /* ── keyboard ── */
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
      else if (event.key === "ArrowLeft" && index > 0) onPrev();
      else if (event.key === "ArrowRight" && index < total - 1) onNext();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [index, total, onPrev, onNext, handleClose]);

  /* ── download ── */
  const handleDownload = useCallback(async () => {
    if (downloadState === "loading") return;

    setDownloadState("loading");
    setDownloadHint("正在通过边缘网络拉取原图…");

    const filename = `pixiv-${item.illustId}`;

    if (item.originalUrl) {
      try {
        await downloadImageAsFile(item.originalUrl, filename);
        setDownloadState("idle");
        setDownloadHint(null);
        return;
      } catch {
        setDownloadHint("直链下载失败，尝试通过代理拉取原图…");
      }

      /* 直链下载失败时，尝试通过服务端代理重定向（Worker / CDN）拉取 */
      try {
        await downloadImageAsFile(toPixivImageUrl(pixivNetOriginalUrl), filename);
        setDownloadState("idle");
        setDownloadHint(null);
        return;
      } catch {
        setDownloadHint("原图下载失败，正在尝试封面…");
      }
    } else {
      setDownloadHint("原图直链不可用，正在尝试封面…");
    }

    try {
      await downloadImageAsFile(toPixivImageUrl(item.coverUrl), filename);
      setDownloadState("idle");
      setDownloadHint(item.originalUrl ? "原图下载失败，已保存封面" : null);
      return;
    } catch {
      setDownloadHint("原图与封面均下载失败；可用下方命令自行下载，或在 Pixiv 查看");
    }

    setDownloadState("error");
  }, [downloadState, item.illustId, item.originalUrl, item.coverUrl]);

  const copyCommand = useCallback(async () => {
    if (!downloadCommand) return;
    try {
      await navigator.clipboard.writeText(downloadCommand.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 静默 */
    }
  }, [downloadCommand]);

  /* ── thumbnail strip ──
   * 直接返回窗口起始索引与切片，渲染时用 start + offset 计算 O(1) 全局索引，
   * 不再 allItems.indexOf(item) 全表线性查找。 */
  const thumbRange = useMemo(() => {
    const half = Math.floor(THUMB_VISIBLE / 2);
    let start = Math.max(0, index - half);
    const end = Math.min(total, start + THUMB_VISIBLE);
    if (end - start < THUMB_VISIBLE) start = Math.max(0, end - THUMB_VISIBLE);
    return { start, items: allItems.slice(start, end) };
  }, [allItems, index, total]);

  /* ── 相邻作品目标图预读 ──
   * 切换作品时按切换方向预读相邻 2 张的目标图（原图优先，无则封面），
   * 通过 new Image().src 触发浏览器缓存，命中后切换不再走 loading-original 全流程。
   * 仅单向预读本方向，反向（已离开）不预取；requestIdleCallback 调度。 */
  const prevIndexRef = useRef(index);
  useEffect(() => {
    const prev = prevIndexRef.current;
    prevIndexRef.current = index;
    const dir = index > prev ? 1 : index < prev ? -1 : 0;
    if (dir === 0) return;
    const targets: number[] = [index + dir, index + 2 * dir].filter((i) => i >= 0 && i < total);
    if (targets.length === 0) return;
    const schedule = () => {
      for (const i of targets) {
        const it = allItems[i];
        if (!it) continue;
        const url = it.originalUrl ? toPixivImageUrl(it.originalUrl) : toPixivImageUrl(it.coverUrl);
        if (!url) continue;
        // 用 createElement 生成 img 预热缓存，避开与 lucide 的 Image 图标重名。
        const img = document.createElement("img");
        img.src = url;
      }
    };
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => schedule());
    } else {
      setTimeout(schedule, 0);
    }
  }, [index, total, allItems]);

  /* ── render ── */
  return createPortal(
    <div
      role="dialog"
      aria-label="Pixiv 作品详情"
      className="fixed inset-0 z-[100] flex items-center justify-center p-0 sm:p-4"
      style={{ perspective: "1200px" }}
    >
      {/* Backdrop */}
      <div
        aria-hidden="true"
        className={`absolute inset-0 bg-slate-950/40 backdrop-blur-[2px] transition-opacity duration-200 ${isClosing ? "opacity-0" : "opacity-100"}`}
        onClick={handleClose}
      />

      {/* Panel */}
      <div
        className={`pointer-events-auto relative z-10 w-full sm:max-w-[92vw] lg:max-w-[88vw] xl:max-w-[84vw] 2xl:max-w-[80vw] h-full sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden rounded-none sm:rounded-[1.75rem] bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-black/[0.04] dark:ring-white/10 transition-all duration-200 ${
          isClosing
            ? "opacity-0 scale-[0.96] -translate-y-1"
            : "opacity-100 scale-100 translate-y-0"
        }`}
      >
        {/* ── Header ── */}
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 lg:px-6 py-3 border-b border-slate-200/60 dark:border-slate-700/40 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={onPrev}
              disabled={index <= 0}
              className="shrink-0 p-1.5 rounded-full text-slate-400 hover:text-pink-500 hover:bg-pink-50 dark:hover:bg-pink-900/20 disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition-colors"
              aria-label="上一张"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="shrink-0 text-sm tabular-nums text-slate-400 font-medium">
              {index + 1}<span className="text-slate-300 dark:text-slate-600"> / {total}</span>
            </span>
            <button
              type="button"
              onClick={onNext}
              disabled={index >= total - 1}
              className="shrink-0 p-1.5 rounded-full text-slate-400 hover:text-pink-500 hover:bg-pink-50 dark:hover:bg-pink-900/20 disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition-colors"
              aria-label="下一张"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <h2 className="ml-1 text-sm sm:text-base font-semibold text-slate-700 dark:text-slate-200 truncate">
              {item.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="shrink-0 p-2 -mr-1 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="min-h-0 flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* ── 左：图片区 ── */}
          <div className="relative flex flex-col flex-grow min-h-[40vh] landscape:min-h-[60vh] lg:min-h-0 bg-slate-900/85 dark:bg-black/90">
            {/* Zoomable Image */}
            <div className="flex-1 min-h-0 relative">
              {imageUrl ? (
                <ZoomableImageViewer
                  src={imageUrl}
                  alt={item.title}
                  onClose={handleClose}
                  onLoadError={onImageError}
                  onLoad={onImageLoad}
                  isLoadingOriginal={imageLoadState === "loading-original" || imageLoadState === "retrying-proxy"}
                  isFallback={imageLoadState === "cover"}
                  onRetryOriginal={handleRetryOriginal}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-500">
                  <Image className="w-12 h-12 opacity-40" />
                </div>
              )}
            </div>

            {/* ── 缩略图导航条 ── */}
            {total > 1 && thumbRange.items.length > 0 && (
              <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 overflow-x-auto scrollbar-hide bg-black/30 backdrop-blur-sm border-t border-white/[0.06]">
                {thumbRange.items.map((t, i) => {
                  const idx = thumbRange.start + i; /* O(1) 全局索引，无全表 indexOf */
                  const isActive = idx === index;
                  return (
                    <button
                      key={t.illustId}
                      type="button"
                      onClick={() => onSelectIndex(idx)}
                      className={`shrink-0 w-10 h-10 sm:w-11 sm:h-11 rounded-lg overflow-hidden ring-2 transition-all duration-150 ${
                        isActive
                          ? "ring-pink-400 scale-110 brightness-110"
                          : "ring-transparent opacity-60 hover:opacity-90 hover:ring-white/30"
                      }`}
                    >
                      <img
                        src={toPixivImageUrl(t.coverUrl)}
                        alt=""
                        loading={Math.abs(idx - index) <= 2 ? "eager" : "lazy"}
                        className="w-full h-full object-cover"
                        draggable={false}
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── 右：信息面板 ── */}
          <aside className="w-full lg:w-[360px] lg:shrink-0 overflow-y-auto border-t lg:border-t-0 lg:border-l border-slate-200/60 dark:border-slate-700/40 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl">
            <div className="p-5 sm:p-6 space-y-5">
              {/* 排名 + 标题 */}
              <div>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-pink-50 dark:bg-pink-900/20 text-pink-600 dark:text-pink-300 text-xs font-semibold mb-3">
                  <Trophy className="w-3.5 h-3.5" />
                  #{item.rank}
                </span>
                <h3 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white leading-tight mt-2">
                  {item.title}
                </h3>
              </div>

              <div className="h-px bg-slate-200/60 dark:bg-slate-700/40" />

              {/* 元信息 */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                <DetailLine label="PID" value={item.illustId} />
                <DetailLine label="作者" value={item.author || "未知"} />
                <DetailLine label="上传时间" value={formatUploadDate(item.uploadDate)} />
                <DetailLine label="浏览量" value={item.viewCount ? item.viewCount.toLocaleString() : "未知"} />
                <DetailLine label="页数" value={`${item.pageCount || 1} 页`} />
                {item.width && item.height && (
                  <DetailLine label="尺寸" value={`${item.width} × ${item.height}`} />
                )}
              </dl>

              <div className="h-px bg-slate-200/60 dark:bg-slate-700/40" />

              {/* 标签 */}
              {item.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {item.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* 说明 */}
              {item.description && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                    说明
                  </h4>
                  <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                    {item.description}
                  </p>
                </div>
              )}

              <div className="h-px bg-slate-200/60 dark:bg-slate-700/40" />

              {/* 操作按钮 */}
              <div className="space-y-2.5">
                <button
                  type="button"
                  disabled={downloadState === "loading"}
                  onClick={handleDownload}
                  className="liquid-button-primary w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-70 transition-all active:scale-[0.98]"
                >
                  {downloadState === "loading" ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      下载中…
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      保存高清原图
                    </>
                  )}
                </button>

                {downloadHint && (
                  <p
                    className={`text-xs text-center ${
                      downloadState === "error" ? "text-red-500" : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    {downloadHint}
                  </p>
                )}

                {downloadCommand && (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                        <Terminal className="w-3.5 h-3.5" />
                        {downloadCommand.label}
                      </span>
                      <button
                        type="button"
                        onClick={copyCommand}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg liquid-button text-slate-600 dark:text-slate-300 hover:text-pink-500 transition-colors"
                      >
                        {copied ? (
                          <Check className="w-3 h-3 text-green-500" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        {copied ? "已复制" : "复制"}
                      </button>
                    </div>
                    <code className="block text-xs text-slate-700 dark:text-slate-200 break-all font-mono leading-relaxed select-all">
                      {downloadCommand.command}
                    </code>
                    {pixivNetOriginalUrl && (
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
                        在终端运行此命令时，本机 Clash/代理会自动处理 <code className="text-pink-500">i.pximg.net</code> 的流量路由
                      </p>
                    )}
                  </div>
                )}

                <a
                  href={item.pixivUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="liquid-button w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 transition-all active:scale-[0.98]"
                >
                  <ExternalLink className="w-4 h-4" />
                  在 Pixiv 查看
                </a>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-0.5">
        {label}
      </dt>
      <dd className="text-sm font-medium text-slate-800 dark:text-slate-200 break-words">
        {value}
      </dd>
    </div>
  );
}
