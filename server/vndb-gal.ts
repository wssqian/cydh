import type { RequestHandler } from "express";
import { createLogger } from "./logger";
import { acgFetch } from "./acg-proxy";
import { createAcgImageRedirectHandler } from "./acg-image-proxy";
import { readAcgFeaturesSettings } from "./acg-features-settings";
import { loadCacheFile, saveCacheFile } from "./acg-file-cache";
import db from "./db";

const log = createLogger("VNDB");
const CACHE_CONTROL = "public, max-age=21600";
export const GAL_SEARCH_CACHE_CONTROL = "public, max-age=1800";
const FAIL_CACHE = "no-store";
const FIELDS = "title,alttitle,description,image.url,rating,votecount,length,released,devstatus,platforms,tags.name,tags.rating,tags.category,tags.spoiler,titles.title,titles.lang";
const RESULT_LIMIT = 30;
const SEARCH_RESULT_LIMIT = 1;
const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;

export interface GalItem {
  id: string;
  title: string;
  altTitle: string | null;
  description: string;
  image_url: string | null;
  rating: number | null;
  vote_count: number;
  length: string | null;
  released: string | null;
  devstatus: number;
  platforms: string[];
  tags: string[];
  vndbUrl: string;
}

type GalMode = "hot" | "new" | "monthly" | "chinese" | "high" | "upcoming";
interface Cache { data: GalItem[]; fetchedAt: number; fetchDate: string; }
interface SearchCache { data: GalItem | null; fetchedAt: number; }

const GAL_MODES = new Set<GalMode>(["hot", "new", "monthly", "chinese", "high", "upcoming"]);
const galCache = new Map<GalMode, Cache>();
const WARMUP_GAL_MODES: GalMode[] = ["monthly", "chinese", "high", "upcoming"];
for (const m of WARMUP_GAL_MODES) {
  const restored = loadCacheFile<GalItem[]>(`gal-${m}`);
  if (restored) galCache.set(m, restored);
}
const galSearchCache = new Map<string, SearchCache>();
const LENGTH_MAP: Record<number,string> = { 1:"极短",2:"短篇(2-10h)",3:"中篇(10-30h)",4:"长篇(30-50h)",5:"超长篇(50h+)" };

function hourKey() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}-${String(n.getHours()).padStart(2,"0")}`;
}

function dateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

function currentMonthRange() {
  const now = new Date();
  return {
    start: dateString(new Date(now.getFullYear(), now.getMonth(), 1)),
    end: dateString(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

function normalizeGalMode(value: unknown): GalMode {
  return typeof value === "string" && GAL_MODES.has(value as GalMode) ? value as GalMode : "high";
}

function hasChineseTitle(item: any): boolean {
  return (item.titles || []).some((title: any) => typeof title.lang === "string" && title.lang.startsWith("zh"));
}

function mapItems(resp: any, options: { chineseOnly?: boolean } = {}): GalItem[] {
  const raw = Array.isArray(resp.results) ? resp.results : [];
  const results = options.chineseOnly ? raw.filter(hasChineseTitle) : raw;

  return results.slice(0, RESULT_LIMIT).map((item: any) => {
    const zh = item.titles?.find((t: any) => typeof t.lang === "string" && t.lang.startsWith("zh"));
    const title = zh?.title || item.title;
    const tags = (item.tags||[])
      .filter((t:any)=>!t.spoiler&&t.rating>0.6&&t.category==="cont")
      .sort((a:any,b:any)=>b.rating-a.rating)
      .slice(0,8)
      .map((t:any)=>t.name);
    return {
      id: item.id,
      title,
      altTitle: item.alttitle||(zh?item.title:null),
      description: (item.description||"").slice(0,300),
      image_url: item.image?.url||null,
      rating: item.rating||null,
      vote_count: item.votecount||0,
      length: item.length ? LENGTH_MAP[item.length]||null : null,
      released: item.released||null,
      devstatus: item.devstatus??0,
      platforms: item.platforms||[],
      tags,
      vndbUrl: `https://vndb.org/${item.id}`,
    };
  });
}

