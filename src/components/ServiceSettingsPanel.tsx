import { type FormEvent, useState } from "react";
import { Settings2, Play, Palette } from "lucide-react";

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

interface Props {
  initialSettings: AdminSettings;
  onSave: (settings: AdminSettings) => Promise<void>;
  onRunScraper: () => void;
  scrapeLoading: boolean;
}

export default function ServiceSettingsPanel({
  initialSettings,
  onSave,
  onRunScraper,
  scrapeLoading,
}: Props) {
  // 本地表单状态：初始化后不再跟随 parent re-render 更新，
  // 只在提交时通过 onSave 同步回 parent，大幅减少 Admin 组件的重渲染
  const [settings, setSettings] = useState(initialSettings);

  const updateSetting = <K extends keyof AdminSettings>(
    key: K,
    value: AdminSettings[K],
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await onSave(settings);
  };

  return (
    <div className="liquid-panel rounded-[2rem] p-6">
      <div className="flex items-center justify-between mb-6 gap-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-pink-500" />
          服务与抓取设置
        </h2>
        <button
          onClick={onRunScraper}
          disabled={scrapeLoading}
          className="liquid-button flex items-center gap-2 px-4 py-2 text-pink-600 dark:text-pink-400 font-medium text-sm"
        >
          <Play className="w-4 h-4" />
          {scrapeLoading ? "后台抓取中..." : "立即抓取资源"}
        </button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="liquid-chip rounded-2xl px-4 py-3">
          <label className="flex items-start gap-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={settings.public_api_enabled === "true"}
              onChange={(event) =>
                updateSetting(
                  "public_api_enabled",
                  event.target.checked ? "true" : "false",
                )
              }
              className="mt-0.5"
            />
            <span>
              开启公开资源 API
              <span className="block mt-1 text-xs font-normal text-slate-500">
                默认关闭。开启后访客可读取导航分类、资源列表和站内搜索索引。
              </span>
            </span>
          </label>
        </div>

        <div className="border-t border-white/30 dark:border-white/10 pt-5 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-700 dark:text-slate-200">
            <Palette className="w-4 h-4 text-indigo-500" />
            站点展示设置
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1 text-sm font-medium">
              站点名称
              <input
                type="text"
                maxLength={40}
                value={settings.site_name}
                onChange={(event) =>
                  updateSetting("site_name", event.target.value)
                }
                className="liquid-input mt-1 w-full rounded-2xl px-3 py-2.5"
                placeholder="次元导航"
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              页脚文案
              <input
                type="text"
                maxLength={80}
                value={settings.footer_text}
                onChange={(event) =>
                  updateSetting("footer_text", event.target.value)
                }
                className="liquid-input mt-1 w-full rounded-2xl px-3 py-2.5"
                placeholder="次元导航"
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              纯搜索按钮文字
              <input
                type="text"
                maxLength={20}
                value={settings.search_mode_label}
                onChange={(event) =>
                  updateSetting("search_mode_label", event.target.value)
                }
                className="liquid-input mt-1 w-full rounded-2xl px-3 py-2.5"
                placeholder="纯搜索"
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              导航页搜索占位
              <input
                type="text"
                maxLength={80}
                value={settings.navigation_search_placeholder}
                onChange={(event) =>
                  updateSetting(
                    "navigation_search_placeholder",
                    event.target.value,
                  )
                }
                className="liquid-input mt-1 w-full rounded-2xl px-3 py-2.5"
                placeholder="🔍 搜索海量资源..."
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              站内搜索占位
              <input
                type="text"
                maxLength={80}
                value={settings.resource_search_placeholder}
                onChange={(event) =>
                  updateSetting(
                    "resource_search_placeholder",
                    event.target.value,
                  )
                }
                className="liquid-input mt-1 w-full rounded-2xl px-3 py-2.5"
                placeholder="搜索动漫、游戏、漫画..."
              />
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="space-y-1 text-sm font-medium">
            上游目标 URL
            <input
              type="url"
              value={settings.scraper_url}
              onChange={(event) =>
                updateSetting("scraper_url", event.target.value)
              }
              className="liquid-input mt-1 w-full rounded-2xl px-3 py-2.5"
              placeholder="https://www.acgbox.link/"
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            抓取间隔（小时）
            <input
              type="number"
              min="0.5"
              step="0.5"
              value={settings.scraper_interval_hours}
              onChange={(event) =>
                updateSetting(
                  "scraper_interval_hours",
                  event.target.value,
                )
              }
              className="liquid-input mt-1 w-full rounded-2xl px-3 py-2.5"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.scraper_enabled === "true"}
            onChange={(event) =>
              updateSetting(
                "scraper_enabled",
                event.target.checked ? "true" : "false",
              )
            }
          />
          启用自动抓取定时任务（不影响手动抓取）
        </label>
        <div className="border-t border-white/30 dark:border-white/10 pt-4 space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={settings.scraper_proxy_enabled === "true"}
              onChange={(event) =>
                updateSetting(
                  "scraper_proxy_enabled",
                  event.target.checked ? "true" : "false",
                )
              }
            />
            使用代理抓取
          </label>
          {settings.scraper_proxy_enabled === "true" && (
            <label className="block text-sm font-medium">
              代理 URL
              <input
                type="url"
                required
                value={settings.scraper_proxy_url}
                onChange={(event) =>
                  updateSetting("scraper_proxy_url", event.target.value)
                }
                className="liquid-input mt-1 w-full rounded-2xl px-3 py-2.5"
                placeholder="http://user:password@127.0.0.1:7890"
              />
              <span className="block text-xs text-slate-500 mt-1">
                支持 http:// 与 https:// 代理，配置保存在服务端数据库中。
              </span>
            </label>
          )}
        </div>

        <div className="pt-4 border-t border-white/30 dark:border-white/10">
          <button
            type="submit"
            className="liquid-button-primary px-6 py-2.5 font-medium text-sm"
          >
            保存设置
          </button>
        </div>
      </form>
    </div>
  );
}
