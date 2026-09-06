/**
 * 更新通道选择器
 */

import { GitBranch, Info } from 'lucide-react';
import { useUpdater } from './UpdateProvider.js';
import type { UpdateChannel } from './types.js';

const CHANNELS: { value: UpdateChannel; label: string; desc: string; icon: string }[] = [
  { value: 'stable', label: '稳定版', desc: '生产环境推荐，仅正式版本', icon: '🟢' },
  { value: 'beta', label: '预发布版', desc: '内测/预生产环境，包含预发布版本', icon: '🟡' },
  { value: 'nightly', label: '夜ly构建', desc: '开发/CI环境，最新提交标签', icon: '🟣' },
];

export function UpdateChannelSelector() {
  const { state, saveSettings } = useUpdater();
  const { settings, settingsLoading } = state;
  const currentChannel = settings?.channel || 'stable';

  const handleChange = async (channel: UpdateChannel) => {
    await saveSettings({ channel });
  };

  return (
    <div className="liquid-chip rounded-2xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-indigo-500" />
          更新通道
        </h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {CHANNELS.map((channel) => {
          const isActive = currentChannel === channel.value;
          return (
            <button
              key={channel.value}
              onClick={() => handleChange(channel.value)}
              disabled={settingsLoading}
              className={`relative p-4 rounded-xl border-2 transition-all ${
                isActive
                  ? 'border-pink-500 bg-pink-50 dark:bg-pink-900/20'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              {isActive && (
                <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-pink-500 flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
              )}
              <div className="flex items-start gap-3">
                <span className="text-2xl mt-0.5">{channel.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className={`font-medium ${isActive ? 'text-pink-700 dark:text-pink-300' : 'text-slate-700 dark:text-slate-200'}`}>
                    {channel.label}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">{channel.desc}</p>
                </div>
              </div>
              {isActive && (
                <div className="absolute bottom-2 right-2 text-pink-500 text-xs font-medium">当前</div>
              )}
            </button>
          );
        })}
      </div>

      {/* 当前通道详情 */}
      <div className="mt-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
        <div className="flex items-center gap-2 text-sm">
          <Info className="w-4 h-4 text-slate-400" />
          <span className="text-slate-600 dark:text-slate-400">
            切换通道后，下次检查更新将从对应通道获取版本。
            <span className="ml-2 font-medium">稳定版</span> 仅返回正式发布版本，
            <span className="ml-2 font-medium">预发布版</span> 包含 alpha/beta/rc 版本，
            <span className="ml-2 font-medium">夜ly构建</span> 直接使用最新 Git 标签。
          </span>
        </div>
      </div>
    </div>
  );
}