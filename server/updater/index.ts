/**
 * 更新系统主入口 - 统一导出所有公共 API
 * 保持与原有 API 向后兼容
 */

import type Database from 'better-sqlite3';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readPackageVersion } from './source-update.js';
import type { UpdateJob as NewUpdateJob } from './types.js';

// 类型导出（新模块类型）
export type {
  UpdateCheckResult as NewUpdateCheckResult,
  UpdateJobResult as NewUpdateJobResult,
  UpdaterSettings as NewUpdaterSettings,
  UpdateJob as NewUpdateJob,
  UpdateOptions,
  PreflightResult,
  PreflightCheck,
  HealthCheckResult,
  HealthCheck,
  BackupInfo,
  AuditLogEntry,
  AuditLogQuery,
  AuditLogResponse,
  NotificationPayload,
  UpdateChannel,
  UpdateMethod,
  JobState,
  AuditEvent,
  MaintenanceWindow,
  SignatureConfig,
  GitHubRelease,
  GitHubTag,
} from './types.js';

// 核心模块导出
export { readUpdaterConfig, saveUpdaterConfig, getDefaultSettings } from './config.js';
export { fetchLatestRelease, fetchTags, fetchReleaseAsset, findDistAsset, findSignatureAsset, verifyAssetSignature, computeFileSHA256, downloadFile } from './github.js';
export { normalizeVersion, parseVersion, isValidVersion, compareVersions, isNewerVersion, filterReleasesByChannel, getLatestVersionFromReleases, getLatestVersionFromTags, getChannelDisplayName, getChannelDescription, getAllChannels } from './version.js';
export { runPreflightChecks } from './preflight.js';
export { runHealthChecks } from './health.js';
export { executeSourceUpdate } from './source-update.js';
export { executeReleaseUpdate } from './release-update.js';
export { readPackageVersion } from './source-update.js';
export { createBackup, rollback, listBackups, verifyBackup } from './rollback.js';
export { recordAudit, queryAuditLog, getAuditLogStats, cleanupOldAuditLogs } from './audit.js';
export { sendUpdateNotification, sendTestNotification } from './notifications.js';
export { isWithinMaintenanceWindow, getNextMaintenanceWindowStart, startAutoCheckCron, stopAutoCheckCron, restartAutoCheckCron, checkAndNotifyUpdates } from './scheduler.js';

// 兼容性类型（原有 API）
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
  checkedAt: string;
}

export interface UpdateJobResult {
  method: 'source' | 'release';
  previousVersion: string;
  newVersion: string | null;
  steps: string[];
  restartScheduled: boolean;
}

export interface UpdaterSettings {
  auto_check_enabled: boolean;
  check_interval_hours: number;
}

export interface UpdateJob {
  id: string;
  method: 'source' | 'release';
  state: 'running' | 'succeeded' | 'failed' | 'cancelled';
  startedAt: number;
  completedAt?: number;
  result?: UpdateJobResult;
  error?: string;
  log: string[];
  channel?: 'stable' | 'beta' | 'nightly';
  options?: { channel?: 'stable' | 'beta' | 'nightly'; skipPreflight?: boolean; skipHealthCheck?: boolean; skipSignatureVerification?: boolean; force?: boolean };
  cancelledAt?: number;
}

interface CancellationController {
  cancelled: boolean;
  cancel: () => void;
}

// 内部状态
let currentJob: UpdateJob | undefined;
let lastStartedAt: number | undefined;
let activeCancellation: CancellationController | undefined;
const JOB_COOLDOWN_MS = 60_000;
const JOB_TIMEOUT_MS = 30 * 60_000; // 整体流水线超时：30 分钟

function getProjectRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith('/dist') || cwd.endsWith('\\dist')) {
    return path.dirname(cwd);
  }
  return cwd;
}

