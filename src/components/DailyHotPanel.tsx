import { useState, useEffect, type FormEvent } from "react";
import { Flame, RefreshCw } from "lucide-react";

interface DailyHotSettings {
  enabled: boolean;
  intervalHours: number;
}

interface DailyHotStats {
  totalItems: number;
  platformStats: Array<{ platform: string; count: number; last_update: string }>;
}

const PLATFORM_NAMES: Record<string, string> = {
  bilibili: "B站", weibo: "微博", zhihu: "知乎", douyin: "抖音",
  tieba: "贴吧", toutiao: "头条", douban: "豆瓣", huxiu: "虎嗅",
  game: "游戏", tech: "科技", acg: "ACG",
};

const adminFetch = async (input: string, init?: RequestInit) => {
  const r = await fetch(input, { ...init, credentials: "same-origin" });
  if (r.status === 401) throw new Error("登录已失效");
  return r;
};

export default function DailyHotPanel() {
  const [settings, setSettings] = useState<DailyHotSettings>({ enabled: false, intervalHours: 1 });
  const [stats, setStats] = useState<DailyHotStats | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sRes, stRes] = await Promise.all([
          adminFetch("/api/admin/dailyhot/settings"),
          adminFetch("/api/admin/dailyhot/statistics"),
        ]);
        if (cancelled) return;
        if (sRes.ok) {
          const d = await sRes.json() as { settings: DailyHotSettings };
          setSettings(d.settings);
        }
        if (stRes.ok) setStats(await stRes.json() as DailyHotStats);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleRun = async () => {
    setRunLoading(true);
    try {
      await adminFetch("/api/admin/dailyhot/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      window.alert("DailyHot 任务已启动，将在后台执行。");
    } catch (err: any) {
      window.alert(err.message);
    } finally {
      setRunLoading(false);
    }
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setSaveLoading(true);
    try {
      const r = await adminFetch("/api/admin/dailyhot/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!r.ok) throw new Error("保存失败");
      window.alert("DailyHot 设置已保存。");
    } catch (err: any) {
      window.alert(err.message);
    } finally {
      setSaveLoading(false);
    }
  };

  return (
    <div className="liquid-panel rounded-[2rem] p-6">
      <div className="flex items-center justify-between mb-6 gap-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Flame className="w-5 h-5 text-orange-500" />
          实时热点（DailyHot）
        </h2>
        <button onClick={handleRun} disabled={runLoading} className="liquid-button flex items-center gap-2 px-4 py-2 text-orange-600 dark:text-orange-400 font-medium text-sm">
          <RefreshCw className={`w-4 h-4 ${runLoading ? "animate-spin" : ""}`} />
          {runLoading ? "获取中..." : "立即获取热点"}
        </button>
      </div>

      {stats?.platformStats && stats.platformStats.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-3">平台数据统计</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {stats.platformStats.map((stat) => (
              <div key={stat.platform} className="liquid-chip rounded-xl px-3 py-2">
                <p className="text-xs text-slate-500">{PLATFORM_NAMES[stat.platform] || stat.platform}</p>
                <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{stat.count}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <div className="liquid-chip rounded-2xl px-4 py-3">
          <label className="flex items-start gap-3 text-sm font-medium">
            <input type="checkbox" checked={settings.enabled} onChange={(e) => setSettings(p => ({ ...p, enabled: e.target.checked }))} className="mt-0.5" />
            <span>
              启用 DailyHot 实时热点
              <span className="block mt-1 text-xs font-normal text-slate-500">启用后将自动从 DailyHot API 获取各平台热点内容（B站、微博、知乎、抖音等）</span>
            </span>
          </label>
        </div>
        <label className="space-y-1 text-sm font-medium">
          更新间隔（小时）
          <input type="number" min="0.1" max="24" step="0.1" value={settings.intervalHours}
            onChange={(e) => setSettings(p => ({ ...p, intervalHours: parseFloat(e.target.value) || 1 }))}
            className="liquid-input mt-1 w-full rounded-2xl px-3 py-2.5" />
          <span className="block text-xs text-slate-500 mt-1">默认每1小时更新一次，最小0.1小时（6分钟）</span>
        </label>
        <button type="submit" disabled={saveLoading} className="liquid-button-primary px-6 py-2.5 font-medium text-sm">
          {saveLoading ? "保存中..." : "保存 DailyHot 设置"}
        </button>
      </form>
    </div>
  );
}
