/**
 * 版本状态卡片 - 显示当前版本、最新版本、更新可用性
 */

import { Package, ArrowUpCircle, CheckCircle2, AlertCircle, GitBranch, CloudDownload, ExternalLink } from 'lucide-react';
import { useUpdater } from './UpdateProvider.js';
import type { UpdateChannel } from './types.js';

const CHANNEL_LABELS: Record<UpdateChannel, { label: string; color: string; desc: string }> = {
  stable: { label: '稳定版', color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30', desc: '生产环境推荐' },
  beta: { label: '预发布版', color: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30', desc: '内测/预生产环境' },
  nightly: { label: '夜ly构建', color: 'text-violet-600 dark:text-violet-400 bg-violet-100 dark:bg-violet-900/30', desc: '开发/CI环境' },
};

export function UpdateStatusCard() {
  const { state, checkUpdate } = useUpdater();
  const { checkResult, checkLoading, settings } = state;

  const currentChannel = settings?.channel || checkResult?.channel || 'stable';
  const channelInfo = CHANNEL_LABELS[currentChannel];

  if (!checkResult) {
    return (
      <div className="liquid-chip rounded-2xl p-4 text-center">
        <div className="animate-pulse space-y-2">
          <div className="h-6 bg-slate-200/50 dark:bg-slate-700/50 rounded w-3/4 mx-auto" />
          <div className="h-4 bg-slate-200/50 dark:bg-slate-700/50 rounded w-1/2 mx-auto" />
        </div>
      </div>
    );
  }

  const hasUpdate = checkResult.hasUpdate;
  const isLatest = !hasUpdate;

  return (
    <div className="liquid-chip rounded-2xl p-4">
      {/* 当前版本 & 通道 */}
      <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
        <div className="flex items-center gap-3">
          <Package className="w-6 h-6 text-indigo-500" />
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              当前版本: <span className="font-mono text-indigo-600 dark:text-indigo-400">{checkResult.currentVersion}</span>
            </p>
            <p className="text-xs text-slate-500">检查于: {new Date(checkResult.checkedAt).toLocaleString('zh-CN')}</p>
          </div>
        </div>

        {/* 通道标签 */}
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${channelInfo.color}`}>
            <GitBranch className="w-3 h-3 mr-1" />
            {channelInfo.label}
          </span>
          <button
            onClick={() => checkUpdate()}
            disabled={checkLoading}
            className="liquid-button flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-pink-600 dark:hover:text-pink-400"
            title="手动检查更新"
          >
            <svg className={`w-4 h-4 ${checkLoading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      </div>

      {/* 通道说明 */}
      <div className="mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
        <p className="text-xs text-slate-600 dark:text-slate-400">{channelInfo.desc}</p>
      </div>

      {/* 更新状态 */}
      <div className="space-y-3">
        {hasUpdate && checkResult.latestVersion && (
          <div className="liquid-chip rounded-xl p-4 border-l-4 border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                  <ArrowUpCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">发现新版本</h3>
                  <p className="text-sm font-mono text-emerald-600 dark:text-emerald-400 truncate">{checkResult.latestVersion}</p>
                  {checkResult.publishedAt && (
                    <p className="text-xs text-emerald-500 dark:text-emerald-400 mt-1">
                      发布时间: {new Date(checkResult.publishedAt).toLocaleString('zh-CN')}
                    </p>
                  )}
                </div>
              </div>
              {checkResult.releaseUrl && (
                <a href={checkResult.releaseUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
                  <button className="liquid-button flex items-center gap-1.5 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30">
                    <ExternalLink className="w-3.5 h-3.5" />
                    查看发布
                  </button>
                </a>
              )}
            </div>
            {checkResult.releaseBody && (
              <div className="mt-3 text-xs text-slate-600 dark:text-slate-300 max-h-32 overflow-y-auto whitespace-pre-wrap">
                {checkResult.releaseBody.slice(0, 300)}
                {checkResult.releaseBody.length > 300 && '...'}
              </div>
            )}
          </div>
        )}

        {isLatest && (
          <div className="liquid-chip rounded-xl p-4 border-l-4 border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">已是最新版本</p>
                <p className="text-xs text-emerald-500 dark:text-emerald-400">无可用更新</p>
              </div>
            </div>
          </div>
        )}

        {/* 能力指示器 */}
        <div className="flex items-center gap-4 flex-wrap text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <GitBranch className={`w-3.5 h-3.5 ${checkResult.hasGitRemote ? 'text-emerald-500' : 'text-slate-400'}`} />
            Git {checkResult.hasGitRemote ? '已配置' : '未配置'}
          </span>
          <span className="flex items-center gap-1.5">
            <CloudDownload className={`w-3.5 h-3.5 ${checkResult.hasRelease ? 'text-emerald-500' : 'text-slate-400'}`} />
            Release {checkResult.hasRelease ? '可用' : '不可用'}
          </span>
        </div>
      </div>
    </div>
  );
}