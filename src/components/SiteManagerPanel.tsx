import React, { useMemo, useState } from "react";
import { LinkIcon, Trash2, Search, X } from "lucide-react";
import type { SiteResponse } from "../types";

interface Props {
  sites: SiteResponse[];
  onDelete: (id: number) => void;
}

const SiteManagerPanel = React.memo(function SiteManagerPanel({ sites, onDelete }: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const RENDER_LIMIT = 50;
  const [showAll, setShowAll] = useState(false);

  const filteredSites = useMemo(() => {
    if (!searchTerm.trim()) return sites;
    const term = searchTerm.toLowerCase();
    return sites.filter(
      (site) =>
        site.name.toLowerCase().includes(term) ||
        site.url.toLowerCase().includes(term) ||
        site.category_name?.toLowerCase().includes(term),
    );
  }, [sites, searchTerm]);

  const visibleSites = showAll ? filteredSites : filteredSites.slice(0, RENDER_LIMIT);
  const hasMore = filteredSites.length > RENDER_LIMIT;

  return (
    <div className="liquid-panel rounded-[2rem] overflow-hidden">
      {/* 搜索栏 */}
      <div className="px-6 py-4 border-b border-white/30 dark:border-white/10">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold flex items-center gap-2 shrink-0">
            <LinkIcon className="w-5 h-5 text-slate-400" />
            管理网站
          </h2>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索网站名称/URL/分类..."
              className="liquid-input w-full rounded-2xl pl-9 pr-8 py-1.5 text-sm"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <span className="liquid-chip text-xs text-slate-500 px-2.5 py-0.5 rounded-full shrink-0">
            {filteredSites.length}/{sites.length} 个
          </span>
        </div>
      </div>

      {/* 网站列表 */}
      <div className="divide-y divide-white/25 dark:divide-white/10 max-h-[500px] overflow-y-auto scrollbar-hide">
        {visibleSites.map((site) => (
          <div
            key={site.id}
            className="p-4 sm:px-6 flex items-center justify-between hover:bg-white/25 dark:hover:bg-white/5"
            style={{ contentVisibility: 'auto', containIntrinsicSize: '0 64px' }}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium truncate">{site.name}</span>
                <span className="liquid-chip text-xs text-slate-500 px-2 py-0.5 rounded-md">
                  {site.category_name}
                </span>
                {site.is_featured === 1 && (
                  <span className="liquid-chip text-xs text-amber-600 px-2 py-0.5 rounded-md">
                    推荐
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-500 truncate mt-1">{site.url}</p>
            </div>
            <button
              onClick={() => onDelete(site.id)}
              className="ml-4 p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 rounded-lg"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {visibleSites.length === 0 && (
          <div className="p-8 text-center text-slate-500">
            {searchTerm ? "未找到匹配的网站。" : "未找到资源。"}
          </div>
        )}
      </div>

      {/* 显示更多 */}
      {hasMore && !showAll && (
        <div className="border-t border-white/30 dark:border-white/10 px-6 py-3 text-center">
          <button
            onClick={() => setShowAll(true)}
            className="text-sm text-pink-500 hover:text-pink-600 font-medium"
          >
            显示全部 {filteredSites.length} 个网站
          </button>
        </div>
      )}
    </div>
  );
});

export default SiteManagerPanel;