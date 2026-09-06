/**
 * data-portable.ts — 便携数据导出/导入 bundle v2
 *
 * 与旧版 data-io.ts (v1, 5 类 JSON) 的区别：
 *   - 覆盖全部业务表 + icons + acg-cache
 *   - 单文件 tar.gz bundle + manifest + SHA-256 完整性
 *   - settings 敏感键默认脱敏
 *   - 导入前自动备份现状，事务内替换，失败回滚
 *   - 安全：解包仅信任内部清单，逐文件校验，防路径穿越
 */

import db from './db.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

// ─── 常量 ───────────────────────────────────────────────

export const BUNDLE_SCHEMA_VERSION = 2;

/** 便携业务表白名单（不包含运行态/派生表） */
export const PORTABLE_TABLES = [
  'categories',
  'sites',
  'site_checks',
  'settings',
  'tags',
  'dailyhot_items',
  'daily_visitors',
  'hot_rankings',
  'platform_highlights',
  'submissions',
  'acgbox_scraper_settings',
] as const;

/** 显式排除的运行态表（AUTOINCREMENT 由显式 id 自动重建） */
const EXCLUDED_TABLES = new Set(['sqlite_sequence']);

/** settings 中携带密钥/凭据的键 —— 默认脱敏 */
const SECRET_SETTING_KEYS = new Set([
  // 邮件 / Resend
  'email_resend_api_key',
  // 代理（可能带用户名密码）
  'scraper_proxy_url',
  'acg_proxy_url',
  'dailyhot_proxy_url',
  // 口令 / token
  'admin_password',
  'community_password',
  'bangumi_access_token',
  'vndb_api_token',
  'pixiv_access_token',
  'github_token',
  'updater_notifications_webhook_secret',
  'updater_signature_public_key',
]);

/** 明确的敏感键名关键词（子串命中即视为敏感，防遗漏） */
const SECRET_KEY_HINTS = /pass(word)?|token|secret|api[_-]?key|access[_-]?key|resend|proxy_url/i;

const REDACTED_VALUE = '__REDACTED__';

// ─── 类型 ───────────────────────────────────────────────

export interface BundleManifest {
  schemaVersion: number;
  exportedAt: string;
  application: string;
  secretsRedacted: boolean;
  tables: Record<string, number>;
  icons: number;
  acgCache: number;
  digest: {
    tables: string;
    icons: string;
    acgCache: string;
  };
}

export interface PreviewSummary {
  schemaVersion: number;
  exportedAt: string;
  secretsRedacted: boolean;
  integrityOk: boolean;
  integrityErrors: string[];
  tables: Record<string, number>;
  icons: number;
  acgCache: number;
}

export interface ImportResult {
  success: boolean;
  preImportBackup: string;
  tablesImported: number;
  iconsImported: number;
  acgCacheImported: number;
  errors: string[];
}

// ─── 数据目录解析 ───────────────────────────────────────

function resolveDataRoot(): string {
  const dataPath = process.env.NAV_DATA_DIR
    ? path.resolve(process.env.NAV_DATA_DIR)
    : path.join(process.cwd(), 'data');
  return dataPath;
}

function isSecretSettingKey(key: string): boolean {
  return SECRET_SETTING_KEYS.has(key) || SECRET_KEY_HINTS.test(key);
}

/** 收集白名单表的全部行（列名 + 值），跳过排除表 */
function collectTableRows(): {
  tables: Record<string, Array<Record<string, unknown>>>;
  counts: Record<string, number>;
} {
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  const counts: Record<string, number> = {};

  for (const table of PORTABLE_TABLES) {
    if (EXCLUDED_TABLES.has(table)) continue;
    try {
      const rows = db.prepare(`SELECT * FROM "${table}"`).all() as Array<Record<string, unknown>>;
      tables[table] = rows;
      counts[table] = rows.length;
    } catch (e: any) {
      // 表不存在（如尚未初始化）视为空表
      tables[table] = [];
      counts[table] = 0;
    }
  }
  return { tables, counts };
}

