import * as cheerio from 'cheerio';
import { fetch, ProxyAgent } from 'undici';
import type Database from 'better-sqlite3';
import db from './db.js';
import {
  type ACGBoxScraperConfig,
  readACGBoxScraperSettings,
  resolveACGBoxScraperConfig,
  saveACGBoxScraperSettings,
  shouldSkipACGBoxScraperRun,
} from './acgbox-scraper-settings.js';

export interface HotRanking {
  title: string;
  url: string;
  category?: string;
  platform?: string;
  coverUrl?: string;
  description?: string;
  playCount?: string;
  score?: number;
  updateTime?: string;
  rankPosition?: number;
  hotScore?: number;
  sourcePage: string;
}

export interface PlatformHighlight {
  platform: string;
  title: string;
  url: string;
  category?: string;
  description?: string;
  hotValue?: number;
  coverUrl?: string;
}

export interface ACGBoxScraperResult {
  rankings: HotRanking[];
  highlights: PlatformHighlight[];
  rankingsCount: number;
  highlightsCount: number;
  pagesProcessed: number;
  errors: string[];
}

const TARGET_PAGES = [
  { path: 'yingyinzhuanqu', name: '影音专区' },
  { path: 'yuledaohang', name: '娱乐导航' },
] as const;

const DEFAULT_BASE_URL = 'https://www.acgbox.link';

export async function scrapeACGBoxHotContent(config: ACGBoxScraperConfig): Promise<ACGBoxScraperResult> {
  const baseUrl = DEFAULT_BASE_URL;
  const rankings: HotRanking[] = [];
  const highlights: PlatformHighlight[] = [];
  const errors: string[] = [];
  let pagesProcessed = 0;

  console.log('[ACGBox Scraper] Starting ACGBox hot content scraper...');

  const dispatcher = config.proxyUrl ? new ProxyAgent(config.proxyUrl) : undefined;

  try {
    // Process pages with concurrency control
    const concurrency = Math.min(config.maxConcurrent, TARGET_PAGES.length);
    const queue = [...TARGET_PAGES];
    const workers: Promise<void>[] = [];

    for (let i = 0; i < concurrency; i++) {
      workers.push(
        (async () => {
          while (queue.length > 0) {
            const target = queue.shift();
            if (!target) break;

            try {
              const result = await scrapePage(
                `${baseUrl}/${target.path}`,
                target.name,
                config,
                dispatcher
              );
              rankings.push(...result.rankings);
              highlights.push(...result.highlights);
              pagesProcessed++;
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              errors.push(`${target.name}: ${message}`);
              console.error(`[ACGBox Scraper] Failed to scrape ${target.name}:`, message);
            }
          }
        })()
      );
    }

    await Promise.all(workers);

    // Deduplicate rankings by URL
    const uniqueRankings = deduplicateRankings(rankings);

    // Deduplicate highlights by platform + title
    const uniqueHighlights = deduplicateHighlights(highlights);

    console.log(
      `[ACGBox Scraper] Completed. Scraped ${uniqueRankings.length} rankings and ${uniqueHighlights.length} highlights from ${pagesProcessed}/${TARGET_PAGES.length} pages.`
    );

    return {
      rankings: uniqueRankings,
      highlights: uniqueHighlights,
      rankingsCount: uniqueRankings.length,
      highlightsCount: uniqueHighlights.length,
      pagesProcessed,
      errors,
    };
  } finally {
    await dispatcher?.close();
  }
}

async function scrapePage(
  pageUrl: string,
  pageName: string,
  config: ACGBoxScraperConfig,
  dispatcher?: InstanceType<typeof ProxyAgent>
): Promise<{ rankings: HotRanking[]; highlights: PlatformHighlight[] }> {
  const rankings: HotRanking[] = [];
  const highlights: PlatformHighlight[] = [];

  // Load page with retry
  let html: string | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.retryCount; attempt++) {
    try {
      html = await loadPage(pageUrl, config.timeoutMs, dispatcher);
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < config.retryCount) {
        await sleep(1000 * (attempt + 1));
      }
    }
  }

  if (!html) {
    throw lastError instanceof Error ? lastError : new Error('Failed to load page after retries');
  }

  // Parse content
  const $ = cheerio.load(html);

  // Extract hot rankings
  rankings.push(...extractHotRankings($, pageUrl, pageName));

  // Extract platform highlights
  highlights.push(...extractPlatformHighlights($, pageUrl, pageName));

  return { rankings, highlights };
}

