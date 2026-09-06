/**
 * 源码更新执行模块
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { UpdateJob, UpdateJobResult, UpdateMethod } from './types.js';

const EXEC_TIMEOUT_MS = 120_000;
const RESTART_DELAY_MS = 2000;

function getProjectRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith('/dist') || cwd.endsWith('\\dist')) {
    return path.dirname(cwd);
  }
  return cwd;
}

export function readPackageVersion(): string {
  try {
    const pkgPath = path.join(getProjectRoot(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function exec(command: string, options: { cwd?: string; timeout?: number; log?: string[] } = {}): string {
  const root = options.cwd ?? getProjectRoot();
  const timeout = options.timeout ?? EXEC_TIMEOUT_MS;
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

function scheduleRestart(job: UpdateJob) {
  job.log.push(`[系统] ${RESTART_DELAY_MS / 1000} 秒后重启服务...`);
  setTimeout(() => {
    job.log.push('[系统] 正在重启...');
    process.exit(0);
  }, RESTART_DELAY_MS);
}

export async function executeSourceUpdate(job: UpdateJob): Promise<UpdateJobResult> {
  const root = getProjectRoot();
  const log = job.log;
  const previousVersion = readPackageVersion();
  
  log.push(`[信息] 当前版本: ${previousVersion}`);

  // 1. 检查 git 状态
  if (!fs.existsSync(path.join(root, '.git'))) {
    throw new Error('项目目录不是 Git 仓库，无法使用源码更新');
  }

  try {
    execSync('git remote -v', { cwd: root, timeout: 5000, stdio: 'pipe' });
  } catch {
    throw new Error('未配置 Git 远程仓库，请先运行 git remote add origin <url>');
  }

  // 2. 检查工作区是否干净
  const status = exec('git status --porcelain', { cwd: root, log });
  if (status) {
    log.push('[警告] 工作区有未提交的更改，将尝试 stash');
    exec('git stash push -m \'auto-stash before update\'', { cwd: root, log });
  }

  // 3. 拉取最新代码
  log.push('[步骤 1/4] 拉取最新代码...');
  exec('git fetch --all --tags', { cwd: root, log });
  exec('git pull --ff-only origin $(git rev-parse --abbrev-ref HEAD)', { cwd: root, log });

  // 4. 安装依赖
  log.push('[步骤 2/4] 安装依赖...');
  exec('npm install --production=false', { cwd: root, log, timeout: 180_000 });

  // 5. 构建
  log.push('[步骤 3/4] 构建项目...');
  exec('npm run build', { cwd: root, log, timeout: 180_000 });

  // 6. 裁剪开发依赖（生产环境）
  if (process.env.NODE_ENV === 'production') {
    log.push('[步骤 4/4] 裁剪开发依赖...');
    exec('npm prune --omit=dev', { cwd: root, log });
  } else {
    log.push('[步骤 4/4] 跳过裁剪（开发环境）');
  }

  const newVersion = readPackageVersion();
  log.push(`[完成] 更新成功！新版本: ${newVersion}`);

  const result: UpdateJobResult = {
    method: 'source',
    previousVersion,
    newVersion,
    steps: ['git fetch/pull', 'npm install', 'npm run build', 'npm prune'],
    restartScheduled: true,
  };

  scheduleRestart(job);
  return result;
}