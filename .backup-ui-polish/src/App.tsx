import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Home from "./pages/Home";
import { Menu, X, PanelLeftClose, Settings, Compass, LayoutGrid, CalendarDays, BookOpen, Gamepad2, Image } from "lucide-react";
import { DynamicIcon } from "./components/DynamicIcon";
import { Category, SiteResponse } from "./types";
import { GroupContext } from "./context";
import { FloatingTools } from "./components/FloatingTools";
import { WaifuWidget } from "./components/WaifuWidget";
import {
  buildSidebarSections,
  COMMUNITY_UNLOCK_KEY,
  DEFAULT_NAVIGATION_GROUP,
  groupNavigationSections,
  initialSearchOnlyMode,
  isCommunityUnlocked,
  subscribeNavigationDataUpdated,
  visibleNavigationGroups,
  type NavigationGroup,
} from "./navigation-data";
import { defaultSiteSettings, mergeSiteSettings } from "./site-settings";
import { readWaifuWidgetPreference, saveWaifuWidgetPreference } from "./waifu-settings";
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

const SPRING_IN = { type: "spring" as const, stiffness: 200, damping: 26, mass: 0.8, restDelta: 0.001 };
const TWEEN_OUT = { duration: 0.12, ease: [0.4, 0, 1, 1] } as const;
const REDUCED_MOTION = { duration: 0.12 } as const;

const modeTransitionVariants = {
  enter: ({ direction }: { direction: number }) => ({
    x: direction > 0 ? "35%" : "-35%",
    opacity: 1,
  }),
  center: ({ reduceMotion }: { reduceMotion: boolean }) => ({
    x: 0,
    opacity: 1,
    transition: reduceMotion ? REDUCED_MOTION : SPRING_IN,
  }),
  exit: ({ reduceMotion }: { reduceMotion: boolean }) => ({
    opacity: 0,
    transition: reduceMotion ? REDUCED_MOTION : TWEEN_OUT,
  }),
};