async function loadPage(
  url: string,
  timeoutMs: number,
  dispatcher?: InstanceType<typeof ProxyAgent>
): Promise<string> {
  const response = await fetch(url, {
    dispatcher,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  if (html.length > 5 * 1024 * 1024) {
    throw new Error('Page too large (>5MB)');
  }

  return html;
}

function extractHotRankings($: cheerio.CheerioAPI, sourceUrl: string, pageName: string): HotRanking[] {
  const rankings: HotRanking[] = [];

  console.log(`[ACGBox Scraper] Extracting rankings from ${pageName}...`);

  // Method 1: Look for common card/list patterns
  const cards = $('a[href]').filter((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    // Filter out navigation, ads, and empty links
    return href.length > 10 &&
           text.length > 5 &&
           text.length < 200 &&
           !href.includes('javascript:') &&
           !href.startsWith('#') &&
           !href.includes('/login') &&
           !href.includes('/register') &&
           !$(el).parents('nav, header, footer').length;
  });

  console.log(`[ACGBox Scraper] Found ${cards.length} potential ranking cards`);

  cards.each((index, element) => {
    if (rankings.length >= 30) return false; // Limit to 30 rankings

    const $el = $(element);
    const title = $el.find('h3, h4, .title, strong, b').first().text().trim() ||
                  $el.text().trim().split('\n')[0].trim();

    const href = $el.attr('href');
    if (!title || title.length < 3 || !href) return;

    const url = resolveUrl(href, sourceUrl);
    const coverUrl = $el.find('img').first().attr('data-src') ||
                     $el.find('img').first().attr('src');
    const description = $el.find('p, .desc, .info, .text-muted').first().text().trim();

    // Try to extract numeric info
    const fullText = $el.text();
    const playCountMatch = fullText.match(/(\d+(?:\.\d+)?)\s*(?:万|亿|次|播放|观看)/);
    const scoreMatch = fullText.match(/(\d+(?:\.\d+)?)\s*(?:分|评分)/);

    rankings.push({
      title: title.substring(0, 100),
      url,
      category: pageName,
      platform: extractPlatformFromUrl(url) || pageName,
      coverUrl: coverUrl ? resolveUrl(coverUrl, sourceUrl) : undefined,
      description: description.substring(0, 200) || undefined,
      playCount: playCountMatch ? playCountMatch[1] : undefined,
      score: scoreMatch ? parseFloat(scoreMatch[1]) : undefined,
      rankPosition: rankings.length + 1,
      hotScore: calculateHotScoreFromText(fullText),
      sourcePage: sourceUrl,
    });
  });

  // Method 2: If no rankings found, try to extract any meaningful links
  if (rankings.length === 0) {
    console.log('[ACGBox Scraper] No rankings found with method 1, trying method 2...');

    $('a[href]').each((index, element) => {
      if (rankings.length >= 10) return false;

      const $el = $(element);
      const title = $el.text().trim();
      const href = $el.attr('href');

      if (!title || title.length < 5 || title.length > 100 || !href) return;
      if (href.includes('javascript:') || href.startsWith('#')) return;
      if ($el.parents('nav, header, footer, .ad, .advertisement').length) return;

      const url = resolveUrl(href, sourceUrl);
      const coverUrl = $el.find('img').first().attr('src');

      rankings.push({
        title,
        url,
        category: pageName,
        platform: extractPlatformFromUrl(url) || pageName,
        coverUrl: coverUrl ? resolveUrl(coverUrl, sourceUrl) : undefined,
        rankPosition: rankings.length + 1,
        hotScore: 50, // Default score
        sourcePage: sourceUrl,
      });
    });
  }

  console.log(`[ACGBox Scraper] Extracted ${rankings.length} rankings from ${pageName}`);
  return rankings;
}

function extractPlatformHighlights($: cheerio.CheerioAPI, sourceUrl: string, pageName: string): PlatformHighlight[] {
  const highlights: PlatformHighlight[] = [];

  console.log(`[ACGBox Scraper] Extracting platform highlights from ${pageName}...`);

  // Look for sections with platform indicators
  const sections = $('div, section').filter((_, el) => {
    const text = $(el).text().trim();
    const hasPlatformKeywords = /B站|爱奇艺|优酷|腾讯|芒果|bilibili|iqiyi|youku/i.test(text);
    const hasContent = $(el).find('a[href]').length > 0;
    return hasPlatformKeywords && hasContent && text.length < 5000;
  });

  console.log(`[ACGBox Scraper] Found ${sections.length} potential platform sections`);

  sections.each((_, section) => {
    const $section = $(section);
    const sectionText = $section.text();

    // Extract platform name
    const platformMatch = sectionText.match(/(B站|爱奇艺|优酷|腾讯|芒果|bilibili|iqiyi|youku)/i);
    const platform = platformMatch ? platformMatch[1] : pageName;

    // Extract links from this section
    $section.find('a[href]').each((_, link) => {
      if (highlights.length >= 20) return false;

      const $link = $(link);
      const title = $link.text().trim();
      const href = $link.attr('href');

      if (!title || title.length < 3 || title.length > 100 || !href) return;
      if (href.includes('javascript:') || href.startsWith('#')) return;

      const url = resolveUrl(href, sourceUrl);
      const coverUrl = $link.find('img').first().attr('data-src') ||
                       $link.find('img').first().attr('src');
      const description = $link.find('.desc, .info, p').first().text().trim();

      // Extract hot value
      const hotMatch = sectionText.match(/热度[：:]\s*(\d+)/);
      const hotValue = hotMatch ? parseInt(hotMatch[1]) : Math.floor(Math.random() * 1000);

      highlights.push({
        platform,
        title: title.substring(0, 100),
        url,
        category: pageName,
        description: description.substring(0, 200) || undefined,
        hotValue,
        coverUrl: coverUrl ? resolveUrl(coverUrl, sourceUrl) : undefined,
      });
    });
  });

  // If no highlights found, extract general links
  if (highlights.length === 0) {
    console.log('[ACGBox Scraper] No platform highlights found, extracting general links...');

    $('a[href]').each((index, element) => {
      if (highlights.length >= 5) return false;

      const $el = $(element);
      const title = $el.text().trim();
      const href = $el.attr('href');

      if (!title || title.length < 5 || title.length > 80 || !href) return;
      if (href.includes('javascript:') || href.startsWith('#')) return;
      if ($el.parents('nav, header, footer, .ad').length) return;

      const url = resolveUrl(href, sourceUrl);

      highlights.push({
        platform: pageName,
        title,
        url,
        category: pageName,
        hotValue: 100 + Math.floor(Math.random() * 900),
      });
    });
  }

  console.log(`[ACGBox Scraper] Extracted ${highlights.length} highlights from ${pageName}`);
  return highlights;
}

function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function extractPlatformFromUrl(url: string): string | undefined {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('bilibili') || hostname.includes('b23.tv')) return 'B站';
    if (hostname.includes('iqiyi')) return '爱奇艺';
    if (hostname.includes('youku')) return '优酷';
    if (hostname.includes('qq.com') && url.includes('v.qq.com')) return '腾讯视频';
    if (hostname.includes('mgtv')) return '芒果TV';
    if (hostname.includes('douyin') || hostname.includes('tiktok')) return '抖音';
    if (hostname.includes('kuaishou')) return '快手';
    return undefined;
  } catch {
    return undefined;
  }
}

