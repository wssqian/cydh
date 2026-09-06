/**
 * 更新操作按钮组 - 检查更新、源码更新、发布包更新
 */

import { RefreshCw, GitBranch, Download, AlertTriangle, XCircle } from 'lucide-react';
import { useUpdater } from './UpdateProvider.js';
import type { UpdateMethod } from './types.js';

const METHOD_INFO: Record<UpdateMethod, { label: string; desc: string; icon: typeof GitBranch; color: string; confirm: string }> = {
  source: {
    label: '源码更新',
    desc: 'git pull + npm install + npm run build',
    icon: GitBranch,
    color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30 hover:bg-emerald-200 dark:hover:bg-emerald-800/50',
    confirm: '确定要执行源码更新吗？\n\n这将执行 git pull + npm install + npm run build，完成后服务将自动重启。',
  },
  release: {
    label: '发布包更新',
    desc: '从 GitHub Releases 下载 dist 包并部署',
    icon: Download,
    color: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-800/50',
    confirm: '确定要执行发布包更新吗？\n\n这将从 GitHub Releases 下载最新 dist 包并部署，完成后服务将自动重启。',
  },
};

export function UpdateActions() {
  const { state, checkUpdate, startUpdate, cancelUpdate } = useUpdater();
  const { checkResult, checkLoading, job, jobLoading } = state;
  const isUpdating = jobLoading || job?.state === 'running';
  const hasUpdate = checkResult?.hasUpdate;

  const handleCheck = () => checkUpdate();

  const handleUpdate = async (method: UpdateMethod) => {
    const info = METHOD_INFO[method];
    if (!window.confirm(info.confirm)) return;
    await startUpdate(method);
  };

  return (
    <div className="liquid-chip rounded-2xl p-4">
      <h3 className="text-sm font-semibold mb-4">更新操作</h3>

      {/* 检查更新按钮 */}
      <button
        onClick={handleCheck}
        disabled={checkLoading || isUpdating}
        className="w-full liquid-button flex items-center justify-center gap-2 px-4 py-3 text-indigo-600 dark:text-indigo-400 font-medium"
      >
        <RefreshCw className={`w-5 h-5 ${checkLoading ? 'animate-spin' : ''}`} />
        {checkLoading ? '检查中...' : '检查更新'}
      </button>

      {/* 更新按钮网格 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
        {(Object.keys(METHOD_INFO) as UpdateMethod[]).map((method) => {
          const info = METHOD_INFO[method];
          const canUpdate = hasUpdate || method === 'source'; // 源码更新始终可用
          const Icon = info.icon;
          return (
            <button
              key={method}
              onClick={() => handleUpdate(method)}
              disabled={isUpdating || !canUpdate}
              className={`liquid-button flex flex-col items-center gap-2 px-4 py-4 ${info.color} disabled:opacity-50 disabled:cursor-not-allowed`}
              title={canUpdate ? undefined : '检测到有新版本时才可用'}
            >
              <div className="flex items-center gap-2">
                <Icon className="w-5 h-5" />
                <span className="font-medium">{info.label}</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 text-center">{info.desc}</p>
            </button>
          );
        })}
      </div>

      {/* 状态提示 */}
      {isUpdating && job && (
        <div className="mt-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <div className="flex items-center justify-between gap-2 text-sm text-amber-700 dark:text-amber-300">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              正在执行 {job.method === 'source' ? '源码更新' : '发布包更新'}... 请勿关闭页面
            </div>
            <button
              onClick={() => void cancelUpdate()}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800/50 transition-colors"
            >
              <XCircle className="w-3.5 h-3.5" />
              取消
            </button>
          </div>
        </div>
      )}

      {!hasUpdate && checkResult && (
        <div className="mt-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <AlertTriangle className="w-4 h-4" />
            当前已是最新版本 ({checkResult.currentVersion})，发布包更新暂不可用。源码更新始终可用（拉取最新代码重新构建）。
          </div>
        </div>
      )}

      {!checkResult && (
        <div className="mt-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
          <p className="text-sm text-slate-600 dark:text-slate-400 text-center">点击"检查更新"获取最新版本信息</p>
        </div>
      )}
    </div>
  );
}