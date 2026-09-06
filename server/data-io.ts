import db from "./db";
import fs from "node:fs";
import path from "node:path";

// ─── 导出数据结构 ───────────────────────────────────────────

export interface ExportData {
  version: number;
  exportedAt: string;
  summary: {
    categories: number;
    sites: number;
    settings: number;
    dailyhotItems: number;
    acgCacheFiles: number;
  };
  data: {
    categories: unknown[];
    sites: unknown[];
    settings: Array<{ key: string; value: string }>;
    dailyhot_items: unknown[];
    acg_cache: Record<string, unknown>;
  };
}

// ─── ACG 缓存目录 ──────────────────────────────────────────

function acgCacheDir() {
  return path.join(process.cwd(), "data", "acg-cache");
}

// ─── 导出 ──────────────────────────────────────────────────

export function exportAllData(): ExportData {
  // 1. 读取数据库表
  const categories = db.prepare("SELECT * FROM categories ORDER BY id").all();
  const sites = db.prepare("SELECT * FROM sites ORDER BY id").all();
  const settings = db.prepare("SELECT key, value FROM settings ORDER BY key").all() as Array<{ key: string; value: string }>;
  const dailyhot_items = db.prepare("SELECT * FROM dailyhot_items ORDER BY platform, id").all();

  // 2. 读取 ACG 缓存文件
  const cacheDir = acgCacheDir();
  const acgCache: Record<string, unknown> = {};
  let acgCacheFiles = 0;

  if (fs.existsSync(cacheDir)) {
    const files = fs.readdirSync(cacheDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(cacheDir, file), "utf-8");
        acgCache[file] = JSON.parse(content);
        acgCacheFiles++;
      } catch {
        // 跳过无法解析的缓存文件
        acgCache[file] = { _error: "无法读取" };
      }
    }
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    summary: {
      categories: categories.length,
      sites: sites.length,
      settings: settings.length,
      dailyhotItems: dailyhot_items.length,
      acgCacheFiles,
    },
    data: {
      categories,
      sites,
      settings,
      dailyhot_items,
      acg_cache: acgCache,
    },
  };
}

// ─── 导入 ──────────────────────────────────────────────────

export interface ImportResult {
  success: boolean;
  summary: {
    categories: number;
    sites: number;
    settings: number;
    dailyhotItems: number;
    acgCacheFiles: number;
  };
  errors: string[];
}

export function importAllData(exportData: ExportData): ImportResult {
  const errors: string[] = [];

  // 基本校验
  if (!exportData || exportData.version !== 1) {
    throw new Error("无效的导入文件格式或不支持的数据版本。");
  }
  if (!exportData.data) {
    throw new Error("导入文件中缺少 data 字段。");
  }

  const { data } = exportData;

  // 在事务中执行所有数据库操作
  const importTransaction = db.transaction(() => {
    // 清空现有数据（按外键顺序反向删除）
    db.prepare("DELETE FROM site_checks").run();
    db.prepare("DELETE FROM dailyhot_items").run();
    db.prepare("DELETE FROM sites").run();
    db.prepare("DELETE FROM categories").run();
    // settings 保留（后续覆盖）
    // hot_rankings, platform_highlights 也清空
    db.prepare("DELETE FROM hot_rankings").run();
    db.prepare("DELETE FROM platform_highlights").run();

    // 导入 categories
    const insertCategory = db.prepare(`
      INSERT INTO categories (id, name, slug, icon, sort_order, parent_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    let catCount = 0;
    if (Array.isArray(data.categories)) {
      for (const cat of data.categories as Record<string, unknown>[]) {
        try {
          insertCategory.run(
            cat.id ?? null,
            cat.name ?? "",
            cat.slug ?? "",
            cat.icon ?? null,
            cat.sort_order ?? 0,
            cat.parent_id ?? null,
          );
          catCount++;
        } catch (err: unknown) {
          errors.push(`分类导入失败 (${(cat as { name?: string }).name || "unknown"}): ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // 导入 sites
    const insertSite = db.prepare(`
      INSERT INTO sites (id, name, url, description, category_id, tags, icon_url, local_icon_path,
        screenshot_path, status, weight, is_featured, is_hidden, source, created_at, updated_at, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let siteCount = 0;
    if (Array.isArray(data.sites)) {
      for (const site of data.sites as Record<string, unknown>[]) {
        try {
          insertSite.run(
            site.id ?? null,
            site.name ?? "",
            site.url ?? "",
            site.description ?? null,
            site.category_id ?? null,
            site.tags ?? null,
            site.icon_url ?? null,
            site.local_icon_path ?? null,
            site.screenshot_path ?? null,
            site.status ?? "active",
            site.weight ?? 0,
            site.is_featured ?? 0,
            site.is_hidden ?? 0,
            site.source ?? null,
            site.created_at ?? null,
            site.updated_at ?? null,
            site.checked_at ?? null,
          );
          siteCount++;
        } catch (err: unknown) {
          errors.push(`站点导入失败 (${(site as { name?: string }).name || "unknown"}): ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // 导入 settings
    const upsertSetting = db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    );
    let settingCount = 0;
    if (Array.isArray(data.settings)) {
      for (const setting of data.settings as Array<{ key: string; value: string }>) {
        try {
          upsertSetting.run(setting.key, setting.value);
          settingCount++;
        } catch {
          // 跳过无效设置
        }
      }
    }

    // 导入 dailyhot_items
    const insertHot = db.prepare(`
      INSERT OR REPLACE INTO dailyhot_items (id, platform, title, description, cover, author, url, mobile_url, hot, timestamp, scraped_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let hotCount = 0;
    if (Array.isArray(data.dailyhot_items)) {
      for (const item of data.dailyhot_items as Record<string, unknown>[]) {
        try {
          insertHot.run(
            item.id ?? "",
            item.platform ?? "",
            item.title ?? "",
            item.description ?? null,
            item.cover ?? null,
            item.author ?? null,
            item.url ?? "",
            item.mobile_url ?? null,
            item.hot ?? 0,
            item.timestamp ?? null,
            item.scraped_at ?? null,
          );
          hotCount++;
        } catch {
          // 跳过无效热点
        }
      }
    }

    return { categories: catCount, sites: siteCount, settings: settingCount, dailyhotItems: hotCount };
  });

  let summary: { categories: number; sites: number; settings: number; dailyhotItems: number; acgCacheFiles: number };
  try {
    const dbResult = importTransaction();
    summary = { ...dbResult, acgCacheFiles: 0 };
  } catch (err: unknown) {
    throw new Error(`导入数据库失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 写入 ACG 缓存文件（事务外执行）
  let acgCacheFiles = 0;
  const cacheDir = acgCacheDir();
  if (data.acg_cache && typeof data.acg_cache === "object") {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    for (const [filename, content] of Object.entries(data.acg_cache)) {
      if (!filename.endsWith(".json")) continue;
      try {
        fs.writeFileSync(path.join(cacheDir, filename), JSON.stringify(content, null, 2), "utf-8");
        acgCacheFiles++;
      } catch (err: unknown) {
        errors.push(`ACG 缓存文件写入失败 (${filename}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    summary.acgCacheFiles = acgCacheFiles;
  }

  return {
    success: errors.length === 0,
    summary,
    errors,
  };
}
