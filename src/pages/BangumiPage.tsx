import { useEffect, useState, useCallback, useRef, memo, useMemo, type CSSProperties } from "react";
import { CalendarDays, RefreshCw, Inbox, Bell, BellRing, X } from "lucide-react";
import { toBangumiCoverUrl } from "../acg-images";
import { readAcgPageCacheSWR, writeAcgPageCache } from "../acg-page-cache";
import { useMasonryCols, distributeToColumns } from "../lib/masonry";
import { useGroup } from "../context";
import { CommunityGate } from "../components/CommunityGate";


interface BangumiAnimeItem {
  id: number; name: string; name_cn: string; summary: string;
  images: { large: string; common: string; medium: string; small: string; grid: string; };
  rating: { rank: number; total: number; score: number; };
  air_date: string; air_weekday: number; eps: number; url: string;
}
interface BangumiCalendarDay { weekday: { id: number; cn: string; en: string; }; items: BangumiAnimeItem[]; }

const SUB_KEY = "animeSubscriptions";
const CACHE_KEY = "bangumiCalendarCacheV2";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
function loadSubs(): Record<string, any> { try { return JSON.parse(localStorage.getItem(SUB_KEY) || "{}"); } catch { return {}; } }
function saveSubs(s: Record<string, any>) { try { localStorage.setItem(SUB_KEY, JSON.stringify(s)); } catch {} }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

/* 8.1/8.2/8.3：overlay 卡片 —— 图片 imageState 可恢复错误、decoding=async、CSS 变量驱动入场延迟 */
const BangumiCard = memo(function BangumiCard({ anime, index, priority, isSubscribed, onToggleSub }: {
  anime: BangumiAnimeItem;
  index: number;
  priority?: boolean;
  isSubscribed: boolean;
  onToggleSub: (a: BangumiAnimeItem) => void;
}) {
  const [imageState, setImageState] = useState<"loading" | "loaded" | "error">("loading");
  const coverUrl = toBangumiCoverUrl(anime.images?.large || anime.images?.common || anime.images?.medium || anime.images?.small);
  const subtitle = anime.name_cn || anime.name;

  return (
    <a
      href={anime.url}
      target="_blank"
      rel="noopener noreferrer"
      className="anime-card-enter group acg-image-card flex flex-col rounded-2xl overflow-hidden liquid-panel hover:shadow-xl hover:-translate-y-0.5 transition-all"
      style={{ "--enter-delay": Math.min(index, 20) * 30 } as CSSProperties}
    >
      <div className="relative overflow-hidden bg-slate-200 dark:bg-slate-700 aspect-[3/4]">
        {(imageState === "loading" || !coverUrl) && (
          <div className={`absolute inset-0 z-10 ${imageState === "loading" && coverUrl ? "image-loading-shimmer" : ""}`} />
        )}
        {coverUrl && imageState !== "error" && (
          <img
            src={coverUrl}
            alt={subtitle}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            decoding="async"
            referrerPolicy="no-referrer"
            className={`w-full h-full object-cover transition-all duration-300 group-hover:scale-105 ${imageState === "loaded" ? "image-loaded" : "opacity-0"}`}
            onLoad={() => setImageState("loaded")}
            onError={() => setImageState("error")}
          />
        )}
        {imageState === "error" && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 p-2 image-error bg-violet-100/60 dark:bg-violet-900/20">
            <Inbox className="w-6 h-6 text-violet-400" />
            <span className="text-xs text-violet-600 dark:text-violet-300 text-center line-clamp-2 leading-tight">{subtitle}</span>
          </div>
        )}

        {imageState !== "error" && coverUrl && (
          <>
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent" />
            {anime.rating?.score > 0 && (
              <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-sm">
                <span className="text-[10px] text-yellow-300 font-bold">{"⭐"} {anime.rating.score.toFixed(1)}</span>
              </div>
            )}
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); onToggleSub(anime); }}
              className={`absolute top-2 left-2 w-7 h-7 rounded-full flex items-center justify-center transition-all ${isSubscribed ? "bg-violet-500 text-white shadow-lg" : "bg-black/30 text-white/70 backdrop-blur-sm hover:bg-black/50"}`}
              title={isSubscribed ? "取消订阅" : "订阅更新提醒"}
            >
              {isSubscribed ? <BellRing className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
            </button>
            <div className="absolute bottom-0 left-0 right-0 p-3 pt-8 flex items-end justify-between gap-2">
              <h4 className="text-xs font-bold text-white leading-snug line-clamp-2 drop-shadow-md flex-1 min-w-0">{subtitle}</h4>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/80 text-white shrink-0">{"去看看 →"}</span>
            </div>
          </>
        )}
      </div>
      {/* 次行仅显示日期 */}
      <div className="px-2.5 py-2 flex items-center justify-between">
        <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{anime.air_date}</span>
      </div>
    </a>
  );
});

