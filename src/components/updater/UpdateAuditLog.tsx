/**
 * 审计日志查看器 - 表格、筛选、导出
 */

import { Search, Filter, Download, ChevronDown, ChevronUp, Eye, ExternalLink, Clock, AlertCircle, CheckCircle2, RotateCcw, RefreshCw } from 'lucide-react';
import { useUpdater } from './UpdateProvider.js';
import { useState, useMemo } from 'react';
import type { AuditLogEntry, AuditLogResponse } from './types.js';

const EVENT_LABELS: Record<string, string> = {
  check: '版本检查',
  preflight: '预检检查',
  update_start: '更新开始',
  update_success: '更新成功',
  update_failed: '更新失败',
  health_check: '健康检查',
  rollback_success: '回滚成功',
  rollback_failed: '回滚失败',
  update_deferred_outside_window: '窗口外延迟',
};

const EVENT_COLORS: Record<string, string> = {
  check: 'text-blue-600 bg-blue-100',
  preflight: 'text-violet-600 bg-violet-100',
  update_start: 'text-amber-600 bg-amber-100',
  update_success: 'text-emerald-600 bg-emerald-100',
  update_failed: 'text-red-600 bg-red-100',
  health_check: 'text-indigo-600 bg-indigo-100',
  rollback_success: 'text-teal-600 bg-teal-100',
  rollback_failed: 'text-red-600 bg-red-100',
  update_deferred_outside_window: 'text-slate-600 bg-slate-100',
};

const METHOD_LABELS: Record<string, string> = {
  source: '源码更新',
  release: '发布包',
};

const CHANNEL_LABELS: Record<string, string> = {
  stable: '稳定版',
  beta: '预发布版',
  nightly: '夜ly构建',
};

