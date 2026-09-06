import { createHash } from 'node:crypto';
import { fetch } from 'undici';

const DEFAULT_DAILYHOT_API_BASE = 'http://dm.uuuc4.uno:6688';
const DAILYHOT_API_BASE = normalizeBaseUrl(process.env.DAILYHOT_API_BASE || DEFAULT_DAILYHOT_API_BASE);
const DAILYHOT_REQUEST_TIMEOUT_MS = 15000;
const BAIDU_HOT_URL = 'https://top.baidu.com/board?tab=realtime';

const DEFAULT_PLATFORMS = [
  'bilibili',
  'weibo',
  'zhihu',
  'douyin',
  'toutiao',
  'baidu',
  'qq-news',
  'sina-news',
] as const;

export interface DailyHotItem {
  id: string;
  title: string;
  desc?: string;
  cover?: string;
  author?: string;
  timestamp?: number;
  hot?: number;
  url: string;
  mobileUrl?: string;
}

export interface DailyHotPlatform {
  name: string;
  title: string;
  type: string;
  description?: string;
  link: string;
  total: number;
  updateTime: string;
  data: DailyHotItem[];
}

export interface DailyHotResult {
  platforms: DailyHotPlatform[];
  totalItems: number;
  errors: string[];
}

export async function fetchDailyHotData(platforms?: string[]): Promise<DailyHotResult> {
  const targetPlatforms = platforms || [...DEFAULT_PLATFORMS];
  const result: DailyHotResult = {
    platforms: [],
    totalItems: 0,
    errors: [],
  };

  console.log(`[DailyHot] Fetching data from ${targetPlatforms.length} platforms...`);

  const promises = targetPlatforms.map(async (platform) => {
    try {
      const data = await fetchPlatform(platform);
      return { success: true as const, data, platform };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false as const, error: message, platform };
    }
  });

  const responses = await Promise.all(promises);

  for (const response of responses) {
    if (response.success) {
      result.platforms.push(response.data);
      result.totalItems += response.data.data.length;
      console.log(`[DailyHot] Fetched ${response.data.data.length} items from ${response.platform}`);
    } else {
      result.errors.push(`${response.platform}: ${response.error}`);
      console.error(`[DailyHot] Failed to fetch ${response.platform}: ${response.error}`);
    }
  }

  if (result.platforms.length === 0) {
    throw new Error(`DailyHot fetch failed for all platforms: ${result.errors.join('; ')}`);
  }

  console.log(`[DailyHot] Completed. Fetched ${result.totalItems} items from ${result.platforms.length} platforms. Errors: ${result.errors.length}`);

  return result;
}

export function getAvailablePlatforms(): string[] {
  return [...DEFAULT_PLATFORMS];
}

export async function fetchSinglePlatform(platform: string): Promise<DailyHotPlatform> {
  return await fetchPlatform(platform);
}

