/**
 * 回滚机制模块
 */

import fs from 'node:fs';
import path from 'node:path';
import type { BackupInfo, UpdateMethod } from './types.js';

const MAX_BACKUPS = 3;
const BACKUP_DIR_NAME = '.updater-backups';

function getProjectRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith('/dist') || cwd.endsWith('\\dist')) {
    return path.dirname(cwd);
  }
  return cwd;
}

function getBackupRoot(): string {
  return path.join(getProjectRoot(), BACKUP_DIR_NAME);
}

function getBackupPath(backupId: string): string {
  return path.join(getBackupRoot(), backupId);
}

export function createBackupId(method: UpdateMethod): string {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  return `${timestamp}-${method}`;
}

export async function createBackup(
  method: UpdateMethod,
  previousVersion: string
): Promise<BackupInfo> {
  const root = getProjectRoot();
  const backupId = createBackupId(method);
  const backupPath = getBackupPath(backupId);
  
  fs.mkdirSync(backupPath, { recursive: true });
  
  const filesToBackup: string[] = [];
  const files: string[] = [];
  
  if (method === 'source') {
    files.push('package.json', 'package-lock.json');
    if (fs.existsSync(path.join(root, 'dist'))) {
      files.push('dist');
    }
    if (fs.existsSync(path.join(root, 'server.ts'))) {
      files.push('server.ts');
    } else if (fs.existsSync(path.join(root, 'server.cjs'))) {
      files.push('server.cjs');
    }
  } else {
    // release update
    if (fs.existsSync(path.join(root, 'dist'))) {
      files.push('dist');
    }
    files.push('package.json');
    if (fs.existsSync(path.join(root, 'server.cjs'))) {
      files.push('server.cjs');
    }
  }
  
  // 复制文件到备份目录
  for (const file of files) {
    const src = path.join(root, file);
    const dest = path.join(backupPath, file);
    
    if (fs.existsSync(src)) {
      if (fs.statSync(src).isDirectory()) {
        fs.cpSync(src, dest, { recursive: true });
      } else {
        fs.copyFileSync(src, dest);
      }
      filesToBackup.push(file);
    }
  }
  
  // 计算备份大小
  let totalSize = 0;
  function calcSize(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        calcSize(fullPath);
      } else {
        totalSize += fs.statSync(fullPath).size;
      }
    }
  }
  calcSize(backupPath);
  
  // 创建清单
  const manifest = {
    id: backupId,
    timestamp: new Date().toISOString(),
    previousVersion,
    method,
    files: filesToBackup,
    size: totalSize,
  };
  
  fs.writeFileSync(path.join(backupPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
  
  // 清理旧备份
  await cleanupOldBackups();
  
  return {
    id: backupId,
    timestamp: manifest.timestamp,
    previousVersion,
    method,
    files: filesToBackup,
    size: totalSize,
  };
}

async function cleanupOldBackups(): Promise<void> {
  const backupRoot = getBackupRoot();
  if (!fs.existsSync(backupRoot)) return;
  
  const entries = fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({
      name: e.name,
      path: path.join(backupRoot, e.name),
      time: fs.statSync(path.join(backupRoot, e.name)).mtime.getTime(),
    }))
    .sort((a, b) => b.time - a.time); // 最新在前
  
  // 保留最新的 MAX_BACKUPS 个
  for (let i = MAX_BACKUPS; i < entries.length; i++) {
    try {
      fs.rmSync(entries[i].path, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  }
}

export async function rollback(backupId: string): Promise<{ success: boolean; restoredVersion: string; error?: string }> {
  const root = getProjectRoot();
  const backupPath = getBackupPath(backupId);
  
  if (!fs.existsSync(backupPath)) {
    return { success: false, restoredVersion: '', error: `备份不存在: ${backupId}` };
  }
  
  // 读取清单
  const manifestPath = path.join(backupPath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { success: false, restoredVersion: '', error: '备份清单不存在' };
  }
  
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as BackupInfo;
  
  try {
    // 恢复文件
    for (const file of manifest.files) {
      const src = path.join(backupPath, file);
      const dest = path.join(root, file);
      
      if (!fs.existsSync(src)) continue;
      
      // 删除目标（如果存在）
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
      
      // 复制回去
      if (fs.statSync(src).isDirectory()) {
        fs.cpSync(src, dest, { recursive: true });
      } else {
        fs.copyFileSync(src, dest);
      }
    }
    
    // 验证恢复的版本
    let restoredVersion = manifest.previousVersion;
    try {
      const pkgPath = path.join(root, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        restoredVersion = pkg.version || manifest.previousVersion;
      }
    } catch {
      // 忽略版本读取错误
    }
    
    return { success: true, restoredVersion };
  } catch (error: any) {
    return { success: false, restoredVersion: '', error: error.message };
  }
}

export async function listBackups(): Promise<BackupInfo[]> {
  const backupRoot = getBackupRoot();
  if (!fs.existsSync(backupRoot)) return [];
  
  const entries = fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => {
      const backupPath = path.join(backupRoot, e.name);
      const manifestPath = path.join(backupPath, 'manifest.json');
      if (!fs.existsSync(manifestPath)) return null;
      try {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as BackupInfo;
      } catch {
        return null;
      }
    })
    .filter((b): b is BackupInfo => b !== null)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  
  return entries;
}

export async function verifyBackup(backupId: string): Promise<boolean> {
  const backupPath = getBackupPath(backupId);
  const manifestPath = path.join(backupPath, 'manifest.json');
  
  if (!fs.existsSync(manifestPath)) return false;
  
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as BackupInfo;
    // 检查所有文件是否存在
    for (const file of manifest.files) {
      if (!fs.existsSync(path.join(backupPath, file))) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}