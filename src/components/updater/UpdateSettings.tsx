/**
 * 综合设置表单 - 自动检查、间隔、通道、窗口
 */

import { useUpdater } from './UpdateProvider.js';

export function UpdateSettings() {
  const { state, saveSettings, checkUpdate } = useUpdater();
  const { settings, settingsLoading, checkResult, checkLoading } = state;

  const currentSettings = settings || {
    auto_check_enabled: false,
    check_interval_hours: 24,
    channel: 'stable' as const,
    maintenance_window: { start_hour: null, end_hour: null, timezone: 'Asia/Shanghai' },
    signature: { public_key: null, allow_unsigned_dev: true },
    notifications: { email_enabled: false, email_recipients: [], webhook_url: null, webhook_secret: null, events: [] },
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget as HTMLFormElement);
    const updates: Partial<typeof currentSettings> = {};

    // 自动检查
    updates.auto_check_enabled = formData.get('auto_check_enabled') === 'on';

    // 检查间隔
    const interval = parseInt(formData.get('check_interval_hours') as string, 10);
    if (!isNaN(interval) && interval >= 1 && interval <= 168) {
      updates.check_interval_hours = interval;
    }

    // 通道
    updates.channel = formData.get('channel') as 'stable' | 'beta' | 'nightly';

    // 维护窗口
    const startHour = formData.get('maintenance_start') as string;
    const endHour = formData.get('maintenance_end') as string;
    const timezone = formData.get('maintenance_timezone') as string;
    updates.maintenance_window = {
      start_hour: startHour ? parseInt(startHour, 10) : null,
      end_hour: endHour ? parseInt(endHour, 10) : null,
      timezone: timezone || 'Asia/Shanghai',
    };

    // 签名
    const publicKey = formData.get('signature_public_key') as string;
    const allowUnsignedDev = formData.get('signature_allow_unsigned_dev') === 'on';
    updates.signature = {
      public_key: publicKey || null,
      allow_unsigned_dev: allowUnsignedDev,
    };

    // 通知事件
    const events: string[] = [];
    formData.getAll('notification_events').forEach(e => events.push(e as string));
    updates.notifications = {
      ...currentSettings.notifications,
      events,
    };

    await saveSettings(updates);
  };

  return (
    <form onSubmit={handleSubmit} className="liquid-chip rounded-2xl p-4 space-y-6">
      <h3 className="text-sm font-semibold">综合设置</h3>

      {/* 自动检查更新 */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">自动检查更新</legend>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="auto_check_enabled"
            checked={currentSettings.auto_check_enabled}
            className="w-4 h-4 rounded border-slate-300 text-pink-600 focus:ring-pink-500"
          />
          <span className="text-sm">启用自动检查 GitHub 更新</span>
        </label>
        <div>
          <label className="block text-sm font-medium mb-1">检查间隔 (小时)</label>
          <input
            type="number"
            name="check_interval_hours"
            min="1"
            max="168"
            value={currentSettings.check_interval_hours}
            className="liquid-input w-full max-w-xs rounded-xl px-3 py-2"
          />
          <p className="text-xs text-slate-500 mt-1">最小 1 小时，最大 168 小时 (一周)</p>
        </div>
        <button
          type="button"
          onClick={() => checkUpdate()}
          disabled={checkLoading}
          className="liquid-button text-sm px-4 py-2"
        >
          {checkLoading ? '检查中...' : '立即检查更新'}
        </button>
      </fieldset>

      {/* 更新通道 */}
      <fieldset className="space-y-3 border-t border-slate-200 dark:border-slate-700 pt-4">
        <legend className="text-sm font-medium">更新通道</legend>
        <div className="grid grid-cols-3 gap-3">
          {(['stable', 'beta', 'nightly'] as const).map(channel => {
            const labels = { stable: '稳定版', beta: '预发布版', nightly: '夜ly构建' };
            const descs = { stable: '生产环境推荐', beta: '内测/预生产', nightly: '开发/CI环境' };
            return (
              <label key={channel} className={`p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                currentSettings.channel === channel
                  ? 'border-pink-500 bg-pink-50 dark:bg-pink-900/20'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
              }`}>
                <input
                  type="radio"
                  name="channel"
                  value={channel}
                  checked={currentSettings.channel === channel}
                  className="sr-only"
                />
                <div className="font-medium">{labels[channel]}</div>
                <div className="text-xs text-slate-500 mt-1">{descs[channel]}</div>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* 维护窗口 */}
      <fieldset className="space-y-3 border-t border-slate-200 dark:border-slate-700 pt-4">
        <legend className="text-sm font-medium">维护窗口</legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">开始时间</label>
            <select
              name="maintenance_start"
              className="liquid-input w-full rounded-xl px-3 py-2"
            >
              <option value="">未设置</option>
              {Array.from({ length: 24 }, (_, i) => i).map(h => (
                <option key={h} value={h} selected={currentSettings.maintenance_window.start_hour === h}>
                  {h.toString().padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">结束时间</label>
            <select
              name="maintenance_end"
              className="liquid-input w-full rounded-xl px-3 py-2"
            >
              <option value="">未设置</option>
              {Array.from({ length: 24 }, (_, i) => i).map(h => (
                <option key={h} value={h} selected={currentSettings.maintenance_window.end_hour === h}>
                  {h.toString().padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">时区</label>
            <input
              type="text"
              name="maintenance_timezone"
              value={currentSettings.maintenance_window.timezone}
              className="liquid-input w-full rounded-xl px-3 py-2"
            />
          </div>
        </div>
        <p className="text-xs text-slate-500">
          留空即禁用维护窗口。开始 &gt; 结束 表示跨午夜 (如 22:00 - 04:00)。
        </p>
      </fieldset>

      {/* 签名验证 */}
      <fieldset className="space-y-3 border-t border-slate-200 dark:border-slate-700 pt-4">
        <legend className="text-sm font-medium">发布包签名验证</legend>
        <div>
          <label className="block text-sm font-medium mb-1">Ed25519 公钥</label>
          <textarea
            name="signature_public_key"
            value={currentSettings.signature.public_key || ''}
            placeholder="Base64 编码的 32 字节公钥..."
            rows={2}
            className="liquid-input w-full rounded-xl px-3 py-2 font-mono text-sm"
          />
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="signature_allow_unsigned_dev"
            checked={currentSettings.signature.allow_unsigned_dev}
            className="w-4 h-4 rounded border-slate-300 text-pink-600 focus:ring-pink-500"
          />
          <span className="text-sm">开发模式允许无签名更新 (NODE_ENV !== production)</span>
        </label>
      </fieldset>

      {/* 通知事件 */}
      <fieldset className="space-y-3 border-t border-slate-200 dark:border-slate-700 pt-4">
        <legend className="text-sm font-medium">通知事件</legend>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {[
            { key: 'update_available', label: '发现新版本' },
            { key: 'update_started', label: '更新开始' },
            { key: 'update_succeeded', label: '更新成功' },
            { key: 'update_failed', label: '更新失败' },
            { key: 'rollback_triggered', label: '触发回滚' },
            { key: 'health_check_failed', label: '健康检查失败' },
          ].map(event => (
            <label key={event.key} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="notification_events"
                value={event.key}
                checked={currentSettings.notifications.events.includes(event.key)}
                className="w-4 h-4 rounded border-slate-300 text-pink-600 focus:ring-pink-500"
              />
              <span className="text-sm">{event.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* 保存按钮 */}
      <div className="flex justify-end border-t border-slate-200 dark:border-slate-700 pt-4">
        <button
          type="submit"
          disabled={settingsLoading}
          className="liquid-button-primary px-6 py-2.5 font-medium text-sm"
        >
          {settingsLoading ? '保存中...' : '保存所有设置'}
        </button>
      </div>
    </form>
  );
}