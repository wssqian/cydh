import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetch, ProxyAgent } from 'undici';
import { resolveIconCacheDirectory } from './icon-cache-path.js';
import { readLimitedResponseBody, resolvePositiveIntegerEnv } from './limited-response.js';
import type { ScrapedCategory } from './scraper-source.js';

interface LoadedIcon {
  bytes: Uint8Array;
  contentType: string;
}

interface CacheScrapedIconOptions {
  dataDirectory?: string;
  proxyUrl?: string;
  loadIcon?: (iconUrl: string) => Promise<LoadedIcon>;
  existingIcons?: Map<string, string>;
}

const CACHED_ICON_ROUTE = '/cached-icons';
export const DEFAULT_ICON_CONCURRENCY = 2;
export const DEFAULT_MAX_ICON_BYTES = 2 * 1024 * 1024;
const extensionsByContentType: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'image/avif': '.avif',
};
const supportedUrlExtensions: Record<string, string> = {
  '.png': '.png',
  '.jpg': '.jpg',
  '.jpeg': '.jpg',
  '.gif': '.gif',
  '.webp': '.webp',
  '.svg': '.svg',
  '.ico': '.ico',
  '.avif': '.avif',
};

export function resolveIconConcurrency() {
  return Math.min(resolvePositiveIntegerEnv('SCRAPER_ICON_CONCURRENCY', DEFAULT_ICON_CONCURRENCY), 16);
}

export function resolveMaxIconBytes() {
  return resolvePositiveIntegerEnv('SCRAPER_MAX_ICON_BYTES', DEFAULT_MAX_ICON_BYTES);
}

function decodedDataIcon(iconUrl: string): LoadedIcon | undefined {
  const matched = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(iconUrl);
  if (!matched || !extensionsByContentType[matched[1].toLowerCase()]) {
    return undefined;
  }
  return {
    contentType: matched[1].toLowerCase(),
    bytes: matched[2] ? Buffer.from(matched[3], 'base64') : Buffer.from(decodeURIComponent(matched[3])),
  };
}

function publicPathForIcon(iconUrl: string, contentType: string) {
  const normalizedType = contentType.split(';', 1)[0].trim().toLowerCase();
  let extension = extensionsByContentType[normalizedType];
  if (!extension && (!normalizedType || normalizedType === 'application/octet-stream')) {
    try {
      extension = supportedUrlExtensions[path.extname(new URL(iconUrl).pathname).toLowerCase()];
    } catch {
      extension = undefined;
    }
  }
  if (!extension) {
    throw new Error(`Unsupported icon type: ${contentType}`);
  }
  return `${CACHED_ICON_ROUTE}/${createHash('sha256').update(iconUrl).digest('hex')}${extension}`;
}

async function persistIcon(iconDirectory: string, iconUrl: string, loaded: LoadedIcon) {
  const maxIconBytes = resolveMaxIconBytes();
  if (loaded.bytes.byteLength > maxIconBytes) {
    throw new Error(`Icon exceeds ${maxIconBytes} bytes`);
  }
  const publicPath = publicPathForIcon(iconUrl, loaded.contentType);
  const targetPath = path.join(iconDirectory, path.basename(publicPath));
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, loaded.bytes);
    await rename(temporaryPath, targetPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return publicPath;
}

export async function cacheScrapedIcons(
  categories: ScrapedCategory[],
  options: CacheScrapedIconOptions = {},
) {
  const iconDirectory = resolveIconCacheDirectory(options.dataDirectory);
  await mkdir(iconDirectory, { recursive: true });
  const dispatcher = !options.loadIcon && options.proxyUrl ? new ProxyAgent(options.proxyUrl) : undefined;
  const remoteLoader = options.loadIcon || (async (iconUrl: string) => {
    const response = await fetch(iconUrl, {
      dispatcher,
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CiyuanNavIconCache/1.0)',
        Accept: 'image/avif,image/webp,image/svg+xml,image/png,image/*,*/*;q=0.8',
      },
    });
    if (!response.ok) {
      throw new Error(`Icon request failed with HTTP ${response.status}`);
    }
    const bytes = await readLimitedResponseBody(response, resolveMaxIconBytes());
    return {
      bytes,
      contentType: response.headers.get('content-type') || '',
    };
  });

  const allUrls = [...new Set(categories
    .flatMap((category) => category.resources)
    .filter((resource) => resource.iconUrl && !resource.collectionUrl)
    .map((resource) => resource.iconUrl!))];
  const existingIcons = options.existingIcons;
  const paths = new Map<string, string>();
  let skipped = 0;
  const urls: string[] = [];
  for (const iconUrl of allUrls) {
    if (existingIcons?.has(iconUrl)) {
      paths.set(iconUrl, existingIcons.get(iconUrl)!);
      skipped += 1;
    } else {
      urls.push(iconUrl);
    }
  }
  let failed = 0;
  let nextIndex = 0;
  const cacheOne = async (iconUrl: string) => {
    try {
      const loaded = iconUrl.startsWith('data:') ? decodedDataIcon(iconUrl) : await remoteLoader(iconUrl);
      if (!loaded) {
        throw new Error('Unsupported embedded icon');
      }
      paths.set(iconUrl, await persistIcon(iconDirectory, iconUrl, loaded));
    } catch {
      failed += 1;
    }
  };
  const worker = async () => {
    while (nextIndex < urls.length) {
      const iconUrl = urls[nextIndex];
      nextIndex += 1;
      await cacheOne(iconUrl);
    }
  };

  try {
    await Promise.all(Array.from(
      { length: Math.min(resolveIconConcurrency(), urls.length) },
      () => worker(),
    ));
  } finally {
    await dispatcher?.close();
  }

  return {
    categories: categories.map((category) => ({
      ...category,
      resources: category.resources.map((resource) => ({
        ...resource,
        ...(resource.iconUrl && paths.has(resource.iconUrl)
          ? { localIconPath: paths.get(resource.iconUrl) }
          : {}),
      })),
    })),
    cached: paths.size - skipped,
    skipped,
    failed,
  };
}
