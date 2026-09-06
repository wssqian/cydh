import { lazy, Suspense, useMemo, useState, useRef, useEffect } from "react";
import { LazyResourceCard } from "../components/LazyResourceCard";
import { ResourceCardSkeleton, SectionTitleSkeleton } from "../components/Skeletons";
import { Search, Star, Sparkles, X } from "lucide-react";import { DynamicIcon } from "../components/DynamicIcon";
import { useGroup } from "../context";
import { buildNavigationSections, groupNavigationSections, isCommunityCategoryName } from "../navigation-data";
import { SearchOnlyHome } from "../components/SearchOnlyHome";
import { WeatherCard } from "../components/WeatherCard";
import { FAVORITES_GROUP_LABEL } from "../favorites";
import { MagneticButton } from "../components/MagneticButton";
import { useScrollReveal } from "../hooks/useScrollReveal";
import Fuse from "fuse.js";
import { SiteResponse } from "../types";
import {
  getCachedSearchIndex,
  isSearchIndexValid,
  setSearchIndexCache,
} from "../search-index-cache";

// 搜索弹窗 — 导航界面点击磁性搜索框时打开（懒加载）
const SearchModal = lazy(() => import("../components/SearchModal"));

export default function Home() {
  const { activeGroup, searchOnlyMode, communityUnlocked, categories, sites, navigationLoading: loading, navigationError, siteSettings, favorites, onToggleFavorite } = useGroup();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SiteResponse[]>([]);
  const [searchIndex, setSearchIndex] = useState<Fuse<SiteResponse> | null>(() => getCachedSearchIndex());
  const [searchError, setSearchError] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);

  const groupedCategories = useMemo(
    () => groupNavigationSections(buildNavigationSections(categories, sites)),
    [categories, sites],
  );
  const isFavoritesView = activeGroup === FAVORITES_GROUP_LABEL;
  const favoriteSites = useMemo(
    () => sites.filter((site) => favorites.has(site.id)),
    [sites, favorites],
  );

  // 滚动触发动画 ref
  const heroRef = useScrollReveal();
  const categoriesRef = useScrollReveal();

  if (searchOnlyMode) {
    return <SearchOnlyHome />;
  }

  return (
    <div className="mobile-content-shell space-y-6 sm:space-y-12 max-w-7xl mx-auto">
      
      {/* 天气卡片 — 滚动淡入 */}
      <div ref={heroRef} className="flex justify-center sm:justify-start reveal-on-scroll"><WeatherCard /></div>

      {/* Hero 搜索区 — 渐变标题 + 磁性搜索框 */}
      <section className="flex flex-col items-center justify-center py-2 sm:py-10">
         <h2 className="text-2xl sm:text-4xl font-bold mb-4 text-gradient-shimmer">
           <Sparkles className="w-6 h-6 sm:w-8 sm:h-8 inline -mt-1 mr-2 text-pink-500" />
           发现新世界
         </h2>
         <p className="text-sm sm:text-base text-slate-500 dark:text-slate-400 mb-6 text-center max-w-md">
           在 {siteSettings.site_name || '次元导航'} 中探索你感兴趣的网站
         </p>
         <MagneticButton
           onClick={() => setIsSearchOpen(true)}
           className="w-full max-w-3xl relative group cursor-text"
           ripple={true}
         >
            <div className="w-full relative">
               <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none text-slate-400 group-hover:text-pink-500 transition-colors">
                  <Search className="w-5 h-5 sm:w-6 sm:h-6" />
               </div>
               <input 
                  type="text" 
                  className="block w-full pl-12 sm:pl-14 pr-4 py-3 sm:py-4 rounded-full glass border border-white/40 shadow-sm text-[15px] sm:text-lg placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-pink-400/50 transition-shadow cursor-text"
                  placeholder={siteSettings.navigation_search_placeholder}
                  readOnly
               />
            </div>
         </MagneticButton>
      </section>

      {/* 收藏夹视图 — 使用 reveal 动画 */}
      {isFavoritesView ? (
        loading ? (
         <div className="mobile-feed-panel liquid-panel p-3 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem]">
            <SectionTitleSkeleton className="mb-5" />
            <div className="mobile-feed-grid grid">
              {Array.from({ length: 5 }).map((_, j) => <ResourceCardSkeleton key={j} />)}
            </div>
            </div>
        ) : favoriteSites.length > 0 ? (
          <section ref={categoriesRef} className="mobile-feed-panel liquid-panel p-3 sm:p-8 rounded-[1.5rem] sm:rounded-[2rem] gradient-border-card reveal-on-scroll">
            <h3 className="flex items-center gap-2 text-[15px] sm:text-[16px] font-bold mb-3 sm:mb-4 text-slate-700 dark:text-slate-200">
              <Star className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400 fill-amber-400" />
              我的收藏
              <span className="liquid-chip text-xs px-2 py-0.5 rounded-full">{favoriteSites.length} 个</span>
            </h3>
          <div className="mobile-feed-grid grid">
            {favoriteSites.map((site, index) => (
              <LazyResourceCard key={site.id} site={site} isFavorited onToggleFavorite={onToggleFavorite} gridStagger={index} />
            ))}
          </div>
            </section>
        ) : (
          <div className="text-center py-20 text-slate-500 glass rounded-2xl animate-in fade-in zoom-in-95 duration-500 glow-border">
            <Star className="w-12 h-12 mx-auto mb-4 text-slate-300 dark:text-slate-600" />
            <p className="text-base font-medium text-slate-600 dark:text-slate-300">暂无收藏资源</p>
            <p className="text-sm mt-1.5 text-slate-400">在导航模式下点击资源卡片上的星标即可收藏</p>
            <button
              onClick={() => setIsSearchOpen(true)}
              className="mt-6 inline-flex items-center gap-2 liquid-button glass-hover px-5 py-2.5 rounded-full text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-pink-500 transition-all"
            >
              <Search className="w-4 h-4" />
              去搜索发现资源
            </button>
          </div>
        )
      ) : (
      loading ? (
         <div className="space-y-6 sm:space-y-12">
           {Array.from({ length: 3 }).map((_, i) => (
            <section key={i} className="mobile-feed-panel liquid-panel p-3 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem]">
                <SectionTitleSkeleton className="mb-5" />
                <div className="mobile-feed-grid grid">
                  {Array.from({ length: 5 }).map((_, j) => <ResourceCardSkeleton key={j} />)}
                </div>
             </section>
           ))}
         </div>
      ) : (
         <div ref={categoriesRef} className="space-y-6 sm:space-y-10 reveal-on-scroll">
            {groupedCategories[activeGroup] && groupedCategories[activeGroup].length > 0 ? (
              <section className="mobile-feed-panel liquid-panel p-3 sm:p-8 rounded-[1.5rem] sm:rounded-[2rem] gradient-border-card">
                <div className="space-y-6 sm:space-y-10">
                  {groupedCategories[activeGroup].map((cat, catIdx) => (
                    <div key={cat.id} id={`category-${cat.slug}`}>
                      <h3 className="flex items-center gap-2 text-[15px] sm:text-[16px] font-bold mb-3 sm:mb-4 text-slate-700 dark:text-slate-200">
                        <DynamicIcon name={cat.icon} className="w-4 h-4 sm:w-5 sm:h-5 text-pink-500/80" />
                        {cat.name}
                      </h3>
                    <div className="mobile-feed-grid grid">
                       {cat.sites.map((site, index) => (
                         <LazyResourceCard key={site.id} site={site} isFavorited={favorites.has(site.id)} onToggleFavorite={onToggleFavorite} gridStagger={index} />
                       ))}
                    </div>
                      {catIdx < groupedCategories[activeGroup].length - 1 && (
                        <hr className="mt-6 sm:mt-8 border-white/20 dark:border-white/5" />
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ) : navigationError ? (
               <div className="text-center py-20 text-slate-500 glass rounded-2xl glow-border">
                 {navigationError}
               </div>
           ) : (
               <div className="text-center py-20 text-slate-500 glass rounded-2xl animate-in fade-in zoom-in-95 duration-500 glow-border">
                 <p className="text-base font-medium text-slate-600 dark:text-slate-300">该分类下暂时没有资源。</p>
                 <p className="text-sm mt-1.5 text-slate-400">试试搜索发现更多内容</p>
                 <button
                   onClick={() => setIsSearchOpen(true)}
                   className="mt-6 inline-flex items-center gap-2 liquid-button glass-hover px-5 py-2.5 rounded-full text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-pink-500 transition-all"
                 >
                   <Search className="w-4 h-4" />
                   去搜索发现资源
                 </button>
               </div>
            )}
         </div>
      )
      )}

      <Suspense fallback={null}>
        {isSearchOpen && <SearchModal onClose={() => setIsSearchOpen(false)} communityUnlocked={communityUnlocked} />}
      </Suspense>
    </div>
  );
}
