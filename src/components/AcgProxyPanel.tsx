import { useState, useEffect } from "react";
import { Sparkles, RefreshCw } from "lucide-react";

interface AcgCheckResult {
  service: string;
  label: string;
  status: "ok" | "error";
  error?: string;
  responseTimeMs?: number;
}

type AcgServiceId = "bangumi" | "mangadex" | "vndb" | "pixiv";

interface AcgFeature {
  id: AcgServiceId;
  name: string;
  icon: string;
  color: string;
  desc: string;
}

const ACG_FEATURES: AcgFeature[] = [
  { id: "bangumi", name: "Bangumi", icon: "tv", color: "pink", desc: "番剧信息查询" },
  { id: "mangadex", name: "MangaDex", icon: "book", color: "indigo", desc: "漫画信息查询" },
  { id: "vndb", name: "VNDB", icon: "gamepad", color: "purple", desc: "Galgame 信息查询" },
  { id: "pixiv", name: "Pixiv", icon: "palette", color: "blue", desc: "插画排行榜" },
];

function AcgFeatureCard({
  name, color, desc, result, loading, onCheck,
}: {
  name: string; color: string; desc: string;
  result: AcgCheckResult | null;
  loading: boolean;
  onCheck: () => void;
}) {
  return (
    <div className="liquid-chip rounded-2xl p-4 border border-white/20 dark:border-white/10">
      <div className="flex items-center justify-between mb-3">
        <span className="font-medium text-sm">{name}</span>
        {result && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            result.status === "ok" ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20" : "text-red-500 bg-red-50 dark:bg-red-900/20"
          }`}>
            {result.status === "ok" ? `✓ ${result.responseTimeMs}ms` : "✗ 失败"}
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500 mb-3">{desc}</p>
      <button onClick={onCheck} disabled={loading}
        className="liquid-button w-full text-xs py-1.5 px-3 font-medium disabled:opacity-50">
        {loading ? "验证中..." : "验证连接"}
      </button>
      {result?.error && <p className="mt-2 text-xs text-red-500">{result.error}</p>}
    </div>
  );
}

const adminFetch = async (input: string, init?: RequestInit) => {
  const r = await fetch(input, { ...init, credentials: "same-origin" });
  if (r.status === 401) throw new Error("登录已失效");
  return r;
};

export default function AcgProxyPanel() {
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyUrl, setProxyUrl] = useState("");
  const [galSearchEnabled, setGalSearchEnabled] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [results, setResults] = useState<Partial<Record<AcgServiceId, AcgCheckResult>>>({});
  const [checkLoading, setCheckLoading] = useState<Partial<Record<AcgServiceId, boolean>>>({});
  const [checkAllLoading, setCheckAllLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await adminFetch("/api/admin/acg-settings");
        if (cancelled) return;
        if (r.ok) {
          const d = await r.json() as { proxy_enabled: boolean; proxy_url: string; gal_search_enabled: boolean };
          setProxyEnabled(d.proxy_enabled);
          setProxyUrl(d.proxy_url);
          setGalSearchEnabled(d.gal_search_enabled);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const checkFeature = async (service: AcgServiceId) => {
    setCheckLoading(p => ({ ...p, [service]: true }));
    try {
      const r = await adminFetch(`/api/admin/acg-check/${service}`);
      if (r.ok) {
        const result = await r.json() as AcgCheckResult;
        setResults(p => ({ ...p, [service]: result }));
      }
    } catch { /* ignore */ }
    finally { setCheckLoading(p => ({ ...p, [service]: false })); }
  };

  const handleSave = async (alsoVerify: boolean) => {
    setSaveLoading(true);
    try {
      const r = await adminFetch("/api/admin/acg-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxy_enabled: proxyEnabled, proxy_url: proxyUrl, gal_search_enabled: galSearchEnabled }),
      });
      if (!r.ok) throw new Error("保存失败");
      window.alert("ACG 代理设置已保存。");
      if (alsoVerify) {
        setCheckAllLoading(true);
        for (const feat of ACG_FEATURES) await checkFeature(feat.id);
        setCheckAllLoading(false);
      }
    } catch (err: any) { window.alert(err.message); }
    finally { setSaveLoading(false); }
  };

  return (
    <div className="liquid-panel rounded-[2rem] p-6">
      <h2 className="text-xl font-semibold flex items-center gap-2 mb-6">
        <Sparkles className="w-5 h-5 text-purple-500" />
        ACG 数据代理
        <span className="text-xs font-normal text-slate-400 ml-2">服务器通过此代理访问海外 API</span>
      </h2>
      <div className="liquid-chip rounded-2xl px-4 py-3 space-y-3">
        <label className="flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" checked={proxyEnabled} onChange={e => setProxyEnabled(e.target.checked)} className="mt-0.5" />
          <span>启用代理<span className="block text-xs font-normal text-slate-500">服务器访问 Bangumi/MangaDex/VNDB/Pixiv API 时使用代理</span></span>
        </label>
        {proxyEnabled && (
          <div className="space-y-1.5">
            <input type="url" value={proxyUrl} onChange={e => setProxyUrl(e.target.value)} className="liquid-input w-full rounded-2xl px-3 py-2.5 text-sm" placeholder="https://your-worker.workers.dev" />
          </div>
        )}
        <label className="flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" checked={galSearchEnabled} onChange={e => setGalSearchEnabled(e.target.checked)} className="mt-0.5" />
          <span>GAL 搜索<span className="block text-xs font-normal text-slate-500">开启后纯搜索页可使用 GAL 作品查询功能</span></span>
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={() => void handleSave(false)} disabled={saveLoading} className="liquid-button flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-purple-600 dark:text-purple-400">
            {saveLoading ? "保存中..." : "保存代理设置"}
          </button>
          <button onClick={() => void handleSave(true)} disabled={saveLoading || checkAllLoading} className="liquid-button-primary flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium">
            <RefreshCw className={`w-3.5 h-3.5 ${checkAllLoading ? "animate-spin" : ""}`} />
            保存并验证四路
          </button>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {ACG_FEATURES.map((feature) => (
          <AcgFeatureCard
            key={feature.id} name={feature.name} color={feature.color} desc={feature.desc}
            result={results[feature.id] || null}
            loading={Boolean(checkLoading[feature.id])}
            onCheck={() => void checkFeature(feature.id)}
          />
        ))}
      </div>
    </div>
  );
}
