import * as cheerio from 'cheerio';
import { fetch, ProxyAgent } from 'undici';
import { readLimitedResponseBody, resolvePositiveIntegerEnv } from './limited-response.js';

export const DEFAULT_SCRAPER_URL = 'https://www.acgbox.link/';
export const DEFAULT_MIN_SCRAPER_RESOURCES = 10;
export const DEFAULT_SCRAPER_TIMEOUT_MS = 15000;
export const DEFAULT_SCRAPER_RETRY_COUNT = 1;
export const DEFAULT_MAX_SCRAPER_HTML_BYTES = 3 * 1024 * 1024;
const DEFAULT_SCRAPER_CONCURRENCY = 2;
const SCRAPER_SECTION_PATHS = [
  '',
  'yingyinzhuanqu',
  'yuledaohang',
  'shiyongruanjian',
  'gongjudaquan',
  'wangzhiguidang',
] as const;

export interface ScrapedResource {
  title: string;
  url: string;
  desc: string;
  iconUrl?: string;
  localIconPath?: string;
  collectionUrl?: string;
  sourceUrl?: string;
}

export interface ScraperProbeResult {
  targetUrl: string;
  statusCode: number;
  durationMs: number;
  resources: ScrapedResource[];
  categories: ScrapedCategory[];
}

export interface ScrapedCategory {
  name: string;
  sourceUrl: string;
  resources: ScrapedResource[];
}

export function resolveScraperTimeoutMs() {
  const requested = Number(process.env.SCRAPER_TIMEOUT_MS || DEFAULT_SCRAPER_TIMEOUT_MS);
  return Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_SCRAPER_TIMEOUT_MS;
}

export function resolveMinimumResourceCount() {
  const requested = Number(process.env.SCRAPER_MIN_RESOURCES || DEFAULT_MIN_SCRAPER_RESOURCES);
  return Number.isInteger(requested) && requested > 0 ? requested : DEFAULT_MIN_SCRAPER_RESOURCES;
}

export function resolveScraperRetryCount() {
  const requested = Number(process.env.SCRAPER_RETRY_COUNT || DEFAULT_SCRAPER_RETRY_COUNT);
  return Number.isInteger(requested) && requested >= 0 ? requested : DEFAULT_SCRAPER_RETRY_COUNT;
}

export function resolveMaxScraperHtmlBytes() {
  return resolvePositiveIntegerEnv('SCRAPER_MAX_HTML_BYTES', DEFAULT_MAX_SCRAPER_HTML_BYTES);
}

export function buildScraperTargets(baseUrl = DEFAULT_SCRAPER_URL) {
  const rootUrl = new URL('/', baseUrl);
  return SCRAPER_SECTION_PATHS.map((pathName) => new URL(pathName, rootUrl).toString());
}

function collectionUrlForResource(resourceUrl: string, targetUrl: string) {
  try {
    const candidate = new URL(resourceUrl, targetUrl);
    if (candidate.origin === new URL(targetUrl).origin && candidate.pathname.startsWith('/q/')) {
      return candidate.toString();
    }
  } catch {
    // Non-URL resource targets are left as normal links.
  }

  return undefined;
}

function parseResourcesInContainer(
  $: cheerio.CheerioAPI,
  container: cheerio.Cheerio<any>,
  targetUrl: string,
) {
  const results: ScrapedResource[] = [];

  container.find('.url-body').each((_, element) => {
    const card = $(element).find('a.card');
    let actualUrl = card.attr('data-url');
    const redirectUrl = $(element).find('a.togo').attr('href');

    if (redirectUrl) {
      try {
        const encodedTarget = new URL(redirectUrl, targetUrl).searchParams.get('url');
        if (encodedTarget) {
          actualUrl = Buffer.from(encodedTarget, 'base64').toString('utf-8');
        }
      } catch {
        // Keep data-url when an optional redirect link is malformed.
      }
    }

    const cleanText = (value?: string) => value ? value.replace(/\s+/g, ' ').trim() : '';
    const title = cleanText(card.find('strong').text()) || cleanText(card.attr('title'));
    const desc = cleanText(card.find('p.text-muted').text());

    let iconUrl = card.find('img').attr('data-src') || card.find('img').attr('src');
    if (iconUrl) {
      try {
        iconUrl = new URL(iconUrl, targetUrl).toString();
      } catch {
        iconUrl = undefined;
      }
    }

    if (actualUrl && title) {
      const collectionUrl = collectionUrlForResource(actualUrl, targetUrl);
      results.push({ title, url: actualUrl, desc, iconUrl, ...(collectionUrl ? { collectionUrl } : {}) });
    }
  });

  return results;
}

export function parseScrapedResources(html: string, targetUrl = DEFAULT_SCRAPER_URL) {
  const $ = cheerio.load(html);
  return parseResourcesInContainer($, $.root(), targetUrl);
}

