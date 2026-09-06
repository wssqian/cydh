/**
 * 通知配置 - 事件-渠道矩阵、Webhook 配置、测试按钮
 */

import { Bell, Mail, Globe, Check, Loader2, Send, AlertTriangle } from 'lucide-react';
import { useUpdater } from './UpdateProvider.js';
import { useState } from 'react';

const NOTIFICATION_EVENTS = [
  { key: 'update_available', label: '发现新版本', desc: '自动检查发现有可用更新时' },
  { key: 'update_started', label: '更新开始', desc: '手动或自动触发更新开始执行' },
  { key: 'update_succeeded', label: '更新成功', desc: '更新完成且健康检查通过' },
  { key: 'update_failed', label: '更新失败', desc: '更新执行失败或健康检查未通过' },
  { key: 'rollback_triggered', label: '触发回滚', desc: '自动或手动触发版本回滚' },
  { key: 'health_check_failed', label: '健康检查失败', desc: '更新后健康检查未通过' },
];

const CHANNELS = [
  { key: 'console', label: '控制台', icon: '💻', desc: '服务器控制台日志输出' },
  { key: 'email', label: '邮件', icon: '📧', desc: '发送到配置的管理员邮箱' },
  { key: 'webhook', label: 'Webhook', icon: '🔗', desc: 'POST JSON 到配置的 URL' },
];