function buildRequest(mode: GalMode) {
  const today = dateString(new Date());
  const month = currentMonthRange();

  switch (mode) {
    case "monthly":
      return {
        body: {
          filters:["and",["devstatus","=",0],["released",">=",month.start],["released","<=",month.end]],
          fields:FIELDS,
          sort:"released",
          reverse:true,
          results:RESULT_LIMIT,
        },
      };
    case "chinese":
      return {
        body: {
          filters:["and",["devstatus","=",0],["released","!=",null]],
          fields:FIELDS,
          sort:"released",
          reverse:true,
          results:80,
        },
        chineseOnly: true,
      };
    case "upcoming":
      return {
        body: {
          filters:["and",["released",">",today]],
          fields:FIELDS,
          sort:"released",
          reverse:false,
          results:RESULT_LIMIT,
        },
      };
    case "new":
      return {
        body: {
          filters:["and",["devstatus","=",0],["released","!=",null]],
          fields:FIELDS,
          sort:"released",
          reverse:true,
          results:RESULT_LIMIT,
        },
      };
    case "hot":
    case "high":
    default:
      return {
        body: {
          filters:["and",["rating",">=",75],["votecount",">=",50],["devstatus","=",0]],
          fields:FIELDS,
          sort:"rating",
          reverse:true,
          results:RESULT_LIMIT,
        },
      };
  }
}

export function buildGalSearchRequest(query: string) {
  return {
    filters: ["search", "=", query],
    fields: FIELDS,
    sort: "searchrank",
    reverse: false,
    results: SEARCH_RESULT_LIMIT,
  };
}

function normalizeSearchQuery(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

async function fetchGalSearch(query: string): Promise<GalItem | null> {
  const cacheKey = query.toLowerCase();
  const cache = galSearchCache.get(cacheKey) || null;
  if (cache && Date.now() - cache.fetchedAt < SEARCH_CACHE_TTL_MS) {
    return cache.data;
  }

  try {
    const res = await acgFetch("/vndb/vn", {
      method: "POST",
      body: JSON.stringify(buildGalSearchRequest(query)),
      headers: { "Content-Type": "application/json" },
      timeout: 15_000,
    });
    if (!res.ok) {
      log.error(`VNDB search HTTP ${res.status}`);
      return cache?.data ?? null;
    }

    const item = mapItems(await res.json())[0] ?? null;
    galSearchCache.set(cacheKey, { data: item, fetchedAt: Date.now() });
    log.info(`VNDB search "${query}": ${item ? item.id : "no result"}`);
    return item;
  } catch (err) {
    log.error(`VNDB search "${query}" failed:`, err);
    return cache?.data ?? null;
  }
}

async function fetchGal(mode: GalMode): Promise<GalItem[]|null> {
  const cache = galCache.get(mode) || null;
  const key = hourKey();
  if (cache && cache.fetchDate === key) return cache.data;

  try {
    const request = buildRequest(mode);
    const res = await acgFetch("/vndb/vn", {
      method:"POST",
      body: JSON.stringify(request.body),
      headers:{"Content-Type":"application/json"},
    });
    if (!res.ok) {
      log.error(`VNDB ${mode} HTTP ${res.status}`);
      return cache?.data??null;
    }

    const items = mapItems(await res.json(), { chineseOnly: request.chineseOnly });
    galCache.set(mode, { data: items, fetchedAt: Date.now(), fetchDate: key });
    saveCacheFile(`gal-${mode}`, galCache.get(mode)!);
    log.info(`VNDB ${mode}: ${items.length} items`);
    return items;
  } catch (err) {
    log.error(`VNDB ${mode} failed:`, err);
    return cache?.data??null;
  }
}

export const handleGalRecommendationsRequest: RequestHandler = async (req, res) => {
  const type = normalizeGalMode(req.query.type);
  const data = await fetchGal(type);
  if (!data) {
    res.set("Cache-Control", FAIL_CACHE);
    res.status(502).json({ error: "Failed" });
    return;
  }
  res.set("Cache-Control", CACHE_CONTROL);
  res.json({ code: 0, data, type });
};

export const handleGalSearchRequest: RequestHandler = async (req, res) => {
  const settings = readAcgFeaturesSettings(db);
  if (!settings.gal_search_enabled) {
    res.set("Cache-Control", FAIL_CACHE);
    res.status(503).json({ error: "GAL search is disabled" });
    return;
  }

  const query = normalizeSearchQuery(req.query.q);
  if (!query) {
    res.set("Cache-Control", FAIL_CACHE);
    res.status(400).json({ error: "Missing query" });
    return;
  }

  const data = await fetchGalSearch(query);
  if (!data) {
    res.set("Cache-Control", FAIL_CACHE);
    res.status(404).json({ code: 1, error: "No result" });
    return;
  }

  res.set("Cache-Control", GAL_SEARCH_CACHE_CONTROL);
  res.json({ code: 0, data, query });
};

export const handleGalCoverRequest = createAcgImageRedirectHandler("gal");

export async function warmUpGal(): Promise<void> {
  await Promise.allSettled(WARMUP_GAL_MODES.map((m) => fetchGal(m)));
}
