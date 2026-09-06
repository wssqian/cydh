/**
 * 更新系统状态管理 Provider
 * 使用 useReducer 管理复杂的更新状态机
 */

import { createContext, useContext, useReducer, useEffect, useCallback, ReactNode } from 'react';
import type {
  UpdateCheckResult,
  UpdateJob,
  UpdateJobResult,
  UpdaterSettings,
  UpdateOptions,
  UpdateMethod,
  PipelinePhase,
  PipelinePhaseInfo,
  BackupInfo,
  AuditLogEntry,
  AuditLogResponse,
  AuditStats,
  NotificationResult,
  MaintenanceWindowStatus,
} from './types.js';

// 状态类型
interface UpdaterState {
  // 版本检查
  checkResult: UpdateCheckResult | null;
  checkLoading: boolean;
  checkError: string | null;

  // 更新任务
  job: UpdateJob | null;
  jobLoading: boolean;
  jobError: string | null;

  // 设置
  settings: UpdaterSettings | null;
  settingsLoading: boolean;
  settingsError: string | null;

  // 流水线阶段
  pipelinePhase: PipelinePhase;
  phaseHistory: PipelinePhaseInfo[];

  // 日志显示
  showLog: boolean;
  logFilter: 'all' | 'error' | 'warning' | 'info' | 'step';

  // 备份
  backups: BackupInfo[];
  backupsLoading: boolean;

  // 审计日志
  auditLogs: AuditLogEntry[];
  auditStats: AuditStats | null;
  auditLoading: boolean;
  auditQuery: {
    event?: string;
    channel?: string;
    method?: string;
    from?: string;
    to?: string;
    page: number;
    pageSize: number;
  };

  // 维护窗口
  maintenanceWindow: MaintenanceWindowStatus | null;
  maintenanceWindowLoading: boolean;
}

type UpdaterAction =
  // 检查更新
  | { type: 'CHECK_START' }
  | { type: 'CHECK_SUCCESS'; payload: UpdateCheckResult }
  | { type: 'CHECK_ERROR'; payload: string }
  // 更新任务
  | { type: 'JOB_START'; payload: { job: UpdateJob; method: UpdateMethod } }
  | { type: 'JOB_PROGRESS'; payload: { log: string; phase?: PipelinePhase } }
  | { type: 'JOB_SUCCESS'; payload: UpdateJobResult }
  | { type: 'JOB_ERROR'; payload: string }
  // 设置
  | { type: 'SETTINGS_LOAD_START' }
  | { type: 'SETTINGS_LOAD_SUCCESS'; payload: UpdaterSettings }
  | { type: 'SETTINGS_LOAD_ERROR'; payload: string }
  | { type: 'SETTINGS_UPDATE'; payload: Partial<UpdaterSettings> }
  // 流水线阶段
  | { type: 'PHASE_CHANGE'; payload: PipelinePhase }
  // 日志
  | { type: 'TOGGLE_LOG'; payload?: boolean }
  | { type: 'SET_LOG_FILTER'; payload: UpdaterState['logFilter'] }
  // 备份
  | { type: 'BACKUPS_LOAD_START' }
  | { type: 'BACKUPS_LOAD_SUCCESS'; payload: BackupInfo[] }
  // 审计日志
  | { type: 'AUDIT_LOAD_START' }
  | { type: 'AUDIT_LOAD_SUCCESS'; payload: { entries: AuditLogEntry[]; totalCount: number; page: number; pageSize: number } }
  | { type: 'AUDIT_STATS_SUCCESS'; payload: AuditStats }
  | { type: 'AUDIT_QUERY_CHANGE'; payload: Partial<UpdaterState['auditQuery']> }
  // 维护窗口
  | { type: 'MAINTENANCE_WINDOW_LOAD_SUCCESS'; payload: MaintenanceWindowStatus }
  | { type: 'MAINTENANCE_WINDOW_LOAD_START' };

// 初始状态
const initialState: UpdaterState = {
  checkResult: null,
  checkLoading: false,
  checkError: null,
  job: null,
  jobLoading: false,
  jobError: null,
  settings: null,
  settingsLoading: false,
  settingsError: null,
  pipelinePhase: 'preflight',
  phaseHistory: [],
  showLog: false,
  logFilter: 'all',
  backups: [],
  backupsLoading: false,
  auditLogs: [],
  auditStats: null,
  auditLoading: false,
  auditQuery: {
    page: 1,
    pageSize: 20,
  },
  maintenanceWindow: null,
  maintenanceWindowLoading: false,
};

