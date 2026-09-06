/**
 * 前端更新系统类型定义
 */

export type UpdateChannel = 'stable' | 'beta' | 'nightly';
export type UpdateMethod = 'source' | 'release';
export type JobState = 'running' | 'succeeded' | 'failed' | 'cancelled';
export type PipelinePhase = 'preflight' | 'execute' | 'health' | 'commit' | 'complete';

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  latestTag: string | null;
  releaseUrl: string | null;
  releaseBody: string | null;
  publishedAt: string | null;
  hasUpdate: boolean;
  hasGitRemote: boolean;
  hasRelease: boolean;
  channel: UpdateChannel;
  checkedAt: string;
}

export interface UpdateJobResult {
  method: UpdateMethod;
  previousVersion: string;
  newVersion: string | null;
  steps: string[];
  restartScheduled: boolean;
}

export interface UpdateJob {
  id: string;
  method: UpdateMethod;
  state: JobState;
  startedAt: number;
  completedAt?: number;
  result?: UpdateJobResult;
  error?: string;
  log: string[];
  channel: UpdateChannel;
  options?: UpdateOptions;
  cancelledAt?: number;
}

export interface UpdateOptions {
  skipPreflight?: boolean;
  skipHealthCheck?: boolean;
  skipSignatureVerification?: boolean;
  force?: boolean;
}

export interface PreflightResult {
  success: boolean;
  checks: PreflightCheck[];
  error?: string;
}

export interface PreflightCheck {
  name: string;
  passed: boolean;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface HealthCheckResult {
  success: boolean;
  checks: HealthCheck[];
  error?: string;
}

export interface HealthCheck {
  name: string;
  passed: boolean;
  message: string;
  durationMs: number;
  details?: Record<string, unknown>;
}

export interface UpdaterSettings {
  auto_check_enabled: boolean;
  check_interval_hours: number;
  channel: UpdateChannel;
  maintenance_window: {
    start_hour: number | null;
    end_hour: number | null;
    timezone: string;
  };
  signature: {
    public_key: string | null;
    allow_unsigned_dev: boolean;
  };
  notifications: {
    email_enabled: boolean;
    email_recipients: string[];
    webhook_url: string | null;
    webhook_secret: string | null;
    events: string[];
  };
}

export interface BackupInfo {
  id: string;
  timestamp: string;
  previousVersion: string;
  method: UpdateMethod;
  files: string[];
  size: number;
}

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  event: string;
  method?: UpdateMethod;
  channel?: UpdateChannel;
  previousVersion?: string;
  targetVersion?: string;
  actualVersion?: string;
  durationMs?: number;
  success: boolean;
  errorMessage?: string;
  metadata?: string;
  triggeredBy: 'manual' | 'auto' | 'scheduled';
}

export interface AuditLogQuery {
  event?: string;
  channel?: UpdateChannel;
  method?: UpdateMethod;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditLogResponse {
  entries: AuditLogEntry[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface AuditStats {
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsByChannel: Record<string, number>;
  successRate: number;
  lastEvent: AuditLogEntry | null;
}

export interface NotificationResult {
  console: boolean;
  email: boolean;
  webhook: boolean;
}

export interface MaintenanceWindowStatus {
  window: {
    start_hour: number | null;
    end_hour: number | null;
    timezone: string;
  };
  isInWindow: boolean;
  nextWindowStart: string | null;
}

export interface PipelinePhaseInfo {
  phase: PipelinePhase;
  label: string;
  icon: string;
  completed: boolean;
  current: boolean;
  failed: boolean;
}