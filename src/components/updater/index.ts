/**
 * 更新系统组件统一导出
 */

export { UpdateProvider, useUpdater } from './UpdateProvider.js';
export { UpdateStatusCard } from './UpdateStatusCard.js';
export { UpdateChannelSelector } from './UpdateChannelSelector.js';
export { UpdateActions } from './UpdateActions.js';
export { UpdateProgress } from './UpdateProgress.js';
export { UpdateMaintenanceWindow } from './UpdateMaintenanceWindow.js';
export { UpdateSignatureKeys } from './UpdateSignatureKeys.js';
export { UpdateNotificationConfig } from './UpdateNotificationConfig.js';
export { UpdateAuditLog } from './UpdateAuditLog.js';
export { UpdateSettings } from './UpdateSettings.js';

// 类型导出
export type {
  UpdateChannel,
  UpdateMethod,
  JobState,
  PipelinePhase,
  UpdateCheckResult,
  UpdateJob,
  UpdateJobResult,
  UpdaterSettings,
  PreflightResult,
  PreflightCheck,
  HealthCheckResult,
  HealthCheck,
  BackupInfo,
  AuditLogEntry,
  AuditLogResponse,
  AuditStats,
  NotificationResult,
  MaintenanceWindowStatus,
  PipelinePhaseInfo,
} from './types.js';