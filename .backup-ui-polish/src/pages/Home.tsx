import { lazy, Suspense, useState } from "react";
import { ResourceCard } from "../components/ResourceCard";
import { ResourceCardSkeleton } from "../components/Skeletons";
import { Search, Star } from "lucide-react";
import { DynamicIcon } from "../components/DynamicIcon";
import { useGroup } from "../context";
import { buildNavigationSections, groupNavigationSections } from "../navigation-data";
import { SearchOnlyHome } from "../components/SearchOnlyHome";
import { WeatherCard } from "../components/WeatherCard";
import { FAVORITES_GROUP_LABEL } from "../favorites";

const SearchModal = lazy(() => import("../components/SearchModal"));

export default function Home() {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const { activeGroup, searchOnlyMode, communityUnlocked, categories, sites, navigationLoading: loading, navigationError, siteSettings, favorites, onToggleFavorite } = useGroup();

  const groupedCategories = groupNavigationSections(buildNavigationSections(categories, sites));
  const isFavoritesView = activeGroup === FAVORITES_GROUP_LABEL;
  const favoriteSites = sites.filter((site) => favorites.has(site.id));

  if (searchOnlyMode) {
    return <SearchOnlyHome />;
  }

  return (
    <div className="mobile-content-shell space-y-6 sm:space-y-12 max-w-7xl mx-auto">
      
<div className="flex justify-center sm:justify-start"><WeatherCard /></div>

            {/* Hero Search */}
      <section className="flex flex-col items-center justify-center py-2 sm:py-10">
         <div 
           className="w-full max-w-3xl relative group cursor-text"
           onClick={() => setIsSearchOpen(true)}
         >
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
      </section>

      {/* 收藏夹视图 */}
      {isFavoritesView ? (
        loading ? (
          <div className="mobile-feed-panel liquid-panel p-3 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem]">
            <div className="h-6 w-32 bg-slate-200/50 dark:bg-slate-800/50 rounded mb-5 animate-pulse" />
            <div className="mobile-feed-grid grid">
              {Array.from({ length: 5 }).map((_, j) => <ResourceCardSkeleton key={j} />)}
            </div>
          </div>
        ) : favoriteSites.length > 0 ? (
          <section className="mobile-feed-panel liquid-panel p-3 sm:p-8 rounded-[1.5rem] sm:rounded-[2rem]">
            <h3 className="flex items-center gap-2 text-[15px] sm:text-[16px] font-bold mb-3 sm:mb-4 text-slate-700 dark:text-slate-200">
              <Star className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400 fill-amber-400" />
              我的收藏
              <span className="liquid-chip text-xs px-2 py-0.5 rounded-full">{favoriteSites.length} 个</span>
            </h3>
            <div className="mobile-feed-grid grid">
              {favoriteSites.map((site) => (
                <ResourceCard key={site.id} site={site} isFavorited onToggleFavorite={onToggleFavorite} />
              ))}
            </div>
          </section>
        ) : (
          <div className="text-center py-20 text-slate-500 glass rounded-2xl">
            <Star className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
            <p>暂无收藏资源</p>
            <p className="text-sm mt-1 text-slate-400">在导航模式下点击资源卡片上的星标即可收藏</p>
          </div>
        )
      ) : (
      loading ? (
         <div className="space-y-6 sm:space-y-12">
           {Array.from({ length: 3 }).map((_, i) => (
             <section key={i} className="mobile-feed-panel liquid-panel p-3 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem]">
                <div className="h-6 w-32 bg-slate-200/50 dark:bg-slate-800/50 rounded mb-5 animate-pulse" />
                <div className="mobile-feed-grid grid">
                  {Array.from({ length: 5 }).map((_, j) => <ResourceCardSkeleton key={j} />)}
                </div>
             </section>
           ))}
         </div>
      ) : (
         <div className="space-y-6 sm:space-y-10">
            {groupedCategories[activeGroup] && groupedCategories[activeGroup].length > 0 ? (
              <section className="mobile-feed-panel liquid-panel p-3 sm:p-8 rounded-[1.5rem] sm:rounded-[2rem]">
                <div className="space-y-6 sm:space-y-10">
                  {groupedCategories[activeGroup].map((cat, catIdx) => (
                    <div key={cat.id} id={`category-${cat.slug}`}>
                      <h3 className="flex items-center gap-2 text-[15px] sm:text-[16px] font-bold mb-3 sm:mb-4 text-slate-700 dark:text-slate-200">
                        <DynamicIcon name={cat.icon} className="w-4 h-4 sm:w-5 sm:h-5 text-pink-500/80" />
                        {cat.name}
                      </h3>
                      <div className="mobile-feed-grid grid">
                         {cat.sites.map((site) => (
                           <ResourceCard key={site.id} site={site} isFavorited={favorites.has(site.id)} onToggleFavorite={onToggleFavorite} />
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
               <div className="text-center py-20 text-slate-500 glass rounded-2xl">
                 {navigationError}
               </div>
            ) : (
               <div className="text-center py-20 text-slate-500 glass rounded-2xl">
                 该分类下暂时没有资源。?               </div>
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

