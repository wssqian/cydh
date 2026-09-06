/**
 * 更新前预检模块
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { PreflightResult, PreflightCheck, UpdaterSettings, UpdateMethod } from './types.js';
import { isWithinMaintenanceWindow } from './scheduler.js';

function getProjectRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith('/dist') || cwd.endsWith('\\dist')) {
    return path.dirname(cwd);
  }
  return cwd;
}

function checkDiskSpace(minBytes: number = 500 * 1024 * 1024): PreflightCheck {
  try {
    const root = getProjectRoot();
    const output = execSync(`df -k "${root}"`, { encoding: 'utf-8', timeout: 5000 });
    const lines = output.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      const availableKb = parseInt(parts[3], 10);
      const availableBytes = availableKb * 1024;
      
      if (availableBytes >= minBytes) {
        return {
          name: 'disk_space',
          passed: true,
          message: `可用磁盘空间: ${(availableBytes / 1024 / 1024).toFixed(0)} MB`,
          severity: 'info',
        };
      }
      return {
        name: 'disk_space',
        passed: false,
        message: `磁盘空间不足: 可用 ${(availableBytes / 1024 / 1024).toFixed(0)} MB，需要 ${(minBytes / 1024 / 1024).toFixed(0)} MB`,
        severity: 'error',
      };
    }
  } catch {
    try {
      execSync(`powershell -Command "Get-PSDrive ${path.parse(getProjectRoot()).root.replace(':', '')} | Select-Object Free"`, { encoding: 'utf-8', timeout: 5000 });
    } catch {
      return {
        name: 'disk_space',
        passed: true,
        message: '无法检查磁盘空间（跳过）',
        severity: 'warning',
      };
    }
  }
  return {
    name: 'disk_space',
    passed: true,
    message: '磁盘空间检查跳过',
    severity: 'info',
  };
}

function checkGitRepo(method: UpdateMethod): PreflightCheck {
  if (method === 'release') {
    return {
      name: 'git_repo',
      passed: true,
      message: '发布包更新不需要 Git 仓库',
      severity: 'info',
    };
  }

  const root = getProjectRoot();
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: root, timeout: 5000, stdio: 'pipe' });
    return {
      name: 'git_repo',
      passed: true,
      message: 'Git 仓库有效',
      severity: 'info',
    };
  } catch {
    return {
      name: 'git_repo',
      passed: false,
      message: '当前目录不是 Git 仓库，无法进行源码更新',
      severity: 'error',
    };
  }
}

function checkGitRemote(method: UpdateMethod): PreflightCheck {
  if (method === 'release') {
    return {
      name: 'git_remote',
      passed: true,
      message: '发布包更新不需要 Git 远程仓库',
      severity: 'info',
    };
  }

  const root = getProjectRoot();
  try {
    execSync('git remote -v', { cwd: root, timeout: 5000, stdio: 'pipe' });
    return {
      name: 'git_remote',
      passed: true,
      message: 'Git 远程仓库已配置',
      severity: 'info',
    };
  } catch {
    return {
      name: 'git_remote',
      passed: false,
      message: '未配置 Git 远程仓库，请先运行 git remote add origin <url>',
      severity: 'error',
    };
  }
}

function checkGitWorktree(method: UpdateMethod): PreflightCheck {
  if (method === 'release') {
    return {
      name: 'git_worktree',
      passed: true,
      message: '发布包更新不检查工作区状态',
      severity: 'info',
    };
  }

  const root = getProjectRoot();
  try {
    const status = execSync('git status --porcelain', { cwd: root, timeout: 5000, encoding: 'utf-8' }).trim();
    if (status) {
      return {
        name: 'git_worktree',
        passed: true,
        message: `工作区有未提交更改，将自动 stash: ${status.split('\n').length} 个文件`,
        severity: 'warning',
      };
    }
    return {
      name: 'git_worktree',
      passed: true,
      message: '工作区干净',
      severity: 'info',
    };
  } catch {
    return {
      name: 'git_worktree',
      passed: false,
      message: '无法检查 Git 工作区状态',
      severity: 'error',
    };
  }
}

function checkConflictingJobs(): PreflightCheck {
  return {
    name: 'conflicting_jobs',
    passed: true,
    message: '无冲突任务（由任务队列管理并发）',
    severity: 'info',
  };
}

function checkMaintenanceWindow(settings: UpdaterSettings, isAuto: boolean): PreflightCheck {
  if (!isAuto) {
    return {
      name: 'maintenance_window',
      passed: true,
      message: '手动更新不受维护窗口限制',
      severity: 'info',
    };
  }

  const { maintenance_window } = settings;
  if (maintenance_window.start_hour === null || maintenance_window.end_hour === null) {
    return {
      name: 'maintenance_window',
      passed: true,
      message: '未配置维护窗口，允许随时更新',
      severity: 'info',
    };
  }

  const within = isWithinMaintenanceWindow(
    maintenance_window.start_hour,
    maintenance_window.end_hour,
    maintenance_window.timezone
  );

  if (within) {
    return {
      name: 'maintenance_window',
      passed: true,
      message: `当前处于维护窗口内 (${maintenance_window.start_hour}:00-${maintenance_window.end_hour}:00 ${maintenance_window.timezone})`,
      severity: 'info',
    };
  }

  return {
    name: 'maintenance_window',
    passed: false,
    message: `当前不在维护窗口内 (${maintenance_window.start_hour}:00-${maintenance_window.end_hour}:00 ${maintenance_window.timezone})，自动更新将延迟`,
    severity: 'error',
  };
}

function checkDependencies(): PreflightCheck {
  const root = getProjectRoot();
  const pkgPath = path.join(root, 'package.json');
  
  if (!fs.existsSync(pkgPath)) {
    return {
      name: 'dependencies',
      passed: false,
      message: 'package.json 不存在',
      severity: 'error',
    };
  }

  try {
    const modulesPath = path.join(root, 'node_modules');
    if (!fs.existsSync(modulesPath)) {
      return {
        name: 'dependencies',
        passed: true,
        message: 'node_modules 不存在，将在更新时安装',
        severity: 'warning',
      };
    }
    return {
      name: 'dependencies',
      passed: true,
      message: '依赖目录存在',
      severity: 'info',
    };
  } catch {
    return {
      name: 'dependencies',
      passed: true,
      message: '依赖检查跳过',
      severity: 'warning',
    };
  }
}

export async function runPreflightChecks(
  method: UpdateMethod,
  settings: UpdaterSettings,
  isAuto: boolean = false
): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];

  checks.push(checkDiskSpace());
  checks.push(checkGitRepo(method));
  checks.push(checkGitRemote(method));
  checks.push(checkGitWorktree(method));
  checks.push(checkConflictingJobs());
  checks.push(checkMaintenanceWindow(settings, isAuto));
  checks.push(checkDependencies());

  const hasError = checks.some(c => !c.passed && c.severity === 'error');
  const hasWarning = checks.some(c => !c.passed && c.severity === 'warning');

  return {
    success: !hasError,
    checks,
    error: hasError ? '预检失败，存在阻塞性错误' : (hasWarning ? '预检通过但有警告' : undefined),
  };
}