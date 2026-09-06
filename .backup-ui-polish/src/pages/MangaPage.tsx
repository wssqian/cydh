import { type ReactNode, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, BookText, Clock, Compass, ExternalLink, Inbox, RefreshCw, ShoppingBag, Star, Tags, Users, X } from "lucide-react";
import { toMangaCoverUrl } from "../acg-images";
import { readAcgPageCacheSWR, writeAcgPageCache } from "../acg-page-cache";

interface MangaUpdateItem {
  id: string;
  title: string;
  originalTitle: string | null;
  altTitles: string[];
  description: string;
  status: string;
  year: number | null;
  contentRating: string;
  tags: string[];
  genres: string[];
  themes: string[];
  contentWarnings: string[];
  authors: string[];
  artists: string[];
  externalLinks: Array<{ label: string; url: string; group: "read" | "track" | "search" }>;
  coverUrl: string | null;
  latestChapter: string | null;
  latestChapterTitle: string | null;
  updatedAt: string;
  mangaUrl: string;
}

type MangaMode = "latest" | "followed" | "rating";

const MODE_TABS: Array<{ mode: MangaMode; label: string; Icon: typeof Clock }> = [
  { mode: "latest", label: "最新更新", Icon: Clock },
  { mode: "followed", label: "关注最多", Icon: Users },
  { mode: "rating", label: "评分最高", Icon: Star },
];
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  ongoing: { label: "连载中", color: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400" },
  completed: { label: "已完结", color: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" },
  hiatus: { label: "休刊中", color: "bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400" },
  cancelled: { label: "已停更", color: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" },
};

function timeAgo(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "时间未知";
  const diff = Date.now() - timestamp;
  const m = Math.floor(diff / 60000);
  if (m < 60) return Math.max(m, 0) + "分钟前";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "小时前";
  const dy = Math.floor(h / 24);
  if (dy < 30) return dy + "天前";
  return Math.floor(dy / 30) + "个月前";
}

export default function MangaPage() {
  const [items, setItems] = useState<MangaUpdateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<MangaMode>("latest");
  const [selectedManga, setSelectedManga] = useState<MangaUpdateItem | null>(null);

  const fetchData = useCallback(async (m: MangaMode, force = false) => {
    const cacheKey = `mangaPage:v2:${m}`;
    if (!force) {
      const swr = readAcgPageCacheSWR<MangaUpdateItem[]>(cacheKey, CACHE_TTL_MS);
      if (swr) {
        setItems(swr.data);
        setLoading(false);
        if (!swr.isStale) return;
        // stale: 渲染旧数据，后台静默刷新
        try {
          const res = await fetch(`/api/public/manga-updates?mode=${m}`);
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
      const res = await fetch(`/api/public/manga-updates?mode=${m}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.code !== 0 || !json.data) throw new Error(json.error || "API error");
      setItems(json.data);
      writeAcgPageCache(cacheKey, json.data);
    } catch (err) {
      const swr = readAcgPageCacheSWR<MangaUpdateItem[]>(cacheKey, Infinity);
      if (swr?.data?.length) setItems(swr.data);
      setError(err instanceof Error ? err.message : "加载失败");
      console.error("[manga] error:", err);
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
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white">漫画情报</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">中文漫画更新与榜单 · MangaDex</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!loading && items.length > 0 && <span className="liquid-chip text-xs px-3 py-1 rounded-full">{items.length} 部作品</span>}
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
              onClick={() => setMode(tabMode)}
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
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex gap-3 p-4 rounded-xl bg-slate-200/30 dark:bg-slate-700/20 animate-pulse" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="w-16 h-20 rounded-lg bg-slate-300/50 dark:bg-slate-600/30 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-48 bg-slate-300/50 rounded" />
                <div className="h-3 w-72 bg-slate-200/50 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : error && items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
            <Inbox className="w-7 h-7 text-red-400" />
          </div>
          <div className="text-red-500 text-sm font-medium">{error}</div>
          <button onClick={() => fetchData(mode, true)} className="liquid-button px-6 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-pink-500 rounded-xl">
            重新加载
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
          {items.map((manga, index) => {
            const st = STATUS_MAP[manga.status] || { label: manga.status, color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" };
            const coverUrl = toMangaCoverUrl(manga.coverUrl);
            return (
              <article
                role="button"
                tabIndex={0}
                key={manga.id}
                onClick={() => setSelectedManga(manga)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedManga(manga);
                  }
                }}
                className="anime-card-enter text-left acg-image-card rounded-2xl liquid-panel overflow-hidden hover:shadow-lg transition-all group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
                style={{ animationDelay: `${Math.min(index, 20) * 30}ms` }}
              >
                <div className="relative aspect-[3/4] overflow-hidden bg-slate-200 dark:bg-slate-700">
                  {coverUrl ? (
                    <img
                      src={coverUrl}
                      alt={manga.title}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <BookOpen className="w-6 h-6 text-slate-400" />
                    </div>
                  )}
                </div>
                <div className="p-3 space-y-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800 dark:text-white line-clamp-2 group-hover:text-emerald-600 dark:group-hover:text-emerald-300 transition-colors">
                      {manga.title}
                    </h3>
                    {(manga.originalTitle || manga.altTitles?.length > 0) && (
                      <p className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">
                        {[manga.originalTitle, ...(manga.altTitles || [])].filter(Boolean).join(" / ")}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center flex-wrap gap-1.5">
                    {index < 3 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300 font-semibold">
                        TOP {index + 1}
                      </span>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span>
                    {manga.latestChapter && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400 font-medium">
                        第{manga.latestChapter}话{manga.latestChapterTitle ? ` · ${manga.latestChapterTitle}` : ""}
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-[10px] text-slate-400 w-full">
                      <Clock className="w-3 h-3" />
                      {timeAgo(manga.updatedAt)}
                    </span>
                    {manga.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{tag}</span>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {selectedManga && (
        <MangaDetailModal manga={selectedManga} onClose={() => setSelectedManga(null)} />
      )}
    </div>
  );
}

function externalSearchLinks(title: string) {
  const query = encodeURIComponent(title);
  return [
    { label: "Google", url: `https://www.google.com/search?q=${query}` },
    { label: "Bing", url: `https://www.bing.com/search?q=${query}` },
    { label: "Nyaa", url: `https://nyaa.si/?f=0&c=3_0&q=${query}` },
    { label: "MangaDex", url: `https://mangadex.org/search?q=${query}` },
  ];
}

function MangaDetailModal({ manga, onClose }: { manga: MangaUpdateItem; onClose: () => void }) {
  const coverUrl = toMangaCoverUrl(manga.coverUrl);
  const status = STATUS_MAP[manga.status] || { label: manga.status || "状态未知", color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" };
  const externalLinks = manga.externalLinks || [];
  const readLinks = externalLinks.filter((link) => link.group === "read");
  const trackLinks = externalLinks.filter((link) => link.group === "track");
  const searchLinks = externalSearchLinks(manga.title);
  const genres = manga.genres || manga.tags || [];
  const themes = manga.themes || [];
  const contentWarnings = manga.contentWarnings || [];
  const authors = manga.authors || [];
  const artists = manga.artists || [];
  const altTitles = manga.altTitles || [];

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

  return createPortal(
    <div className="liquid-overlay fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6">
      <div aria-hidden="true" className="absolute inset-0 bg-slate-950/25" onClick={onClose} />
      <div className="acg-detail-panel pointer-events-auto relative z-10 w-full max-w-5xl max-h-[88vh] overflow-hidden liquid-panel rounded-[1.75rem] animate-in fade-in zoom-in-95 flex flex-col">
        <div className="shrink-0 flex items-center justify-between gap-4 px-4 sm:px-6 py-4 border-b border-white/30 dark:border-white/10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl">
          <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white truncate">{manga.title}</h2>
          <button type="button" onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 transition-colors" aria-label="关闭">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
          <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] gap-5 sm:gap-6">
            <div className="mx-auto md:mx-0 w-48 sm:w-56 md:w-full">
              <div className="aspect-[3/4] overflow-hidden rounded-2xl bg-slate-200 dark:bg-slate-800 shadow-lg">
                {coverUrl ? (
                  <img src={coverUrl} alt={manga.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <BookOpen className="w-10 h-10 text-slate-400" />
                  </div>
                )}
              </div>
              <a
                href={manga.mangaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 liquid-button-primary w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold"
              >
                <ExternalLink className="w-4 h-4" />
                MangaDex 查看
              </a>
            </div>
            <div className="min-w-0 space-y-4">
              <div>
                <h3 className="text-2xl sm:text-3xl font-black text-emerald-600 dark:text-emerald-300 leading-tight">{manga.title}</h3>
                {(manga.originalTitle || altTitles.length > 0) && (
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 line-clamp-2">
                    {[manga.originalTitle, ...altTitles].filter(Boolean).join(" / ")}
                  </p>
                )}
              </div>

              <div className="divide-y divide-white/30 dark:divide-white/10 text-sm">
                <InfoRow label="作者" value={authors.join("、") || "未知"} />
                <InfoRow label="画师" value={artists.join("、") || "未知"} />
                <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 py-2">
                  <span className="text-slate-500 dark:text-slate-400">状态</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${status.color}`}>{status.label}</span>
                    {manga.year && <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">{manga.year}年</span>}
                    {manga.latestChapter && <span className="text-xs px-2.5 py-1 rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300">第{manga.latestChapter}话</span>}
                  </div>
                </div>
                <TagRow label="类型" tags={genres} active />
                <TagRow label="主题" tags={themes} />
                {contentWarnings.length > 0 && <TagRow label="提示" tags={contentWarnings} warning />}
              </div>

              <section>
                <h4 className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">
                  <BookText className="w-4 h-4 text-emerald-500" />
                  剧情简介
                </h4>
                <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{manga.description || "暂无中文简介"}</p>
              </section>

              <LinkSection icon={<ShoppingBag className="w-4 h-4 text-emerald-500" />} title="阅读 / 购买" links={readLinks} fallback={{ label: "MangaDex", url: manga.mangaUrl }} />
              <LinkSection icon={<Tags className="w-4 h-4 text-sky-500" />} title="跟踪数据" links={trackLinks} />
              <LinkSection icon={<Compass className="w-4 h-4 text-pink-500" />} title="资源搜索" links={searchLinks} />
            </div>
          </div>
        </div>
        <div className="shrink-0 flex justify-end px-4 sm:px-6 py-4 border-t border-white/30 dark:border-white/10 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl">
          <button type="button" onClick={onClose} className="liquid-button rounded-2xl px-5 py-2 text-sm font-semibold text-slate-600 dark:text-slate-200">
            关闭
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 py-2">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-slate-700 dark:text-slate-200">{value}</span>
    </div>
  );
}

function TagRow({ label, tags, active = false, warning = false }: { label: string; tags: string[]; active?: boolean; warning?: boolean }) {
  if (!tags.length) return null;
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 py-2">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className={`text-xs px-2.5 py-1 rounded-full border ${
              active
                ? "border-emerald-500 bg-emerald-500 text-white"
                : warning
                  ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
                  : "border-white/50 bg-white/45 text-slate-600 dark:border-white/10 dark:bg-slate-800/70 dark:text-slate-300"
            }`}
          >
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

function LinkSection({
  icon,
  title,
  links,
  fallback,
}: {
  icon: ReactNode;
  title: string;
  links: Array<{ label: string; url: string }>;
  fallback?: { label: string; url: string };
}) {
  const resolvedLinks = links.length ? links : fallback ? [fallback] : [];
  if (!resolvedLinks.length) return null;
  return (
    <section>
      <h4 className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">
        {icon}
        {title}
      </h4>
      <div className="flex flex-wrap gap-2">
        {resolvedLinks.map((link) => (
          <a
            key={`${link.label}-${link.url}`}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="liquid-button rounded-full px-4 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-emerald-600"
          >
            {link.label}
          </a>
        ))}
      </div>
    </section>
  );
}
