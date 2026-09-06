import type { RequestHandler } from "express";
import { createLogger } from "./logger";
import { acgFetch } from "./acg-proxy";
import { createAcgImageRedirectHandler } from "./acg-image-proxy";
import { loadCacheFile, saveCacheFile } from "./acg-file-cache";

const log = createLogger("Bangumi");
const CACHE_CONTROL = "public, max-age=3600";
const FAIL_CACHE = "no-store";

export interface BangumiCalendarItem {
  id: number; name: string; name_cn: string; summary: string;
  images: { large: string; common: string; medium: string; small: string; grid: string };
  rating: { rank: number; total: number; score: number; count: Record<string, number> };
  air_date: string; air_weekday: number; eps: number; url: string;
}
export interface BangumiCalendarData {
  weekday: { id: number; cn: string; en: string };
  items: BangumiCalendarItem[];
}

interface Cache { data: BangumiCalendarData[]; fetchedAt: number; fetchDate: string; }
let cache: Cache | null = loadCacheFile<BangumiCalendarData[]>("bangumi");
function todayStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;
}

export async function getBangumiCalendar(): Promise<BangumiCalendarData[] | null> {
  const key = todayStr();
  if (cache && cache.fetchDate === key) return cache.data;
  try {
    const res = await acgFetch("/bangumi/calendar");
    if (!res.ok) { log.error(`Bangumi HTTP ${res.status}`); return cache?.data ?? null; }
    const json = (await res.json()) as BangumiCalendarData[];
    if (!Array.isArray(json) || json.length === 0) { log.error("Bangumi empty"); return cache?.data ?? null; }
    cache = { data: json, fetchedAt: Date.now(), fetchDate: key };
    saveCacheFile("bangumi", cache);
    log.info(`Bangumi fetched: ${json.reduce((s,d) => s+d.items.length,0)} items`);
    return json;
  } catch (err) { log.error("Bangumi fetch failed:", err); return cache?.data ?? null; }
}

export const handleBangumiCalendarRequest: RequestHandler = async (_req, res) => {
  const data = await getBangumiCalendar();
  if (!data) { res.set("Cache-Control", FAIL_CACHE); res.status(502).json({ error: "Failed" }); return; }
  res.set("Cache-Control", CACHE_CONTROL);
  res.json({ code: 0, data });
};

export const handleBangumiCoverRequest = createAcgImageRedirectHandler("bangumi");

export async function warmUpBangumi(): Promise<void> {
  try { await getBangumiCalendar(); } catch { /* 预热失败静默 */ }
}