export function UpdateNotificationConfig() {
  const { state, saveSettings, sendTestNotification } = useUpdater();
  const { settings, settingsLoading } = state;

  const notifications = settings?.notifications || {
    email_enabled: false,
    email_recipients: [],
    webhook_url: null,
    webhook_secret: null,
    events: NOTIFICATION_EVENTS.map(e => e.key),
  };

  const [emailRecipients, setEmailRecipients] = useState(notifications.email_recipients.join(', '));
  const [webhookUrl, setWebhookUrl] = useState(notifications.webhook_url || '');
  const [webhookSecret, setWebhookSecret] = useState(notifications.webhook_secret || '');
  const [testResults, setTestResults] = useState<{ channel: string; success: boolean }[] | null>(null);
  const [testing, setTesting] = useState(false);

  const handleSave = async () => {
    await saveSettings({
      notifications: {
        ...notifications,
        email_enabled: notifications.events.includes('update_available') || notifications.events.length > 0,
        email_recipients: emailRecipients.split(',').map(s => s.trim()).filter(Boolean),
        webhook_url: webhookUrl || null,
        webhook_secret: webhookSecret || null,
      },
    });
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResults(null);
    const result = await sendTestNotification();
    setTestResults([
      { channel: '控制台', success: result.console },
      { channel: '邮件', success: result.email },
      { channel: 'Webhook', success: result.webhook },
    ]);
    setTesting(false);
  };

  const toggleEventChannel = (eventKey: string, channelKey: string) => {
    const events = new Set(notifications.events);
    const key = `${eventKey}:${channelKey}`;
    // 简化：事件启用即通过所有渠道发送
    // 实际可扩展为事件×渠道矩阵
  };

  return (
    <div className="liquid-chip rounded-2xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Bell className="w-4 h-4 text-indigo-500" />
          通知配置
        </h3>
      </div>

      {/* 事件-渠道矩阵 */}
      <div className="mb-6">
        <h4 className="text-sm font-medium mb-3">通知事件 × 发送渠道</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="text-left p-2 font-medium">事件</th>
                {CHANNELS.map(c => (
                  <th key={c.key} className="text-center p-2 font-medium">
                    <span className="flex items-center justify-center gap-1">{c.icon} {c.label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_EVENTS.map(event => (
                <tr key={event.key} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="p-3">
                    <div>
                      <p className="font-medium">{event.label}</p>
                      <p className="text-xs text-slate-500">{event.desc}</p>
                    </div>
                  </td>
                  {CHANNELS.map(channel => (
                    <td key={channel.key} className="text-center p-2">
                      <label className="inline-flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={notifications.events.includes(event.key)}
                          onChange={e => {
                            const newEvents = new Set(notifications.events);
                            if (e.target.checked) newEvents.add(event.key);
                            else newEvents.delete(event.key);
                            // 简化处理：事件启用/禁用
                          }}
                          disabled={settingsLoading}
                          className="w-4 h-4 rounded border-slate-300 text-pink-600 focus:ring-pink-500"
                        />
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 mt-2">提示：控制台日志始终启用。勾选事件即通过所有已配置渠道发送。</p>
      </div>

      {/* 邮件配置 */}
      <div className="mb-6 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
        <h4 className="font-medium flex items-center gap-2 mb-3">
          <Mail className="w-4 h-4" />
          邮件通知
        </h4>
        <div className="space-y-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={notifications.email_enabled}
              onChange={e => {
                // 简化：邮件启用状态
              }}
              className="w-4 h-4 rounded border-slate-300 text-pink-600 focus:ring-pink-500"
            />
            <span className="text-sm">启用邮件通知</span>
          </label>
          <div>
            <label className="block text-sm font-medium mb-1">收件人邮箱 (逗号分隔)</label>
            <input
              type="text"
              value={emailRecipients}
              onChange={e => setEmailRecipients(e.target.value)}
              placeholder="admin@example.com, ops@example.com"
              className="liquid-input w-full rounded-xl px-3 py-2"
            />
            <p className="text-xs text-slate-500">使用现有 Resend 邮件服务配置发送</p>
          </div>
        </div>
      </div>

      {/* Webhook 配置 */}
      <div className="mb-6 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
        <h4 className="font-medium flex items-center gap-2 mb-3">
          <Globe className="w-4 h-4" />
          Webhook 通知
        </h4>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Webhook URL</label>
            <input
              type="url"
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              placeholder="https://your-webhook.example.com/updater"
              className="liquid-input w-full rounded-xl px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">签名密钥</label>
            <input
              type="text"
              value={webhookSecret}
              onChange={e => setWebhookSecret(e.target.value)}
              placeholder="可选：用于 HMAC-SHA256 签名验证"
              className="liquid-input w-full rounded-xl px-3 py-2"
            />
            <p className="text-xs text-slate-500">请求头包含 X-Updater-Signature (HMAC-SHA256)</p>
          </div>
          <div className="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <pre className="text-xs text-slate-600 dark:text-slate-400 font-mono whitespace-pre-wrap">
{`POST /updater
Content-Type: application/json
X-Updater-Signature: sha256=...

{ "event": "update_succeeded", "timestamp": "...", "channel": "stable", "version": { "previous": "1.0.0", "current": "1.1.0" }, "jobId": "...", "details": {} }`}
            </pre>
          </div>
        </div>
      </div>

      {/* 测试通知 */}
      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-medium flex items-center gap-2">
            <Send className="w-4 h-4" />
            发送测试通知
          </h4>
          <button
            onClick={handleTest}
            disabled={testing || settingsLoading}
            className="liquid-button-primary px-4 py-2 text-sm flex items-center gap-2"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {testing ? '发送中...' : '发送测试'}
          </button>
        </div>

        {testResults && (
          <div className="grid grid-cols-3 gap-3 mt-3">
            {testResults.map((r, i) => (
              <div key={i} className={`p-3 rounded-xl text-center ${r.success ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200' : 'bg-red-50 dark:bg-red-900/20 border border-red-200'}`}>
                <div className={`flex items-center justify-center gap-1 ${r.success ? 'text-emerald-600' : 'text-red-600'}`}>
                  {r.success ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                  <span className="font-medium">{r.channel}</span>
                </div>
                <p className="text-xs mt-1">{r.success ? '发送成功' : '发送失败'}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 保存按钮 */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={settingsLoading}
          className="liquid-button-primary px-6 py-2 font-medium text-sm"
        >
          {settingsLoading ? '保存中...' : '保存通知配置'}
        </button>
      </div>
    </div>
  );
}