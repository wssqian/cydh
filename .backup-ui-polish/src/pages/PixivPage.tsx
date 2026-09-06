import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  BarChart3,
  CalendarDays,
  Download,
  ExternalLink,
  Eye,
  Image,
  Inbox,
  RefreshCw,
  Sparkles,
  Trophy,
  UserRound,
  X,
} from "lucide-react";
import { toPixivImageUrl, downloadImageAsFile, toPixivDirectUrls, PIXIV_REFERER } from "../acg-images";
import { readAcgPageCacheSWR, writeAcgPageCache } from "../acg-page-cache";

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

type PixivMode = "daily" | "weekly" | "monthly" | "rookie" | "original";

const MODE_TABS: Array<{ mode: PixivMode; label: string; Icon: typeof CalendarDays }> = [
  { mode: "daily", label: "日榜", Icon: CalendarDays },
  { mode: "weekly", label: "周榜", Icon: BarChart3 },
  { mode: "monthly", label: "月榜", Icon: Trophy },
  { mode: "rookie", label: "新人榜", Icon: UserRound },
  { mode: "original", label: "原创榜", Icon: Sparkles },
];
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;

export default function PixivPage() {
  const [items, setItems] = useState<PixivIllustItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<PixivMode>("daily");
  const [selectedItem, setSelectedItem] = useState<PixivIllustItem | null>(null);

  const fetchData = useCallback(async (m: PixivMode, force = false) => {
    const cacheKey = `pixivPage:v2:${m}`;
    if (!force) {
      const swr = readAcgPageCacheSWR<PixivIllustItem[]>(cacheKey, CACHE_TTL_MS);
      if (swr) {
        setItems(swr.data);
        setLoading(false);
        if (!swr.isStale) return;
        try {
          const res = await fetch(`/api/public/pixiv-ranking?mode=${m}`);
          if (!res.ok) return;
          const json = await res.json();
          if (json.code === 0 && json.data) {
            setItems(json.data);
            writeAcgPageCache(cacheKey, json.data);
          }
        } catch { /* 静默 */ }
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/pixiv-ranking?mode=${m}`);
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
  }, []);

  useEffect(() => {
    fetchData(mode);
  }, [mode, fetchData]);

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-6 sm:py-10">
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
          {!loading && items.length > 0 && <span className="liquid-chip text-xs px-3 py-1 rounded-full">{items.length} 件作品</span>}
          <button
            onClick={() => fetchData(mode, true)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl liquid-button text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-pink-500 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> 刷新
          </button>
        </div>
      </div>

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

      {loading && items.length === 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {Array.from({ length: 15 }).map((_, i) => (
            <div
              key={i}
              className="break-inside-avoid h-48 rounded-xl bg-slate-200/30 dark:bg-slate-700/20 skeleton-shimmer"
              style={{ animationDelay: `${i * 50}ms` }}
            />
          ))}
        </div>
      ) : error && items.length === 0 ? (
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
        <div key={mode} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 grid-enter">
          {items.map((item, index) => (
            <PixivCard
              key={item.illustId}
              item={item}
              index={index}
              onOpen={() => setSelectedItem(item)}
            />
          ))}
        </div>
      )}
      {selectedItem && <PixivDetailModal item={selectedItem} onClose={() => setSelectedItem(null)} />}
    </div>
  );
}

function PixivCard({
  item,
  index,
  onOpen,
}: {
  item: PixivIllustItem;
  index: number;
  onOpen: () => void;
}) {
  const [imageAttempt, setImageAttempt] = useState<"primary" | "cf" | "failed">("primary");
  const [imageState, setImageState] = useState<"loading" | "loaded" | "error">("loading");

  useEffect(() => {
    setImageAttempt("primary");
    setImageState("loading");
  }, [item.coverUrl]);

  const imageUrl = imageAttempt === "failed" ? "" : toPixivImageUrl(item.coverUrl, imageAttempt === "cf" ? { fallback: "cf" } : undefined);

  const handleImageLoad = () => {
    setImageState("loaded");
  };

  const handleImageError = () => {
    setImageAttempt((current) => {
      if (current === "primary") return "cf";
      if (current === "cf") {
        setImageState("error");
        return "failed";
      }
      return current;
    });
  };

  return (
    <article
      role="button"
      tabIndex={0}
      className="anime-card-enter group acg-image-card rounded-2xl liquid-panel cursor-pointer transition-all text-left w-full p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400/70"
      style={{ animationDelay: `${Math.min(index, 20) * 30}ms` }}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div
        className="relative overflow-hidden rounded-[0.75rem] bg-slate-200 dark:bg-slate-700 pixiv-card-image-wrap"
        style={{ aspectRatio: item.width && item.height ? `${item.width}/${item.height}` : '3/4', maxHeight: '80vh' }}
      >
        {/* 骨架占位层 — 图片加载中显示 */}
        {(imageState === "loading" || imageState === "error" || !imageUrl) && (
          <div
            className={`absolute inset-0 ${imageState === "loading" && imageUrl ? "image-loading-shimmer" : ""}`}
          />
        )}
        {/* 图片层 — 加载完成后淡入 */}
        {imageUrl && (
          <img
            src={imageUrl}
            alt={item.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            className={`w-full h-full object-cover ${imageState === "loaded" ? "image-loaded" : "opacity-0"}`}
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
        )}
        {/* 错误占位层 — 三次尝试均失败时显示 */}
        {imageState === "error" && !imageUrl && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-2 image-error bg-slate-200/50 dark:bg-slate-700/50">
            <Image className="w-6 h-6 text-slate-400" />
            <span className="text-xs text-slate-500 dark:text-slate-400 text-center line-clamp-2 leading-tight">{item.title}</span>
          </div>
        )}
      </div>
      <div className="px-1.5 py-2">
        <h4 className="text-xs font-bold text-slate-800 dark:text-white line-clamp-2 group-hover:text-pink-500 transition-colors">{item.title}</h4>
        <p className="text-[10px] text-slate-400 mt-0.5 truncate">{item.author}</p>
        <div className="mt-1 flex items-center flex-wrap gap-1.5 text-[10px] text-slate-400">
          {index < 3 && (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300 font-semibold">
              TOP {index + 1}
            </span>
          )}
          {item.viewCount > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
              <Eye className="w-3 h-3" />
              {item.viewCount.toLocaleString()}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

function describeDownloadError(err?: unknown): string {
  if (err instanceof Error) {
    return err.message || "未知网络错误";
  }
  if (typeof err === "string" && err) return err;
  return "未知网络错误";
}

function formatUploadDate(value: string | null): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, "0")}月${String(date.getDate()).padStart(2, "0")}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function PixivDetailModal({ item, onClose }: { item: PixivIllustItem; onClose: () => void }) {
  const [imageAttempt, setImageAttempt] = useState<"original" | "cover" | "cf" | "failed">("original");
  const [downloadState, setDownloadState] = useState<"idle" | "loading" | "error">("idle");
  const [downloadHint, setDownloadHint] = useState<string | null>(null);
  const displaySource = imageAttempt === "original" ? item.originalUrl || item.coverUrl : item.coverUrl;
  const imageUrl = imageAttempt === "failed"
    ? ""
    : toPixivImageUrl(displaySource, imageAttempt === "cf" ? { fallback: "cf" } : undefined);

  useEffect(() => {
    setImageAttempt("original");
  }, [item.illustId]);

  useEffect(() => {
    setDownloadState("idle");
    setDownloadHint(null);
  }, [item.illustId]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const onImageError = () => {
    setImageAttempt((current) => {
      if (current === "original") return "cover";
      if (current === "cover") return "cf";
      return "failed";
    });
  };

  const handleDownload = async () => {
    if (downloadState === "loading") return;

    setDownloadState("loading");
    setDownloadHint("正在通过服务器拉取原图…");

    const filename = `pixiv-${item.illustId}`;

    // Tier 1（首选）：服务器流式代理下载原图 —— 服务器侧带正确 Referer + 流式 pipe，浏览器无需跨域
    if (item.originalUrl) {
      const originalUrl = toPixivDownloadUrl(item.originalUrl, `${filename}.jpg`);
      try {
        await downloadImageAsFile(originalUrl, filename);
        setDownloadState("idle");
        setDownloadHint(null);
        return;
      } catch (err) {
        setDownloadHint("原图下载失败，正在尝试封面…");
      }
    } else {
      setDownloadHint("原图 URL 不可用，正在尝试封面…");
    }

    // Tier 2（回退）：服务器流式代理下载封面 —— 同样走 /api/public/pixiv-image-download，不直连 i.pximg.net
    if (item.coverUrl) {
      const coverUrl = toPixivDownloadUrl(item.coverUrl, `${filename}.jpg`);
      try {
        await downloadImageAsFile(coverUrl, filename);
        setDownloadState("idle");
        setDownloadHint(item.originalUrl ? "原图暂不可用，已下载封面" : null);
        return;
      } catch (err) {
        setDownloadHint("封面下载失败，正在尝试 CF 缓存…");
      }
    }

    // Tier 3（兜底）：CF CDN 302 链路（保留，作为最后的弱网兜底）
    const cfUrl = toPixivImageUrl(item.coverUrl, { fallback: "cf" });
    if (cfUrl) {
      try {
        await downloadImageAsFile(cfUrl, filename);
        setDownloadState("idle");
        setDownloadHint(item.originalUrl || item.coverUrl ? "原图暂不可用，已下载封面（CF 缓存）" : null);
        return;
      } catch (err) {
        setDownloadHint(describeDownloadError(err));
      }
    }

    // Tier 4（全失败）：提示用户去 Pixiv 官网手动保存
    setDownloadState("error");
    setDownloadHint("原图与封面均下载失败；可在 Pixiv 查看（跳转链接见下方）");
  };

  return createPortal(
    <div className="liquid-overlay fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6">
      <div aria-hidden="true" className="absolute inset-0 bg-slate-950/25" onClick={onClose} />
      <div className="acg-detail-panel pointer-events-auto relative z-10 w-full max-w-6xl max-h-[90vh] overflow-hidden liquid-panel rounded-[1.75rem] animate-in fade-in zoom-in-95 flex flex-col">
        <div className="shrink-0 flex items-center justify-between gap-4 px-4 sm:px-6 py-4 border-b border-white/30 dark:border-white/10 bg-white/85 dark:bg-slate-900/80 backdrop-blur-xl">
          <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white">作品详情</h2>
          <button type="button" onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 transition-colors" aria-label="关闭">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.75fr)] overflow-y-auto lg:overflow-hidden">
          <div className="min-h-[52vh] lg:min-h-0 bg-white/45 dark:bg-slate-800/60 flex items-center justify-center overflow-auto p-4">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={item.title}
                className="max-w-full max-h-[72vh] object-contain rounded-[0.75rem] shadow-xl ring-1 ring-black/5 dark:ring-white/10"
                referrerPolicy="no-referrer"
                onError={onImageError}
              />
            ) : (
              <div className="w-full h-80 flex items-center justify-center text-slate-500">
                <Image className="w-10 h-10" />
              </div>
            )}
          </div>
          <aside className="min-h-0 overflow-y-auto p-5 sm:p-6 bg-white/72 dark:bg-slate-950/72 backdrop-blur-xl border-t lg:border-t-0 lg:border-l border-white/30 dark:border-white/10">
            <div className="space-y-5">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-pink-500 mb-2">
                  <Trophy className="w-4 h-4" />
                  排名 #{item.rank}
                </div>
                <h3 className="text-2xl sm:text-3xl font-black text-pink-600 dark:text-pink-300 leading-tight">{item.title}</h3>
              </div>
              <div className="h-px bg-slate-200/80 dark:bg-white/10" />
              <dl className="space-y-3 text-sm">
                <DetailLine label="PID" value={item.illustId} />
                <DetailLine label="作者" value={item.author || "未知"} />
                <DetailLine label="上传时间" value={formatUploadDate(item.uploadDate)} />
                <DetailLine label="浏览量" value={item.viewCount ? item.viewCount.toLocaleString() : "未知"} />
                <DetailLine label="页数" value={`${item.pageCount || 1} 页`} />
                {item.width && item.height && <DetailLine label="尺寸" value={`${item.width} × ${item.height}`} />}
              </dl>
              {item.tags.length > 0 && (
                <section>
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-2">标签</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {item.tags.map((tag) => (
                      <span key={tag} className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
                        {tag}
                      </span>
                    ))}
                  </div>
                </section>
              )}
              {item.description && (
                <section>
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-2">说明</h4>
                  <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{item.description}</p>
                </section>
              )}
              <div className="pt-2 space-y-2">
                <button
                  type="button"
                  disabled={downloadState === "loading"}
                  onClick={handleDownload}
                  className="liquid-button-primary w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm sm:text-base font-bold disabled:opacity-70"
                >
                  {downloadState === "loading" ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      下载中…
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      保存高清原图（PNG/JPG）
                    </>
                  )}
                </button>
                {downloadHint && (
                  <p className={`text-xs text-center ${downloadState === "error" ? "text-red-500" : "text-slate-500 dark:text-slate-400"}`}>
                    {downloadHint}
                  </p>
                )}
                <a
                  href={item.pixivUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="liquid-button w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200"
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
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3">
      <dt className="font-bold text-slate-800 dark:text-slate-100">{label}：</dt>
      <dd className="min-w-0 text-slate-600 dark:text-slate-300 break-words">{value}</dd>
    </div>
  );
}
