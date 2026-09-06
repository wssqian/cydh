import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate } from "react-router-dom";
import Home from "./pages/Home";
import { Menu, X, PanelLeftClose, Settings, Compass, LayoutGrid, CalendarDays, BookOpen, Gamepad2, Image, MessageSquare, Sparkles } from "lucide-react";
import { DynamicIcon } from "./components/DynamicIcon";
import { Category, SiteResponse } from "./types";
import { GroupContext } from "./context";
import { FloatingTools } from "./components/FloatingTools";
import { MobileBottomNav } from "./components/MobileBottomNav";
import {
  buildSidebarSections,
  DEFAULT_NAVIGATION_GROUP,
  groupNavigationSections,
  initialSearchOnlyMode,
  subscribeNavigationDataUpdated,
  visibleNavigationGroups,
  type NavigationGroup,
} from "./navigation-data";
import { useCommunityAccess } from "./hooks/useCommunityAccess";
import { defaultSiteSettings, mergeSiteSettings } from "./site-settings";
import {
  applyUiThemePreference,
  readUiThemePreference,
  saveUiThemePreference,
  type UiTheme,
} from "./ui-theme";
import {
  loadFavorites,
  toggleFavorite as toggleFavoriteUtil,
  subscribeFavoritesChanged,
  FAVORITES_GROUP_LABEL,
} from "./favorites";

const Admin = lazy(() => import("./pages/Admin"));
const CategoryView = lazy(() => import("./pages/CategoryView"));
const BangumiPage = lazy(() => import("./pages/BangumiPage"));
const MangaPage = lazy(() => import("./pages/MangaPage"));
const GalgamePage = lazy(() => import("./pages/GalgamePage"));
const PixivPage = lazy(() => import("./pages/PixivPage"));
const SettingsModal = lazy(() => import("./components/SettingsModal"));
const SubmitSuggestion = lazy(() => import("./components/SubmitSuggestion"));