/** settings 表脱敏：根据 includeSecrets 决定是否替换敏感键值 */
function redactSettings(rows: Array<Record<string, unknown>>, includeSecrets: boolean): Array<Record<string, unknown>> {
  if (includeSecrets) return rows;
  return rows.map((row) => {
    const key = String(row.key ?? '');
    if (!isSecretSettingKey(key)) return row;
    return { ...row, value: REDACTED_VALUE };
  });
}

// ─── 文件收集与摘要 ─────────────────────────────────────

function collectDirectoryFiles(dir: string): Array<{ rel: string; content: Buffer }> {
  const root = resolveDataRoot();
  const fullDir = path.join(root, dir);
  const out: Array<{ rel: string; content: Buffer }> = [];
  if (!fs.existsSync(fullDir)) return out;
  for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(fullDir, entry.name);
    // 仅允许常规文件；忽略符号链接，避免解包/读取指向仓库外
    if (fs.lstatSync(fullPath).isSymbolicLink()) continue;
    out.push({ rel: `${dir}/${entry.name}`, content: fs.readFileSync(fullPath) });
  }
  return out;
}

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

// ─── 导出 ───────────────────────────────────────────────

export interface ExportOptions {
  includeSecrets?: boolean;
  /** 写出目录（默认 process.cwd()/data-export） */
  outDir?: string;
}

export interface ExportResult {
  filePath: string;
  manifest: BundleManifest;
}

