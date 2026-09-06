/**
 * 发布包更新执行模块（含签名验证）
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { UpdateJob, UpdateJobResult, GitHubRelease } from './types.js';
import { findDistAsset, findSignatureAsset, verifyAssetSignature, computeFileSHA256 } from './github.js';

const EXEC_TIMEOUT_MS = 120_000;
const DOWNLOAD_TIMEOUT_MS = 300_000;
const RESTART_DELAY_MS = 2000;

function getProjectRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith('/dist') || cwd.endsWith('\\dist')) {
    return path.dirname(cwd);
  }
  return cwd;
}

function readPackageVersion(): string {
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

async function downloadFile(url: string, destPath: string, log: string[]): Promise<void> {
  const { pipeline } = await import('node:stream/promises');
  const { createWriteStream } = await import('node:fs');

  const response = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    headers: {
      'User-Agent': 'guga-updater',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`下载失败: HTTP ${response.status}`);
  }

  if (!response.body) {
    throw new Error('下载响应为空');
  }

  log.push(`[信息] 开始下载: ${url}`);
  await pipeline(response.body as any, createWriteStream(destPath));
  log.push('[信息] 下载完成');
}

function scheduleRestart(job: UpdateJob) {
  job.log.push(`[系统] ${RESTART_DELAY_MS / 1000} 秒后重启服务...`);
  setTimeout(() => {
    job.log.push('[系统] 正在重启...');
    process.exit(0);
  }, RESTART_DELAY_MS);
}

export async function executeReleaseUpdate(
  job: UpdateJob,
  release: GitHubRelease,
  publicKey: string | null,
  allowUnsignedDev: boolean,
  skipSignatureVerification: boolean = false
): Promise<UpdateJobResult> {
  const root = getProjectRoot();
  const log = job.log;
  const tmpDir = path.join(root, '.updater-tmp');
  const previousVersion = readPackageVersion();
  
  log.push(`[信息] 当前版本: ${previousVersion}`);
  log.push(`[信息] 目标版本: ${release.tag_name}`);

  // 1. 寻找 dist 资源
  const asset = findDistAsset(release);
  if (!asset) {
    throw new Error(
      `Release ${release.tag_name} 中未找到 dist 包资源。` +
      `请在 Release 中上传 dist.tar.gz 或 dist.zip，或使用源码更新。`
    );
  }

  // 2. 查找签名文件
  const signatureAsset = findSignatureAsset(release, asset.name);
  
  // 3. 下载
  log.push(`[步骤 1/5] 下载 ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)...`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const downloadPath = path.join(tmpDir, asset.name);
  await downloadFile(asset.browser_download_url, downloadPath, log);

  // 4. 签名验证
  if (!skipSignatureVerification && publicKey) {
    log.push('[步骤 2/5] 验证签名...');
    const signatureValid = await verifyAssetSignature(publicKey, downloadPath, signatureAsset);
    if (!signatureValid) {
      throw new Error('签名验证失败：文件可能被篡改或签名不匹配');
    }
    log.push('[信息] Ed25519 签名验证通过');
  } else if (!skipSignatureVerification && !publicKey) {
    // 无公钥时尝试 SHA256 校验（从 release body 解析）
    log.push('[警告] 未配置公钥，跳过签名验证，尝试 SHA256 校验...');
    const sha256 = await computeFileSHA256(downloadPath);
    log.push(`[信息] 文件 SHA256: ${sha256}`);
    // TODO: 从 release body 解析预期 SHA256 并比较
  } else {
    log.push('[警告] 跳过签名验证（开发模式或强制跳过）');
  }

  // 5. 解压到临时目录
  log.push('[步骤 3/5] 解压并部署...');
  const extractDir = path.join(tmpDir, 'extract');
  fs.mkdirSync(extractDir, { recursive: true });

  if (asset.name.endsWith('.tar.gz') || asset.name.endsWith('.tgz')) {
    exec(`tar -xzf "${downloadPath}" -C "${extractDir}"`, { cwd: root, log, timeout: 60_000 });
  } else if (asset.name.endsWith('.zip')) {
    exec(`unzip -o "${downloadPath}" -d "${extractDir}"`, { cwd: root, log, timeout: 60_000 });
  }

  // 6. 确定 dist 目录位置
  const distSourceDir = fs.existsSync(path.join(extractDir, 'dist'))
    ? path.join(extractDir, 'dist')
    : extractDir;

  const distTargetDir = path.join(root, 'dist');

  // 7. 备份当前 dist
  if (fs.existsSync(distTargetDir)) {
    const backupDir = path.join(root, `.dist-backup-${Date.now()}`);
    fs.cpSync(distTargetDir, backupDir, { recursive: true });
    log.push(`[信息] 已备份当前 dist 到 ${path.basename(backupDir)}`);
    fs.rmSync(distTargetDir, { recursive: true, force: true });
  }

  // 8. 部署新 dist
  fs.cpSync(distSourceDir, distTargetDir, { recursive: true });
  log.push('[信息] dist 目录已更新');

  // 9. 更新 package.json 版本号（如果 release 中包含）
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

  // 10. 更新 server.cjs（如果 release 中包含）
  const serverSource = path.join(extractDir, 'server.cjs');
  if (fs.existsSync(serverSource)) {
    fs.copyFileSync(serverSource, path.join(distTargetDir, 'server.cjs'));
    log.push('[信息] server.cjs 已更新');
  }

  // 11. 同步安装生产依赖（如果 release 中包含 package.json）
  if (fs.existsSync(pkgSource)) {
    log.push('[步骤 4/5] 同步生产依赖...');
    exec('npm install --omit=dev', { cwd: root, log, timeout: 180_000 });
  } else {
    log.push('[步骤 4/5] 跳过依赖安装（release 中无 package.json）');
  }

  // 12. 清理临时文件
  log.push('[步骤 5/5] 清理临时文件...');
  try {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch {
    log.push('[警告] 临时文件清理失败，请手动清理');
  }

  const newVersion = readPackageVersion();
  log.push(`[完成] 更新成功！新版本: ${newVersion}`);

  const result: UpdateJobResult = {
    method: 'release',
    previousVersion,
    newVersion,
    steps: ['fetch release', 'download', 'verify signature', 'extract & deploy', 'npm install'],
    restartScheduled: true,
  };

  scheduleRestart(job);
  return result;
}