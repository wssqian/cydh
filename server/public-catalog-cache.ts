import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { Request, Response } from 'express';

interface CachedCatalogResponse {
  gzipBody: Buffer;
  storedBytes: number;
  etag: string;
}

export const DEFAULT_PUBLIC_CATALOG_CACHE_MAX_BYTES = 4 * 1024 * 1024;

export function resolvePublicCatalogCacheMaxBytes() {
  const requested = Number(process.env.PUBLIC_CATALOG_CACHE_MAX_BYTES || DEFAULT_PUBLIC_CATALOG_CACHE_MAX_BYTES);
  return Number.isInteger(requested) && requested > 0
    ? requested
    : DEFAULT_PUBLIC_CATALOG_CACHE_MAX_BYTES;
}

function requestAcceptsGzip(request: Request) {
  return /\bgzip\b/i.test(request.get('Accept-Encoding') || '');
}

function etagMatches(header: string | undefined, etag: string) {
  if (!header) {
    return false;
  }
  return header
    .split(',')
    .map((value) => value.trim())
    .some((value) => value === etag || value === '*');
}

export class PublicCatalogCache {
  private readonly entries = new Map<string, CachedCatalogResponse>();
  private storedBytes = 0;

  constructor(private readonly maxBytes = resolvePublicCatalogCacheMaxBytes()) {}

  clear() {
    this.entries.clear();
    this.storedBytes = 0;
  }

  size() {
    return this.entries.size;
  }

  private put(key: string, json: string) {
    const body = Buffer.from(json);
    const etag = `"${createHash('sha256').update(body).digest('base64url')}"`;
    const gzipBody = gzipSync(body);
    const storedBytes = gzipBody.byteLength;
    const response: CachedCatalogResponse = { gzipBody, storedBytes, etag };

    if (storedBytes > this.maxBytes) {
      return response;
    }

    while (this.storedBytes + storedBytes > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      const oldest = this.entries.get(oldestKey);
      if (oldest) {
        this.storedBytes -= oldest.storedBytes;
      }
      this.entries.delete(oldestKey);
    }

    this.entries.set(key, response);
    this.storedBytes += storedBytes;
    return response;
  }

  private write(request: Request, response: Response, entry: CachedCatalogResponse, cacheControl: string) {
    response.set('Cache-Control', cacheControl);
    response.set('Content-Type', 'application/json; charset=utf-8');
    response.set('ETag', entry.etag);
    response.set('Vary', 'Accept-Encoding');

    if (etagMatches(request.get('If-None-Match'), entry.etag)) {
      response.status(304).end();
      return;
    }

    if (requestAcceptsGzip(request)) {
      response.set('Content-Encoding', 'gzip');
      response.set('Content-Length', String(entry.gzipBody.byteLength));
      response.send(entry.gzipBody);
      return;
    }

    const raw = gunzipSync(entry.gzipBody);
    response.set('Content-Length', String(raw.byteLength));
    response.send(raw);
  }

  sendJson(
    request: Request,
    response: Response,
    key: string,
    cacheControl: string,
    buildJson: () => string,
  ) {
    const entry = this.entries.get(key) || this.put(key, buildJson());
    this.write(request, response, entry, cacheControl);
  }
}
