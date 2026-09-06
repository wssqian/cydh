import type { RequestHandler } from "express";
import { createLogger } from "./logger";
import { acgFetch } from "./acg-proxy";
import { createAcgImageRedirectHandler } from "./acg-image-proxy";
import { loadCacheFile, saveCacheFile } from "./acg-file-cache";

const log = createLogger("Pixiv");
const CACHE_CONTROL = "public, max-age=3600";
const FAIL_CACHE = "no-store";

export interface PixivIllustItem {
  rank: number; title: string; author: string; illustId: string;
  coverUrl: string; originalUrl: string | null; description: string; tags: string[];
  viewCount: number; uploadDate: string | null; pageCount: number; width: number | null; height: number | null; pixivUrl: string;
}
type PixivMode = "daily" | "weekly" | "monthly" | "rookie" | "original";
interface Cache { data: PixivIllustItem[]; fetchedAt: number; fetchDate: string; }
const rankingCache = new Map<PixivMode, Cache>();
const PIXIV_MODES = new Set<PixivMode>(["daily", "weekly", "monthly", "rookie", "original"]);
for (const m of PIXIV_MODES) {
  const restored = loadCacheFile<PixivIllustItem[]>(`pixiv-${m}`);
  if (restored) rankingCache.set(m, restored);
}
function todayStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;
}

function normalizePixivMode(value: unknown): PixivMode {
  return typeof value === "string" && PIXIV_MODES.has(value as PixivMode) ? value as PixivMode : "daily";
}

const PIXIV_TAG_TRANSLATIONS: Record<string, string> = {
  "オリジナル": "原创",
  "女の子": "女孩子",
  "男の子": "男孩子",
  "初音ミク": "初音未来",
  "東方": "东方",
  "アークナイツ": "明日方舟",
  "ブルーアーカイブ": "蔚蓝档案",
  "原神": "原神",
  "崩壊:スターレイル": "崩坏：星穹铁道",
  "崩壊3rd": "崩坏3",
  "Fate/GrandOrder": "Fate/Grand Order",
  "ウマ娘": "赛马娘",
  "アイドルマスター": "偶像大师",
  "艦隊これくしょん": "舰队收藏",
  "ホロライブ": "Hololive",
  "VTuber": "虚拟主播",
  "創作": "原创",
  "漫画": "漫画",
  "イラスト": "插画",
  "風景": "风景",
  "制服": "制服",
  "水着": "泳装",
  "メイド": "女仆",
  "百合": "百合",
  "ケモミミ": "兽耳",
  "猫耳": "猫耳",
};

function cleanDescription(value: unknown): string {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, "").trim().slice(0, 200) : "";
}

function translatePixivTag(tag: unknown): string {
  const value = typeof tag === "string" ? tag.trim() : "";
  return PIXIV_TAG_TRANSLATIONS[value] || value;
}

function normalizeUploadDate(value: any): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  return null;
}

/**
 * 把 ranking 的封面 URL 派生为浏览器可直接 fetch 的原图 URL。
 * 路径推断：去 /c/<size>/ 前缀、/img-master/ -> /img-original/、去 _master1200 后缀。
 * 出口固定走 CF CDN 镜像（i0.wp.com/i.pximg.org），返 ACAO:* 可直接 fetch。
 */
function inferOriginalImageUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  try {
    const parsed = new URL(url);
    let pathname = parsed.pathname.replace(/^\/c\/[^/]+\/?/i, "/");
    pathname = pathname.replace("/img-master/", "/img-original/");
    pathname = pathname.replace(/_(?:master|square)\d+\.(jpg|jpeg|png|webp)$/i, ".$1");
    if (!pathname.includes("/img-original/")) return null;
    return `https://i0.wp.com/i.pximg.org${pathname}`;
  } catch {
    return null;
  }
}

async function fetchRanking(mode: PixivMode): Promise<PixivIllustItem[]|null> {
  const cache = rankingCache.get(mode) || null;
  const todayKey = todayStr();
  if (cache && cache.fetchDate === todayKey) return cache.data;
  try {
    const res = await acgFetch(`/pixiv/ranking.php?mode=${mode}&content=illust&p=1&format=json`);
    if (!res.ok) { log.error(`Pixiv ${mode} HTTP ${res.status}`); return cache?.data??null; }
    const json = (await res.json()) as { contents?: any[] };
    if (!json.contents?.length) return cache?.data??null;
    const items: PixivIllustItem[] = json.contents.map((c: any) => ({
      rank: c.rank, title: c.title, author: c.user_name, illustId: String(c.illust_id),
      coverUrl: typeof c.url === "string" ? c.url : "",
      // 原图直链在响应时由 handlePixivRankingRequest 按当前 Worker/CDN 策略实时派生，
      // 不写入缓存，避免缓存命中旧格式后策略变更无法生效。
      originalUrl: null,
      description: cleanDescription(c.description),
      tags: Array.isArray(c.tags) ? c.tags.map(translatePixivTag).filter(Boolean) : [],
      viewCount: c.view_count||0,
      uploadDate: normalizeUploadDate(c.date || c.illust_upload_timestamp),
      pageCount: Number(c.illust_page_count || c.page_count || 1) || 1,
      width: Number.isFinite(Number(c.width)) ? Number(c.width) : null,
      height: Number.isFinite(Number(c.height)) ? Number(c.height) : null,
      pixivUrl: `https://www.pixiv.net/artworks/${c.illust_id}`,
    }));
    const newC = { data: items, fetchedAt: Date.now(), fetchDate: todayKey };
    rankingCache.set(mode, newC);
    saveCacheFile(`pixiv-${mode}`, newC);
    log.info(`Pixiv ${mode}: ${items.length} items`);
    return items;
  } catch (err) { log.error(`Pixiv ${mode} failed:`, err); return cache?.data??null; }
}

export const handlePixivRankingRequest: RequestHandler = async (req, res) => {
  const mode = normalizePixivMode(req.query.mode);
  const data = await fetchRanking(mode);
  if (!data) { res.set("Cache-Control", FAIL_CACHE); res.status(502).json({ error: "Failed" }); return; }
  // 响应时实时派生原图直链，旧缓存（originalUrl=null）随策略变化即时迁移。
  const served = data.map((it) =>
    it.coverUrl ? { ...it, originalUrl: inferOriginalImageUrl(it.coverUrl) } : it,
  );
  res.set("Cache-Control", CACHE_CONTROL);
  res.json({ code: 0, data: served, mode });
};

export const handlePixivImageRequest = createAcgImageRedirectHandler("pixiv");

export async function warmUpPixiv(): Promise<void> {
  await Promise.allSettled(
    (["daily", "weekly", "monthly", "rookie"] as PixivMode[]).map((m) => fetchRanking(m))
  );
}