function hasGitRemote(): boolean {
  try {
    const root = getProjectRoot();
    execSync('git remote -v', { cwd: root, timeout: 5000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function isGitRepo(): boolean {
  try {
    const root = getProjectRoot();
    execSync('git rev-parse --is-inside-work-tree', { cwd: root, timeout: 5000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function exec(command: string, options: { cwd?: string; timeout?: number; log?: string[] } = {}): string {
  const root = options.cwd ?? getProjectRoot();
  const timeout = options.timeout ?? 120_000;
  const log = options.log;

  log?.push(`$ ${command}`);
  try {
    const output = execSync(command, {
      cwd: root,
      timeout,
      stdio: 'pipe',
      encoding: 'utf-8',
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=512' },
    }).trim();
    if (output) log?.push(output);
    return output;
  } catch (error: any) {
    const stderr = error.stderr?.toString?.() || error.message;
    log?.push(`ERROR: ${stderr}`);
    throw new Error(`Command failed: ${command}\n${stderr}`);
  }
}

function startJob(method: 'source' | 'release'): UpdateJob {
  if (currentJob?.state === 'running') {
    throw new Error('更新任务正在运行中，请稍候');
  }
  if (lastStartedAt && Date.now() - lastStartedAt < JOB_COOLDOWN_MS) {
    throw new Error('更新操作过于频繁，请稍后再试');
  }

  const job: UpdateJob = {
    id: randomUUID(),
    method,
    state: 'running',
    startedAt: Date.now(),
    log: [],
  };
  currentJob = job;
  lastStartedAt = Date.now();
  return job;
}

function completeJob(job: UpdateJob, result: UpdateJobResult) {
  if (currentJob?.id !== job.id) return;
  currentJob = { ...job, state: 'succeeded', completedAt: Date.now(), result };
}

function failJob(job: UpdateJob, error: string) {
  if (currentJob?.id !== job.id) return;
  currentJob = { ...job, state: 'failed', completedAt: Date.now(), error };
}

function cancelJob(job: UpdateJob) {
  if (currentJob?.id !== job.id) return;
  currentJob = { ...job, state: 'cancelled', completedAt: Date.now(), cancelledAt: Date.now() };
}

export function getUpdateJobStatus(): UpdateJob | null {
  return currentJob || null;
}

/**
 * 请求取消当前运行中的更新任务。
 * 当前步骤完成后流水线会停止；若执行阶段已开始，会触发回滚。
 */
export function cancelUpdateJob(): { success: boolean; job?: UpdateJob; error?: string } {
  if (!currentJob || currentJob.state !== 'running') {
    return { success: false, error: '没有正在运行的更新任务' };
  }

  activeCancellation?.cancel();
  currentJob.log.push('[系统] 收到取消请求，当前步骤完成后停止');
  return { success: true, job: currentJob };
}

function scheduleRestart(job: UpdateJob) {
  job.log.push('[系统] 2 秒后重启服务...');
  setTimeout(() => {
    job.log.push('[系统] 正在重启...');
    process.exit(0);
  }, 2000);
}

// 向后兼容的 checkForUpdates
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const { fetchLatestRelease, fetchTags } = await import('./github.js');
  const { compareVersions } = await import('./version.js');
  const currentVersion = readPackageVersion();
  
  let latestRelease: any = null;
  let latestTag: string | null = null;
  
  try {
    latestRelease = await fetchLatestRelease('stable');
  } catch {}
  
  if (!latestRelease) {
    try {
      const tags = await fetchTags();
      if (tags && tags.length > 0) latestTag = tags[0].name;
    } catch {}
  }
  
  const latestVersion = latestRelease?.tag_name || latestTag;
  const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;
  
  return {
    currentVersion,
    latestVersion: latestVersion || null,
    latestTag: latestRelease?.tag_name || latestTag || null,
    releaseUrl: latestRelease?.html_url || null,
    releaseBody: latestRelease?.body || null,
    publishedAt: latestRelease?.published_at || null,
    hasUpdate,
    hasGitRemote: isGitRepo() && hasGitRemote(),
    hasRelease: !!latestRelease,
    checkedAt: new Date().toISOString(),
  };
}

// 向后兼容的 startSourceUpdate
export function startSourceUpdate(): UpdateJob {
  const job = startJob('source');
  const root = getProjectRoot();
  const log = job.log;
  const previousVersion = readPackageVersion();
  
  log.push(`[信息] 当前版本: ${previousVersion}`);

  void (async () => {
    try {
      if (!isGitRepo()) throw new Error('项目目录不是 Git 仓库，无法使用源码更新');
      if (!hasGitRemote()) throw new Error('未配置 Git 远程仓库');

      const status = exec('git status --porcelain', { cwd: root, log });
      if (status) {
        log.push('[警告] 工作区有未提交的更改，将尝试 stash');
        exec('git stash push -m \'auto-stash before update\'', { cwd: root, log });
      }

      log.push('[步骤 1/4] 拉取最新代码...');
      exec('git fetch --all --tags', { cwd: root, log });
      exec('git pull --ff-only origin $(git rev-parse --abbrev-ref HEAD)', { cwd: root, log });

      log.push('[步骤 2/4] 安装依赖...');
      exec('npm install --production=false', { cwd: root, log, timeout: 180_000 });

      log.push('[步骤 3/4] 构建项目...');
      exec('npm run build', { cwd: root, log, timeout: 180_000 });

      if (process.env.NODE_ENV === 'production') {
        log.push('[步骤 4/4] 裁剪开发依赖...');
        exec('npm prune --omit=dev', { cwd: root, log });
      } else {
        log.push('[步骤 4/4] 跳过裁剪（开发环境）');
      }

      const newVersion = readPackageVersion();
      log.push(`[完成] 更新成功！新版本: ${newVersion}`);

      completeJob(job, {
        method: 'source',
        previousVersion,
        newVersion,
        steps: ['git fetch/pull', 'npm install', 'npm run build', 'npm prune'],
        restartScheduled: true,
      });

      scheduleRestart(job);
    } catch (error: any) {
      log.push(`[失败] ${error.message}`);
      failJob(job, error.message);
    }
  })();

  return job;
}

// 向后兼容的 startReleaseUpdate
export function startReleaseUpdate(): UpdateJob {
  const job = startJob('release');
  const root = getProjectRoot();
  const log = job.log;
  const tmpDir = path.join(root, '.updater-tmp');
  const previousVersion = readPackageVersion();
  
  log.push(`[信息] 当前版本: ${previousVersion}`);

  void (async () => {
    try {
      const { fetchLatestRelease, findDistAsset, downloadFile } = await import('./github.js');
      
      log.push('[步骤 1/4] 获取最新版本信息...');
      const release = await fetchLatestRelease('stable');
      if (!release) throw new Error('未找到 GitHub Release');
      log.push(`[信息] 最新版本: ${release.tag_name}`);

      const asset = findDistAsset(release);
      if (!asset) throw new Error(`Release ${release.tag_name} 中未找到 dist 包资源`);

      log.push(`[步骤 2/4] 下载 ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)...`);
      fs.mkdirSync(tmpDir, { recursive: true });
      const downloadPath = path.join(tmpDir, asset.name);
      await downloadFile(asset.browser_download_url, downloadPath);
      log.push('[信息] 下载完成');

      log.push('[步骤 3/4] 解压并部署...');
      const extractDir = path.join(tmpDir, 'extract');
      fs.mkdirSync(extractDir, { recursive: true });

      if (asset.name.endsWith('.tar.gz') || asset.name.endsWith('.tgz')) {
        exec(`tar -xzf "${downloadPath}" -C "${extractDir}"`, { cwd: root, log, timeout: 60_000 });
      } else if (asset.name.endsWith('.zip')) {
        exec(`unzip -o "${downloadPath}" -d "${extractDir}"`, { cwd: root, log, timeout: 60_000 });
      }

      const distSourceDir = fs.existsSync(path.join(extractDir, 'dist'))
        ? path.join(extractDir, 'dist')
        : extractDir;
      const distTargetDir = path.join(root, 'dist');

      if (fs.existsSync(distTargetDir)) {
        const backupDir = path.join(root, `.dist-backup-${Date.now()}`);
        fs.cpSync(distTargetDir, backupDir, { recursive: true });
        log.push(`[信息] 已备份当前 dist 到 ${path.basename(backupDir)}`);
        fs.rmSync(distTargetDir, { recursive: true, force: true });
      }

      fs.cpSync(distSourceDir, distTargetDir, { recursive: true });
      log.push('[信息] dist 目录已更新');

      const pkgSource = path.join(extractDir, 'package.json');
      if (fs.existsSync(pkgSource)) {
        try {
          const newPkg = JSON.parse(fs.readFileSync(pkgSource, 'utf-8'));
          const currentPkgPath = path.join(root, 'package.json');
          const currentPkg = JSON.parse(fs.readFileSync(currentPkgPath, 'utf-8'));
          if (newPkg.version && newPkg.version !== currentPkg.version) {
            currentPkg.version = newPkg.version;
            fs.writeFileSync(currentPkgPath, JSON.stringify(currentPkg, null, 2) + '\n');
            log.push(`[信息] 版本号已更新: ${currentPkg.version} → ${newPkg.version}`);
          }
        } catch {
          log.push('[警告] 无法更新 package.json 版本号');
        }
      }

      const serverSource = path.join(extractDir, 'server.cjs');
      if (fs.existsSync(serverSource)) {
        fs.copyFileSync(serverSource, path.join(distTargetDir, 'server.cjs'));
        log.push('[信息] server.cjs 已更新');
      }

      if (fs.existsSync(pkgSource)) {
        log.push('[步骤 4/4] 同步生产依赖...');
        exec('npm install --omit=dev', { cwd: root, log, timeout: 180_000 });
      }

      const newVersion = readPackageVersion();
      log.push(`[完成] 更新成功！新版本: ${newVersion}`);

      completeJob(job, {
        method: 'release',
        previousVersion,
        newVersion,
        steps: ['fetch release', 'download', 'extract & deploy', 'npm install'],
        restartScheduled: true,
      });

      scheduleRestart(job);
    } catch (error: any) {
      log.push(`[失败] ${error.message}`);
      failJob(job, error.message);
    } finally {
      try {
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  })();

  return job;
}

// 设置管理（向后兼容）
export function readUpdaterSettings(database: Database.Database): UpdaterSettings {
  const rows = database
    .prepare('SELECT key, value FROM settings WHERE key IN (?, ?)')
    .all('updater_auto_check_enabled', 'updater_check_interval_hours') as Array<{ key: string; value: string }>;
  
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    auto_check_enabled: map.get('updater_auto_check_enabled') === 'true',
    check_interval_hours: Math.max(1, Number(map.get('updater_check_interval_hours')) || 24),
  };
}

export function saveUpdaterSettings(database: Database.Database, settings: Partial<UpdaterSettings>) {
  const stmt = database.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const tx = database.transaction(() => {
    if (settings.auto_check_enabled !== undefined) {
      stmt.run('updater_auto_check_enabled', settings.auto_check_enabled ? 'true' : 'false');
    }
    if (settings.check_interval_hours !== undefined) {
      const hours = Math.max(1, Math.min(168, Math.round(settings.check_interval_hours)));
      stmt.run('updater_check_interval_hours', String(hours));
    }
  });
  tx();
}

let lastCheckResult: UpdateCheckResult | null = null;

// 任务状态持久化
const JOB_STATE_DB_KEY = 'updater_job_state';

function saveJobState(database: Database.Database, job: NewUpdateJob): void {
  const stmt = database.prepare('INSERT INTO updater_job_state (id, method, state, started_at, completed_at, result, error, log, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state, completed_at=excluded.completed_at, result=excluded.result, error=excluded.error, log=excluded.log, updated_at=excluded.updated_at');
  stmt.run(
    job.id,
    job.method,
    job.state,
    job.startedAt,
    job.completedAt || null,
    job.result ? JSON.stringify(job.result) : null,
    job.error || null,
    JSON.stringify(job.log),
    Date.now()
  );
}

function loadJobState(database: Database.Database): NewUpdateJob | null {
  const row = database.prepare('SELECT * FROM updater_job_state WHERE state = ? ORDER BY updated_at DESC LIMIT 1').get('running') as
    | { id: string; method: string; state: string; started_at: number; completed_at: number | null; result: string | null; error: string | null; log: string; updated_at: number }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    method: row.method as 'source' | 'release',
    state: row.state as 'running' | 'succeeded' | 'failed',
    startedAt: row.started_at,
    completedAt: row.completed_at || undefined,
    result: row.result ? JSON.parse(row.result) : undefined,
    error: row.error || undefined,
    log: JSON.parse(row.log),
    channel: 'stable',
    options: {},
  };
}

function clearJobState(database: Database.Database, jobId: string): void {
  database.prepare('DELETE FROM updater_job_state WHERE id = ?').run(jobId);
}

// 核心更新流水线
export async function executeUpdatePipeline(
  database: Database.Database,
  method: 'source' | 'release',
  options: { channel?: 'stable' | 'beta' | 'nightly'; skipPreflight?: boolean; skipHealthCheck?: boolean; skipSignatureVerification?: boolean; force?: boolean } = {}
): Promise<UpdateJob> {
  const { runPreflightChecks } = await import('./preflight.js');
  const { runHealthChecks } = await import('./health.js');
  const { executeSourceUpdate } = await import('./source-update.js');
  const { executeReleaseUpdate } = await import('./release-update.js');
  const { createBackup } = await import('./rollback.js');
  const { recordAudit } = await import('./audit.js');
  const { sendUpdateNotification } = await import('./notifications.js');
  const { readUpdaterConfig } = await import('./config.js');
  const { fetchLatestRelease } = await import('./github.js');
  const { isWithinMaintenanceWindow } = await import('./scheduler.js');

  const settings = readUpdaterConfig(database);
  const channel = options.channel || settings.channel;
  // executeUpdatePipeline 当前仅由手动 API 端点（update-source/update-release）触发，
  // 手动更新不受维护窗口限制，因此 isAuto 恒为 false。
  // 自动更新的调度由 scheduler 的 checkAndNotifyUpdates 负责（仅检查+通知，不在此执行更新）。
  const isAuto = false;

  // 创建任务
  const job = startJob(method);
  job.channel = channel;
  job.options = options;

  // 设置取消控制器与整体超时
  let cancelled = false;
  const cancellation: CancellationController = {
    cancelled: false,
    cancel() {
      this.cancelled = true;
      cancelled = true;
    },
  };
  activeCancellation = cancellation;
  const timeoutHandle = setTimeout(() => {
    if (currentJob?.id === job.id && currentJob.state === 'running') {
      job.log.push(`[系统] 更新流水线超时（超过 ${JOB_TIMEOUT_MS / 60_000} 分钟），取消任务`);
      cancellation.cancel();
    }
  }, JOB_TIMEOUT_MS);
  timeoutHandle.unref?.();

  // 记录审计：更新开始
  await recordAudit(database, {
    timestamp: new Date().toISOString(),
    event: 'update_start',
    method,
    channel,
    targetVersion: undefined,
    triggeredBy: isAuto ? 'scheduled' : 'manual',
    success: true,
  });

  // 发送开始通知
  await sendUpdateNotification(settings, {
    event: 'update_started',
    timestamp: new Date().toISOString(),
    channel,
    method,
    jobId: job.id,
  });

  // 持久化任务状态
  saveJobState(database, job as NewUpdateJob);

  void (async () => {
    const startTime = Date.now();
    let targetVersion: string | undefined;
    let backupId: string | undefined;
    let previousVersion: string | undefined;

    try {
      // ========== 阶段 1: 预检 ==========
      if (!options.skipPreflight) {
        job.log.push('[阶段 1/4] 预检检查...');
        const preflight = await runPreflightChecks(method, settings, isAuto);
        for (const check of preflight.checks) {
          job.log.push(`  ${check.passed ? '✓' : '✗'} ${check.name}: ${check.message}`);
        }
        if (!preflight.success) {
          throw new Error(preflight.error || '预检失败');
        }
        job.log.push('[阶段 1/4] 预检通过');
      } else {
        job.log.push('[阶段 1/4] 跳过预检');
      }

      // 记录预检审计
      await recordAudit(database, {
        timestamp: new Date().toISOString(),
        event: 'preflight',
        method,
        channel,
        success: true,
        metadata: JSON.stringify({ skipped: options.skipPreflight }),
        triggeredBy: isAuto ? 'scheduled' : 'manual',
      });

      if (cancelled) throw new Error('更新任务已取消');

      // ========== 阶段 2: 执行更新 ==========
      job.log.push('[阶段 2/4] 执行更新...');

      // 创建备份
      previousVersion = readPackageVersion();
      const backup = await createBackup(method, previousVersion);
      backupId = backup.id;
      job.log.push(`[信息] 已创建备份: ${backupId}`);

      let result: UpdateJobResult;
      if (method === 'source') {
        result = await executeSourceUpdate(job as NewUpdateJob);
      } else {
        // 发布包更新需要获取 release 信息
        const release = await fetchLatestRelease(channel);
        if (!release) throw new Error(`未找到 ${channel} 通道的 Release`);
        targetVersion = release.tag_name;
        result = await executeReleaseUpdate(job as NewUpdateJob, release, settings.signature.public_key, settings.signature.allow_unsigned_dev, options.skipSignatureVerification);
      }

      targetVersion = result.newVersion || targetVersion;
      job.log.push('[阶段 2/4] 更新执行完成');

      if (cancelled) throw new Error('更新任务已取消');

      // ========== 阶段 3: 健康检查 ==========
      if (!options.skipHealthCheck) {
        job.log.push('[阶段 3/4] 健康检查...');
        const baseUrl = `http://localhost:${process.env.PORT || '3123'}`;
        const health = await runHealthChecks(baseUrl, targetVersion || previousVersion || '', method);
        for (const check of health.checks) {
          job.log.push(`  ${check.passed ? '✓' : '✗'} ${check.name}: ${check.message} (${check.durationMs}ms)`);
        }
        if (!health.success) {
          throw new Error(health.error || '健康检查失败');
        }
        job.log.push('[阶段 3/4] 健康检查通过');
      } else {
        job.log.push('[阶段 3/4] 跳过健康检查');
      }

      // 记录健康检查审计
      await recordAudit(database, {
        timestamp: new Date().toISOString(),
        event: 'health_check',
        method,
        channel,
        success: true,
        metadata: JSON.stringify({ skipped: options.skipHealthCheck }),        triggeredBy: isAuto ? 'scheduled' : 'manual',
      });

      if (cancelled) throw new Error('更新任务已取消');

      // ========== 阶段 4: 确认完成 ==========
      job.log.push('[阶段 4/4] 确认更新完成...');

      const durationMs = Date.now() - startTime;

      // 记录成功审计
      await recordAudit(database, {
        timestamp: new Date().toISOString(),
        event: 'update_success',
        method,
        channel,
        previousVersion,
        actualVersion: targetVersion,
        durationMs,
        success: true,
        metadata: JSON.stringify({ backupId, steps: result.steps }),
        triggeredBy: isAuto ? 'scheduled' : 'manual',
      });

      // 发送成功通知
      await sendUpdateNotification(settings, {
        event: 'update_succeeded',
        timestamp: new Date().toISOString(),
        channel,
        method,
        version: { previous: previousVersion || '', current: targetVersion || '' },
        jobId: job.id,
        details: { durationMs, backupId },
      });

      completeJob(job, result);
      saveJobState(database, job as NewUpdateJob);
      clearJobState(database, job.id);
      activeCancellation = undefined;
      clearTimeout(timeoutHandle);

    } catch (error: any) {
      const durationMs = Date.now() - startTime;

      // ========== 取消处理 ==========
      if (cancelled) {
        job.log.push('[取消] 更新任务已取消');

        // 若执行阶段已开始（已创建备份），回滚到更新前
        if (backupId) {
          job.log.push('[回滚] 取消前执行已开始，尝试回滚...');
          const { rollback } = await import('./rollback.js');
          const rbResult = await rollback(backupId);
          if (rbResult.success) {
            job.log.push(`[回滚] 回滚成功，恢复版本: ${rbResult.restoredVersion}`);
            await recordAudit(database, {
              timestamp: new Date().toISOString(),
              event: 'rollback_success',
              method,
              channel,
              previousVersion,
              actualVersion: rbResult.restoredVersion,
              durationMs,
              success: true,
              metadata: JSON.stringify({ backupId, reason: 'cancelled' }),
              triggeredBy: isAuto ? 'scheduled' : 'manual',
            });
          } else {
            job.log.push(`[回滚] 回滚失败: ${rbResult.error}`);
            await recordAudit(database, {
              timestamp: new Date().toISOString(),
              event: 'rollback_failed',
              method,
              channel,
              previousVersion,
              durationMs,
              success: false,
              errorMessage: rbResult.error,
              metadata: JSON.stringify({ backupId, reason: 'cancelled' }),
              triggeredBy: isAuto ? 'scheduled' : 'manual',
            });
          }
        }

        cancelJob(job);
        saveJobState(database, job as NewUpdateJob);
        clearJobState(database, job.id);
        activeCancellation = undefined;
        clearTimeout(timeoutHandle);
        return;
      }

      job.log.push(`[失败] ${error.message}`);

      // 尝试自动回滚
      if (backupId) {
        job.log.push('[回滚] 尝试自动回滚...');
        const { rollback } = await import('./rollback.js');
        const rbResult = await rollback(backupId);
        if (rbResult.success) {
          job.log.push(`[回滚] 回滚成功，恢复版本: ${rbResult.restoredVersion}`);
          
          await recordAudit(database, {
            timestamp: new Date().toISOString(),
            event: 'rollback_success',
            method,
            channel,
            previousVersion,
            actualVersion: rbResult.restoredVersion,
            durationMs,
            success: true,
            metadata: JSON.stringify({ backupId, reason: error.message }),
            triggeredBy: isAuto ? 'scheduled' : 'manual',
          });

          await sendUpdateNotification(settings, {
            event: 'rollback_triggered',
            timestamp: new Date().toISOString(),
            channel,
            method,
            error: error.message,
            jobId: job.id,
            details: { backupId, restoredVersion: rbResult.restoredVersion },
          });
        } else {
          job.log.push(`[回滚] 回滚失败: ${rbResult.error}`);
          
          await recordAudit(database, {
            timestamp: new Date().toISOString(),
            event: 'rollback_failed',
            method,
            channel,
            previousVersion,
            durationMs,
            success: false,
            errorMessage: rbResult.error,
            metadata: JSON.stringify({ backupId, originalError: error.message }),
            triggeredBy: isAuto ? 'scheduled' : 'manual',
          });
        }
      }

      // 记录失败审计
      await recordAudit(database, {
        timestamp: new Date().toISOString(),
        event: 'update_failed',
        method,
        channel,
        previousVersion,
        targetVersion,
        durationMs,
        success: false,
        errorMessage: error.message,
        metadata: JSON.stringify({ backupId }),
        triggeredBy: isAuto ? 'scheduled' : 'manual',
      });

      // 发送失败通知
      await sendUpdateNotification(settings, {
        event: 'update_failed',
        timestamp: new Date().toISOString(),
        channel,
        method,
        error: error.message,
        jobId: job.id,
        details: { durationMs, backupId },
      });

      failJob(job, error.message);
      saveJobState(database, job as NewUpdateJob);
      activeCancellation = undefined;
      clearTimeout(timeoutHandle);
    }
  })();

  return job;
}

// 启动时恢复运行中的任务
export function recoverRunningJobs(database: Database.Database): void {
  const job = loadJobState(database);
  if (job) {
    job.log.push('[恢复] 检测到上次更新未完成，标记为失败');
    job.state = 'failed';
    job.error = 'Server restarted during update';
    job.completedAt = Date.now();
    currentJob = job;
    
    // 记录崩溃恢复审计（动态导入避免循环依赖）
    import('./audit.js').then(({ recordAudit }) => {
      recordAudit(database, {
      timestamp: new Date().toISOString(),
      event: 'update_failed',
      method: job.method,
      channel: job.channel,
      success: false,
      errorMessage: 'Server restarted during update',
      metadata: JSON.stringify({ crashRecovery: true, jobId: job.id }),
      triggeredBy: 'scheduled',
    });
    });
  }
}

export function getLastCheckResult(): UpdateCheckResult | null {
  return lastCheckResult;
}