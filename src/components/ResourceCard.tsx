import { ChevronRight, Star } from "lucide-react";
import { SiteResponse } from "../types";
import { memo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";

// React.memo 包裹：props 稳定时跳过重渲染——避免 favorites/categories 变化导致整组卡片重绘
export const ResourceCard = memo(function ResourceCard({
  site,
  isFavorited,
  gridStagger,
  onToggleFavorite,
}: {
  site: SiteResponse;
  isFavorited?: boolean;
  onToggleFavorite?: (siteId: number) => void;
  gridStagger?: number;
}) {
  const [iconUrl, setIconUrl] = useState(() => {
    if (site.local_icon_path) return site.local_icon_path;
    if (site.icon_url) return site.icon_url;

    const cacheKey = `favicon_url_${site.id}`;
    const cachedUrl = localStorage.getItem(cacheKey);
    if (cachedUrl) return cachedUrl;

    try {
      const domain = new URL(site.url).hostname;
      // 使用更快的 favicon 服务
      const url = `https://www.google.com/s2/favicons?domain=${domain}&sz=48`;
      localStorage.setItem(cacheKey, url);
      return url;
    } catch {
      return "https://placehold.co/48x48/png?text=Acg";
    }
  });

  // 注意：原来的 JS 驱动的 pointer 倾斜效果已移除，改用 CSS-only hover lift（通过 interactive-card class 实现）
  // 同时也移除了 useScrollReveal — ResourceCard 不需要滚动淡入动画，
  // 以避免视图切换时卡片初始 opacity:0 造成的"消失"感。

  const staggerDelay = gridStagger != null ? Math.min(gridStagger, 12) : undefined;
  const className = `resource-card interactive-card group flex flex-row items-center gap-3 overflow-hidden rounded-2xl p-4 glass-card${gridStagger != null ? " grid-enter" : ""}`;
  const enterStyle = staggerDelay != null ? ({ "--grid-stagger": staggerDelay } as CSSProperties) : undefined;

  const contents = (
    <>
      {/* 3D 深度光晕 — 纯 CSS 实现，无 JS 事件开销 */}
      <div className="card-3d-layer-glow" aria-hidden="true" />
      <div className="card-3d-layer flex items-center gap-3 w-full">
        <img
          src={iconUrl}
          alt={site.name}
          className="resource-card-icon liquid-chip w-10 h-10 rounded-full object-cover shrink-0 p-0.5"
          loading="lazy"
          // 使用 fetchPriority 提示浏览器优先级
          fetchPriority={gridStagger !== undefined && gridStagger < 6 ? "high" : "low"}
          decoding="async"
          onError={(e) => {
             const fallback = iconUrl === site.local_icon_path && site.icon_url
               ? site.icon_url
               : "https://placehold.co/48x48/png?text=Acg";
             if (iconUrl !== fallback) {
               setIconUrl(fallback);
               if (!site.icon_url) {
                 localStorage.setItem(`favicon_url_${site.id}`, fallback);
               }
             }
          }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <h3 className="resource-card-title flex min-w-0 items-center font-bold text-[15px] text-slate-800 dark:text-slate-100 truncate group-hover:text-pink-500 transition-colors" title={site.name}>
              <span
                className={`resource-card-status w-2 h-2 rounded-full mr-1.5 shrink-0 ${site.status === 'active' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-slate-400 dark:bg-slate-500'}`}
                title={site.status === 'active' ? '正常运行' : '可能失效'}
              />
              <span className="truncate">{site.name}</span>
            </h3>
          </div>
          <p className="resource-card-description text-[12px] text-slate-500 dark:text-slate-400 truncate mt-0.5" title={site.description}>
            {site.description || site.name}
          </p>
        </div>
        {onToggleFavorite && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleFavorite(site.id);
            }}
            className={`shrink-0 p-1.5 rounded-full transition-all ${
              isFavorited
                ? "text-amber-400 hover:text-amber-500"
                : "text-slate-300 dark:text-slate-600 hover:text-amber-400 opacity-0 group-hover:opacity-100"
            }`}
            title={isFavorited ? "取消收藏" : "收藏"}
          >
            <Star className={`w-4 h-4 ${isFavorited ? "fill-amber-400" : ""}`} />
          </button>
        )}
        <div className="resource-card-chevron text-slate-300 dark:text-slate-600 group-hover:text-pink-400 transition-colors shrink-0">
          <ChevronRight className="w-4 h-4" />
        </div>
      </div>
    </>
  );

  if (site.url.startsWith("/")) {
    return (
      <Link to={site.url} className={className} style={enterStyle}>
        {contents}
      </Link>
    );
  }

  return (
    <a
      href={site.url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      style={enterStyle}
    >
      {contents}
    </a>
  );
});
