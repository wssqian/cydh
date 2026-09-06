/**
 * 维护窗口配置
 */

import { Clock, Info, Globe } from 'lucide-react';
import { useUpdater } from './UpdateProvider.js';

export function UpdateMaintenanceWindow() {
  const { state, saveSettings } = useUpdater();
  const { settings, settingsLoading, maintenanceWindow, maintenanceWindowLoading } = state;

  const window = settings?.maintenance_window || { start_hour: null, end_hour: null, timezone: 'Asia/Shanghai' };
  const isInWindow = maintenanceWindow?.isInWindow;
  const nextStart = maintenanceWindow?.nextWindowStart;

  const handleStartChange = (value: string) => {
    const hour = value ? parseInt(value, 10) : null;
    saveSettings({
      maintenance_window: { ...window, start_hour: hour },
    });
  };

  const handleEndChange = (value: string) => {
    const hour = value ? parseInt(value, 10) : null;
    saveSettings({
      maintenance_window: { ...window, end_hour: hour },
    });
  };

  const handleTimezoneChange = (value: string) => {
    saveSettings({
      maintenance_window: { ...window, timezone: value || 'Asia/Shanghai' },
    });
  };

  const getWindowDescription = () => {
    const { start_hour, end_hour } = window;
    if (start_hour === null || end_hour === null) return '未配置维护窗口，自动更新可在任何时间运行';
    
    const formatHour = (h: number) => `${h.toString().padStart(2, '0')}:00`;
    
    if (start_hour <= end_hour) {
      return `每天 ${formatHour(start_hour)} - ${formatHour(end_hour)} (${window.timezone})`;
    } else {
      return `每天 ${formatHour(start_hour)} - 次日 ${formatHour(end_hour)} (${window.timezone}，跨午夜)`;
    }
  };

  return (
    <div className="liquid-chip rounded-2xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4 text-indigo-500" />
          维护窗口
        </h3>
      </div>

      {/* 状态显示 */}
      {maintenanceWindowLoading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-10 bg-slate-200/50 dark:bg-slate-700/50 rounded" />
          <div className="h-10 bg-slate-200/50 dark:bg-slate-700/50 rounded" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* 当前状态 */}
          <div className={`p-3 rounded-xl ${isInWindow ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200' : 'bg-slate-50 dark:bg-slate-800/50'}`}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isInWindow ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-slate-100 dark:bg-slate-800'}`}>
                {isInWindow ? (
                  <svg className="w-5 h-5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l-2 2" />
                  </svg>
                )}
              </div>
              <div>
                <p className="font-medium">{isInWindow ? '当前处于维护窗口内' : '当前不在维护窗口内'}</p>
                <p className="text-sm text-slate-500">{getWindowDescription()}</p>
              </div>
            </div>
          </div>

          {/* 下次窗口开始 */}
          {nextStart && !isInWindow && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200">
              <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
                下次维护窗口开始: {new Date(nextStart).toLocaleString('zh-CN')}
              </div>
            </div>
          )}

          {/* 配置表单 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium mb-1">开始时间</label>
              <select
                value={window.start_hour !== null ? String(window.start_hour) : ''}
                onChange={e => handleStartChange(e.target.value)}
                disabled={settingsLoading}
                className="liquid-input w-full rounded-xl px-3 py-2"
              >
                <option value="">未设置 (禁用维护窗口)</option>
                {Array.from({ length: 24 }, (_, i) => i).map(h => (
                  <option key={h} value={h}>{h.toString().padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">结束时间</label>
              <select
                value={window.end_hour !== null ? String(window.end_hour) : ''}
                onChange={e => handleEndChange(e.target.value)}
                disabled={settingsLoading}
                className="liquid-input w-full rounded-xl px-3 py-2"
              >
                <option value="">未设置 (禁用维护窗口)</option>
                {Array.from({ length: 24 }, (_, i) => i).map(h => (
                  <option key={h} value={h}>{h.toString().padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">时区</label>
              <input
                type="text"
                value={window.timezone}
                onChange={e => handleTimezoneChange(e.target.value)}
                disabled={settingsLoading}
                className="liquid-input w-full rounded-xl px-3 py-2"
                placeholder="Asia/Shanghai"
              />
            </div>
          </div>

          {/* 说明 */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
            <div className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium mb-1">关于维护窗口</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li>自动检查更新仅在维护窗口内执行</li>
                  <li>手动触发的更新不受维护窗口限制</li>
                  <li>开始时间 &le; 结束时间：同一天窗口（如 02:00-04:00）</li>
                  <li>开始时间 &gt; 结束时间：跨午夜窗口（如 22:00-04:00）</li>
                  <li>留空即禁用维护窗口，自动更新可随时运行</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}