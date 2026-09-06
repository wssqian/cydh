import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Category, SiteResponse } from "../types";
import { ResourceCard } from "../components/ResourceCard";
import { ArrowLeft } from "lucide-react";
import { ResourceCardSkeleton } from "../components/Skeletons";
import { isCommunityCategoryName, sortSitesForDisplay, subscribeNavigationDataUpdated } from "../navigation-data";
import { useGroup } from "../context";

export default function CategoryView() {
  const { slug } = useParams();
  const { communityUnlocked, favorites, onToggleFavorite } = useGroup();
  const [category, setCategory] = useState<Category | null>(null);
  const [sites, setSites] = useState<SiteResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadData = () => {
    setLoading(true);
    setError("");
    
    Promise.all([
      fetch("/api/public/categories"),
      fetch(`/api/public/sites?category=${slug}`)
    ]).then(async ([categoriesResponse, sitesResponse]) => {
      if (categoriesResponse.status === 403 || sitesResponse.status === 403) {
        throw new Error("公开资源 API 当前未开放，无法查看分类内容。");
      }
      if (!categoriesResponse.ok || !sitesResponse.ok) {
        throw new Error("暂时无法加载分类内容，请稍后重试。");
      }
      const [catsData, sitesData] = await Promise.all([
        categoriesResponse.json() as Promise<Category[]>,
        sitesResponse.json() as Promise<SiteResponse[]>,
      ]);
      const matching = catsData.find((c: Category) => c.slug === slug);
      setCategory(matching || null);
      setSites(sortSitesForDisplay(
        (sitesData as SiteResponse[]).filter((site) => site.url !== `/category/${slug}`),
      ));
      setLoading(false);
    }).catch((loadError: Error) => {
      setCategory(null);
      setSites([]);
      setError(loadError.message);
      setLoading(false);
    });
    };

    loadData();
    return subscribeNavigationDataUpdated(loadData);
  }, [slug]);

  if (!loading && error) {
    return <div className="liquid-panel text-center py-20 text-slate-500 rounded-2xl">{error}</div>;
  }

  if (!loading && !category) {
    return <div className="text-center py-20 text-slate-500">未找到分类。</div>;
  }

  if (!loading && category && !communityUnlocked && isCommunityCategoryName(category.name)) {
    return (
      <div className="liquid-panel mx-auto mt-12 max-w-lg rounded-[2rem] px-8 py-14 text-center text-slate-500">
        此分类已隐藏，请在设置中输入访问口令后查看。
      </div>
    );
  }

  return (
    <div className="mobile-content-shell space-y-5 sm:space-y-8 animate-in fade-in zoom-in-95 duration-300">
      <div className="flex items-center gap-3 sm:gap-4">
        <Link to="/" className="liquid-button p-2 sm:p-2.5 rounded-full glass-hover transition-colors">
          <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5 text-slate-500" />
        </Link>
        <div>
          {loading ? (
             <div className="h-8 w-48 bg-white/40 dark:bg-slate-800/50 rounded-lg animate-pulse" />
          ) : (
             <>
               <h1 className="text-2xl sm:text-3xl font-bold">{category?.name}</h1>
               <p className="mt-1 text-sm sm:text-base text-slate-500">显示 {category?.name} 中的所有资源</p>
             </>
          )}
        </div>
      </div>

      {!loading && sites.length === 0 ? (
        <div className="text-center py-20 text-slate-500 border border-dashed rounded-2xl border-white/20 glass">
          此分类下未找到任何资源。
        </div>
      ) : (
        <div className="mobile-feed-grid grid">
          {loading ? (
             Array.from({ length: 8 }).map((_, i) => <ResourceCardSkeleton key={i} />)
          ) : (
             sites.map((site) => (
               <ResourceCard key={site.id} site={site} isFavorited={favorites.has(site.id)} onToggleFavorite={onToggleFavorite} />
             ))
          )}
        </div>
      )}
    </div>
  );
}