async function fetchPlatform(platform: string): Promise<DailyHotPlatform> {
  try {
    const response = await fetch(`${DAILYHOT_API_BASE}/${encodeURIComponent(platform)}`, {
      signal: AbortSignal.timeout(DAILYHOT_REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ciyuan-nav/1.0 (+DailyHot fetcher)',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return normalizeDailyHotPlatform(data, platform);
  } catch (error) {
    if (platform === 'baidu') {
      const primaryMessage = error instanceof Error ? error.message : String(error);
      console.warn(`[DailyHot] Primary baidu fetch failed: ${primaryMessage}. Falling back to Baidu hot board.`);
      try {
        return await fetchBaiduHotBoard();
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(`${primaryMessage}; baidu fallback failed: ${fallbackMessage}`);
      }
    }

    throw error;
  }
}

export function normalizeDailyHotPlatform(raw: unknown, requestedPlatform: string): DailyHotPlatform {
  const source = asRecord(raw);
  if (!source) {
    throw new Error(`Invalid ${requestedPlatform} response: expected object`);
  }

  const rawItems = Array.isArray(source.data) ? source.data : [];
  if (rawItems.length === 0) {
    throw new Error(`Invalid ${requestedPlatform} response: data is empty or missing`);
  }

  const items = rawItems
    .map((item, index) => normalizeDailyHotItem(item, requestedPlatform, index))
    .filter((item): item is DailyHotItem => item !== null);

  if (items.length === 0) {
    throw new Error(`Invalid ${requestedPlatform} response: no usable items`);
  }

  const skipped = rawItems.length - items.length;
  if (skipped > 0) {
    console.warn(`[DailyHot] Dropped ${skipped} invalid item(s) from ${requestedPlatform}`);
  }

  return {
    name: requestedPlatform,
    title: readString(source.title) || requestedPlatform,
    type: readString(source.type) || readString(source.subtitle) || '',
    description: readString(source.description) || undefined,
    link: readString(source.link) || '',
    total: items.length,
    updateTime: readString(source.updateTime) || new Date().toISOString(),
    data: items,
  };
}

async function fetchBaiduHotBoard(): Promise<DailyHotPlatform> {
  const response = await fetch(BAIDU_HOT_URL, {
    signal: AbortSignal.timeout(DAILYHOT_REQUEST_TIMEOUT_MS),
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (compatible; ciyuan-nav/1.0; +https://top.baidu.com/)',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return await parseBaiduHotBoardHtml(await response.text());
}

export async function parseBaiduHotBoardHtml(html: string): Promise<DailyHotPlatform> {
  const { load } = await import('cheerio');
  const $ = load(html);
  const items: DailyHotItem[] = [];

  $('[class*="category-wrap"]').each((index, element) => {
    const root = $(element);
    const title = cleanText(root.find('[class*="c-single-text-ellipsis"]').first().text());
    const href = root.find('a[href]').first().attr('href') || '';

    if (!title || !href) {
      return;
    }

    const rawDescription = cleanText(root.find('[class*="hot-desc"]').first().text());
    const description = rawDescription.replace(/查看更多>?$/u, '').trim();
    const image = root
      .find('[class*="img-wrapper"] img')
      .toArray()
      .map((imageElement) => $(imageElement).attr('src') || '')
      .find((source) => source && !source.includes('/static/asset/')) || '';
    const url = normalizeUrl(href, 'https://top.baidu.com');

    items.push({
      id: createStableId('baidu', title, url),
      title,
      desc: description || undefined,
      cover: normalizeUrl(image, 'https:') || undefined,
      timestamp: Date.now(),
      hot: parseHotScore(root.find('[class*="hot-index"]').first().text()),
      url,
      mobileUrl: url,
    });
  });

  if (items.length === 0) {
    throw new Error('Baidu hot board fallback did not contain usable items');
  }

  return {
    name: 'baidu',
    title: '百度',
    type: '热搜',
    description: '百度热搜',
    link: BAIDU_HOT_URL,
    total: items.length,
    updateTime: new Date().toISOString(),
    data: items,
  };
}

function normalizeDailyHotItem(raw: unknown, platform: string, index: number): DailyHotItem | null {
  const item = asRecord(raw);
  if (!item) {
    return null;
  }

  const title = readString(item.title) || readString(item.word) || readString(item.name);
  const url = normalizeUrl(readString(item.url) || readString(item.link), DAILYHOT_API_BASE);

  if (!title || !url || url.includes('wd=undefined')) {
    return null;
  }

  const owner = asRecord(item.owner);

  return {
    id: readString(item.id) || createStableId(platform, title, url),
    title,
    desc: readString(item.desc) || readString(item.description) || undefined,
    cover: readString(item.cover) || readString(item.pic) || readString(item.image) || undefined,
    author: readString(item.author) || readString(owner?.name) || undefined,
    timestamp: parseTimestamp(item.timestamp),
    hot: parseHotScore(item.hot ?? asRecord(item.data)?.view ?? index),
    url,
    mobileUrl: normalizeUrl(readString(item.mobileUrl) || readString(item.mobile_url), DAILYHOT_API_BASE) || undefined,
  };
}

function asRecord(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, any> : null;
}

function readString(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return '';
}

function parseHotScore(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return 0;
  }

  const text = value.trim().replace(/,/g, '');
  const match = text.match(/([\d.]+)/);
  if (!match) {
    return 0;
  }

  const base = Number(match[1]);
  if (!Number.isFinite(base)) {
    return 0;
  }

  if (text.includes('亿')) {
    return Math.round(base * 100000000);
  }

  if (text.includes('万')) {
    return Math.round(base * 10000);
  }

  return Math.round(base);
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function createStableId(platform: string, title: string, url: string): string {
  const digest = createHash('sha1').update(`${platform}:${title}:${url}`).digest('hex').slice(0, 16);
  return `${platform}-${digest}`;
}

function normalizeUrl(value: string, base: string): string {
  const url = value.trim().replace(/&amp;/g, '&');
  if (!url) {
    return '';
  }

  if (url.startsWith('//')) {
    return `https:${url}`;
  }

  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/u, '');
}
