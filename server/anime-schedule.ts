const log = createLogger("Anime");

import type { RequestHandler } from "express";
import { createLogger } from "./logger";
import { fetch as undiciFetch } from "undici";
import { readLimitedResponseBody } from "./limited-response";

export const ANIME_API_BASE = "http://dm.uuuc4.uno:3456";
export const ANIME_SCHEDULE_TIMEOUT_MS = 15_000;
export const ANIME_COVER_TIMEOUT_MS = 10_000;
export const ANIME_SCHEDULE_CACHE_CONTROL = "public, max-age=3600";
export const ANIME_COVER_CACHE_CONTROL = "public, max-age=86400";
export const ANIME_FAILURE_CACHE_CONTROL = "no-store";
export const ANIME_COVER_MAX_BYTES = 5 * 1024 * 1024; // 5 MiB 封面图片上限

export interface AnimeScheduleItem {
  title: string;
  cover: string;
  link: string;
  update_date: string;
}

export type AnimeScheduleData = Record<string, AnimeScheduleItem[]>;

interface CacheEntry {
  data: AnimeScheduleData;
  fetchedAt: number;
  fetchDate: string;
}

let scheduleCache: CacheEntry | null = null;

type UndiciResponse = Awaited<ReturnType<typeof undiciFetch>>;

function todayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<UndiciResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await undiciFetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function getAnimeSchedule(): Promise<AnimeScheduleData | null> {
  const today = todayDateString();

  if (scheduleCache && scheduleCache.fetchDate === today) {
    return scheduleCache.data;
  }

  try {
    const res = await fetchWithTimeout(`${ANIME_API_BASE}/api/schedule`, ANIME_SCHEDULE_TIMEOUT_MS);

    if (!res.ok) {
      log.error("Anime", ` upstream HTTP ${res.status}`);
      return scheduleCache?.data ?? null;
    }

    const json = (await res.json()) as { code: number; data?: AnimeScheduleData; msg?: string };
    if (json.code !== 0 || !json.data) {
      log.error("Anime", ` upstream API error: ${json.msg ?? "unknown"}`);
      return scheduleCache?.data ?? null;
    }

    scheduleCache = {
      data: json.data,
      fetchedAt: Date.now(),
      fetchDate: today,
    };

    return json.data;
  } catch (err) {
    log.error("Anime", " fetch failed:", err);
    return scheduleCache?.data ?? null;
  }
}

export async function proxyAnimeCover(coverUrl: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANIME_COVER_TIMEOUT_MS);
  try {
    const targetUrl = `${ANIME_API_BASE}/api/cover?url=${encodeURIComponent(coverUrl)}`;
    const res = await undiciFetch(targetUrl, { signal: controller.signal });

    if (!res.ok) return null;

    // 预检查 Content-Length，拒绝超限响应
    const contentLength = Number(res.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > ANIME_COVER_MAX_BYTES) {
      log.error("Anime", ` cover too large: ${contentLength} bytes`);
      return null;
    }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const bytes = await readLimitedResponseBody(res, ANIME_COVER_MAX_BYTES);
    return { buffer: Buffer.from(bytes), contentType };
  } catch (err) {
    log.error("Anime", " cover proxy failed:", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export const handleAnimeScheduleRequest: RequestHandler = async (_req, res) => {
  try {
    const data = await getAnimeSchedule();
    if (!data) {
      res.set("Cache-Control", ANIME_FAILURE_CACHE_CONTROL);
      res.status(502).json({ error: "Failed to fetch anime schedule" });
      return;
    }

    res.set("Cache-Control", ANIME_SCHEDULE_CACHE_CONTROL);
    res.json({ code: 0, data });
  } catch (err) {
    log.error("Anime", " route failed:", err);
    res.set("Cache-Control", ANIME_FAILURE_CACHE_CONTROL);
    res.status(500).json({ error: "Internal error" });
  }
};

export const handleAnimeCoverRequest: RequestHandler = async (req, res) => {
  try {
    const coverUrl = typeof req.query.url === "string" ? req.query.url : "";
    if (!coverUrl) {
      res.set("Cache-Control", ANIME_FAILURE_CACHE_CONTROL);
      res.status(400).json({ error: "Missing url parameter" });
      return;
    }

    const result = await proxyAnimeCover(coverUrl);
    if (!result) {
      res.set("Cache-Control", ANIME_FAILURE_CACHE_CONTROL);
      res.status(502).end();
      return;
    }

    res.set("Content-Type", result.contentType);
    res.set("Cache-Control", ANIME_COVER_CACHE_CONTROL);
    res.send(result.buffer);
  } catch (err) {
    log.error("Anime", " cover route failed:", err);
    res.set("Cache-Control", ANIME_FAILURE_CACHE_CONTROL);
    res.status(500).end();
  }
};