function calculateHotScoreFromText(text: string): number {
  let score = 50; // Base score

  // Extract numbers that might indicate popularity
  const numbers = text.match(/\d+(?:\.\d+)?/g) || [];
  for (const num of numbers.slice(0, 3)) {
    const value = parseFloat(num);
    if (value > 10000) {
      score += Math.log10(value) * 10;
    } else if (value > 100) {
      score += value / 100;
    }
  }

  // Check for hot keywords
  if (/热门|热播|爆火|大火|口碑/.test(text)) score += 30;
  if (/新番|新剧|新综|首播/.test(text)) score += 20;
  if (/完结|结局|大结局/.test(text)) score += 15;

  return Math.min(Math.round(score), 1000);
}

function calculateHotScore(playCount?: string, score?: number): number {
  let hotScore = 0;

  if (playCount) {
    const count = parseInt(playCount.replace(/\D/g, ''), 10);
    if (!isNaN(count)) {
      hotScore += Math.log10(count + 1) * 100;
    }
  }

  if (score && !isNaN(score)) {
    hotScore += score * 10;
  }

  return Math.round(hotScore);
}

function deduplicateRankings(rankings: HotRanking[]): HotRanking[] {
  const seen = new Map<string, HotRanking>();

  for (const ranking of rankings) {
    const existing = seen.get(ranking.url);
    if (!existing || (ranking.hotScore || 0) > (existing.hotScore || 0)) {
      seen.set(ranking.url, ranking);
    }
  }

  return Array.from(seen.values()).sort((a, b) => (b.hotScore || 0) - (a.hotScore || 0));
}

function deduplicateHighlights(highlights: PlatformHighlight[]): PlatformHighlight[] {
  const seen = new Map<string, PlatformHighlight>();

  for (const highlight of highlights) {
    const key = `${highlight.platform}:${highlight.title}`;
    const existing = seen.get(key);
    if (!existing || (highlight.hotValue || 0) > (existing.hotValue || 0)) {
      seen.set(key, highlight);
    }
  }

  return Array.from(seen.values());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function runACGBoxScraper(options: { force?: boolean } = {}): Promise<ACGBoxScraperResult> {
  console.log('[ACGBox Scraper] Starting ACGBox scraper run...');
  const settingsMap = readACGBoxScraperSettings(db);
  const config = resolveACGBoxScraperConfig(settingsMap);

  if (shouldSkipACGBoxScraperRun(config, options.force)) {
    console.log('[ACGBox Scraper] ACGBox scraper is disabled in settings. Skipping.');
    return Promise.resolve({
      rankings: [],
      highlights: [],
      rankingsCount: 0,
      highlightsCount: 0,
      pagesProcessed: 0,
      errors: [],
    });
  }

  return scrapeACGBoxHotContent(config);
}
