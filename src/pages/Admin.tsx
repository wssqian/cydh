import { type ComponentType, type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import UpdateSystemPanel from "../components/UpdateSystemPanel";
import DailyHotPanel from "../components/DailyHotPanel";
import AcgProxyPanel from "../components/AcgProxyPanel";
import AddResourcePanel from "../components/AddResourcePanel";
import SiteManagerPanel from "../components/SiteManagerPanel";
import ServiceSettingsPanel from "../components/ServiceSettingsPanel";
import { AlertCircle, BarChart3, LinkIcon, Lock, LogOut, Palette, Play, Plus, Settings2, Trash2, Flame, TrendingUp, RefreshCw, Activity, Download, GitBranch, CheckCircle2, XCircle, Loader2, ArrowUpCircle, CloudDownload, Package, HeartPulse, ExternalLink, Sparkles, Globe, Mail, Bell, MessageSquare, Inbox, Database, Upload, FileDown, Bot, Brain, Tags, Shuffle } from "lucide-react";
import { Category, SiteResponse } from "../types";
import { announceNavigationDataUpdated } from "../navigation-data";
import { defaultSiteSettings } from "../site-settings";
import UrlManager from "../components/UrlManager";
import SubmissionManager from "../components/SubmissionManager";
import AIClassifyPanel from "../components/AIClassifyPanel";
import EmailSettingsForm from "../components/EmailSettingsForm";

interface AdminSettings {
  scraper_url: string;
  scraper_interval_hours: string;
  scraper_enabled: string;
  scraper_proxy_enabled: string;
  scraper_proxy_url: string;
  public_api_enabled: string;
  site_name: string;
  footer_text: string;
  search_mode_label: string;
  navigation_search_placeholder: string;
  resource_search_placeholder: string;
}

interface DailyHotSettings {
  enabled: boolean;
  intervalHours: number;
  availablePlatforms: string[];
}

interface DailyHotJob {
  id: string;
  state: "idle" | "running" | "succeeded" | "failed";
  result?: {
    totalItems: number;
    platformsSynced: number;
    errors: string[];
  };
  syncResult?: {
    itemsInserted: number;
    itemsUpdated: number;
    itemsDeleted: number;
    platformsSynced: number;
  };
  error?: string;
  durationMs?: number;
}

interface DailyHotStats {
  totalItems: number;
  platformStats: Array<{ platform: string; count: number; last_update: string }>;
  latestScrape: string | null;
  lastJob: DailyHotJob | null;
  isRunning: boolean;
  cooldownRemaining: number;
  availablePlatforms: string[];
}

const defaultSettings: AdminSettings = {
  scraper_url: "",
  scraper_interval_hours: "6",
  scraper_enabled: "true",
  scraper_proxy_enabled: "false",
  scraper_proxy_url: "",
  public_api_enabled: "false",
  ...defaultSiteSettings,
};

const defaultDailyHotSettings: DailyHotSettings = {
  enabled: true,
  intervalHours: 1,
  availablePlatforms: [],
};

interface ScraperJobResult {
  processed?: number;
  categories?: number;
  pages?: number;
  requestedPages?: number;
  failedPages?: string[];
  cachedIcons?: number;
  failedIcons?: number;
  deletedExternalCollections?: number;
  deletedInternalCards?: number;
  deletedCategories?: number;
}

interface ScraperJob {
  id: string;
  state: "running" | "succeeded" | "failed";
  result?: ScraperJobResult;
  error?: string;
}

interface TodayVisitorCount {
  date: string;
  visitors: number;
}

// 平台显示名称映射
const PLATFORM_NAMES: Record<string, string> = {
  bilibili: 'B站',
  weibo: '微博',
  zhihu: '知乎',
  douyin: '抖音',
  toutiao: '今日头条',
  baidu: '百度',
  'qq-news': 'QQ新闻',
  'sina-news': '新浪新闻',
};

type AcgServiceId = "bangumi" | "mangadex" | "vndb" | "pixiv";

interface AcgCheckAttempt {
  source: "direct" | "http-proxy" | "worker";
  label: string;
  url: string;
  durationMs: number;
  ok: boolean;
  status?: number;
  error?: string;
}

interface AcgCheckResult {
  service: AcgServiceId;
  label: string;
  ok: boolean;
  checkedAt: string;
  durationMs: number;
  itemCount: number;
  minimumExpected: number;
  source: "direct" | "http-proxy" | "worker" | null;
  status?: number;
  sample?: string[];
  warnings?: string[];
  error?: string;
  attempts: AcgCheckAttempt[];
  proxy: {
    configured: boolean;
    mode: "auto" | "worker" | "none";
    source: "env" | "settings" | "system" | "none";
    policy: "configured-first" | "configured-only" | "direct-only";
  };
}

const ACG_FEATURES: Array<{
  id: AcgServiceId;
  name: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  desc: string;
}> = [
  { id: "bangumi", name: "Bangumi", icon: Sparkles, color: "violet", desc: "番组放送日程" },
  { id: "mangadex", name: "MangaDex", icon: Package, color: "emerald", desc: "中文漫画数据" },
  { id: "vndb", name: "VNDB", icon: HeartPulse, color: "amber", desc: "视觉小说数据" },
  { id: "pixiv", name: "Pixiv", icon: Palette, color: "pink", desc: "插画排行榜" },
];

export default function Admin() {
  const [authChecking, setAuthChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sites, setSites] = useState<SiteResponse[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [tags, setTags] = useState("");
  const [isFeatured, setIsFeatured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<AdminSettings>(defaultSettings);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [todayVisitors, setTodayVisitors] = useState<TodayVisitorCount | null>(null);
  const scrapePollTimer = useRef<number | null>(null);

  // DailyHot state
  const [dailyhotSettings, setDailyHotSettings] = useState<DailyHotSettings>(defaultDailyHotSettings);
  const [dailyhotSettingsLoading, setDailyHotSettingsLoading] = useState(false);
  const [dailyhotRunLoading, setDailyHotRunLoading] = useState(false);
  const [dailyhotStats, setDailyHotStats] = useState<DailyHotStats | null>(null);
  const dailyhotPollTimer = useRef<number | null>(null);

  // ACG proxy state
  const [acgProxyEnabled, setAcgProxyEnabled] = useState(false);
  const [acgProxyUrl, setAcgProxyUrl] = useState("");
  const [galSearchEnabled, setGalSearchEnabled] = useState(false);
  const [acgSettingsLoading, setAcgSettingsLoading] = useState(false);
  const [acgCheckResults, setAcgCheckResults] = useState<Partial<Record<AcgServiceId, AcgCheckResult>>>({});
  const [acgCheckLoading, setAcgCheckLoading] = useState<Partial<Record<AcgServiceId, boolean>>>({});
  const [acgCheckAllLoading, setAcgCheckAllLoading] = useState(false);

  // Site health check state
  interface SiteCheckResult {
    siteId: number;
    siteName: string;
    siteUrl: string;
    statusCode: number | null;
    finalUrl: string | null;
    responseTimeMs: number;
    errorMessage: string | null;
    checkedAt: string;
  }
  interface SiteCheckJob {
    id: string;
    state: "running" | "succeeded" | "failed";
    total: number;
    checked: number;
  }
  const [healthCheckJob, setHealthCheckJob] = useState<SiteCheckJob | null>(null);
  const [adminTab, setAdminTab] = useState<string>("dashboard");
  const [healthCheckLoading, setHealthCheckLoading] = useState(false);
  const [healthResults, setHealthResults] = useState<SiteCheckResult[]>([]);
  const healthPollTimer = useRef<number | null>(null);

  const adminFetch = async (input: string, init?: RequestInit) => {
    const response = await fetch(input, { ...init, credentials: "same-origin" });
    if (response.status === 401) {
      setAuthenticated(false);
      throw new Error("登录已失效，请重新登录。");
    }
    return response;
  };

  const readError = async (response: Response, fallback: string) => {
    try {
      const result = await response.json() as { error?: string };
      return result.error || fallback;
    } catch {
      return fallback;
    }
  };

  const loadData = async () => {
    const [categoriesResponse, sitesResponse, settingsResponse, visitorsResponse] = await Promise.all([
      adminFetch("/api/admin/categories"),
      adminFetch("/api/admin/sites"),
      adminFetch("/api/admin/settings"),
      adminFetch("/api/admin/analytics/visits/today"),
    ]);
    if (!categoriesResponse.ok || !sitesResponse.ok || !settingsResponse.ok || !visitorsResponse.ok) {
      throw new Error("读取管理数据失败。");
    }

    const [nextCategories, nextSites, nextSettings, nextVisitors] = await Promise.all([
      categoriesResponse.json() as Promise<Category[]>,
      sitesResponse.json() as Promise<SiteResponse[]>,
      settingsResponse.json() as Promise<Partial<AdminSettings>>,
      visitorsResponse.json() as Promise<TodayVisitorCount>,
    ]);
    setCategories(nextCategories);
    setSites(nextSites);
    setSettings((previous) => ({ ...previous, ...nextSettings }));
    setTodayVisitors(nextVisitors);

    // 可选：非关键数据（各面板自行加载）
    Promise.all([
      adminFetch("/api/admin/dailyhot/settings").then(r => r.ok && r.json()).catch(() => null),
      adminFetch("/api/admin/dailyhot/statistics").then(r => r.ok && r.json()).catch(() => null),
      adminFetch("/api/admin/acg-settings").then(r => r.ok && r.json()).catch(() => null),
    ]).then(([dailyhotSettingsData, dailyhotStatsData, acgData]) => {
      if (dailyhotSettingsData) {
        const d = dailyhotSettingsData as { settings: DailyHotSettings };
        setDailyHotSettings(d.settings);
      }
      if (dailyhotStatsData) setDailyHotStats(dailyhotStatsData as DailyHotStats);
      if (acgData) {
        const a = acgData as { settings: { acg_proxy_enabled: boolean; acg_proxy_url: string; gal_search_enabled: boolean } };
        setAcgProxyEnabled(a.settings.acg_proxy_enabled);
        setAcgProxyUrl(a.settings.acg_proxy_url);
        setGalSearchEnabled(a.settings.gal_search_enabled ?? false);
      }
    });

    void loadHealthResults();
  };

  useEffect(() => {
    fetch("/api/admin/auth/session", { credentials: "same-origin" })
      .then((response) => setAuthenticated(response.ok))
      .finally(() => setAuthChecking(false));
  }, []);

  useEffect(() => {
    if (authenticated) {
      void loadData().catch((loadError: Error) => setError(loadError.message));
    }
  }, [authenticated]);

  useEffect(() => () => {
    if (scrapePollTimer.current !== null) {
      window.clearTimeout(scrapePollTimer.current);
    }
    if (dailyhotPollTimer.current !== null) {
      window.clearTimeout(dailyhotPollTimer.current);
    }
    if (healthPollTimer.current !== null) {
      window.clearTimeout(healthPollTimer.current);
    }
  }, []);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoginLoading(true);
    setAuthError("");
    try {
      const response = await fetch("/api/admin/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "登录失败。"));
      }
      setPassword("");
      setAuthenticated(true);
    } catch (loginError: any) {
      setAuthError(loginError.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/admin/auth/logout", { method: "POST", credentials: "same-origin" });
    setAuthenticated(false);
    setCategories([]);
    setSites([]);
    setSettings(defaultSettings);
    setTodayVisitors(null);
    setDailyHotStats(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name || !url || !categoryId) {
      setError("名称、URL 和分类是必填项。");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await adminFetch("/api/admin/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          url,
          description,
          category_id: parseInt(categoryId, 10),
          icon_url: iconUrl,
          tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          is_featured: isFeatured,
        }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "添加网站失败。"));
      }
      setName("");
      setUrl("");
      setDescription("");
      setIconUrl("");
      setTags("");
      setIsFeatured(false);
      await loadData();
      announceNavigationDataUpdated();
    } catch (submitError: any) {
      setError(submitError.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = useCallback(async (id: number) => {
    if (!window.confirm("确定要删除此资源吗？")) {
      return;
    }
    try {
      const response = await adminFetch(`/api/admin/sites/${id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await readError(response, "删除资源失败。"));
      }
      await loadData();
      announceNavigationDataUpdated();
    } catch (deleteError: any) {
      setError(deleteError.message);
    }
  }, []);

  const handleSaveSettings = async (newSettings: AdminSettings) => {
    setSettingsLoading(true);
    try {
      const response = await adminFetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSettings),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "保存失败。"));
      }
      // 保存成功后同步回 parent state
      setSettings(newSettings);
      window.alert("设置已保存。");
      announceNavigationDataUpdated();
    } catch (settingsError: any) {
      window.alert(settingsError.message);
    } finally {
      setSettingsLoading(false);
    }
  };

  const updateSetting = <Key extends keyof AdminSettings>(key: Key, value: AdminSettings[Key]) => {
    setSettings((previous) => ({ ...previous, [key]: value }));
  };

  const checkAcgFeature = async (service: AcgServiceId) => {
    setAcgCheckLoading((previous) => ({ ...previous, [service]: true }));
    try {
      const response = await adminFetch(`/api/admin/acg-check/${service}`);
      if (!response.ok) {
        throw new Error(await readError(response, "ACG 检查失败。"));
      }
      const result = await response.json() as AcgCheckResult;
      setAcgCheckResults((previous) => ({ ...previous, [service]: result }));
    } catch (err) {
      setAcgCheckResults((previous) => ({
        ...previous,
        [service]: {
          service,
          label: service,
          ok: false,
          checkedAt: new Date().toISOString(),
          durationMs: 0,
          itemCount: 0,
          minimumExpected: 1,
          source: null,
          error: err instanceof Error ? err.message : "ACG 检查失败。",
          attempts: [],
          proxy: { configured: acgProxyEnabled && Boolean(acgProxyUrl.trim()), mode: "none", source: "none", policy: "direct-only" },
        },
      }));
    } finally {
      setAcgCheckLoading((previous) => ({ ...previous, [service]: false }));
    }
  };

  const checkAllAcgFeatures = async () => {
    setAcgCheckAllLoading(true);
    try {
      await Promise.all(ACG_FEATURES.map((feature) => checkAcgFeature(feature.id)));
    } finally {
      setAcgCheckAllLoading(false);
    }
  };

  const handleSaveAcgSettings = async (verifyAfterSave = false) => {
    setAcgSettingsLoading(true);
    try {
      const response = await adminFetch("/api/admin/acg-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acg_proxy_enabled: acgProxyEnabled, acg_proxy_url: acgProxyUrl, gal_search_enabled: galSearchEnabled }),
      });
      if (!response.ok) throw new Error(await readError(response, "保存失败。"));
      if (verifyAfterSave) {
        await checkAllAcgFeatures();
      } else {
        window.alert("ACG 代理设置已保存。");
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "保存失败。");
    } finally { setAcgSettingsLoading(false); }
  };

    const handleSaveDailyHotSettings = async (event: FormEvent) => {
    event.preventDefault();
    setDailyHotSettingsLoading(true);
    try {
      const response = await adminFetch("/api/admin/dailyhot/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: dailyhotSettings.enabled,
          intervalHours: dailyhotSettings.intervalHours,
        }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "保存DailyHot设置失败。"));
      }
      window.alert("DailyHot设置已保存。");
      // Reload stats
      const statsResponse = await adminFetch("/api/admin/dailyhot/statistics");
      if (statsResponse.ok) {
        const stats = await statsResponse.json() as DailyHotStats;
        setDailyHotStats(stats);
      }
    } catch (dailyhotError: any) {
      window.alert(dailyhotError.message);
    } finally {
      setDailyHotSettingsLoading(false);
    }
  };

  const runDailyHot = async () => {
    setDailyHotRunLoading(true);
    try {
      const response = await adminFetch("/api/admin/dailyhot/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "无法启动DailyHot任务。"));
      }
      const { job } = await response.json() as { job: DailyHotJob };
      void monitorDailyHotJob(job.id);
    } catch (dailyhotError: any) {
      setDailyHotRunLoading(false);
      window.alert(dailyhotError.message);
    }
  };

  const monitorDailyHotJob = async (jobId: string) => {
    try {
      const response = await adminFetch("/api/admin/dailyhot/status");
      if (!response.ok) {
        throw new Error(await readError(response, "读取DailyHot任务状态失败。"));
      }
      const { job } = await response.json() as { job: DailyHotJob | null };
      if (!job || job.id !== jobId) {
        throw new Error("无法找到本次DailyHot任务。");
      }
      if (job.state === "running") {
        dailyhotPollTimer.current = window.setTimeout(() => void monitorDailyHotJob(jobId), 1000);
        return;
      }
      setDailyHotRunLoading(false);

      if (job.state === "failed") {
        throw new Error(job.error || "DailyHot任务失败。");
      }

      const result = job.result as DailyHotJob["result"];
      const syncResult = job.syncResult as DailyHotJob["syncResult"];
      window.alert(
        `DailyHot爬取完成！\n` +
        `获取了 ${result?.totalItems || 0} 条热点，来自 ${result?.platformsSynced || 0} 个平台\n` +
        `同步：新增 ${syncResult?.itemsInserted || 0} 条，更新 ${syncResult?.itemsUpdated || 0} 条\n` +
        `耗时：${((job.durationMs || 0) / 1000).toFixed(2)}秒`
      );

      // Reload stats
      const statsResponse = await adminFetch("/api/admin/dailyhot/statistics");
      if (statsResponse.ok) {
        const stats = await statsResponse.json() as DailyHotStats;
        setDailyHotStats(stats);
      }
    } catch (dailyhotError: any) {
      setDailyHotRunLoading(false);
      window.alert(dailyhotError.message);
    }
  };

  const runHealthCheck = async () => {
    setHealthCheckLoading(true);
    try {
      const response = await adminFetch("/api/admin/site-checks/run", { method: "POST" });
      if (!response.ok) throw new Error(await readError(response, "无法启动健康检查。"));
      const { job } = await response.json() as { job: SiteCheckJob };
      setHealthCheckJob(job);
      void monitorHealthCheck(job.id);
    } catch (err: any) {
      setHealthCheckLoading(false);
      window.alert(err.message);
    }
  };

  const monitorHealthCheck = async (jobId: string) => {
    try {
      const response = await adminFetch("/api/admin/site-checks/status");
      if (!response.ok) throw new Error(await readError(response, "读取检查状态失败。"));
      const { job } = await response.json() as { job: SiteCheckJob | null };
      if (!job || job.id !== jobId) {
        setHealthCheckLoading(false);
        return;
      }
      setHealthCheckJob(job);
      if (job.state === "running") {
        healthPollTimer.current = window.setTimeout(() => void monitorHealthCheck(jobId), 1000);
        return;
      }
      setHealthCheckLoading(false);
      // Load results
      const resultsRes = await adminFetch("/api/admin/site-checks/results");
      if (resultsRes.ok) {
        const data = await resultsRes.json() as { results: SiteCheckResult[] };
        setHealthResults(data.results);
      }
    } catch (err: any) {
      setHealthCheckLoading(false);
      window.alert(err.message);
    }
  };

  const loadHealthResults = async () => {
    try {
      const response = await adminFetch("/api/admin/site-checks/results");
      if (response.ok) {
        const data = await response.json() as { results: SiteCheckResult[] };
        setHealthResults(data.results);
      }
    } catch { /* ignore */ }
  };

  const runScraper = async () => {
    setScrapeLoading(true);
    try {
      const response = await adminFetch("/api/admin/scraper/run", { method: "POST" });
      if (!response.ok) {
        throw new Error(await readError(response, "无法启动后台抓取任务。"));
      }
      const { job } = await response.json() as { job: ScraperJob };
      void monitorScraperJob(job.id);
    } catch (scraperError: any) {
      setScrapeLoading(false);
      window.alert(scraperError.message);
    }
  };

  const monitorScraperJob = async (jobId: string) => {
    try {
      const response = await adminFetch("/api/admin/scraper/status");
      if (!response.ok) {
        throw new Error(await readError(response, "读取抓取任务状态失败。"));
      }
      const { job } = await response.json() as { job: ScraperJob | null };
      if (!job || job.id !== jobId) {
        throw new Error("无法找到本次后台抓取任务。");
      }
      if (job.state === "running") {
        scrapePollTimer.current = window.setTimeout(() => void monitorScraperJob(jobId), 1000);
        return;
      }
      setScrapeLoading(false);

      if (job.state === "failed") {
        throw new Error(job.error || "后台抓取任务失败。");
      }

      const result = job.result || {};
      window.alert(`抓取完成，已同步 ${result.pages || 0}/${result.requestedPages || 0} 个页面、${result.categories || 0} 个分类、${result.processed || 0} 条资源、本地缓存 ${result.cachedIcons || 0} 个图标。${
        (result.deletedExternalCollections || result.deletedInternalCards || result.deletedCategories)
          ? ` 已清理 ${result.deletedExternalCollections || 0} 个旧 /q/ 外链、${result.deletedInternalCards || 0} 个旧分类入口、${result.deletedCategories || 0} 个空分类。`
          : ""
      }${
        result.failedPages?.length ? ` ${result.failedPages.length} 个页面网络失败并保留原数据，请检查代理设置。` : ""
      }`);
      await loadData();
      announceNavigationDataUpdated();
    } catch (scraperError: any) {
      setScrapeLoading(false);
      window.alert(scraperError.message);
    }
  };

  if (authChecking) {
    return <div className="liquid-panel max-w-md mx-auto mt-12 rounded-3xl p-8 text-center text-slate-500">正在检查登录状态...</div>;
  }

  if (!authenticated) {
    return (
      <div className="liquid-panel max-w-md mx-auto mt-12 rounded-[2rem] p-8">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Lock className="w-6 h-6 text-pink-500" />
          管理员登录
        </h1>
        <p className="text-sm text-slate-500 mt-2">登录后管理资源、抓取源及代理网络设置。</p>
        <form onSubmit={handleLogin} className="mt-6 space-y-4">
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="liquid-input w-full rounded-2xl px-4 py-3"
            placeholder="管理密码"
            autoFocus
          />
          {authError && <p className="text-sm text-red-600">{authError}</p>}
          <button type="submit" disabled={loginLoading} className="liquid-button-primary w-full px-6 py-3 font-medium">
            {loginLoading ? "登录中..." : "登录"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">后台管理</h1>
          <p className="text-slate-500 mt-1">管理次元导航资源与抓取设置。</p>
        </div>
        <button onClick={handleLogout} className="liquid-button inline-flex items-center gap-2 px-4 py-2 text-sm">
          <LogOut className="w-4 h-4" />
          退出登录
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide liquid-chip rounded-2xl p-1">
        <button onClick={() => setAdminTab("dashboard")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
            adminTab === "dashboard"
              ? "bg-white/75 text-slate-900 shadow-sm ring-2 ring-pink-500 dark:bg-white/15 dark:text-slate-100"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}>
          <BarChart3 className="w-4 h-4" />
          仪表盘
        </button>
        <button onClick={() => setAdminTab("urls")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
            adminTab === "urls"
              ? "bg-white/75 text-slate-900 shadow-sm ring-2 ring-pink-500 dark:bg-white/15 dark:text-slate-100"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}>
          <Globe className="w-4 h-4" />
          网址管理
        </button>
        <button onClick={() => setAdminTab("submissions")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
            adminTab === "submissions"
              ? "bg-white/75 text-slate-900 shadow-sm ring-2 ring-pink-500 dark:bg-white/15 dark:text-slate-100"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}>
          <Inbox className="w-4 h-4" />
          用户提交
        </button>
        <button onClick={() => setAdminTab("email")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
            adminTab === "email"
              ? "bg-white/75 text-slate-900 shadow-sm ring-2 ring-pink-500 dark:bg-white/15 dark:text-slate-100"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}>
          <Mail className="w-4 h-4" />
          邮箱通知
        </button>
        <button onClick={() => setAdminTab("settings")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
            adminTab === "settings"
              ? "bg-white/75 text-slate-900 shadow-sm ring-2 ring-pink-500 dark:bg-white/15 dark:text-slate-100"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}>
          <Settings2 className="w-4 h-4" />
          系统设置
        </button>
        <button onClick={() => setAdminTab("data")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
            adminTab === "data"
              ? "bg-white/75 text-slate-900 shadow-sm ring-2 ring-pink-500 dark:bg-white/15 dark:text-slate-100"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}>
          <Database className="w-4 h-4" />
          数据管理
        </button>
        <button onClick={() => setAdminTab("ai-classify")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
            adminTab === "ai-classify"
              ? "bg-white/75 text-slate-900 shadow-sm ring-2 ring-pink-500 dark:bg-white/15 dark:text-slate-100"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}>
          <Brain className="w-4 h-4" />
          AI 分类
        </button>
      </div>

      {/* Dashboard Tab */}
      {adminTab === "dashboard" && (
      <>
      <div className="liquid-panel rounded-[2rem] p-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">今日访客</p>
          <p className="mt-2 text-4xl font-bold tracking-tight">{todayVisitors?.visitors ?? "--"}</p>
          <p className="mt-2 text-xs text-slate-500">按匿名浏览器标识每日去重 · {todayVisitors?.date ?? "正在读取"}</p>
        </div>
        <div className="liquid-chip rounded-2xl p-4 text-pink-500">
          <BarChart3 className="w-9 h-9" />
        </div>
      </div>

      <DailyHotPanel />


      {/* 资源健康检查 */}
      <div className="liquid-panel rounded-[2rem] p-6">
        <div className="flex items-center justify-between mb-6 gap-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <HeartPulse className="w-5 h-5 text-rose-500" />
            资源健康检查
          </h2>
          <button onClick={runHealthCheck} disabled={healthCheckLoading} className="liquid-button flex items-center gap-2 px-4 py-2 text-rose-600 dark:text-rose-400 font-medium text-sm">
            <RefreshCw className={`w-4 h-4 ${healthCheckLoading ? 'animate-spin' : ''}`} />
            {healthCheckLoading ? `检查中 ${healthCheckJob?.checked || 0}/${healthCheckJob?.total || 0}...` : "开始检查"}
          </button>
        </div>

        {healthCheckJob && healthCheckJob.state === "running" && (
          <div className="mb-4">
            <div className="h-2 bg-slate-200/50 dark:bg-slate-700/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-rose-400 to-pink-500 rounded-full transition-all duration-300"
                style={{ width: `${healthCheckJob.total > 0 ? (healthCheckJob.checked / healthCheckJob.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {healthResults.length > 0 ? (
          <div className="max-h-[400px] overflow-y-auto scrollbar-hide">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {healthResults.map((r) => (
                <div key={r.siteId} className="liquid-chip rounded-xl px-3 py-2 flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    r.statusCode && r.statusCode >= 200 && r.statusCode < 400
                      ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]'
                      : r.statusCode
                        ? 'bg-amber-500'
                        : 'bg-red-500'
                  }`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-medium truncate">{r.siteName}</span>
                      {r.statusCode && (
                        <span className={`text-[10px] tabular-nums ${
                          r.statusCode >= 200 && r.statusCode < 400 ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'
                        }`}>{r.statusCode}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <span>{r.responseTimeMs}ms</span>
                      {r.errorMessage && <span className="text-red-400 truncate">{r.errorMessage}</span>}
                    </div>
                  </div>
                  <a href={r.siteUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-slate-300 hover:text-pink-500 transition-colors">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ))}
            </div>
            <div className="mt-3 text-xs text-slate-400 text-center">
              共 {healthResults.length} 个资源 · {healthResults.filter(r => r.statusCode && r.statusCode >= 200 && r.statusCode < 400).length} 个正常 · {healthResults.filter(r => !r.statusCode || r.statusCode < 200 || r.statusCode >= 400).length} 个异常
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500 text-center py-6">点击"开始检查"检测所有资源的可达性</p>
        )}
      </div>

      <SiteManagerPanel sites={sites} onDelete={handleDelete} />
      </>
      )}

      {/* URL Management Tab */}
      {adminTab === "urls" && (
        <UrlManager
          initialCategories={categories}
          initialSites={sites}
          onDataChange={() => {
            announceNavigationDataUpdated();
          }}
        />
      )}

      {/* Submissions Tab */}
      {adminTab === "submissions" && (
        <SubmissionManager />
      )}

      {/* Email Settings Tab */}
      {adminTab === "email" && (
        <div className="liquid-panel rounded-[2rem] p-6">
          <h2 className="text-xl font-semibold flex items-center gap-2 mb-6">
            <Mail className="w-5 h-5 text-pink-500" />
            邮箱通知系统
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            配置 SMTP 邮箱后，系统可以在用户提交建议/网址时发送通知到管理员邮箱。
            支持任意标准 SMTP 服务器（QQ邮箱、163邮箱、Gmail等）。
          </p>
          <EmailSettingsForm />
        </div>
      )}

      {/* Settings Tab */}
      {adminTab === "settings" && (
        <>
      <ServiceSettingsPanel
        initialSettings={settings}
        onSave={handleSaveSettings}
        onRunScraper={runScraper}
        scrapeLoading={scrapeLoading}
      />

      <UpdateSystemPanel />

      <AcgProxyPanel />

      {/* 添加新资源 */}

      <AddResourcePanel categories={categories} onSuccess={() => announceNavigationDataUpdated()} />
      </>
      )}

      {/* Data Management Tab */}
      {adminTab === "data" && (
        <div className="liquid-panel rounded-[2rem] p-6">
          <h2 className="text-xl font-semibold flex items-center gap-2 mb-6">
            <Database className="w-5 h-5 text-indigo-500" />
            数据导入/导出
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            导出服务器所有数据（分类、站点、设置、ACG 缓存等）为 JSON 文件，或从之前导出的文件中恢复数据。
            导入会<b className="text-amber-600">覆盖</b>现有数据库内容，请谨慎操作。
          </p>

          <DataManagement />
        </div>
      )}

      {/* AI Classification Tab */}
      {adminTab === "ai-classify" && (
        <AIClassifyPanel
          categories={categories}
          sites={sites}
          onDataChange={() => {
            announceNavigationDataUpdated();
            loadData().catch(() => {});
          }}
        />
      )}
    </div>
  );
}


// ACG 特色功能状态卡片
function AcgFeatureCard({ name, icon: Icon, color, desc, result, loading, onCheck }: {
  name: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  desc: string;
  result: AcgCheckResult | null;
  loading: boolean;
  onCheck: () => void;
}) {
  const colorMap: Record<string, { bg: string; text: string; border: string }> = {
    violet: { bg: "bg-violet-100 dark:bg-violet-900/20", text: "text-violet-600 dark:text-violet-400", border: "border-violet-200 dark:border-violet-800" },
    emerald: { bg: "bg-emerald-100 dark:bg-emerald-900/20", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-200 dark:border-emerald-800" },
    amber: { bg: "bg-amber-100 dark:bg-amber-900/20", text: "text-amber-600 dark:text-amber-400", border: "border-amber-200 dark:border-amber-800" },
    pink: { bg: "bg-pink-100 dark:bg-pink-900/20", text: "text-pink-600 dark:text-pink-400", border: "border-pink-200 dark:border-pink-800" },
  };
  const c = colorMap[color] || colorMap.violet;
  const sourceLabel: Record<string, string> = {
    direct: "直连",
    "http-proxy": "HTTP 代理",
    worker: "Worker",
  };
  const proxySourceLabel: Record<AcgCheckResult["proxy"]["source"], string> = {
    env: "环境变量",
    settings: "管理设置",
    system: "系统代理",
    none: "未配置",
  };

  return (
    <div className={`liquid-chip rounded-2xl p-4 border ${c.border}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center shrink-0`}>
            <Icon className={`w-5 h-5 ${c.text}`} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{name}</h3>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{desc}</p>
          </div>
        </div>
        <button
          onClick={onCheck}
          disabled={loading}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium ${c.text} ${c.bg} hover:opacity-80 disabled:opacity-50 transition-opacity`}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          验证
        </button>
      </div>
      {result && (
        <div className="mt-3 pt-3 border-t border-white/30 dark:border-white/10 space-y-2">
          <div className="flex items-center gap-2">
            {result.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <XCircle className="w-3.5 h-3.5 text-red-500" />}
            <span className={`text-xs ${result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
              {result.ok ? "真实数据返回正常" : "真实数据检查失败"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span>条数 {result.itemCount}/{result.minimumExpected}</span>
            <span>{result.durationMs}ms</span>
            <span>{result.status ? `HTTP ${result.status}` : "无 HTTP 状态"}</span>
            <span>{result.source ? sourceLabel[result.source] || result.source : "未连通"}</span>
            <span>代理 {proxySourceLabel[result.proxy.source] || result.proxy.source}</span>
            <span>策略 {result.proxy.policy}</span>
          </div>
          {result.sample && result.sample.length > 0 && (
            <p className="text-[11px] text-slate-400 truncate">样本：{result.sample.join(" / ")}</p>
          )}
          {result.warnings?.map((warning) => (
            <p key={warning} className="text-[11px] text-amber-600 dark:text-amber-400">{warning}</p>
          ))}
          {result.error && (
            <p className="text-[11px] text-red-500 break-words">{result.error}</p>
          )}
          {result.attempts.length > 0 && (
            <div className="space-y-1">
              {result.attempts.map((attempt, index) => (
                <div key={`${attempt.source}-${index}`} className="text-[10px] text-slate-400 flex items-start gap-1">
                  <span className={attempt.ok ? "text-emerald-500" : "text-red-400"}>{attempt.ok ? "OK" : "FAIL"}</span>
                  <span className="truncate">{sourceLabel[attempt.source] || attempt.source}</span>
                  <span className="shrink-0">{attempt.status ? `HTTP ${attempt.status}` : attempt.error || ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LegacyAcgFeatureCard({ name, icon: Icon, color, api, desc }: {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  api: string;
  desc: string;
}) {
  const [status, setStatus] = useState<{ items: number; cached: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/${api}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const items = json.data ? (Array.isArray(json.data) ? json.data.length : Object.keys(json.data).length) : 0;
      setStatus({ items, cached: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  const colorMap: Record<string, { bg: string; text: string; border: string }> = {
    violet: { bg: "bg-violet-100 dark:bg-violet-900/20", text: "text-violet-600 dark:text-violet-400", border: "border-violet-200 dark:border-violet-800" },
    emerald: { bg: "bg-emerald-100 dark:bg-emerald-900/20", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-200 dark:border-emerald-800" },
    amber: { bg: "bg-amber-100 dark:bg-amber-900/20", text: "text-amber-600 dark:text-amber-400", border: "border-amber-200 dark:border-amber-800" },
    pink: { bg: "bg-pink-100 dark:bg-pink-900/20", text: "text-pink-600 dark:text-pink-400", border: "border-pink-200 dark:border-pink-800" },
  };
  const c = colorMap[color] || colorMap.violet;

  return (
    <div className={`liquid-chip rounded-2xl p-4 border ${c.border}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center shrink-0`}>
            <Icon className={`w-5 h-5 ${c.text}`} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{name}</h3>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{desc}</p>
          </div>
        </div>
        <button
          onClick={checkStatus}
          disabled={loading}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium ${c.text} ${c.bg} hover:opacity-80 disabled:opacity-50 transition-opacity`}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          测试
        </button>
      </div>
      {status && (
        <div className="mt-3 pt-3 border-t border-white/30 dark:border-white/10 flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          <span className="text-xs text-slate-500">接口正常 · {status.items} 条数据</span>
        </div>
      )}
      {error && (
        <div className="mt-3 pt-3 border-t border-white/30 dark:border-white/10 flex items-center gap-2">
          <XCircle className="w-3.5 h-3.5 text-red-500" />
          <span className="text-xs text-red-500">{error}</span>
        </div>
      )}
    </div>
  );
}

// ─── 数据管理组件（增强版：跨设备导入/导出 + 预览） ───────

function DataManagement() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    schemaVersion?: number;
    exportedAt?: string;
    secretsRedacted?: boolean;
    integrityOk?: boolean;
    integrityErrors?: string[];
    categories: number;
    sites: number;
    settings: number;
    dailyhotItems: number;
    acgCacheFiles: number;
    icons?: number;
  } | null>(null);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    tablesImported?: number;
    iconsImported?: number;
    acgCacheImported?: number;
    preImportBackup?: string;
    errors?: string[];
  } | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  // 是否显示二维码分享
  const [showQR, setShowQR] = useState(false);
  // 导入方式：直接导入 / 预览后导入
  const [importMode, setImportMode] = useState<"direct" | "preview">("preview");

  const handleExport = async () => {
    setExporting(true);
    setError("");
    try {
      const response = await fetch("/api/admin/data/bundle/export", { credentials: "same-origin" });
      if (!response.ok) {
        throw new Error((await response.json().catch(() => ({ error: "导出失败" }))).error || "导出失败");
      }
      // 从 Content-Disposition 提取文件名，否则用默认
      let filename = `guga-data-${new Date().toISOString().slice(0, 10)}.tar.gz`;
      const disposition = response.headers.get("Content-Disposition") || "";
      const match = /filename\*?=(?:UTF-8''|""|")([^";]+)/i.exec(disposition);
      if (match && match[1]) filename = decodeURIComponent(match[1]);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || "导出失败");
    } finally {
      setExporting(false);
    }
  };

  // 上传 bundle 并预览（原始二进制 body）
  const handlePreview = async (file: File) => {
    setImportFile(file);
    setError("");
    setImportResult(null);
    try {
      const response = await fetch("/api/admin/data/bundle/import/preview", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "预览失败");
      }
      // 将新结构映射为展示字段
      setImportPreview({
        schemaVersion: data.schemaVersion,
        exportedAt: data.exportedAt,
        secretsRedacted: data.secretsRedacted,
        integrityOk: data.integrityOk,
        integrityErrors: data.integrityErrors || [],
        categories: data.tables?.categories ?? 0,
        sites: data.tables?.sites ?? 0,
        settings: data.tables?.settings ?? 0,
        dailyhotItems: data.tables?.dailyhot_items ?? 0,
        acgCacheFiles: data.acgCache ?? 0,
        icons: data.icons ?? 0,
      });
    } catch (err: any) {
      setError(err.message || "预览失败");
      setImportPreview(null);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (importMode === "preview") {
      await handlePreview(file);
    } else {
      await handleImportFile(file);
    }
  };

  const handleImportFile = async (file: File) => {
    setImporting(true);
    setError("");
    setImportResult(null);
    try {
      const response = await fetch("/api/admin/data/bundle/import", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error || "导入失败");
      }
      setImportResult({
        success: !!result.success,
        tablesImported: result.tablesImported ?? 0,
        iconsImported: result.iconsImported ?? 0,
        acgCacheImported: result.acgCacheImported ?? 0,
        preImportBackup: result.preImportBackup || undefined,
        errors: result.errors || [],
      });
      setImportPreview(null);
    } catch (err: any) {
      setError(err.message || "导入失败");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && /\.(tar\.gz|tgz|gz|json)$/i.test(file.name)) {
      if (importMode === "preview") {
        await handlePreview(file);
      } else {
        await handleImportFile(file);
      }
    } else {
      setError("请拖入 .tar.gz / .gz 格式的数据 bundle");
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const confirmImport = async () => {
    if (!importFile) return;
    await handleImportFile(importFile);
  };

  return (
    <div className="space-y-6">
      {/* 导入/导出模式切换 */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-slate-500">导入模式：</span>
        <button
          onClick={() => setImportMode("preview")}
          className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
            importMode === "preview"
              ? "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          🧐 预览后导入
        </button>
        <button
          onClick={() => setImportMode("direct")}
          className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
            importMode === "direct"
              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          ⚡ 直接导入
        </button>
      </div>

      {/* 导出区 */}
      <div className="liquid-chip rounded-2xl p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">
              导出数据
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              将所有分类、站点、设置、热点数据、访问统计、图标与 ACG 缓存导出为一个
              <code className="mx-1 px-1 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-xs">.tar.gz</code>
              bundle 文件。敏感设置（密钥/口令）默认脱敏。在另一台设备导入即可跨设备迁移。
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="liquid-button-primary flex items-center gap-2 px-5 py-2.5 text-sm font-medium"
            >
              <FileDown className={`w-4 h-4 ${exporting ? "animate-bounce" : ""}`} />
              {exporting ? "导出中..." : "导出数据"}
            </button>
          </div>
        </div>
      </div>

      {/* 导入区（拖放 + 点击） */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`liquid-chip rounded-2xl p-5 border-2 border-dashed transition-all ${
          dragOver
            ? "border-pink-400 bg-pink-50 dark:bg-pink-900/10"
            : "border-slate-200 dark:border-slate-700"
        }`}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">
              导入数据
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              {importMode === "preview"
                ? "上传之前导出的 .tar.gz bundle，预览后确认导入。"
                : "上传之前导出的 .tar.gz bundle 直接恢复数据。"}
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-1 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              导入会覆盖现有数据库和缓存文件，不可撤销！
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleImportClick}
              disabled={importing}
              className="liquid-button flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700"
            >
              <Upload className={`w-4 h-4 ${importing ? "animate-spin" : ""}`} />
              {importing ? "导入中..." : "选择文件"}
            </button>
          </div>
        </div>
        {!importPreview && !importResult && (
          <p className="text-xs text-slate-400 mt-3 text-center">
            或将 .tar.gz / .gz bundle 拖放到此区域
          </p>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".tar.gz,.tgz,.gz"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* 导入预览 */}
      {importPreview && !importResult && (
        <div className="liquid-panel rounded-[2rem] p-6 border-emerald-300 dark:border-emerald-700">
          <div className="flex items-center gap-2 mb-4">
            {importPreview.integrityOk === false ? (
              <AlertCircle className="w-5 h-5 text-red-500" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            )}
            <span className={`text-sm font-semibold ${importPreview.integrityOk === false ? "text-red-500" : "text-emerald-600 dark:text-emerald-400"}`}>
              {importPreview.integrityOk === false ? "完整性校验未通过，不建议导入" : "数据预览 — 可安全查看导入内容"}
            </span>
          </div>
          {importPreview.integrityErrors && importPreview.integrityErrors.length > 0 && (
            <div className="mb-3 space-y-1">
              {importPreview.integrityErrors.map((err, i) => (
                <p key={i} className="text-xs text-red-500">✗ {err}</p>
              ))}
            </div>
          )}
          {importPreview.secretsRedacted && (
            <p className="mb-3 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              该 bundle 含脱敏的密钥设置，导入后请在管理页重新配置邮件 / 代理等凭据。
            </p>
          )}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-sm mb-4">
            <div className="text-center p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{importPreview.categories}</p>
              <p className="text-xs text-slate-500">分类</p>
            </div>
            <div className="text-center p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{importPreview.sites}</p>
              <p className="text-xs text-slate-500">站点</p>
            </div>
            <div className="text-center p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{importPreview.settings}</p>
              <p className="text-xs text-slate-500">设置项</p>
            </div>
            <div className="text-center p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{importPreview.dailyhotItems}</p>
              <p className="text-xs text-slate-500">热点数据</p>
            </div>
            <div className="text-center p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{importPreview.icons ?? 0}</p>
              <p className="text-xs text-slate-500">图标</p>
            </div>
            <div className="text-center p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{importPreview.acgCacheFiles}</p>
              <p className="text-xs text-slate-500">缓存文件</p>
            </div>
          </div>

          <p className="text-xs text-slate-400 mb-4">
            导出时间：{importPreview.exportedAt || "未知"} | 数据版本：{importPreview.schemaVersion || 2}
          </p>

          <div className="flex items-center gap-3">
            <button
              onClick={confirmImport}
              disabled={importing || importPreview.integrityOk === false}
              className="liquid-button-primary flex items-center gap-2 px-6 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {importing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              {importing ? "导入中..." : "确认导入"}
            </button>
            <button
              onClick={() => { setImportPreview(null); setImportFile(null); }}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-3">
          <XCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* 导入结果 */}
      {importResult && (
        <div className={`liquid-chip rounded-2xl p-5 ${importResult.success ? "border-emerald-300 dark:border-emerald-700" : "border-red-300 dark:border-red-700"}`}>
          <div className="flex items-center gap-2 mb-3">
            {importResult.success ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            ) : (
              <AlertCircle className="w-5 h-5 text-amber-500" />
            )}
            <span className={`text-sm font-semibold ${importResult.success ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
              {importResult.success ? "导入成功" : "导入完成（有错误）"}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="text-center">
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{importResult.tablesImported ?? 0}</p>
              <p className="text-xs text-slate-500">导入表数</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{importResult.iconsImported ?? 0}</p>
              <p className="text-xs text-slate-500">图标</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{importResult.acgCacheImported ?? 0}</p>
              <p className="text-xs text-slate-500">缓存文件</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{importResult.success ? "✓" : "✗"}</p>
              <p className="text-xs text-slate-500">状态</p>
            </div>
          </div>
          {importResult.preImportBackup && importResult.success && (
            <p className="mt-3 text-xs text-slate-400">
              导入前备份：<code className="font-mono">{importResult.preImportBackup}</code>
            </p>
          )}
          {importResult.errors && importResult.errors.length > 0 && (
            <div className="mt-3 max-h-24 overflow-y-auto scrollbar-hide">
              {importResult.errors.map((err, i) => (
                <p key={i} className="text-xs text-red-500 py-0.5">{err}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