export default function BangumiPage() {
  const [calendar, setCalendar] = useState<BangumiCalendarDay[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<number>(() => { const d = new Date().getDay(); return d === 0 ? 7 : d; });
  const [subs, setSubs] = useState(loadSubs);
  const [notifs, setNotifs] = useState<Array<{title:string;cover:string;link:string}>>([]);
  const notifRef = useRef(false);
  useEffect(() => { saveSubs(subs); }, [subs]);

  const { communityUnlocked, communityChecking, unlockCommunity, markCommunityLocked } = useGroup();

  const fetchData = useCallback(async (force = false) => {
    if (!force) {
      const swr = readAcgPageCacheSWR<BangumiCalendarDay[]>(CACHE_KEY, CACHE_TTL_MS);
      if (swr) {
        setCalendar(swr.data);
        setLoading(false);
        setError(null);
        if (!swr.isStale) return;
        try {
          const res = await fetch(`/api/public/bangumi-calendar`);
          if (res.status === 401) {
            markCommunityLocked();
            return;
          }
          if (!res.ok) return;
          const json = await res.json();
          if (Array.isArray(json.data) && json.data.length > 0) {
            setCalendar(json.data);
            writeAcgPageCache(CACHE_KEY, json.data);
          }
        } catch { /* 静默 */ }
        return;
      }
    }
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/public/bangumi-calendar`);
      if (res.status === 401) {
        markCommunityLocked();
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const data: BangumiCalendarDay[] = json.data;
      if (!data || !Array.isArray(data)) throw new Error("Invalid data format");
      writeAcgPageCache(CACHE_KEY, data); setCalendar(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
      const swr = readAcgPageCacheSWR<BangumiCalendarDay[]>(CACHE_KEY, Infinity);
      if (swr?.data) setCalendar(swr.data);
    } finally { setLoading(false); }
  }, [markCommunityLocked]);
  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!calendar || notifRef.current) return;
    notifRef.current = true;
    const today = todayStr();
    const tw = new Date().getDay(); const todayW = tw === 0 ? 7 : tw;
    const items = calendar.find(d => d.weekday.id === todayW)?.items || [];
    const pending: any[] = [];
    for (const a of items) { const k = a.name_cn || a.name; if (subs[k] && subs[k].lastNotified !== today) pending.push({ title: k, cover: a.images?.common || "", link: a.url }); }
    if (pending.length > 0) {
      setNotifs(pending);
      setSubs(prev => { const u = { ...prev }; for (const p of pending) if (u[p.title]) u[p.title] = { ...u[p.title], lastNotified: today }; return u; });
    }
  }, [calendar]);

  // 9.4: 稳定引用的订阅切换回调，配合 memo 化卡片避免整网格重渲染
  const toggleSub = useCallback((a: BangumiAnimeItem) => {
    const k = a.name_cn || a.name;
    setSubs(prev => { const n = { ...prev }; if (n[k]) delete n[k]; else n[k] = { title: k, day: String(a.air_weekday), lastNotified: "", link: a.url, cover: a.images?.common || "" }; return n; });
  }, []);

  const todayW = (() => { const d = new Date().getDay(); return d === 0 ? 7 : d; })();
  const selectedItems = calendar?.find(d => d.weekday.id === selectedDay)?.items || [];
  const total = calendar?.reduce((s, d) => s + d.items.length, 0) || 0;
  const cols = useMasonryCols();
  const columns = useMemo(() => distributeToColumns(selectedItems, cols), [selectedItems, cols]);

  return (
    <CommunityGate unlocked={communityUnlocked} checking={communityChecking} unlock={unlockCommunity} title="番组放送">
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-6 sm:py-10">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <CalendarDays className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white">番组放送</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">每周新番放送日程 · Bangumi</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {total > 0 && <span className="liquid-chip text-xs px-3 py-1 rounded-full">{total} 部番剧</span>}
          <button onClick={() => fetchData(true)} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl liquid-button text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-pink-500 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> 刷新
          </button>
        </div>
      </div>
      <div className="flex justify-center mb-6">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide px-1">
          {calendar?.map(day => {
            const active = day.weekday.id === selectedDay;
            const today = day.weekday.id === todayW;
            return (
              <button key={day.weekday.id} onClick={() => setSelectedDay(day.weekday.id)}
                className={`shrink-0 flex flex-col items-center gap-0.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${active ? "liquid-button-primary text-white shadow-md" : "liquid-button glass-hover text-slate-600 hover:text-pink-500 dark:text-slate-300"}`}>
                <div className="flex items-center gap-1">
                  <span className="text-xs font-semibold">{day.weekday.cn}</span>
                  {today && !active && <span className="w-1.5 h-1.5 rounded-full bg-pink-500" />}
                </div>
                <span className={`text-[10px] tabular-nums ${active ? "text-white/80" : "text-slate-400"}`}>{day.items.length}</span>
              </button>
            );
          })}
        </div>
      </div>
      {loading && !calendar ? (
        /* 瀑布流骨架：多列 flex 占位 */
        <div className="flex gap-3 items-start">
          {Array.from({ length: Math.min(cols, 5) }).map((_, c) => (
            <div key={c} className="flex-1 flex flex-col gap-3 min-w-0">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-2xl aspect-[3/4] bg-slate-200/30 dark:bg-slate-700/20 skeleton-shimmer" style={{ "--enter-delay": (c * 3 + i) * 50 } as CSSProperties} />
              ))}
            </div>
          ))}
        </div>
      ) : error && !calendar ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Inbox className="w-10 h-10 text-red-400" />
          <div className="text-red-500 text-sm font-medium">{error}</div>
          <button onClick={() => fetchData(true)} className="liquid-button px-6 py-2 text-sm rounded-xl">重新加载</button>
        </div>
      ) : (
        <>
          {/* 瀑布流：多列 flex，卡片高度由 aspect-[3/4] 自适应 */}
          <div className="flex gap-3 items-start">
            {columns.map((colItems, colIdx) => (
              <div key={colIdx} className="flex flex-col gap-3 flex-1 min-w-0">
                {colItems.map((item, itemIdx) => {
                  const originalIndex = itemIdx * cols + colIdx;
                  const key = item.name_cn || item.name;
                  return (
                    <BangumiCard
                      key={item.id}
                      anime={item}
                      index={originalIndex}
                      priority={originalIndex < cols}
                      isSubscribed={!!subs[key]}
                      onToggleSub={toggleSub}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          {selectedItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 gap-2 text-slate-400">
              <CalendarDays className="w-10 h-10 opacity-40" /><span className="text-sm">当日暂无放送番剧</span>
            </div>
          )}
        </>
      )}
      {notifs.length > 0 && (
        <div className="fixed bottom-20 right-4 z-50">
          <div className="liquid-panel rounded-2xl p-4 max-w-xs shadow-2xl">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2"><div className="w-7 h-7 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center"><BellRing className="w-3.5 h-3.5 text-white" /></div><span className="text-xs font-semibold text-slate-700 dark:text-slate-200">番剧更新提醒</span></div>
              <button onClick={() => setNotifs([])} className="p-0.5 text-slate-400"><X className="w-3.5 h-3.5" /></button>
            </div>
            {notifs.map(n => (
              <a key={n.title} href={n.link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-black/[0.04] transition-colors">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{n.title}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
    </CommunityGate>
  );
}