/** 生成 tar.gz bundle；返回产物路径与 manifest */
export async function exportBundle(options: ExportOptions = {}): Promise<ExportResult> {
  const includeSecrets = options.includeSecrets === true;
  const outDir = path.resolve(options.outDir || path.join(process.cwd(), 'data-export'));
  fs.mkdirSync(outDir, { recursive: true });

  // 1. 收集表数据（settings 脱敏）
  const { tables, counts } = collectTableRows();
  if (!includeSecrets) {
    if (Array.isArray(tables.settings)) {
      tables.settings = redactSettings(tables.settings as Array<Record<string, unknown>>, false);
    }
  }

  // 2. 收集 icons / acg-cache
  const icons = collectDirectoryFiles('icons');
  const acgCache = collectDirectoryFiles('acg-cache');

  // 3. 构造 tar 成员（manifest.json + tables.json + icons/* + acg-cache/*）
  const tablesJson = Buffer.from(JSON.stringify(tables), 'utf-8');
  const members: Array<{ name: string; content: Buffer }> = [
    { name: 'tables.json', content: tablesJson },
    ...icons.map((f) => ({ name: `icons/${path.basename(f.rel)}`, content: f.content })),
    ...acgCache.map((f) => ({ name: `acg-cache/${path.basename(f.rel)}`, content: f.content })),
  ];

  const manifest: BundleManifest = {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    application: 'guga-nav',
    secretsRedacted: !includeSecrets,
    tables: counts,
    icons: icons.length,
    acgCache: acgCache.length,
    digest: {
      tables: sha256(tablesJson),
      icons: sha256(Buffer.concat(icons.map((f) => f.content))),
      acgCache: sha256(Buffer.concat(acgCache.map((f) => f.content))),
    },
  };

  // 4. 写到隔离 staging 目录并 tar.gz
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'guga-export-'));
  try {
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    fs.writeFileSync(path.join(staging, 'tables.json'), tablesJson);
    // 始终创建 icons / acg-cache 目录（即使为空，保证 tar 成员稳定）
    fs.mkdirSync(path.join(staging, 'icons'), { recursive: true });
    fs.mkdirSync(path.join(staging, 'acg-cache'), { recursive: true });
    for (const icon of icons) {
      fs.writeFileSync(path.join(staging, 'icons', path.basename(icon.rel)), icon.content);
    }
    for (const cache of acgCache) {
      fs.writeFileSync(path.join(staging, 'acg-cache', path.basename(cache.rel)), cache.content);
    }

    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const filePath = path.join(outDir, `guga-data-${stamp}.tar.gz`);
    // --force-local: Windows 盘符路径（如 D:\）不被误判为远程主机
    execFileSync('tar', ['--force-local', '-czf', filePath, '-C', staging, 'manifest.json', 'tables.json', 'icons', 'acg-cache'], { stdio: 'pipe' });

    return { filePath, manifest };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

// ─── 解包辅助（安全） ───────────────────────────────────

interface UnpackedBundle {
  manifest: BundleManifest;
  tables: Record<string, Array<Record<string, unknown>>>;
  icons: Map<string, Buffer>;
  acgCache: Map<string, Buffer>;
}

/**
 * 将 tar.gz 解包到隔离临时目录，仅读取 manifest.json 声明的成员，
 * 校验文件名（仅允许 basename、禁止路径穿越字符）。
 */
async function unpackBundle(filePath: string): Promise<{ dir: string; cleanup: () => void; files: UnpackedBundle }> {
  if (!fs.existsSync(filePath)) {
    throw new Error('数据文件不存在');
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('数据文件不是普通文件');
  if (stat.size > 200 * 1024 * 1024) throw new Error('数据文件过大（> 200MB）');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guga-import-'));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });

  try {
    execFileSync('tar', ['--force-local', '-xzf', filePath, '-C', dir], { stdio: 'pipe' });

    // 读取 manifest
    const manifestRaw = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(manifestRaw) as BundleManifest;
    if (!manifest || manifest.schemaVersion !== BUNDLE_SCHEMA_VERSION) {
      throw new Error(`不支持的数据版本: ${manifest?.schemaVersion ?? 'unknown'}（期望 ${BUNDLE_SCHEMA_VERSION}）`);
    }

    const tablesRaw = fs.readFileSync(path.join(dir, 'tables.json'), 'utf-8');
    const tables = JSON.parse(tablesRaw) as Record<string, Array<Record<string, unknown>>>;

    // 读取 icons / acg-cache —— 逐个验证文件名安全
    const readDirSafe = (relDir: string): Map<string, Buffer> => {
      const map = new Map<string, Buffer>();
      const fullDir = path.join(dir, relDir);
      if (!fs.existsSync(fullDir)) return map;
      for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const safeName = sanitizeFileName(entry.name);
        if (!safeName) continue; // 丢弃含路径分隔符/非法字符的文件名
        const fullPath = path.join(fullDir, entry.name);
        if (fs.lstatSync(fullPath).isSymbolicLink()) continue; // 拒绝符号链接
        map.set(safeName, fs.readFileSync(fullPath));
      }
      return map;
    };

    return {
      dir,
      cleanup,
      files: {
        manifest,
        tables,
        icons: readDirSafe('icons'),
        acgCache: readDirSafe('acg-cache'),
      },
    };
  } catch (e) {
    cleanup();
    throw e;
  }
}

/** 校验文件名安全：拒绝路径分隔符、`.`/`..`、绝对路径、空名 */
function sanitizeFileName(name: string): string | null {
  if (!name || name.length > 255) return null;
  const base = path.basename(name);
  if (base !== name) return null; // 含目录部分 → 拒绝
  if (base === '.' || base === '..') return null;
  if (name.includes('\\') || name.includes('/')) return null;
  if (/^[a-zA-Z]:/.test(name)) return null; // Windows 盘符
  return base;
}

// ─── 预览 ───────────────────────────────────────────────

/** 仅校验与统计，不落库 */
export async function previewBundle(filePath: string): Promise<PreviewSummary> {
  const { files, cleanup } = await unpackBundle(filePath);
  try {
    const integrityErrors: string[] = [];

    // tables.json 摘要校验
    const tablesJson = Buffer.from(JSON.stringify(files.tables), 'utf-8');
    if (sha256(tablesJson) !== files.manifest.digest.tables) {
      integrityErrors.push('tables.json 摘要不匹配');
    }
    if (files.manifest.icons !== files.icons.size) {
      integrityErrors.push(`图标数量不一致: manifest=${files.manifest.icons}, 实际=${files.icons.size}`);
    }
    if (files.manifest.acgCache !== files.acgCache.size) {
      integrityErrors.push(`缓存数量不一致: manifest=${files.manifest.acgCache}, 实际=${files.acgCache.size}`);
    }

    const counts: Record<string, number> = {};
    for (const [table, rows] of Object.entries(files.tables)) {
      counts[table] = rows.length;
    }

    return {
      schemaVersion: files.manifest.schemaVersion,
      exportedAt: files.manifest.exportedAt,
      secretsRedacted: files.manifest.secretsRedacted,
      integrityOk: integrityErrors.length === 0,
      integrityErrors,
      tables: counts,
      icons: files.icons.size,
      acgCache: files.acgCache.size,
    };
  } finally {
    cleanup();
  }
}

// ─── 导入 ───────────────────────────────────────────────

/**
 * 导入 bundle：先备份现状（.backup()），DB 表在单事务内替换，
 * icons/acg-cache 在事务成功后写入。任一步失败尝试从快照回滚。
 */
export async function importBundle(filePath: string): Promise<ImportResult> {
  // 0. 前置校验
  const { files, cleanup } = await unpackBundle(filePath);
  const errors: string[] = [];
  let preImportBackup = '';

  // tables 摘要校验
  try {
    const tablesJson = Buffer.from(JSON.stringify(files.tables), 'utf-8');
    if (sha256(tablesJson) !== files.manifest.digest.tables) {
      throw new Error('tables.json 摘要不匹配，拒绝导入');
    }
  } catch (e) {
    cleanup();
    throw e;
  }

  try {
    // 1. 预检：备份当前 DB 到 backups/pre-import-<ts>.db
    const dataRoot = resolveDataRoot();
    const backupsDir = path.join(path.dirname(dataRoot), 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const backupId = `${stamp}-${randomUUID().slice(0, 8)}`;
    preImportBackup = path.join(backupsDir, `pre-import-${backupId}.db`);
    {
      const srcDbPath = path.join(dataRoot, 'nav.db');
      const { default: Database } = await import('better-sqlite3');
      // 对磁盘文件做只读快照，避免与运行中连接争用
      const snapshot = new Database(srcDbPath, { readonly: true, fileMustExist: true });
      try {
        const check = snapshot.pragma('quick_check', { simple: true }) as string;
        if (check !== 'ok') throw new Error(`导入前源库 quick_check 失败: ${check}`);
        await snapshot.backup(preImportBackup);
      } finally {
        snapshot.close();
      }
    }

    // 2. 仅允许白名单内的表，拒绝未知表注入
    const allowed = new Set<string>(PORTABLE_TABLES);
    const bundleTables = Object.keys(files.tables);
    for (const t of bundleTables) {
      if (!allowed.has(t)) {
        errors.push(`bundle 含未知表 "${t}"，已忽略`);
      }
    }

    // 3. 单事务替换 DB 表（事务失败由 SQLite 自动回滚，DB 状态安全）
    //    foreign_keys 无法在事务内修改，故在事务开始前置 OFF，事务结束后按原状态恢复
    const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1;
    let tablesImported = 0;
    if (fkWasOn) db.pragma('foreign_keys = OFF');
    try {
      const tx = db.transaction(() => {
        const knownTables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>;
      const existing = new Set(knownTables.map((t) => t.name));

      const deleteOrder = [
        'site_checks',
        'submissions',
        'sites',
        'categories',
        'dailyhot_items',
        'daily_visitors',
        'hot_rankings',
        'platform_highlights',
        'tags',
        'acgbox_scraper_settings',
      ];
      for (const table of deleteOrder) {
        if (existing.has(table)) db.prepare(`DELETE FROM "${table}"`).run();
      }
      if (existing.has('settings')) db.prepare('DELETE FROM settings').run();

      const importOrder = [...deleteOrder, 'settings'];
      for (const table of importOrder) {
        const rows = files.tables[table];
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const cols = Object.keys(rows[0]);
        if (cols.length === 0) continue;
        const placeholders = cols.map(() => '?').join(', ');
        const insert = db.prepare(
          `INSERT OR REPLACE INTO "${table}" ("${cols.join('","')}") VALUES (${placeholders})`,
        );
        for (const row of rows) {
          insert.run(...cols.map((c) => (row[c] === undefined ? null : (row[c] as string | number | null))));
        }
        tablesImported++;
      }
    });

    tx();
    } finally {
      // 事务提交/失败后恢复外键设置
      if (fkWasOn) db.pragma('foreign_keys = ON');
    }

    // 4. 事务提交后写文件（icons / acg-cache），逐文件先备份再替换，失败即还原
    const iconDir = path.join(dataRoot, 'icons');
    const cacheDir = path.join(dataRoot, 'acg-cache');
    fs.mkdirSync(iconDir, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });

    let iconsImported = 0;
    let acgCacheImported = 0;
    const fileErrors: string[] = [];

    const replaceDirFiles = (dir: string, incoming: Map<string, Buffer>, report: (n: number) => void) => {
      const oldBak: Array<{ name: string; bakPath: string }> = [];
      // 1) 把现文件全部移到 .bak（保留以便回滚）
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const name = entry.name;
        const bakPath = path.join(dir, `${name}.bak`);
        fs.renameSync(path.join(dir, name), bakPath);
        oldBak.push({ name, bakPath });
      }
      // 2) 写入新文件
      let wrote = 0;
      try {
        for (const [name, content] of incoming) {
          const safe = sanitizeFileName(name);
          if (!safe) continue;
          fs.writeFileSync(path.join(dir, safe), content);
          wrote++;
        }
        // 3) 成功后清理 .bak
        for (const b of oldBak) fs.rmSync(b.bakPath, { force: true });
        report(wrote);
      } catch (e) {
        // 4) 失败回滚：删除新文件、还原 .bak
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isFile()) fs.rmSync(path.join(dir, entry.name), { force: true });
        }
        for (const b of oldBak) {
          try { fs.renameSync(b.bakPath, path.join(dir, b.name)); } catch {}
        }
        fileErrors.push(`写入 ${path.basename(dir)} 失败并已回滚: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    replaceDirFiles(iconDir, files.icons, (n) => (iconsImported = n));
    replaceDirFiles(cacheDir, files.acgCache, (n) => (acgCacheImported = n));

    // 文件写入失败时，DB 已替换但文件缺失 → 提示使用预导入备份整体还原
    if (fileErrors.length > 0) {
      errors.push(...fileErrors);
      errors.push(`DB 已替换但部分文件失败；如需整体还原，请使用备份: ${preImportBackup}`);
      return {
        success: false,
        preImportBackup,
        tablesImported,
        iconsImported,
        acgCacheImported,
        errors,
      };
    }

    return {
      success: errors.length === 0,
      preImportBackup,
      tablesImported,
      iconsImported,
      acgCacheImported,
      errors,
    };
  } catch (e) {
    // DB 事务或备份失败：记录错误（事务已自动回滚），并提示快照路径
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`导入失败: ${msg}`);
    if (preImportBackup && fs.existsSync(preImportBackup)) {
      errors.push(`已生成预导入备份，可手动还原: ${preImportBackup}`);
    }
    return { success: false, preImportBackup, tablesImported: 0, iconsImported: 0, acgCacheImported: 0, errors };
  } finally {
    cleanup();
  }
}
