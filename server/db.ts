import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'node:url';
import { initializeVisitStats } from './visit-stats.js';

// Run updater migrations
function runUpdaterMigrations(database: Database.Database) {
  const migrationsDir = resolveMigrationsDir();
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');
    database.exec(sql);
  }
}

/**
 * 解析 server/migrations/updater 目录。
 * 兼容三种运行形态：tsx/ESM 源文件、dist 打包 CJS（import.meta 为空）、直接 node 运行。
 */
function resolveMigrationsDir(): string {
  const candidates: string[] = [];

  // 1) ESM 源文件形态（tsx）：import.meta.url 指向源码目录
  try {
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      const here = path.dirname(fileURLToPath(import.meta.url));
      candidates.push(path.join(here, 'migrations', 'updater'));
      // server/db.ts -> ../server/.. （若在 server/ 下）
      candidates.push(path.join(here, '..', 'migrations', 'updater'));
    }
  } catch {}

  // 2) CJS bundle 形态（dist/server.cjs）：相对入口定位
  const cwd = process.cwd();
  candidates.push(path.join(cwd, 'server', 'migrations', 'updater'));
  candidates.push(path.join(cwd, 'migrations', 'updater'));
  // 3) 从当前文件目录向上找（CJS __dirname；ESM 下可能未定义，安全访问）
  try {
    // @ts-ignore CJS 特有全局，仅在非 ESM 运行时存在
    if (typeof __dirname !== 'undefined') {
      candidates.push(path.join(__dirname, 'migrations', 'updater'));
      candidates.push(path.join(__dirname, '..', 'server', 'migrations', 'updater'));
    }
  } catch {}

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return candidates[0];
}

const schema = `
  CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      icon TEXT,
      sort_order INTEGER DEFAULT 0,
      parent_id INTEGER,
      FOREIGN KEY (parent_id) REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      description TEXT,
      category_id INTEGER,
      tags TEXT,
      icon_url TEXT,
      local_icon_path TEXT,
      screenshot_path TEXT,
      status TEXT DEFAULT 'active',
      weight INTEGER DEFAULT 0,
      is_featured INTEGER DEFAULT 0,
      is_hidden INTEGER DEFAULT 0,
      source TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      checked_at DATETIME,
      FOREIGN KEY (category_id) REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS site_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL,
      status_code INTEGER,
      final_url TEXT,
      response_time INTEGER,
      error_message TEXT,
      checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (site_id) REFERENCES sites(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS hot_rankings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      category TEXT,
      platform TEXT,
      cover_url TEXT,
      description TEXT,
      play_count TEXT,
      score REAL,
      update_time TEXT,
      rank_position INTEGER,
      hot_score INTEGER DEFAULT 0,
      source_page TEXT,
      scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS platform_highlights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      category TEXT,
      description TEXT,
      hot_value INTEGER,
      cover_url TEXT,
      scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS acgbox_scraper_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dailyhot_items (
      id TEXT NOT NULL,
      platform TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      cover TEXT,
      author TEXT,
      url TEXT NOT NULL,
      mobile_url TEXT,
      hot INTEGER DEFAULT 0,
      timestamp INTEGER,
      scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id, platform)
  );
`;

function resolveDatabasePath() {
  const dataPath = process.env.NAV_DATA_DIR
    ? path.resolve(process.env.NAV_DATA_DIR)
    : path.join(process.cwd(), 'data');
  return path.join(dataPath, 'nav.db');
}

function isCorruptionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /\[DB_CORRUPT\]|database disk image is malformed|file is not a database|not a database|file is encrypted/i.test(message);
}

function assertDatabaseIsHealthy(database: Database.Database) {
  const result = database.pragma('quick_check', { simple: true });
  if (result !== 'ok') {
    throw new Error(`[DB_CORRUPT] SQLite quick_check returned ${String(result)}`);
  }
}

function quarantineCorruptDatabase(databasePath: string) {
  const timestamp = new Date().toISOString().replace(/\D/g, '');
  const backupBase = `${databasePath}.corrupt-${timestamp}`;

  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const source = `${databasePath}${suffix}`;
    if (!fs.existsSync(source)) {
      continue;
    }

    const target = `${backupBase}${suffix}.bak`;
    fs.renameSync(source, target);
  }

  return `${backupBase}.bak`;
}

