import { useEffect, useState, useRef } from "react";
import { Search, X } from "lucide-react";
import Fuse from "fuse.js";
import { SiteResponse } from "../types";
import { isCommunityCategoryName } from "../navigation-data";
import { useGroup } from "../context";
import {
  getCachedSearchIndex,
  isSearchIndexValid,
  setSearchIndexCache,
} from "../search-index-cache";

export default function SearchModal({ onClose, communityUnlocked }: { onClose: () => void; communityUnlocked: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SiteResponse[]>([]);
  const [index, setIndex] = useState<Fuse<SiteResponse> | null>(() => getCachedSearchIndex());
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { siteSettings } = useGroup();

  useEffect(() => {
    setError("");

    // 优先使用有效缓存，过期缓存仍可用于 stale-while-revalidate
    if (isSearchIndexValid()) {
      setIndex(getCachedSearchIndex());
      inputRef.current?.focus();
      return;
    }

    const controller = new AbortController();
    fetch("/api/public/search-index", { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 403) {
          throw new Error("公开资源 API 当前未开放，无法使用站内资源搜索。");
        }
        if (!response.ok) {
          throw new Error("暂时无法加载搜索索引。");
        }
        return response.json();
      })
      .then(data => {
        const visibleSites = (data as SiteResponse[]).filter(
          (site) => communityUnlocked || !isCommunityCategoryName(site.category_name),
        );
        const fuse = setSearchIndexCache(visibleSites);
        setIndex(fuse);
      })
      .catch((loadError: Error) => {
        if (loadError.name !== "AbortError") {
          setError(loadError.message);
        }
      });

      // Auto focus
      inputRef.current?.focus();
      return () => controller.abort();
  }, [communityUnlocked]);

  useEffect(() => {
    if (!index || !query) {
      setResults([]);
      return;
    }
    const searchResults = index.search(query).map(result => result.item);
    setResults(searchResults.slice(0, 8)); // limit to 8 results
  }, [query, index]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4">
      <div 
        className="liquid-overlay absolute inset-0 transition-opacity"
        onClick={onClose}
      />
      
      <div className="relative w-full max-w-2xl liquid-panel rounded-[2rem] overflow-hidden animate-in fade-in slide-in-from-top-4 duration-200">
        <div className="flex items-center px-5 py-4 border-b border-white/30 dark:border-white/10">
          <Search className="w-5 h-5 text-slate-400 mr-3" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent border-0 focus:ring-0 text-lg outline-none placeholder-slate-400"
            placeholder={siteSettings.resource_search_placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-md">
            <X className="w-5 h-5" />
          </button>
        </div>

        {results.length > 0 && (
          <div className="max-h-96 overflow-y-auto py-2">
            {results.map((site) => (
              <a
                key={site.id}
                href={site.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onClose}
                className="flex items-center gap-4 mx-2 px-4 py-3 rounded-2xl hover:bg-white/35 dark:hover:bg-white/10 transition-colors"
              >
                <img
                  src={site.local_icon_path || site.icon_url || "https://placehold.co/32x32/png?text=..."}
                  alt={site.name}
                  className="w-8 h-8 rounded-full shrink-0 liquid-chip"
                />
                <div className="flex-1 min-w-0">
                   <div className="flex items-center justify-between">
                     <span className="font-semibold text-sm truncate pr-2">{site.name}</span>
                     <span className="text-xs text-slate-400">{site.category_name}</span>
                   </div>
                   <p className="text-xs text-slate-500 truncate">{site.description}</p>
                </div>
              </a>
            ))}
          </div>
        )}

        {error && (
           <div className="py-14 px-5 text-center text-sm text-slate-500">
             {error}
           </div>
        )}

        {!error && query && results.length === 0 && (
           <div className="py-14 text-center text-sm text-slate-500">
             未找到与 "{query}" 相关的资源。
           </div>
        )}
      </div>
    </div>
  );
}