// Reducer
function updaterReducer(state: UpdaterState, action: UpdaterAction): UpdaterState {
  switch (action.type) {
    // 检查更新
    case 'CHECK_START':
      return { ...state, checkLoading: true, checkError: null };
    case 'CHECK_SUCCESS':
      return { ...state, checkLoading: false, checkResult: action.payload, checkError: null };
    case 'CHECK_ERROR':
      return { ...state, checkLoading: false, checkError: action.payload };

    // 更新任务
    case 'JOB_START':
      return {
        ...state,
        job: action.payload.job,
        jobLoading: true,
        jobError: null,
        pipelinePhase: 'preflight',
        phaseHistory: [
          { phase: 'preflight', label: '预检检查', icon: '🔍', completed: false, current: true, failed: false },
          { phase: 'execute', label: '执行更新', icon: '⚙️', completed: false, current: false, failed: false },
          { phase: 'health', label: '健康检查', icon: '🏥', completed: false, current: false, failed: false },
          { phase: 'commit', label: '确认完成', icon: '✅', completed: false, current: false, failed: false },
        ],
        showLog: true,
      };
    case 'JOB_PROGRESS':
      return {
        ...state,
        job: state.job ? { ...state.job, log: [...state.job.log, action.payload.log] } : null,
        pipelinePhase: action.payload.phase ?? state.pipelinePhase,
        phaseHistory: state.phaseHistory.map(p => {
          if (action.payload.phase && p.phase === action.payload.phase) {
            return { ...p, current: true };
          }
          return p;
        }),
      };
    case 'JOB_SUCCESS':
      return {
        ...state,
        job: state.job ? { ...state.job, state: 'succeeded' as const, completedAt: Date.now(), result: action.payload, log: [...state.job.log, `[完成] 更新成功！新版本: ${action.payload.newVersion}`] } : null,
        jobLoading: false,
        pipelinePhase: 'complete',
        phaseHistory: state.phaseHistory.map(p => ({ ...p, completed: true, current: false, failed: false })),
      };
    case 'JOB_ERROR':
      return {
        ...state,
        job: state.job ? { ...state.job, state: 'failed' as const, completedAt: Date.now(), error: action.payload, log: [...state.job.log, `[失败] ${action.payload}`] } : null,
        jobLoading: false,
        jobError: action.payload,
        pipelinePhase: 'preflight',
        phaseHistory: state.phaseHistory.map(p => ({ ...p, current: false, failed: p.phase === state.pipelinePhase })),
      };

    // 设置
    case 'SETTINGS_LOAD_START':
      return { ...state, settingsLoading: true, settingsError: null };
    case 'SETTINGS_LOAD_SUCCESS':
      return { ...state, settingsLoading: false, settings: action.payload, settingsError: null };
    case 'SETTINGS_LOAD_ERROR':
      return { ...state, settingsLoading: false, settingsError: action.payload };
    case 'SETTINGS_UPDATE':
      return { ...state, settings: state.settings ? { ...state.settings, ...action.payload } : null };

    // 流水线阶段
    case 'PHASE_CHANGE':
      return {
        ...state,
        pipelinePhase: action.payload,
        phaseHistory: state.phaseHistory.map(p => ({
          ...p,
          current: p.phase === action.payload,
          completed: p.phase !== action.payload && (p.phase === 'preflight' || p.phase === 'execute' || p.phase === 'health'),
        })),
      };

    // 日志
    case 'TOGGLE_LOG':
      return { ...state, showLog: action.payload ?? !state.showLog };
    case 'SET_LOG_FILTER':
      return { ...state, logFilter: action.payload };

    // 备份
    case 'BACKUPS_LOAD_START':
      return { ...state, backupsLoading: true };
    case 'BACKUPS_LOAD_SUCCESS':
      return { ...state, backupsLoading: false, backups: action.payload };

    // 审计日志
    case 'AUDIT_LOAD_START':
      return { ...state, auditLoading: true };
    case 'AUDIT_LOAD_SUCCESS':
      return {
        ...state,
        auditLoading: false,
        auditLogs: action.payload.entries,
        auditQuery: { ...state.auditQuery, page: action.payload.page, pageSize: action.payload.pageSize },
      };
    case 'AUDIT_STATS_SUCCESS':
      return { ...state, auditStats: action.payload };
    case 'AUDIT_QUERY_CHANGE':
      return { ...state, auditQuery: { ...state.auditQuery, ...action.payload } };

    // 维护窗口
    case 'MAINTENANCE_WINDOW_LOAD_START':
      return { ...state, maintenanceWindowLoading: true };
    case 'MAINTENANCE_WINDOW_LOAD_SUCCESS':
      return { ...state, maintenanceWindowLoading: false, maintenanceWindow: action.payload };

    default:
      return state;
  }
}