export function parseScrapedCategories(html: string, targetUrl = DEFAULT_SCRAPER_URL) {
  const $ = cheerio.load(html);
  const categories: ScrapedCategory[] = [];

  $('h4.text-gray').each((_, heading) => {
    const name = $(heading).text().replace(/\s+/g, ' ').trim();
    if (!name || name === '友情链接' || name === '广告位') {
      return;
    }

    let contentRow = $(heading).closest('.d-flex').next('.row');
    if (contentRow.length === 0) {
      contentRow = $(heading).closest('.border-theme').nextAll('.row').first();
    }
    const resources = parseResourcesInContainer($, contentRow, targetUrl);
    if (resources.length > 0) {
      categories.push({ name, sourceUrl: targetUrl, resources });
    }
  });

  return categories;
}

export async function expandScrapedCollections(
  categories: ScrapedCategory[],
  loadPage: (targetUrl: string) => Promise<string>,
) {
  const expandedCategories: ScrapedCategory[] = [];

  for (const category of categories) {
    const resources: ScrapedResource[] = [];
    const seenResources = new Set<string>();
    const expandedCollections = new Set<string>();

    const appendAndExpand = async (resource: ScrapedResource) => {
      if (!seenResources.has(resource.url)) {
        resources.push(resource);
        seenResources.add(resource.url);
      }

      if (!resource.collectionUrl || expandedCollections.has(resource.collectionUrl)) {
        return;
      }

      expandedCollections.add(resource.collectionUrl);
      const childHtml = await loadPage(resource.collectionUrl);
      const childResources = parseScrapedResources(childHtml, resource.collectionUrl);
      for (const child of childResources) {
        await appendAndExpand({ ...child, sourceUrl: resource.collectionUrl });
      }
    };

    for (const resource of category.resources) {
      await appendAndExpand(resource);
    }

    expandedCategories.push({ ...category, resources });
  }

  return expandedCategories;
}

export async function probeScraperSource(
  targetUrl = DEFAULT_SCRAPER_URL,
  minimumResources = resolveMinimumResourceCount(),
  proxyUrl?: string,
) {
  const startedAt = Date.now();
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

  try {
    const loadPage = async (pageUrl: string) => {
      const response = await fetch(pageUrl, {
        dispatcher,
        signal: AbortSignal.timeout(resolveScraperTimeoutMs()),
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
        },
      });

      if (!response.ok) {
        throw new Error(`抓取源请求失败：${pageUrl} 返回 HTTP ${response.status} ${response.statusText}`);
      }

      const htmlBytes = await readLimitedResponseBody(response, resolveMaxScraperHtmlBytes());
      return {
        html: Buffer.from(htmlBytes).toString('utf8'),
        statusCode: response.status,
      };
    };

    const response = await loadPage(targetUrl);
    const parsedCategories = parseScrapedCategories(response.html, targetUrl);
    const categories = await expandScrapedCollections(parsedCategories, async (collectionUrl) => {
      const page = await loadPage(collectionUrl);
      return page.html;
    });
    if (categories.length === 0) {
      throw new Error('抓取源结构不可用：未解析到任何分类分节');
    }
    const resources = categories.flatMap((category) => category.resources);
    if (resources.length < minimumResources) {
      throw new Error(`抓取源结构不可用：分类分节内仅解析出 ${resources.length} 条资源，要求至少 ${minimumResources} 条`);
    }

    return {
      targetUrl,
      statusCode: response.statusCode,
      durationMs: Date.now() - startedAt,
      resources,
      categories,
    } satisfies ScraperProbeResult;
  } finally {
    await dispatcher?.close();
  }
}

type ProbeFunction = typeof probeScraperSource;

export interface ScraperTargetFailure {
  targetUrl: string;
  message: string;
}

export async function probeScraperTargetsSettled(
  targets: string[],
  proxyUrl?: string,
  probe: ProbeFunction = probeScraperSource,
) {
  const results: Array<ScraperProbeResult | undefined> = new Array(targets.length);
  const failures: Array<ScraperTargetFailure | undefined> = new Array(targets.length);
  const retryCount = resolveScraperRetryCount();
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < targets.length) {
      const index = nextIndex;
      nextIndex += 1;
      let lastError: unknown;

      for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        try {
          results[index] = await probe(targets[index], undefined, proxyUrl);
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (lastError) {
        const message = lastError instanceof Error ? lastError.message : String(lastError);
        failures[index] = {
          targetUrl: targets[index],
          message: `已尝试 ${retryCount + 1} 次：${message}`,
        };
      }
    }
  };

  const concurrency = Math.min(DEFAULT_SCRAPER_CONCURRENCY, targets.length);
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return {
    probes: results.filter((result): result is ScraperProbeResult => result !== undefined),
    failures: failures.filter((failure): failure is ScraperTargetFailure => failure !== undefined),
  };
}

export async function probeScraperTargets(
  targets: string[],
  proxyUrl?: string,
  probe: ProbeFunction = probeScraperSource,
) {
  const { probes, failures } = await probeScraperTargetsSettled(targets, proxyUrl, probe);
  if (failures.length > 0) {
    const failed = failures[0];
    throw new Error(`抓取页面失败：${failed.targetUrl}（${failed.message}）`);
  }
  return probes;
}
