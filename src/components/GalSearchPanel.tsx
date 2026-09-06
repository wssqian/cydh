import { FormEvent, useState } from "react";
import { Search, ExternalLink, Star, Calendar, Gamepad2, Inbox, Loader2 } from "lucide-react";
import { toGalCoverUrl } from "../acg-images";
import {
  GAL_SEARCH_PLATFORMS,
  type GalPlatformCategory,
  type GalSearchPlatform,
} from "../search-experience";

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

const PLAT_ICON: Record<string, string> = {
  win: "\u{1F4BB}", mac: "\u{1F34E}", linux: "\u{1F427}",
  ios: "\u{1F4F1}", android: "\u{1F916}",
  ps4: "\u{1F3AE}", ps5: "\u{1F3AE}", switch: "\u{1F3AE}",
};

const CATEGORY_META: Record<GalPlatformCategory, { label: string; dotColor: string }> = {
  resource: { label: "GAL 资源", dotColor: "bg-amber-400" },
  patch:    { label: "GAL 补丁", dotColor: "bg-teal-400" },
};

function openSite(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function PlatformButton({ platform, query }: { platform: GalSearchPlatform; query?: string }) {
  const handleClick = () => {
    // 如果有查询词且平台支持搜索，可以拼接搜索 URL（当前大多数站点跳转首页）
    openSite(platform.url);
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      className="liquid-panel glass-hover rounded-xl px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200 hover:text-amber-600 dark:hover:text-amber-400 transition-all text-left truncate"
      title={platform.name}
    >
      {platform.name}
      {platform.tags?.includes("Login") && (
        <span className="ml-1 text-[10px] text-slate-400">需登录</span>
      )}
    </button>
  );
}

function VndbInfoCard({ item, query }: { item: GalItem; query: string }) {
  const resourcePlatforms = GAL_SEARCH_PLATFORMS.filter((p) => p.category === "resource");
  const patchPlatforms = GAL_SEARCH_PLATFORMS.filter((p) => p.category === "patch");

  return (
    <div className="anime-card-enter liquid-panel rounded-2xl overflow-hidden">
      <div className="flex flex-col sm:flex-row">
        {/* 封面 */}
        <div className="relative w-full aspect-[3/4] sm:w-48 sm:aspect-auto sm:h-auto shrink-0 overflow-hidden bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/20 dark:to-orange-900/20">
          {item.image_url ? (
            <img
              src={toGalCoverUrl(item.image_url)}
              alt={item.title}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Gamepad2 className="w-12 h-12 text-amber-300 dark:text-amber-700" />
            </div>
          )}
          {item.rating && (
            <div className="absolute top-3 right-3 flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm">
              <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
              <span className="text-sm font-bold text-white">{(item.rating / 10).toFixed(1)}</span>
            </div>
          )}
        </div>
        {/* 信息 */}
        <div className="flex-1 p-5 space-y-3">
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white leading-snug">{item.title}</h3>
            {item.altTitle && (
              <p className="text-xs text-teal-600 dark:text-teal-400 mt-0.5">{item.altTitle}</p>
            )}
          </div>
          {item.description && (
            <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-3">{item.description}</p>
          )}
          <div className="flex items-center flex-wrap gap-2">
            {item.released && (
              <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <Calendar className="w-3.5 h-3.5" />{item.released}
              </span>
            )}
            {item.length && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                {item.length}
              </span>
            )}
            {item.platforms.map((p) => (
              <span key={p} className="text-sm" title={p}>{PLAT_ICON[p] || "\u{1F5A5}\u{FE0F}"}</span>
            ))}
            <span className="text-xs text-slate-400">{item.vote_count} 票</span>
          </div>
          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.tags.slice(0, 5).map((tag) => (
                <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full bg-teal-50 text-teal-600 dark:bg-teal-900/20 dark:text-teal-400">
                  {tag}
                </span>
              ))}
            </div>
          )}
          <a
            href={item.vndbUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline"
          >
            在 VNDB 查看 <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* 资源/补丁快捷入口 */}
      <div className="border-t border-slate-200/50 dark:border-slate-700/50 p-5 space-y-4">
        {([["resource", resourcePlatforms], ["patch", patchPlatforms]] as [GalPlatformCategory, GalSearchPlatform[]][]).map(([cat, platforms]) => (
          <div key={cat}>
            <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">
              {CATEGORY_META[cat].label}
            </h4>
            <div className="flex flex-wrap gap-2">
              {platforms.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => openSite(p.url)}
                  className="liquid-button glass-hover px-3 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GalSearchPanel() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<GalItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const trimmedQuery = query.trim();

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!trimmedQuery) return;

    setLoading(true);
    setError(null);
    setSearched(true);
    setResult(null);

    try {
      const res = await fetch(`/api/public/gal-search?q=${encodeURIComponent(trimmedQuery)}`);
      if (res.status === 503) {
        setError("GAL 搜索功能未启用，请联系管理员开启");
        return;
      }
      if (res.status === 404) {
        // 无结果，不算错误
        return;
      }
      if (!res.ok) throw new Error(`请求失败 (${res.status})`);
      const json = await res.json();
      if (json.code === 0 && json.data) {
        setResult(json.data);
      } else {
        setError(json.error || "查询失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setLoading(false);
    }
  };

  const showPlatformGrid = !searched || (!loading && !result && !error);

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      {/* 搜索输入 */}
      <form onSubmit={(e) => void handleSearch(e)} className="search-form flex w-full items-stretch gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          placeholder="输入 GAL 作品名，查询 VNDB 信息..."
          className="search-hub-input glass liquid-input min-w-0 flex-1 rounded-full px-6 py-4 text-xl text-slate-700 placeholder:text-slate-400 sm:px-10 sm:py-5 sm:text-3xl dark:text-slate-100 dark:placeholder:text-slate-400"
        />
        <button
          type="submit"
          disabled={loading || !trimmedQuery}
          className="liquid-button-primary flex w-16 shrink-0 items-center justify-center rounded-full sm:w-20 disabled:opacity-50"
          aria-label="搜索 GAL"
        >
          {loading
            ? <Loader2 className="h-7 w-7 animate-spin sm:h-9 sm:w-9" />
            : <Search className="h-7 w-7 stroke-[2.75] sm:h-9 sm:w-9" />}
        </button>
      </form>

      {/* 加载态 */}
      {loading && (
        <div className="flex items-center justify-center py-10 gap-3 text-amber-500 dark:text-amber-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">正在查询 VNDB...</span>
        </div>
      )}

      {/* 错误态 */}
      {!loading && error && (
        <div className="flex flex-col items-center justify-center py-10 gap-3">
          <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
            <Inbox className="w-7 h-7 text-red-400" />
          </div>
          <div className="text-red-500 text-sm font-medium">{error}</div>
        </div>
      )}

      {/* 空结果提示 */}
      {!loading && !error && searched && !result && (
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
            <Gamepad2 className="w-6 h-6 text-slate-400" />
          </div>
          <div className="text-slate-500 dark:text-slate-400 text-sm">VNDB 未找到匹配作品</div>
          <p className="text-xs text-slate-400">试试其他关键词，或浏览下方资源站点</p>
        </div>
      )}

      {/* VNDB 作品信息卡 */}
      {!loading && result && <VndbInfoCard item={result} query={trimmedQuery} />}

      {/* 平台入口网格 — 始终在底部展示 */}
      {showPlatformGrid && (
        <div className="space-y-5">
          {(["resource", "patch"] as GalPlatformCategory[]).map((cat) => {
            const platforms = GAL_SEARCH_PLATFORMS.filter((p) => p.category === cat);
            return (
              <div key={cat}>
                <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-3 flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${CATEGORY_META[cat].dotColor}`} />
                  {CATEGORY_META[cat].label}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
                  {platforms.map((p) => (
                    <PlatformButton key={p.id} platform={p} query={trimmedQuery} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