function AppLayout({ children }: { children: React.ReactNode }) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSuggestionOpen, setIsSuggestionOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sites, setSites] = useState<SiteResponse[]>([]);
  const [navigationLoading, setNavigationLoading] = useState(true);
  const [navigationLoaded, setNavigationLoaded] = useState(false);
  const [navigationError, setNavigationError] = useState("");
  const [siteSettings, setSiteSettings] = useState(defaultSiteSettings);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [searchOnlyMode, setSearchOnlyMode] = useState(initialSearchOnlyMode);
  const { unlocked: communityUnlocked, unlock: unlockCommunity, logout: logoutCommunity, checking: communityChecking, markLocked: markCommunityLocked } = useCommunityAccess();
  const [uiTheme, setUiTheme] = useState<UiTheme>(readUiThemePreference);
  const [favorites, setFavorites] = useState<Set<number>>(loadFavorites);
  const [hotContentTop, setHotContentTop] = useState<number | null>(null);
  const [isLargeNavigationViewport, setIsLargeNavigationViewport] = useState(() => {
    return window.matchMedia("(min-width: 1024px)").matches;
  });
  const visitReportedRef = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [activeGroup, setActiveGroup] = useState<NavigationGroup | string>(DEFAULT_NAVIGATION_GROUP);
  const [searchPageActive, setSearchPageActive] = useState(false);
  const isSearchView = searchOnlyMode && location.pathname === "/";
  const isAdminView = location.pathname.startsWith("/wssqianadmin");
  const isNavigationSidebarVisible = !isSearchView && (isSidebarOpen || (isLargeNavigationViewport && !isSidebarCollapsed));
  const handleGroupChange = useCallback(
    (group: NavigationGroup | string) => {
      setActiveGroup(group);
      if (location.pathname !== "/") navigate("/");
    },
    [location.pathname, navigate],
  );
  const toggleSearchOnlyMode = useCallback(() => {
    const nextMode = !searchOnlyMode;
    setSearchOnlyMode(nextMode);
    if (!nextMode) {
      setActiveGroup(DEFAULT_NAVIGATION_GROUP);
    }
    if (nextMode && location.pathname !== "/") {
      navigate("/");
    }
  }, [searchOnlyMode, location.pathname, navigate]);
  const handleToggleFavorite = useCallback((siteId: number) => {
    // updateFn 用 setFavorites updater（稳定引用），避免在 favorites 变化时刷新 pageContextValue.onToggleFavorite
    setFavorites((prev) => toggleFavoriteUtil(prev, siteId));
  }, []);
  const updateUiThemePreference = useCallback(async (theme: UiTheme) => {
    await applyUiThemePreference(theme);
    const savedTheme = saveUiThemePreference(theme);
    setUiTheme(savedTheme);
    return savedTheme;
  }, []);
  const loadNavigationData = useCallback(async () => {
    setNavigationLoading(true);
    setNavigationError("");
    try {
      const [categoriesResponse, sitesResponse] = await Promise.all([
        fetch("/api/public/categories"),
        fetch("/api/public/sites"),
      ]);
      if (categoriesResponse.status === 403 || sitesResponse.status === 403) {
        throw new Error("Public API is currently disabled, please contact admin to enable it");
      }
      if (!categoriesResponse.ok || !sitesResponse.ok) {
        throw new Error("Unable to load navigation content, please try again later");
      }
      const [categoriesData, sitesData] = await Promise.all([
        categoriesResponse.json() as Promise<Category[]>,
        sitesResponse.json() as Promise<SiteResponse[]>,
      ]);
      setCategories(categoriesData);
      setSites(sitesData);
      setNavigationLoaded(true);
    } catch (error) {
      setCategories([]);
      setSites([]);
      setNavigationLoaded(true);
      setNavigationError(error instanceof Error ? error.message : "Unable to load navigation content");
    } finally {
      setNavigationLoading(false);
    }
  }, []);
  const loadSiteSettings = useCallback(async () => {
    try {
      const response = await fetch("/api/public/settings");
      if (!response.ok) {
      throw new Error("Site settings temporarily unavailable");
      }
      setSiteSettings(mergeSiteSettings(await response.json()));
    } catch {
      setSiteSettings(defaultSiteSettings);
    }
  }, []);

  const groupedCategories = useMemo(
    () => groupNavigationSections(buildSidebarSections(categories, sites)),
    [categories, sites],
  );
  const navigationGroups = useMemo(
    () => visibleNavigationGroups(communityUnlocked),
    [communityUnlocked],
  );

  useEffect(() => {
    if (location.pathname.startsWith("/wssqianadmin") || visitReportedRef.current) {
      return;
    }
    visitReportedRef.current = true;
    void fetch("/api/public/visits", {
      method: "POST",
      keepalive: true,
    })
      .then((response) => {
        if (!response.ok) {
          visitReportedRef.current = false;
        }
      })
      .catch(() => {
        visitReportedRef.current = false;
      });
  }, [location.pathname]);

  useEffect(() => {
    void loadSiteSettings();
    return subscribeNavigationDataUpdated(loadSiteSettings);
  }, []);

  useEffect(() => {
    return subscribeFavoritesChanged(() => setFavorites(loadFavorites()));
  }, []);

  // 无论当前视图是什么，首次挂载时都加载导航数据
  // 避免搜索模式（initialSearchOnlyMode = true）下切换到导航视图时无数据
  useEffect(() => {
    if (!navigationLoaded) {
      loadNavigationData();
    }
    return subscribeNavigationDataUpdated(loadNavigationData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const updateViewport = () => setIsLargeNavigationViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  // 滚动期间临时降级 backdrop-filter：滚动中卡片快速运动，模糊细节不可感知；
  // 滚动停止 120ms 后恢复。消除滚动时 ~20 个玻璃层每帧背景重采样的主线程开销。
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const root = document.documentElement;
    const onScroll = () => {
      root.classList.add("is-scrolling");
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => root.classList.remove("is-scrolling"), 120);
    };
    // scroll 不冒泡：用捕获阶段监听所有滚动容器（.mode-page 等）
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      if (timer) clearTimeout(timer);
      root.classList.remove("is-scrolling");
    };
  }, []);

  useEffect(() => {
    if (isSearchView) {
      // 延迟添加 .active 以触发 CSS opacity transition
      const id = requestAnimationFrame(() => setSearchPageActive(true));
      return () => cancelAnimationFrame(id);
    }
    setSearchPageActive(false);
  }, [isSearchView]);

  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);


  const currentGroupCats = useMemo(
    () => groupedCategories[activeGroup] || [],
    [groupedCategories, activeGroup],
  );
  const sidebarLinks = useMemo(
    () =>
      currentGroupCats.map((cat) => {
        const active = location.pathname === `/category/${cat.slug}`;
        return (
          <li key={cat.slug}>
            <Link
              to={`/category/${cat.slug}`}
              className={`flex items-center gap-3 px-3 sm:px-4 py-2 rounded-xl text-sm font-medium transition-colors hover:bg-white/40 dark:hover:bg-slate-800/50 hover:text-pink-500 dark:hover:text-pink-400 ${
                active
                  ? "liquid-chip text-pink-600 dark:text-pink-400 shadow-sm"
                  : "text-slate-600 dark:text-slate-300 border border-transparent"
              }`}
            >
              <DynamicIcon name={cat.icon} className="w-[16px] h-[16px] opacity-70" />
              {cat.name}
            </Link>
          </li>
        );
      }),
    [currentGroupCats, location.pathname],
  );
  const pageContextValue = useMemo(() => ({
    activeGroup,
    setActiveGroup,
    searchOnlyMode,
    communityUnlocked,
    communityChecking,
    unlockCommunity,
    logoutCommunity,
    markCommunityLocked,
    categories,
    sites,
    navigationLoading,
    navigationError,
    siteSettings,
    onHotContentTopChange: setHotContentTop,
    favorites,
    onToggleFavorite: handleToggleFavorite,
  }), [activeGroup, searchOnlyMode, communityUnlocked, communityChecking, unlockCommunity, logoutCommunity, markCommunityLocked, categories, sites, navigationLoading, navigationError, siteSettings, favorites]);

  return (
    <div className="liquid-app min-h-screen bg-transparent text-slate-900 dark:text-slate-100 flex font-sans transition-colors">
      {/* Mobile sidebar overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 lg:hidden backdrop-blur-sm mode-fade active"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[82vw] max-w-[18rem] sm:w-56 xl:w-64 glass border-r-0 transform transition-transform duration-300 lg:transition-all mode-fade ${!isSearchView ? 'active' : ''} ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} ${isSidebarCollapsed ? 'lg:-translate-x-full' : 'lg:translate-x-0'}`}>
        <div className="flex h-[60px] sm:h-[72px] items-center px-4 sm:px-6 justify-between">
           <Link to="/" className="flex min-w-0 items-center gap-2 font-bold text-xl sm:text-2xl tracking-tight text-slate-800 dark:text-white">
             <img src="/site-logo.png" alt="" className="h-9 w-9 sm:h-10 sm:w-10 rounded-full object-cover shadow-sm" />
             <span className="truncate">
             {siteSettings.site_name}
             </span>
           </Link>
           <button
             onClick={() => setIsSidebarCollapsed(true)}
             className="hidden lg:flex shrink-0 p-2 text-slate-500 hover:text-pink-500 transition-colors"
             aria-label="Collapse sidebar"
           >
             <PanelLeftClose className="w-5 h-5" />
           </button>
           <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-2 -mr-2 text-slate-500 hover:text-pink-500">
             <X className="w-5 h-5" />
           </button>
        </div>
        <div className="overflow-y-auto h-[calc(100vh-60px)] sm:h-[calc(100vh-72px)] py-3 sm:py-4 px-3 flex flex-col">
             <div className="mb-4 flex-1">
                <h3 className="px-4 text-xs font-bold text-slate-500/80 dark:text-slate-400 uppercase tracking-wider mb-2">{activeGroup}</h3>
                <ul className="space-y-0.5">
                  {sidebarLinks}
                </ul>
             </div>
             {/* 提交建议/网址按钮 */}
             <div className="px-3 pb-2 pt-2 border-t border-white/30 dark:border-white/10">
               <button
                 onClick={() => setIsSuggestionOpen(true)}
                 className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-white/40 dark:hover:bg-slate-800/50 text-slate-500 hover:text-pink-500 dark:hover:text-pink-400"
               >
                 <MessageSquare className="w-4 h-4" />
                 <span>提交建议/网址</span>
               </button>
             </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className={`flex-1 flex flex-col min-h-screen relative w-full overflow-hidden ${isSearchView || isSidebarCollapsed ? 'lg:pl-0' : 'lg:pl-56 xl:pl-64'}`}>
        <header
              className={`sticky top-0 z-30 flex h-[60px] sm:h-[72px] items-center justify-between gap-2 px-3 sm:px-8 lg:pl-6 xl:pl-8 glass border-b border-white/20 dark:border-white/5 shadow-sm mode-fade ${!isSearchView ? 'active' : ''}`}>
           <div className="flex items-center gap-2 sm:gap-4">
              <button 
                onClick={() => {
                  if (window.innerWidth >= 1024) {
                    setIsSidebarCollapsed(false);
                  } else {
                    setIsSidebarOpen(!isSidebarOpen);
                  }
                }} 
                className={`p-2 -ml-2 text-slate-600 dark:text-slate-300 hover:text-pink-500 transition-colors ${!isSidebarCollapsed ? 'lg:hidden' : ''}`}
              >
                <Menu className="w-6 h-6" />
              </button>
           </div>
           
           {useMemo(
             () => (
               <div className="flex-1 flex min-w-0 lg:justify-start overflow-x-auto scrollbar-hide items-center gap-3 sm:gap-4 lg:gap-8 mr-1 sm:mr-4 pb-1">
                 <button
                   onClick={() => handleGroupChange(FAVORITES_GROUP_LABEL)}
                   className={`whitespace-nowrap font-bold text-sm sm:text-base lg:text-lg transition-[color,transform,opacity] ${activeGroup === FAVORITES_GROUP_LABEL && location.pathname === "/" ? "text-pink-500 scale-105" : "text-slate-600 dark:text-slate-300 hover:text-pink-400"}`}
                 >
                   {FAVORITES_GROUP_LABEL}
                 </button>
                 {navigationGroups.map((group) => (
                   <button
                     key={group}
                     onClick={() => handleGroupChange(group)}
                     className={`whitespace-nowrap font-bold text-sm sm:text-base lg:text-lg transition-[color,transform,opacity] ${activeGroup === group && location.pathname === "/" ? "text-pink-500 scale-105" : "text-slate-600 dark:text-slate-300 hover:text-pink-400"}`}
                   >
                     {group}
                   </button>
                 ))}
                 {/* ACG 特色功能入口 — 口令解锁后显示 */}
                 {communityUnlocked && (
                   <>
                     <span className="w-px h-4 bg-slate-300 dark:bg-slate-600 mx-1" />
                     <Link
                       to="/bangumi"
                       className={`whitespace-nowrap flex items-center gap-1.5 text-xs sm:text-sm font-medium transition-[color,transform,opacity] ${location.pathname === "/bangumi" ? "text-violet-500 scale-105" : "text-slate-500 dark:text-slate-400 hover:text-violet-400"}`}
                     >
                       <CalendarDays className="w-3.5 h-3.5" />
                       番组放送
                     </Link>
                     <Link
                       to="/manga"
                       className={`whitespace-nowrap flex items-center gap-1.5 text-xs sm:text-sm font-medium transition-[color,transform,opacity] ${location.pathname === "/manga" ? "text-emerald-500 scale-105" : "text-slate-500 dark:text-slate-400 hover:text-emerald-400"}`}
                     >
                       <BookOpen className="w-3.5 h-3.5" />
                       漫画情报
                     </Link>
                     <Link
                       to="/galgame"
                       className={`whitespace-nowrap flex items-center gap-1.5 text-xs sm:text-sm font-medium transition-[color,transform,opacity] ${location.pathname === "/galgame" ? "text-amber-500 scale-105" : "text-slate-500 dark:text-slate-400 hover:text-amber-400"}`}
                     >
                       <Gamepad2 className="w-3.5 h-3.5" />
                       GAL空间
                     </Link>
                     <Link
                       to="/pixiv"
                       className={`whitespace-nowrap flex items-center gap-1.5 text-xs sm:text-sm font-medium transition-[color,transform,opacity] ${location.pathname === "/pixiv" ? "text-pink-500 scale-105" : "text-slate-500 dark:text-slate-400 hover:text-pink-400"}`}
                     >
                       <Image className="w-3.5 h-3.5" />
                       P站美图榜
                     </Link>
                   </>
                 )}
               </div>
             ),
             [activeGroup, communityUnlocked, handleGroupChange, location.pathname, navigationGroups],
           )}

           <div className="flex shrink-0 justify-end items-center gap-1.5 sm:gap-3">
              <button
                onClick={toggleSearchOnlyMode}
                className="flex h-9 w-9 items-center justify-center gap-2 rounded-full glass-card glass-hover text-slate-600 dark:text-slate-300 hover:text-pink-500 text-sm font-medium sm:h-10 sm:w-auto sm:px-4"
              aria-label={`Switch to ${siteSettings.search_mode_label} page`}
              >
                <Compass className="w-4 h-4" />
                <span className="hidden sm:inline">{siteSettings.search_mode_label}</span>
              </button>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full glass-card glass-hover text-slate-600 dark:text-slate-300 hover:text-pink-500"
              aria-label="Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
           </div>
        </header>

        {isSearchView && (
          <div className="fixed right-3 top-3 z-40 flex items-center gap-2 sm:right-5 sm:top-5 mode-fade active">
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="liquid-button flex h-10 w-10 items-center justify-center text-slate-600 dark:text-slate-200"
              aria-label="Settings"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              onClick={toggleSearchOnlyMode}
              className="liquid-button flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-200 sm:px-4 sm:py-2.5"
            >
              <LayoutGrid className="h-4 w-4" />
              返回导航
            </button>
          </div>
        )}

        <GroupContext.Provider value={pageContextValue}>
          {/* nav main — 始终挂载，通过 .mode-page + .active 控制 */}
          <main
            className={`mode-page nav-page ${!isSearchView ? 'active' : ''} ${!isSearchView ? 'p-3 sm:p-8' : ''}`}
          >
            {!isSearchView ? children : null}
            {!isSearchView && <footer className="py-5 sm:py-8 mt-auto text-center text-xs sm:text-sm text-slate-400 font-mono">
               <p>{siteSettings.footer_text} &copy; {new Date().getFullYear()}</p>
            </footer>}
          </main>
          {/* search main — 仅在 search 模式下渲染内容，延迟 .active 触发 opacity transition */}
          {isSearchView && (
            <main className={`mode-page search-page ${searchPageActive ? 'active' : ''}`}>
              {children}
            </main>
          )}
        </GroupContext.Provider>
      </div>

      <div className={`mode-fade ${!isSearchView ? 'active' : ''}`}>
        <FloatingTools />
      </div>
      {!isAdminView && (
        <MobileBottomNav
          communityUnlocked={communityUnlocked}
          activeGroup={typeof activeGroup === 'string' ? activeGroup : DEFAULT_NAVIGATION_GROUP}
          onGroupChange={setActiveGroup}
          visible={!isSearchView}
        />
      )}
      <Suspense fallback={null}>
        {isSettingsOpen && (
          <SettingsModal
            onClose={() => setIsSettingsOpen(false)}
            communityUnlocked={communityUnlocked}
            onCommunityUnlock={unlockCommunity}
            onCommunityLogout={logoutCommunity}
            uiThemePreference={uiTheme}
            onUiThemeChange={updateUiThemePreference}
          />
        )}
        {isSuggestionOpen && (
          <SubmitSuggestion onClose={() => setIsSuggestionOpen(false)} />
        )}
      </Suspense>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
       <AppLayout>
          <Suspense fallback={null}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/category/:slug" element={<CategoryView />} />
              <Route path="/bangumi" element={<BangumiPage />} />
              <Route path="/manga" element={<MangaPage />} />
              <Route path="/galgame" element={<GalgamePage />} />
              <Route path="/pixiv" element={<PixivPage />} />
              <Route path="/wssqianadmin" element={<Admin />} />
            </Routes>
          </Suspense>
       </AppLayout>
    </BrowserRouter>
  );
}

