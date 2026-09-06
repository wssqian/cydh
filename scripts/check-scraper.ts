import 'dotenv/config';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import {
  DEFAULT_SCRAPER_URL,
  buildScraperTargets,
  resolveMaxScraperHtmlBytes,
  probeScraperTargets,
  resolveMinimumResourceCount,
  resolveScraperTimeoutMs,
} from '../server/scraper-source.js';
import { readScraperSettings, resolveScraperProxyUrl } from '../server/scraper-settings.js';

interface Arguments {
  databasePath?: string;
  targetUrl?: string;
  proxyUrl?: string;
}

function parseArguments() {
  const parsed: Arguments = {};
  const args = process.argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--url') {
      parsed.targetUrl = args[index + 1];
      index += 1;
    } else if (option === '--proxy-url') {
      parsed.proxyUrl = args[index + 1];
      index += 1;
    } else if (option === '--database') {
      parsed.databasePath = path.resolve(args[index + 1]);
      index += 1;
    } else {
      throw new Error(`不支持的参数：${option}`);
    }
  }

  return parsed;
}

function defaultDatabasePath() {
  const dataDir = process.env.NAV_DATA_DIR
    ? path.resolve(process.env.NAV_DATA_DIR)
    : path.join(process.cwd(), 'data');
  return path.join(dataDir, 'nav.db');
}

function readConfiguredSettings(databasePath: string) {
  if (!fs.existsSync(databasePath)) {
    return {};
  }

  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = database.pragma('quick_check', { simple: true });
    if (integrity !== 'ok') {
      throw new Error(`配置数据库完整性检查失败：${String(integrity)}`);
    }

    return readScraperSettings(database);
  } catch (error) {
    if (error instanceof Error && /no such table: settings/.test(error.message)) {
      return {};
    }
    throw error;
  } finally {
    database.close();
  }
}

async function checkScraper() {
  const args = parseArguments();
  const databasePath = args.databasePath || defaultDatabasePath();
  const settings = readConfiguredSettings(databasePath);
  const configuredUrl = args.targetUrl || process.env.SCRAPER_URL || settings.scraper_url?.trim();
  const targetUrl = configuredUrl || DEFAULT_SCRAPER_URL;
  const explicitProxyUrl = args.proxyUrl || process.env.SCRAPER_PROXY_URL;
  const proxyUrl = explicitProxyUrl
    ? resolveScraperProxyUrl({
      scraper_proxy_enabled: 'true',
      scraper_proxy_url: explicitProxyUrl,
    })
    : resolveScraperProxyUrl(settings);

  console.log(`[Scraper Check] 配置数据库：${databasePath}`);
  const targets = buildScraperTargets(targetUrl);
  console.log(`[Scraper Check] 检测站点根地址：${targetUrl}`);
  console.log(`[Scraper Check] 检测页面数：${targets.length}`);
  console.log(`[Scraper Check] 代理抓取：${proxyUrl ? '启用' : '未启用'}`);
  console.log(`[Scraper Check] 超时限制：${resolveScraperTimeoutMs()} ms；单页最大响应：${resolveMaxScraperHtmlBytes()} bytes；最低资源数：${resolveMinimumResourceCount()}`);

  const probes = await probeScraperTargets(targets, proxyUrl);
  const resources = probes.flatMap((probe) => probe.resources);
  const categories = probes.flatMap((probe) => probe.categories);
  const sample = resources.slice(0, 3).map((resource) => resource.title).join('、');
  console.log(`[Scraper Check] 可用：共解析页面 ${probes.length} 个，分类 ${categories.length} 个，资源 ${resources.length} 条。`);
  console.log(`[Scraper Check] 样例资源：${sample}`);
}

checkScraper().catch((error) => {
  console.error(`[Scraper Check] 不可用：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
