/**
 * 更新进度展示 - 流水线阶段指示器、步骤进度、实时日志
 */

import { ChevronDown, ChevronUp, X, Download, RefreshCw, CheckCircle2, AlertCircle, Loader2, Terminal } from 'lucide-react';
import { useUpdater } from './UpdateProvider.js';
import type { PipelinePhase, UpdateJob, PreflightCheck, HealthCheck } from './types.js';

const PHASE_INFO: Record<PipelinePhase, { label: string; icon: string; color: string }> = {
  preflight: { label: '预检检查', icon: '🔍', color: 'text-blue-600' },
  execute: { label: '执行更新', icon: '⚙️', color: 'text-amber-600' },
  health: { label: '健康检查', icon: '🏥', color: 'text-violet-600' },
  commit: { label: '确认完成', icon: '✅', color: 'text-emerald-600' },
  complete: { label: '已完成', icon: '🎉', color: 'text-emerald-600' },
};

const PHASE_ORDER: PipelinePhase[] = ['preflight', 'execute', 'health', 'commit', 'complete'];

export function UpdateProgress() {
  const { state, dispatch } = useUpdater();
  const { job, pipelinePhase, phaseHistory, showLog, logFilter } = state;

  if (!job) {
    return null;
  }

  const currentPhaseIndex = PHASE_ORDER.indexOf(pipelinePhase);

  // 解析日志行
  const parseLogLine = (line: string) => {
    if (line.startsWith('[阶段')) return { type: 'phase' as const, content: line };
    if (line.startsWith('[步骤')) return { type: 'step' as const, content: line };
    if (line.startsWith('[完成]')) return { type: 'success' as const, content: line };
    if (line.startsWith('[失败]') || line.startsWith('ERROR:')) return { type: 'error' as const, content: line };
    if (line.startsWith('[警告]')) return { type: 'warning' as const, content: line };
    if (line.startsWith('[信息]') || line.startsWith('[系统]')) return { type: 'info' as const, content: line };
    if (line.startsWith('$')) return { type: 'command' as const, content: line };
    if (line.startsWith('  ✓') || line.startsWith('  ✗')) return { type: 'check' as const, content: line };
    return { type: 'output' as const, content: line };
  };

  const filteredLogs = job.log
    .map(parseLogLine)
    .filter(l => logFilter === 'all' || l.type === logFilter);

  const toggleLog = () => dispatch({ type: 'TOGGLE_LOG' });
  const setFilter = (filter: typeof logFilter) => dispatch({ type: 'SET_LOG_FILTER', payload: filter });

  return (
    <div className="liquid-chip rounded-2xl p-4 animate-in slide-in-from-bottom duration-300">
      {/* 阶段指示器 */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">更新流水线</h3>
          <div className="flex items-center gap-2">
            <select
              value={logFilter}
              onChange={e => setFilter(e.target.value as typeof logFilter)}
              className="text-xs px-2 py-1 rounded border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
            >
              <option value="all">全部</option>
              <option value="error">错误</option>
              <option value="warning">警告</option>
              <option value="step">步骤</option>
              <option value="info">信息</option>
            </select>
            <button
              onClick={toggleLog}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${showLog ? 'bg-pink-100 text-pink-700' : 'bg-slate-100 text-slate-600'}`}
            >
              {showLog ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showLog ? '隐藏' : '展开'} 日志
            </button>
          </div>
        </div>

        {/* 阶段进度条 */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {PHASE_ORDER.map((phase, index) => {
            const info = PHASE_INFO[phase];
            const history = phaseHistory.find(h => h.phase === phase);
            const isCurrent = phase === pipelinePhase && job.state === 'running';
            const isCompleted = history?.completed && !history.failed;
            const isFailed = history?.failed;
            const isPending = index > currentPhaseIndex || (index === currentPhaseIndex && !isCurrent);

            return (
              <div key={phase} className="flex items-center flex-shrink-0">
                <div className="relative flex flex-col items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                    isCurrent ? 'animate-pulse ring-4 ring-pink-200' :
                    isCompleted ? 'bg-emerald-500 text-white' :
                    isFailed ? 'bg-red-500 text-white' :
                    'bg-slate-200 dark:bg-slate-700 text-slate-400'
                  }`}>
                    {isCurrent ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : isCompleted ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : isFailed ? (
                      <AlertCircle className="w-5 h-5" />
                    ) : (
                      <span>{info.icon}</span>
                    )}
                  </div>
                  <span className={`mt-1 text-xs font-medium truncate w-20 text-center ${isCurrent ? 'text-pink-600' : 'text-slate-500'}`}>
                    {info.label}
                  </span>
                </div>
                {index < PHASE_ORDER.length - 1 && (
                  <div className={`flex-1 h-1 mx-1 rounded ${isCompleted || isCurrent ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 实时日志 */}
      {showLog && (
        <div className="mt-4 border-t border-slate-200 dark:border-slate-700 pt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Terminal className="w-4 h-4" />
              实时日志 ({filteredLogs.length})
              {job.state === 'running' && <Loader2 className="w-4 h-4 animate-spin text-amber-500" />}
            </h4>
            <button
              onClick={() => dispatch({ type: 'JOB_PROGRESS', payload: { log: '' } })}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="font-mono text-xs bg-slate-900/90 dark:bg-slate-950 rounded-xl p-3 max-h-64 overflow-y-auto">
            {filteredLogs.map((log, index) => (
              <div key={index} className={`py-0.5 ${getLogColor(log.type)}`}>
                <span className="text-slate-400 mr-2">[{new Date().toLocaleTimeString()}]</span>
                {log.content}
              </div>
            ))}
            {job.state === 'running' && (
              <div className="text-slate-400 animate-pulse">等待更多输出...</div>
            )}
          </div>
        </div>
      )}

      {/* 完成状态 */}
      {(job.state === 'succeeded' || job.state === 'failed') && (
        <div className={`mt-4 p-4 rounded-xl ${job.state === 'succeeded' ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200' : 'bg-red-50 dark:bg-red-900/20 border border-red-200'}`}>
          <div className="flex items-center gap-3">
            {job.state === 'succeeded' ? (
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
            ) : (
              <AlertCircle className="w-6 h-6 text-red-500" />
            )}
            <div>
              <p className="font-medium">
                {job.state === 'succeeded' ? '更新成功！' : '更新失败'}
              </p>
              {job.result && (
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  {job.result.previousVersion} → {job.result.newVersion}
                </p>
              )}
              {job.error && (
                <p className="text-sm text-red-600 dark:text-red-400 mt-1">{job.error}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getLogColor(type: string): string {
  switch (type) {
    case 'error': return 'text-red-400';
    case 'warning': return 'text-amber-400';
    case 'success': return 'text-emerald-400';
    case 'phase': return 'text-blue-400 font-medium';
    case 'step': return 'text-violet-400';
    case 'check': return 'text-slate-300';
    case 'command': return 'text-slate-500';
    case 'info': return 'text-slate-300';
    default: return 'text-slate-300';
  }
}