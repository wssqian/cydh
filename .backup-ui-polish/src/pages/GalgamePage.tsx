import { useCallback, useEffect, useState } from "react";
import { Calendar, ExternalLink, Gamepad2, Globe2, Inbox, RefreshCw, Rocket, Star } from "lucide-react";
import { toGalCoverUrl } from "../acg-images";
import { readAcgPageCacheSWR, writeAcgPageCache } from "../acg-page-cache";

interface GalItem {
  id: string;
  title: string;
  altTitle: string | null;
  description: string;
  image_url: string | null;
  rating: number | null;
  vote_count: number;
  length: string | null;
  released: string | null;
  devstatus: number;
  platforms: string[];
  tags: string[];
  vndbUrl: string;
}

type GalTab = "monthly" | "chinese" | "high" | "upcoming";

const GAL_TABS: Array<{ tab: GalTab; label: string; Icon: typeof Calendar }> = [
  { tab: "monthly", label: "当月新作", Icon: Calendar },
  { tab: "chinese", label: "中文新作", Icon: Globe2 },
  { tab: "high", label: "高分作品", Icon: Star },
  { tab: "upcoming", label: "即将发售", Icon: Rocket },
];
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const DEVSTATUS: Record<number, string> = { 0: "已发售", 1: "开发中", 2: "已取消" };
const PLAT_ICON: Record<string, string> = {
  win: "\u{1F4BB}",
  mac: "\u{1F34E}",
  linux: "\u{1F427}",
  ios: "\u{1F4F1}",
  android: "\u{1F916}",
  ps4: "\u{1F3AE}",
  ps5: "\u{1F3AE}",
  switch: "\u{1F3AE}",
};

export default function GalgamePage() {
  const [items, setItems] = useState<GalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<GalTab>("monthly");

  const fetchData = useCallback(async (t: GalTab, force = false) => {
    const cacheKey = `galPage:${t}`;
    if (!force) {
      const swr = readAcgPageCacheSWR<GalItem[]>(cacheKey, CACHE_TTL_MS);
      if (swr) {
        setItems(swr.data);
        setLoading(false);
        if (!swr.isStale) return;
        try {
          const res = await fetch(`/api/public/gal-recommendations?type=${t}`);
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
      const res = await fetch(`/api/public/gal-recommendations?type=${t}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.code !== 0 || !json.data) throw new Error(json.error || "API error");
      setItems(json.data);
      writeAcgPageCache(cacheKey, json.data);
    } catch (err) {
      const swr = readAcgPageCacheSWR<GalItem[]>(cacheKey, Infinity);
      if (swr?.data?.length) setItems(swr.data);
      setError(err instanceof Error ? err.message : "加载失败");
      console.error("[gal] error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(tab);
  }, [tab, fetchData]);

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-6 sm:py-10">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
            <Gamepad2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white">GAL空间</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">视觉小说新作与榜单 · VNDB</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!loading && items.length > 0 && <span className="liquid-chip text-xs px-3 py-1 rounded-full">{items.length} 部作品</span>}
          <button
            onClick={() => fetchData(tab, true)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl liquid-button text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-pink-500 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> 刷新
          </button>
        </div>
      </div>

      <div className="flex justify-center mb-6">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide px-1">
          {GAL_TABS.map(({ tab: tabKey, label, Icon }) => (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className={`shrink-0 flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-full text-sm font-medium transition-all ${
                tab === tabKey
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-64 sm:h-72 rounded-xl bg-slate-200/30 dark:bg-slate-700/20 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
          ))}
        </div>
      ) : error && items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
            <Inbox className="w-7 h-7 text-red-400" />
          </div>
          <div className="text-red-500 text-sm font-medium">{error}</div>
          <button onClick={() => fetchData(tab, true)} className="liquid-button px-6 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-pink-500 rounded-xl">
            重新加载
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-2 text-slate-400">
          <Gamepad2 className="w-10 h-10 opacity-40" />
          <span className="text-sm">当前分类暂无作品</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item, index) => {
            const imageUrl = toGalCoverUrl(item.image_url);
            return (
              <a
                key={item.id}
                href={item.vndbUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="anime-card-enter group relative flex flex-col rounded-xl overflow-hidden liquid-panel hover:shadow-lg transition-all"
                style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
              >
                <div className="relative aspect-[3/4] overflow-hidden bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/20 dark:to-orange-900/20">
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={item.title}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Gamepad2 className="w-10 h-10 text-amber-300 dark:text-amber-700" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  {index < 3 && (
                    <div className="absolute top-2 left-2 w-7 h-7 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center shadow-lg">
                      <span className="text-xs font-bold text-white">{index + 1}</span>
                    </div>
                  )}
                  {item.rating && (
                    <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-sm">
                      <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                      <span className="text-xs font-bold text-white">{(item.rating / 10).toFixed(1)}</span>
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <h3 className="text-sm font-bold text-white leading-snug line-clamp-2 drop-shadow-md">{item.title}</h3>
                    {item.altTitle && <p className="text-[10px] text-white/60 mt-0.5 truncate">{item.altTitle}</p>}
                  </div>
                </div>
                <div className="p-3 flex flex-col gap-2">
                  {item.description && <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-3">{item.description}</p>}
                  <div className="flex items-center flex-wrap gap-1.5 mt-auto">
                    {item.released && (
                      <span className="flex items-center gap-1 text-[10px] text-slate-400">
                        <Calendar className="w-3 h-3" />
                        {item.released}
                      </span>
                    )}
                    {item.length && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">{item.length}</span>}
                    {item.platforms.slice(0, 4).map((p) => <span key={p} className="text-[10px]" title={p}>{PLAT_ICON[p] || "\u{1F5A5}\u{FE0F}"}</span>)}
                  </div>
                  {item.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {item.tags.slice(0, 5).map((tag) => (
                        <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{tag}</span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] text-slate-300">{DEVSTATUS[item.devstatus] || ""}</span>
                    <ExternalLink className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