export function UpdateAuditLog() {
  const { state, loadAuditLogs, loadAuditStats } = useUpdater();
  const { auditLogs, auditStats, auditLoading, auditQuery } = state;

  const [searchTerm, setSearchTerm] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'timestamp', direction: 'desc' });

  // 筛选状态
  const [eventFilter, setEventFilter] = useState<string[]>([]);
  const [channelFilter, setChannelFilter] = useState<string[]>([]);
  const [methodFilter, setMethodFilter] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // 处理筛选变更
  const handleFilterChange = () => {
    loadAuditLogs({
      event: eventFilter.length === 1 ? eventFilter[0] : undefined,
      channel: channelFilter.length === 1 ? channelFilter[0] as any : undefined,
      method: methodFilter.length === 1 ? methodFilter[0] as any : undefined,
      from: dateFrom || undefined,
      to: dateTo || undefined,
      page: 1,
      pageSize: auditQuery.pageSize,
    });
  };

  // 导出 CSV
  const exportCSV = () => {
    const headers = ['时间', '事件', '通道', '方式', '版本变更', '耗时(ms)', '状态', '触发方式', '错误信息'];
    const rows = auditLogs.map(log => [
      new Date(log.timestamp).toLocaleString('zh-CN'),
      EVENT_LABELS[log.event] || log.event,
      log.channel ? CHANNEL_LABELS[log.channel] : '-',
      log.method ? METHOD_LABELS[log.method] : '-',
      log.previousVersion && log.actualVersion ? `${log.previousVersion} → ${log.actualVersion}` : log.targetVersion || '-',
      log.durationMs || '-',
      log.success ? '成功' : '失败',
      log.triggeredBy === 'manual' ? '手动' : log.triggeredBy === 'auto' ? '自动' : '定时',
      log.errorMessage || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `updater-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 导出 JSON
  const exportJSON = () => {
    const data = auditLogs.map(log => ({
      ...log,
      eventLabel: EVENT_LABELS[log.event] || log.event,
      channelLabel: log.channel ? CHANNEL_LABELS[log.channel] : null,
      methodLabel: log.method ? METHOD_LABELS[log.method] : null,
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `updater-audit-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleExpand = (id: number) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const formatDuration = (ms: number | undefined) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="liquid-chip rounded-2xl p-4">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <RotateCcw className="w-4 h-4 text-indigo-500" />
          更新审计日志
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={exportCSV} className="liquid-button text-xs px-3 py-1.5 flex items-center gap-1">
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          <button onClick={exportJSON} className="liquid-button text-xs px-3 py-1.5 flex items-center gap-1">
            <Download className="w-3.5 h-3.5" />
            JSON
          </button>
          <button onClick={() => { loadAuditStats(); loadAuditLogs({ page: 1 }); }} className="liquid-button text-xs px-3 py-1.5" disabled={auditLoading}>
            <RefreshCw className={`w-3.5 h-3.5 ${auditLoading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="mb-4 space-y-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium mb-1">搜索 (版本/错误/ID)</label>
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="搜索..."
              className="liquid-input w-full rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">事件类型</label>
            <select
              multiple
              value={eventFilter}
              onChange={e => {
                const selected = Array.from(e.target.selectedOptions).map(o => o.value);
                setEventFilter(selected);
                handleFilterChange();
              }}
              className="liquid-input w-full rounded-xl px-3 py-2 text-sm min-w-[150px]"
            >
              {Object.entries(EVENT_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">通道</label>
            <select
              multiple
              value={channelFilter}
              onChange={e => {
                const selected = Array.from(e.target.selectedOptions).map(o => o.value);
                setChannelFilter(selected);
                handleFilterChange();
              }}
              className="liquid-input w-full rounded-xl px-3 py-2 text-sm min-w-[120px]"
            >
              <option value="stable">稳定版</option>
              <option value="beta">预发布版</option>
              <option value="nightly">夜ly构建</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">方式</label>
            <select
              multiple
              value={methodFilter}
              onChange={e => {
                const selected = Array.from(e.target.selectedOptions).map(o => o.value);
                setMethodFilter(selected);
                handleFilterChange();
              }}
              className="liquid-input w-full rounded-xl px-3 py-2 text-sm min-w-[120px]"
            >
              <option value="source">源码更新</option>
              <option value="release">发布包</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">开始时间</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); handleFilterChange(); }}
              className="liquid-input w-full rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">结束时间</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); handleFilterChange(); }}
              className="liquid-input w-full rounded-xl px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      {/* 统计摘要 */}
      {auditStats && (
        <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800">
            <p className="text-slate-500">总事件</p>
            <p className="font-bold">{auditStats.totalEvents}</p>
          </div>
          <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
            <p className="text-emerald-700">成功率</p>
            <p className="font-bold text-emerald-700">{(auditStats.successRate * 100).toFixed(1)}%</p>
          </div>
          <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
            <p className="text-amber-700">事件类型</p>
            <p className="font-bold text-amber-700">{Object.keys(auditStats.eventsByType).length}</p>
          </div>
          <div className="p-2 rounded-lg bg-violet-100 dark:bg-violet-900/30">
            <p className="text-violet-700">最近事件</p>
            <p className="font-bold text-violet-700">
              {auditStats.lastEvent ? new Date(auditStats.lastEvent.timestamp).toLocaleDateString('zh-CN') : '无'}
            </p>
          </div>
        </div>
      )}

      {/* 表格 */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="text-left p-2 font-medium">时间</th>
              <th className="text-left p-2 font-medium">事件</th>
              <th className="text-left p-2 font-medium">通道</th>
              <th className="text-left p-2 font-medium">方式</th>
              <th className="text-left p-2 font-medium">版本变更</th>
              <th className="text-right p-2 font-medium">耗时</th>
              <th className="text-center p-2 font-medium">状态</th>
              <th className="text-left p-2 font-medium">触发</th>
              <th className="text-center p-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {auditLogs.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-slate-500">
                  {auditLoading ? '加载中...' : '暂无审计日志'}
                </td>
              </tr>
            ) : (
              auditLogs.map((log) => (
                <tr key={log.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer" onClick={() => toggleExpand(log.id)}>
                  <td className="p-2 whitespace-nowrap text-slate-600 dark:text-slate-300">
                    {new Date(log.timestamp).toLocaleString('zh-CN')}
                  </td>
                  <td className="p-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${EVENT_COLORS[log.event] || 'text-slate-600 bg-slate-100'}`}>
                      {EVENT_LABELS[log.event] || log.event}
                    </span>
                  </td>
                  <td className="p-2">
                    {log.channel ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-slate-100 dark:bg-slate-800">
                        {CHANNEL_LABELS[log.channel] || log.channel}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="p-2">
                    {log.method ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-slate-100 dark:bg-slate-800">
                        {METHOD_LABELS[log.method] || log.method}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="p-2 font-mono text-xs">
                    {log.previousVersion && log.actualVersion ? (
                      `${log.previousVersion} → ${log.actualVersion}`
                    ) : log.targetVersion || '-'}
                  </td>
                  <td className="p-2 text-right text-slate-500 tabular-nums">
                    {formatDuration(log.durationMs)}
                  </td>
                  <td className="p-2 text-center">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${log.success ? 'text-emerald-600 bg-emerald-100' : 'text-red-600 bg-red-100'}`}>
                      {log.success ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                      {log.success ? '成功' : '失败'}
                    </span>
                  </td>
                  <td className="p-2">
                    <span className="text-xs text-slate-500 capitalize">{log.triggeredBy}</span>
                  </td>
                  <td className="p-2 text-center">
                    <button onClick={e => { e.stopPropagation(); toggleExpand(log.id); }} className="text-slate-400 hover:text-pink-600">
                      {expandedId === log.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </td>
                </tr>
              )))}
          </tbody>
        </table>
      </div>

      {/* 展开详情 */}
      {expandedId && (
        <div className="mt-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 animate-in slide-in-from-top duration-200">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium">详情</h4>
            <button onClick={() => setExpandedId(null)} className="text-slate-400 hover:text-slate-600">
              <ExternalLink className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div><span className="text-slate-500">ID:</span> <code className="ml-2 font-mono">{auditLogs.find(l => l.id === expandedId)?.id}</code></div>
            <div><span className="text-slate-500">时间:</span> <span className="ml-2">{auditLogs.find(l => l.id === expandedId)?.timestamp}</span></div>
            <div className="sm:col-span-2"><span className="text-slate-500">元数据:</span>
              <pre className="mt-1 p-2 bg-slate-900/90 rounded text-xs overflow-x-auto text-slate-100">{auditLogs.find(l => l.id === expandedId)?.metadata || '无'}</pre>
            </div>
            {auditLogs.find(l => l.id === expandedId)?.errorMessage && (
              <div className="sm:col-span-2"><span className="text-slate-500">错误信息:</span>
                <p className="mt-1 p-2 bg-red-50 dark:bg-red-900/20 rounded text-red-600 text-xs">{auditLogs.find(l => l.id === expandedId)?.errorMessage}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 分页 */}
      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs text-slate-500">
          第 {auditQuery.page} 页 / 每页 {auditQuery.pageSize} 条
        </p>
        <div className="flex items-center gap-2">
          <button onClick={() => loadAuditLogs({ page: auditQuery.page - 1 })} disabled={auditQuery.page <= 1 || auditLoading} className="liquid-button text-xs px-3 py-1.5">上一页</button>
          <button onClick={() => loadAuditLogs({ page: auditQuery.page + 1 })} disabled={auditLoading} className="liquid-button text-xs px-3 py-1.5">下一页</button>
        </div>
      </div>
    </div>
  );
}