// Context
const UpdaterContext = createContext<{
  state: UpdaterState;
  dispatch: React.Dispatch<UpdaterAction>;
  // 便捷方法
  checkUpdate: (channel?: string) => Promise<void>;
  startUpdate: (method: UpdateMethod, options?: UpdateOptions) => Promise<void>;
  cancelUpdate: () => Promise<boolean>;
  loadSettings: () => Promise<void>;
  saveSettings: (settings: Partial<UpdaterSettings>) => Promise<void>;
  loadBackups: () => Promise<void>;
  rollback: (backupId: string) => Promise<void>;
  loadAuditLogs: (query?: Partial<UpdaterState['auditQuery']>) => Promise<void>;
  loadAuditStats: () => Promise<void>;
  loadMaintenanceWindow: () => Promise<void>;
  sendTestNotification: () => Promise<NotificationResult>;
} | null>(null);

// Admin API helper
async function adminFetch(input: string, init?: RequestInit) {
  const response = await fetch(input, { ...init, credentials: 'same-origin' });
  if (response.status === 401) {
    throw new Error('登录已失效，请刷新页面重新登录。');
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '请求失败' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response;
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(updaterReducer, initialState);

  // 检查更新
  const checkUpdate = useCallback(async (channel?: string) => {
    dispatch({ type: 'CHECK_START' });
    try {
      const url = channel ? `/api/admin/updater/check?channel=${channel}` : '/api/admin/updater/check';
      const response = await adminFetch(url);
      const result = await response.json() as UpdateCheckResult;
      dispatch({ type: 'CHECK_SUCCESS', payload: result });
    } catch (error: any) {
      dispatch({ type: 'CHECK_ERROR', payload: error.message });
    }
  }, []);

  // 启动更新
  const startUpdate = useCallback(async (method: UpdateMethod, options?: UpdateOptions) => {
    const jobId = crypto.randomUUID();
    const job: UpdateJob = {
      id: jobId,
      method,
      state: 'running',
      startedAt: Date.now(),
      log: [],
      channel: state.settings?.channel || 'stable',
      options,
    };
    dispatch({ type: 'JOB_START', payload: { job, method } });

    try {
      const response = await adminFetch(`/api/admin/updater/update-${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options || {}),
      });
      const { job: serverJob } = await response.json() as { job: UpdateJob };
      
      // 轮询任务状态
      const pollJob = async (currentJobId: string) => {
        try {
          const statusRes = await adminFetch('/api/admin/updater/status');
          const { job: statusJob } = await statusRes.json() as { job: UpdateJob | null };
          if (!statusJob || statusJob.id !== currentJobId) return;
          
          dispatch({ type: 'JOB_PROGRESS', payload: { log: '', phase: statusJob.state === 'running' ? 'execute' : undefined } });
          
          if (statusJob.state === 'running') {
            setTimeout(() => pollJob(currentJobId), 1500);
          } else if (statusJob.state === 'succeeded') {
            dispatch({ type: 'JOB_SUCCESS', payload: statusJob.result! });
          } else if (statusJob.state === 'cancelled') {
            dispatch({ type: 'JOB_ERROR', payload: statusJob.error || '更新任务已取消' });
          } else {
            dispatch({ type: 'JOB_ERROR', payload: statusJob.error || '更新失败' });
          }
        } catch (e) {
          // 忽略轮询错误
        }
      };
      
      await pollJob(serverJob.id);
    } catch (error: any) {
      dispatch({ type: 'JOB_ERROR', payload: error.message });
    }
  }, [state.settings?.channel]);

  // 取消更新
  const cancelUpdate = useCallback(async (): Promise<boolean> => {
    try {
      const response = await adminFetch('/api/admin/updater/cancel', { method: 'POST' });
      const data = await response.json() as { success: boolean };
      if (data.success) {
        dispatch({ type: 'JOB_ERROR', payload: '更新任务已取消' });
        return true;
      }
      alert('没有正在运行的更新任务');
      return false;
    } catch (error: any) {
      alert(`取消失败: ${error.message}`);
      return false;
    }
  }, []);

  // 加载设置
  const loadSettings = useCallback(async () => {
    dispatch({ type: 'SETTINGS_LOAD_START' });
    try {
      const response = await adminFetch('/api/admin/updater/settings');
      const { settings } = await response.json() as { settings: UpdaterSettings };
      dispatch({ type: 'SETTINGS_LOAD_SUCCESS', payload: settings });
    } catch (error: any) {
      dispatch({ type: 'SETTINGS_LOAD_ERROR', payload: error.message });
    }
  }, []);

  // 保存设置
  const saveSettings = useCallback(async (settings: Partial<UpdaterSettings>) => {
    dispatch({ type: 'SETTINGS_LOAD_START' });
    try {
      const response = await adminFetch('/api/admin/updater/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const { settings: savedSettings } = await response.json() as { settings: UpdaterSettings };
      dispatch({ type: 'SETTINGS_LOAD_SUCCESS', payload: savedSettings });
    } catch (error: any) {
      dispatch({ type: 'SETTINGS_LOAD_ERROR', payload: error.message });
    }
  }, []);

  // 加载备份列表
  const loadBackups = useCallback(async () => {
    dispatch({ type: 'BACKUPS_LOAD_START' });
    try {
      const response = await adminFetch('/api/admin/updater/backups');
      const { backups } = await response.json() as { backups: BackupInfo[] };
      dispatch({ type: 'BACKUPS_LOAD_SUCCESS', payload: backups });
    } catch {
      dispatch({ type: 'BACKUPS_LOAD_SUCCESS', payload: [] });
    }
  }, []);

  // 回滚
  const rollback = useCallback(async (backupId: string) => {
    try {
      const response = await adminFetch('/api/admin/updater/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupId }),
      });
      await response.json();
      // 重新加载状态
      await loadBackups();
      await checkUpdate();
    } catch (error: any) {
      alert(`回滚失败: ${error.message}`);
    }
  }, [loadBackups, checkUpdate]);

  // 加载审计日志
  const loadAuditLogs = useCallback(async (query?: Partial<UpdaterState['auditQuery']>) => {
    dispatch({ type: 'AUDIT_LOAD_START' });
    if (query) dispatch({ type: 'AUDIT_QUERY_CHANGE', payload: query });
    
    const params = new URLSearchParams();
    const q = { ...state.auditQuery, ...query };
    Object.entries(q).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, String(value));
      }
    });
    
    try {
      const response = await adminFetch(`/api/admin/updater/audit-log?${params}`);
      const data = await response.json() as AuditLogResponse;
      dispatch({ type: 'AUDIT_LOAD_SUCCESS', payload: data });
    } catch {
      dispatch({ type: 'AUDIT_LOAD_SUCCESS', payload: { entries: [], totalCount: 0, page: 1, pageSize: 20 } });
    }
  }, [state.auditQuery]);

  // 加载审计统计
  const loadAuditStats = useCallback(async () => {
    try {
      const response = await adminFetch('/api/admin/updater/audit-stats');
      const stats = await response.json() as AuditStats;
      dispatch({ type: 'AUDIT_STATS_SUCCESS', payload: stats });
    } catch {
      // 忽略
    }
  }, []);

  // 加载维护窗口状态
  const loadMaintenanceWindow = useCallback(async () => {
    dispatch({ type: 'MAINTENANCE_WINDOW_LOAD_START' });
    try {
      const response = await adminFetch('/api/admin/updater/maintenance-window');
      const data = await response.json() as MaintenanceWindowStatus;
      dispatch({ type: 'MAINTENANCE_WINDOW_LOAD_SUCCESS', payload: data });
    } catch {
      dispatch({ type: 'MAINTENANCE_WINDOW_LOAD_SUCCESS', payload: null });
    }
  }, []);

  // 发送测试通知
  const sendTestNotification = useCallback(async (): Promise<NotificationResult> => {
    try {
      const response = await adminFetch('/api/admin/updater/test-notification', {
        method: 'POST',
      });
      return await response.json() as NotificationResult;
    } catch (error: any) {
      return { console: false, email: false, webhook: false };
    }
  }, []);

  // 初始化加载
  useEffect(() => {
    loadSettings();
    loadMaintenanceWindow();
    checkUpdate();
    loadAuditStats();
  }, [loadSettings, loadMaintenanceWindow, checkUpdate, loadAuditStats]);

  const value = {
    state,
    dispatch,
    checkUpdate,
    startUpdate,
    cancelUpdate,
    loadSettings,
    saveSettings,
    loadBackups,
    rollback,
    loadAuditLogs,
    loadAuditStats,
    loadMaintenanceWindow,
    sendTestNotification,
  };

  return <UpdaterContext.Provider value={value}>{children}</UpdaterContext.Provider>;
}

export function useUpdater() {
  const context = useContext(UpdaterContext);
  if (!context) {
    throw new Error('useUpdater must be used within an UpdateProvider');
  }
  return context;
}