function AppLayout({ children }: { children: React.ReactNode }) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sites, setSites] = useState<SiteResponse[]>([]);
  const [navigationLoading, setNavigationLoading] = useState(true);
  const [navigationLoaded, setNavigationLoaded] = useState(false);
  const [navigationError, setNavigationError] = useState("");
  const [siteSettings, setSiteSettings] = useState(defaultSiteSettings);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [searchOnlyMode, setSearchOnlyMode] = useState(initialSearchOnlyMode);
  const [communityUnlocked, setCommunityUnlocked] = useState(() => isCommunityUnlocked(localStorage.getItem(COMMUNITY_UNLOCK_KEY)));
  const [waifuWidgetEnabled, setWaifuWidgetEnabled] = useState(readWaifuWidgetPreference);
  const [uiTheme, setUiTheme] = useState<UiTheme>(readUiThemePreference);
  const [favorites, setFavorites] = useState<Set<number>>(loadFavorites);
  const [hotContentTop, setHotContentTop] = useState<number | null>(null);
  const [modeDirection, setModeDirection] = useState(1);
  const [isLargeNavigationViewport, setIsLargeNavigationViewport] = useState(() => {
    return window.matchMedia("(min-width: 1024px)").matches;
  });
  const shellRef = useRef<HTMLDivElement>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const visitReportedRef = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [activeGroup, setActiveGroup] = useState<NavigationGroup | string>(DEFAULT_NAVIGATION_GROUP);
  const reduceMotion = useReducedMotion();
  const isSearchView = searchOnlyMode && location.pathname === "/";
  const isAdminView = location.pathname.startsWith("/wssqianadmin");
  const isNavigationSidebarVisible = !isSearchView && (isSidebarOpen || (isLargeNavigationViewport && !isSidebarCollapsed));
  const toggleSearchOnlyMode = () => {
    const nextMode = !searchOnlyMode;
    setModeDirection(nextMode ? 1 : -1);
    setSearchOnlyMode(nextMode);
    if (!nextMode) {
      setActiveGroup(DEFAULT_NAVIGATION_GROUP);
    }
    if (nextMode && location.pathname !== "/") {
      navigate("/");
    }
  };
  const updateCommunityAccess = (unlocked: boolean) => {
    setCommunityUnlocked(unlocked);
    if (unlocked) {
      localStorage.setItem(COMMUNITY_UNLOCK_KEY, "true");
      return;
    }

    localStorage.removeItem(COMMUNITY_UNLOCK_KEY);
    if (activeGroup === "次元社区") {
      setActiveGroup(DEFAULT_NAVIGATION_GROUP);
    }
  };
  const updateWaifuWidgetPreference = (enabled: boolean) => {
    saveWaifuWidgetPreference(enabled);
    setWaifuWidgetEnabled(enabled);
  };
  const handleToggleFavorite = (siteId: number) => {
    setFavorites((prev) => toggleFavoriteUtil(prev, siteId));
  };
  const updateUiThemePreference = async (theme: UiTheme) => {
    await applyUiThemePreference(theme);
    const savedTheme = saveUiThemePreference(theme);
    setUiTheme(savedTheme);
    return savedTheme;
  };
  const loadNavigationData = async () => {
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
  };
  const loadSiteSettings = async () => {
    try {
      const response = await fetch("/api/public/settings");
      if (!response.ok) {
      throw new Error("Site settings temporarily unavailable");
      }
      setSiteSettings(mergeSiteSettings(await response.json()));
    } catch {
      setSiteSettings(defaultSiteSettings);
    }
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || !shellRef.current) {
      return;
    }

    const pointerX = event.clientX;
    const pointerY = event.clientY;
    if (pointerFrameRef.current !== null) {
      window.cancelAnimationFrame(pointerFrameRef.current);
    }
    pointerFrameRef.current = window.requestAnimationFrame(() => {
      const shell = shellRef.current;
      if (!shell) {
        return;
      }
      shell.style.setProperty("--pointer-x", `${pointerX}px`);
      shell.style.setProperty("--pointer-y", `${pointerY}px`);
      shell.dataset.pointerActive = "true";
      pointerFrameRef.current = null;
    });
  };
  const handlePointerLeave = () => {
    shellRef.current?.removeAttribute("data-pointer-active");
  };

  const groupedCategories = groupNavigationSections(buildSidebarSections(categories, sites));
  const navigationGroups = visibleNavigationGroups(communityUnlocked);

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

  useEffect(() => {
    if (isSearchView) {
      return;
    }
    if (!navigationLoaded) {
      loadNavigationData();
    }
    return subscribeNavigationDataUpdated(loadNavigationData);
  }, [isSearchView, navigationLoaded]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const updateViewport = () => setIsLargeNavigationViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => () => {
    if (pointerFrameRef.current !== null) {
      window.cancelAnimationFrame(pointerFrameRef.current);
    }
  }, []);

  const currentGroupCats = groupedCategories[activeGroup] || [];
  const pageContextValue = useMemo(() => ({
    activeGroup,
    setActiveGroup,
    searchOnlyMode: isSearchView,
    communityUnlocked,
    categories,
    sites,
    navigationLoading,
    navigationError,
    siteSettings,
    onHotContentTopChange: setHotContentTop,
    favorites,
    onToggleFavorite: handleToggleFavorite,
  }), [activeGroup, isSearchView, communityUnlocked, categories, sites, navigationLoading, navigationError, siteSettings, favorites]);

  return (
    <div
      ref={shellRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className="liquid-app min-h-screen bg-transparent text-slate-900 dark:text-slate-100 flex font-sans transition-colors"
    >
      <div className="liquid-pointer-light" aria-hidden="true" />
      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {!isSearchView && isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 bg-black/20 z-40 lg:hidden backdrop-blur-sm"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}
      </AnimatePresence>
      
      {/* Sidebar */}
      <AnimatePresence>
        {!isSearchView && (
          <motion.aside
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className={`fixed inset-y-0 left-0 z-50 w-[82vw] max-w-[18rem] sm:w-56 xl:w-64 glass border-r-0 transform transition-transform duration-300 lg:transition-all ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} ${isSidebarCollapsed ? 'lg:-translate-x-full' : 'lg:translate-x-0'}`}>
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
        <div className="overflow-y-auto h-[calc(100vh-60px)] sm:h-[calc(100vh-72px)] py-3 sm:py-4 px-3">
             <div className="mb-4">
                <h3 className="px-4 text-xs font-bold text-slate-500/80 dark:text-slate-400 uppercase tracking-wider mb-2">{activeGroup}</h3>
                <ul className="space-y-0.5">
                  {currentGroupCats.map((cat) => (
                    <li key={cat.slug}>
                      <Link 
                        to={`/category/${cat.slug}`} 
                        className={`flex items-center gap-3 px-3 sm:px-4 py-2 rounded-xl text-sm font-medium transition-colors hover:bg-white/40 dark:hover:bg-slate-800/50 hover:text-pink-500 dark:hover:text-pink-400 ${
                           location.pathname === `/category/${cat.slug}` 
                             ? 'liquid-chip text-pink-600 dark:text-pink-400 shadow-sm' 
                             : 'text-slate-600 dark:text-slate-300 border border-transparent'
                        }`}
                      >
                        <DynamicIcon name={cat.icon} className="w-[16px] h-[16px] opacity-70" />
                        {cat.name}
                      </Link>
                    </li>
                  ))}
                </ul>
             </div>
        </div>
      </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className={`flex-1 flex flex-col min-h-screen relative w-full overflow-hidden ${isSearchView || isSidebarCollapsed ? 'lg:pl-0' : 'lg:pl-56 xl:pl-64'}`}>
        <AnimatePresence>
          {!isSearchView && (
            <motion.header
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="sticky top-0 z-30 flex h-[60px] sm:h-[72px] items-center justify-between gap-2 px-3 sm:px-8 lg:pl-6 xl:pl-8 glass border-b border-white/20 dark:border-white/5 shadow-sm">
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
           
           <div className="flex-1 flex min-w-0 lg:justify-start overflow-x-auto scrollbar-hide items-center gap-3 sm:gap-4 lg:gap-8 mr-1 sm:mr-4 pb-1">
               <button
                   onClick={() => { setActiveGroup(FAVORITES_GROUP_LABEL); if (location.pathname !== '/') navigate('/'); }}
                   className={`whitespace-nowrap font-bold text-sm sm:text-base lg:text-lg transition-all ${activeGroup === FAVORITES_GROUP_LABEL && location.pathname === '/' ? 'text-pink-500 scale-105' : 'text-slate-600 dark:text-slate-300 hover:text-pink-400'}`}
               >
                   {FAVORITES_GROUP_LABEL}
               </button>
               {navigationGroups.map(group => (
                   <button
                       key={group}
                       onClick={() => { setActiveGroup(group); if (location.pathname !== '/') navigate('/'); }}
                       className={`whitespace-nowrap font-bold text-sm sm:text-base lg:text-lg transition-all ${activeGroup === group && location.pathname === '/' ? 'text-pink-500 scale-105' : 'text-slate-600 dark:text-slate-300 hover:text-pink-400'}`}
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
                     className={`whitespace-nowrap flex items-center gap-1.5 text-xs sm:text-sm font-medium transition-all ${location.pathname === '/bangumi' ? 'text-violet-500 scale-105' : 'text-slate-500 dark:text-slate-400 hover:text-violet-400'}`}
                   >
                     <CalendarDays className="w-3.5 h-3.5" />
                     番组放送
                   </Link>
                   <Link
                     to="/manga"
                     className={`whitespace-nowrap flex items-center gap-1.5 text-xs sm:text-sm font-medium transition-all ${location.pathname === '/manga' ? 'text-emerald-500 scale-105' : 'text-slate-500 dark:text-slate-400 hover:text-emerald-400'}`}
                   >
                     <BookOpen className="w-3.5 h-3.5" />
                     漫画情报
                   </Link>
                   <Link
                     to="/galgame"
                     className={`whitespace-nowrap flex items-center gap-1.5 text-xs sm:text-sm font-medium transition-all ${location.pathname === '/galgame' ? 'text-amber-500 scale-105' : 'text-slate-500 dark:text-slate-400 hover:text-amber-400'}`}
                   >
                     <Gamepad2 className="w-3.5 h-3.5" />
                     GAL空间
                   </Link>
                   <Link
                     to="/pixiv"
                     className={`whitespace-nowrap flex items-center gap-1.5 text-xs sm:text-sm font-medium transition-all ${location.pathname === '/pixiv' ? 'text-pink-500 scale-105' : 'text-slate-500 dark:text-slate-400 hover:text-pink-400'}`}
                   >
                     <Image className="w-3.5 h-3.5" />
                     P站美图榜
                   </Link>
                 </>
               )}
           </div>

           <div data-waifu-safe-zone="top-actions" className="flex shrink-0 justify-end items-center gap-1.5 sm:gap-3">
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
        </motion.header>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isSearchView && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              data-waifu-safe-zone="top-actions"
              className="fixed right-3 top-3 z-40 flex items-center gap-2 sm:right-5 sm:top-5">
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
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false} mode="sync" custom={{ direction: modeDirection, reduceMotion: Boolean(reduceMotion) }}>
          <motion.main
            key={isSearchView ? "search-only" : "navigation"}
            custom={{ direction: modeDirection, reduceMotion: Boolean(reduceMotion) }}
            variants={modeTransitionVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className={`mode-surface flex-1 ${isSearchView ? "search-mode" : "p-3 sm:p-8"}`}
          >
            <GroupContext.Provider value={pageContextValue}>
              {children}
            </GroupContext.Provider>
          </motion.main>
        </AnimatePresence>
        
        {!isSearchView && <footer className="py-5 sm:py-8 mt-auto text-center text-xs sm:text-sm text-slate-400 font-mono">
           <p>{siteSettings.footer_text} &copy; {new Date().getFullYear()}</p>
        </footer>}
      </div>

      <AnimatePresence>
        {!isSearchView && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <FloatingTools />
          </motion.div>
        )}
      </AnimatePresence>
      {!isAdminView && waifuWidgetEnabled && (
        <WaifuWidget
          isSearchView={isSearchView}
          hotContentTop={isSearchView ? hotContentTop : null}
          isNavigationSidebarVisible={isNavigationSidebarVisible}
          isSettingsOpen={isSettingsOpen}
        />
      )}
      <Suspense fallback={null}>
        {isSettingsOpen && (
          <SettingsModal
            onClose={() => setIsSettingsOpen(false)}
            communityUnlocked={communityUnlocked}
            onCommunityAccessChange={updateCommunityAccess}
            waifuWidgetEnabled={waifuWidgetEnabled}
            onWaifuWidgetChange={updateWaifuWidgetPreference}
            uiThemePreference={uiTheme}
            onUiThemeChange={updateUiThemePreference}
          />
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