function openDatabaseWithRecovery(databasePath: string) {
  try {
    const candidate = new Database(databasePath);
    try {
      assertDatabaseIsHealthy(candidate);
      return candidate;
    } catch (error) {
      candidate.close();
      throw error;
    }
  } catch (error) {
    if (!fs.existsSync(databasePath) || !isCorruptionError(error)) {
      throw error;
    }

    const backupPath = quarantineCorruptDatabase(databasePath);
    console.error(`[Database] Corrupt SQLite file moved to ${backupPath}. Initializing a clean database.`);
    return new Database(databasePath);
  }
}

const databasePath = resolveDatabasePath();
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = openDatabaseWithRecovery(databasePath);

// Initialize tables
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.exec(schema);
initializeVisitStats(db);
runUpdaterMigrations(db);

// Index for dailyhot_items window function query (per-platform ordering)
db.exec(`CREATE INDEX IF NOT EXISTS idx_dailyhot_items_platform_hot ON dailyhot_items (platform, hot DESC, scraped_at DESC)`);

// Seed data if empty
const catCount = db.prepare('SELECT COUNT(*) as count FROM categories').get() as { count: number };
if (catCount.count === 0) {
  const insertCat = db.prepare('INSERT INTO categories (name, slug, icon, sort_order) VALUES (?, ?, ?, ?)');

  const animeId = insertCat.run('动漫资源', 'anime', 'Tv', 1).lastInsertRowid;
  const comicId = insertCat.run('漫画资源', 'comic', 'BookOpen', 2).lastInsertRowid;
  const gameId = insertCat.run('游戏资源', 'game', 'Gamepad2', 3).lastInsertRowid;
  const toolId = insertCat.run('工具站点', 'tools', 'Wrench', 4).lastInsertRowid;

  const insertSite = db.prepare(`
    INSERT INTO sites (name, url, description, category_id, tags, is_featured, icon_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertSite.run(
    'Bilibili', 'https://www.bilibili.com', '国内知名的视频弹幕网站，这里有及时的动漫新番。', animeId,
    JSON.stringify(['视频', '二次元', '综合']), 1, 'https://www.bilibili.com/favicon.ico'
  );
  insertSite.run(
    'Bangumi 番组计划', 'https://bgm.tv', '专注于动漫、音乐、游戏作品的评分和条目管理。', animeId,
    JSON.stringify(['资料库', '评分', '动漫']), 1, 'https://bgm.tv/img/favicon.ico'
  );
  insertSite.run(
    'Pixiv', 'https://www.pixiv.net', '著名的插画交流网站，汇聚海量同人图。', comicId,
    JSON.stringify(['插画', '二次元', '同人']), 1, 'https://www.pixiv.net/favicon.ico'
  );
  insertSite.run(
    'Moegirl 萌娘百科', 'https://zh.moegirl.org.cn', '万物皆可萌的百科全书，收录 ACG 相关的条目。', toolId,
    JSON.stringify(['百科', '工具', '资料库']), 1, 'https://zh.moegirl.org.cn/favicon.ico'
  );
  insertSite.run(
    'Steam', 'https://store.steampowered.com', '全球最大的PC游戏数字发行平台。', gameId,
    JSON.stringify(['游戏', '平台']), 0, 'https://store.steampowered.com/favicon.ico'
  );
}

// Seed default ACGBox scraper settings if empty
const acgboxSettingCount = db.prepare('SELECT COUNT(*) as count FROM acgbox_scraper_settings').get() as { count: number };
if (acgboxSettingCount.count === 0) {
  const insertSetting = db.prepare('INSERT OR REPLACE INTO acgbox_scraper_settings (key, value) VALUES (?, ?)');
  insertSetting.run('acgbox_scraper_enabled', 'true');
  insertSetting.run('acgbox_scraper_interval_hours', '1');
  insertSetting.run('acgbox_scraper_proxy_enabled', 'false');
  insertSetting.run('acgbox_scraper_proxy_url', '');
  insertSetting.run('acgbox_scraper_max_concurrent', '2');
  insertSetting.run('acgbox_scraper_timeout_ms', '30000');
  insertSetting.run('acgbox_scraper_retry_count', '3');
}

// Seed default DailyHot settings if empty
const dailyhotSettingCount = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key LIKE 'dailyhot_%'").get() as { count: number };
if (dailyhotSettingCount.count === 0) {
  const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('dailyhot_enabled', 'true');
  insertSetting.run('dailyhot_interval_hours', '1');
}

export default db;
