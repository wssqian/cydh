import { ChevronRight, Star } from "lucide-react";
import { SiteResponse } from "../types";
import { PointerEvent, useState } from "react";
import { Link } from "react-router-dom";

export function ResourceCard({
  site,
  isFavorited,
  onToggleFavorite,
}: {
  site: SiteResponse;
  isFavorited?: boolean;
  onToggleFavorite?: (siteId: number) => void;
}) {
  const [iconUrl, setIconUrl] = useState(() => {
    if (site.local_icon_path) return site.local_icon_path;
    if (site.icon_url) return site.icon_url;
    
    const cacheKey = `favicon_url_${site.id}`;
    const cachedUrl = localStorage.getItem(cacheKey);
    if (cachedUrl) return cachedUrl;

    try {
      const domain = new URL(site.url).hostname;
      const url = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
      localStorage.setItem(cacheKey, url);
      return url;
    } catch {
      return "https://placehold.co/48x48/png?text=Acg";
    }
  });

  const className = "resource-card interactive-card group flex flex-row items-center gap-3 overflow-hidden rounded-2xl p-4 glass-card";
  const moveCardHighlight = (event: PointerEvent<HTMLAnchorElement>) => {
    if (event.pointerType !== "mouse") {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    event.currentTarget.style.setProperty("--card-pointer-x", `${x * 100}%`);
    event.currentTarget.style.setProperty("--card-pointer-y", `${y * 100}%`);
    event.currentTarget.style.setProperty("--card-rotate-x", `${(0.5 - y) * 5}deg`);
    event.currentTarget.style.setProperty("--card-rotate-y", `${(x - 0.5) * 6}deg`);
  };
  const resetCardHighlight = (event: PointerEvent<HTMLAnchorElement>) => {
    event.currentTarget.style.setProperty("--card-pointer-x", "50%");
    event.currentTarget.style.setProperty("--card-pointer-y", "20%");
    event.currentTarget.style.setProperty("--card-rotate-x", "0deg");
    event.currentTarget.style.setProperty("--card-rotate-y", "0deg");
  };
  const interactionProps = {
    className,
    onPointerMove: moveCardHighlight,
    onPointerLeave: resetCardHighlight,
  };
  const contents = (
    <>
      <img
        src={iconUrl}
        alt={site.name}
        className="resource-card-icon liquid-chip w-10 h-10 rounded-full object-cover shrink-0 p-0.5"
        loading="lazy"
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
    </>
  );

  if (site.url.startsWith("/")) {
    return (
      <Link to={site.url} {...interactionProps}>
        {contents}
      </Link>
    );
  }

  return (
    <a
      href={site.url}
      target="_blank"
      rel="noopener noreferrer"
      {...interactionProps}
    >
      {contents}
    </a>
  );
}
