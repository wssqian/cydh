import type { RequestHandler } from "express";
import { createLogger } from "./logger";
import { acgFetch } from "./acg-proxy";
import { createAcgImageRedirectHandler } from "./acg-image-proxy";
import { loadCacheFile, saveCacheFile } from "./acg-file-cache";

const log = createLogger("MangaDex");
const CACHE_CONTROL = "public, max-age=3600";
const FAIL_CACHE = "no-store";

export interface MangaUpdateItem {
  id: string;
  title: string;
  originalTitle: string | null;
  altTitles: string[];
  description: string;
  status: string;
  year: number | null;
  contentRating: string;
  tags: string[];
  genres: string[];
  themes: string[];
  contentWarnings: string[];
  authors: string[];
  artists: string[];
  externalLinks: Array<{ label: string; url: string; group: "read" | "track" | "search" }>;
  coverUrl: string | null;
  latestChapter: string | null;
  latestChapterTitle: string | null;
  updatedAt: string;
  mangaUrl: string;
}

type MangaMode = "latest" | "followed" | "rating";
interface Cache { data: MangaUpdateItem[]; fetchedAt: number; fetchDate: string; }

const MANGA_MODES = new Set<MangaMode>(["latest", "followed", "rating"]);
const mangaCache = new Map<MangaMode, Cache>();
for (const m of MANGA_MODES) {
  const restored = loadCacheFile<MangaUpdateItem[]>(`manga-${m}`);
  if (restored) mangaCache.set(m, restored);
}
const CHINESE_LANGS = ["zh", "zh-hans", "zh-hant", "zh-cn", "zh-tw", "zh-hk", "zh-ro"];
const TAG_TRANSLATIONS: Record<string, string> = {
  "4-koma": "四格",
  action: "动作",
  adaptation: "改编",
  adventure: "冒险",
  "aliens": "外星人",
  animals: "动物",
  anthology: "短篇集",
  "award winning": "获奖作品",
  "boys' love": "耽美",
  comedy: "喜剧",
  cooking: "料理",
  crime: "犯罪",
  crossdressing: "异装",
  delinquents: "不良少年",
  demons: "恶魔",
  doujinshi: "同人志",
  drama: "剧情",
  fantasy: "奇幻",
  "fan colored": "粉丝上色",
  "full color": "全彩",
  "ghosts": "幽灵",
  "girls' love": "百合",
  gore: "血腥",
  gyaru: "辣妹",
  harem: "后宫",
  historical: "历史",
  horror: "恐怖",
  isekai: "异世界",
  "long strip": "条漫",
  "magic": "魔法",
  "magical girls": "魔法少女",
  "martial arts": "武术",
  mecha: "机甲",
  medical: "医疗",
  military: "军事",
  "monster girls": "魔物娘",
  monsters: "怪物",
  music: "音乐",
  mystery: "悬疑",
  ninja: "忍者",
  "office workers": "职场",
  "official colored": "官方彩色",
  oneshot: "单篇",
  philosophical: "哲学",
  police: "警察",
  "post-apocalyptic": "末世",
  psychological: "心理",
  reincarnation: "转生",
  romance: "恋爱",
  "samurai": "武士",
  "school life": "校园",
  "sci-fi": "科幻",
  "sexual violence": "性暴力",
  "slice of life": "日常",
  sports: "体育",
  superhero: "超级英雄",
  supernatural: "超自然",
  survival: "生存",
  thriller: "惊悚",
  "time travel": "时间旅行",
  tragedy: "悲剧",
  "traditional games": "传统游戏",
  vampires: "吸血鬼",
  "video games": "电子游戏",
  villainess: "恶役千金",
  "virtual reality": "虚拟现实",
  "web comic": "网络漫画",
  wuxia: "武侠",
  zombies: "丧尸",
};

function hourKey() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}-${String(n.getHours()).padStart(2,"0")}`;
}

function normalizeMangaMode(value: unknown): MangaMode {
  return typeof value === "string" && MANGA_MODES.has(value as MangaMode) ? value as MangaMode : "latest";
}

function pickByLanguages(values: Record<string, string> | undefined, languages: string[]): string {
  if (!values) return "";
  const normalized = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  for (const lang of languages) {
    const value = normalized.get(lang);
    if (value) return value;
  }
  return "";
}

function localizedText(values: Record<string, string> | undefined): string {
  if (!values) return "";
  return pickByLanguages(values, CHINESE_LANGS) || values["ja"] || values["en"] || Object.values(values)[0] || "";
}

function chineseText(values: Record<string, string> | undefined): string {
  return pickByLanguages(values, CHINESE_LANGS);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function collectTitles(attributes: any): { title: string; originalTitle: string | null; altTitles: string[] } {
  const primary = attributes?.title as Record<string, string> | undefined;
  const altTitleMaps = Array.isArray(attributes?.altTitles) ? attributes.altTitles as Array<Record<string, string>> : [];
  const chineseTitle = chineseText(primary) || altTitleMaps.map(chineseText).find(Boolean) || "";
  const fallbackTitle = localizedText(primary) || altTitleMaps.map(localizedText).find(Boolean) || "";
  const title = chineseTitle || fallbackTitle;
  const originalTitle = fallbackTitle && fallbackTitle !== title ? fallbackTitle : null;
  const altTitles = unique([
    ...altTitleMaps.map(chineseText),
    ...altTitleMaps.map(localizedText),
    originalTitle || "",
  ]).filter((value) => value !== title);
  return { title, originalTitle, altTitles: altTitles.slice(0, 5) };
}

function translateTag(name: string): string {
  return TAG_TRANSLATIONS[name.trim().toLowerCase()] || name;
}

function localizedTag(tag: any): { name: string; group: string } | null {
  const attributes = tag?.attributes;
  const name = chineseText(attributes?.name) || translateTag(attributes?.name?.en || localizedText(attributes?.name));
  if (!name) return null;
  return { name, group: attributes?.group || "theme" };
}

function relationshipNames(manga: any, type: "author" | "artist"): string[] {
  return unique((manga.relationships || [])
    .filter((relationship: any) => relationship.type === type)
    .map((relationship: any) => relationship.attributes?.name || ""));
}

function normalizeExternalUrl(value: unknown, builder: (id: string) => string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : builder(trimmed);
}

function buildExternalLinks(links: Record<string, unknown> | undefined): MangaUpdateItem["externalLinks"] {
  if (!links) return [];
  const definitions: Record<string, { label: string; group: "read" | "track" | "search"; build: (value: string) => string }> = {
    amz: { label: "Amazon 购买", group: "read", build: (value) => `https://www.amazon.co.jp/dp/${value}` },
    bw: { label: "BOOK☆WALKER", group: "read", build: (value) => `https://bookwalker.jp/${value}` },
    cdj: { label: "CDJapan", group: "read", build: (value) => `https://www.cdjapan.co.jp/product/${value}` },
    ebj: { label: "eBookJapan", group: "read", build: (value) => `https://ebookjapan.yahoo.co.jp/books/${value}` },
    raw: { label: "官方原文", group: "read", build: (value) => value },
    engtl: { label: "官方英文", group: "read", build: (value) => value },
    al: { label: "AniList", group: "track", build: (value) => `https://anilist.co/manga/${value}` },
    ap: { label: "Anime-Planet", group: "track", build: (value) => `https://www.anime-planet.com/manga/${value}` },
    kt: { label: "Kitsu", group: "track", build: (value) => `https://kitsu.io/manga/${value}` },
    mal: { label: "MyAnimeList", group: "track", build: (value) => `https://myanimelist.net/manga/${value}` },
    mu: { label: "MangaUpdates", group: "track", build: (value) => `https://www.mangaupdates.com/series/${value}` },
  };
  return Object.entries(definitions)
    .map(([key, definition]) => {
      const url = normalizeExternalUrl(links[key], definition.build);
      return url ? { label: definition.label, url, group: definition.group } : null;
    })
    .filter((link): link is MangaUpdateItem["externalLinks"][number] => Boolean(link));
}

function mapMangaItem(m: any, chapter?: any): MangaUpdateItem | null {
  const a = m.attributes;
  if (!a) return null;

  const coverRel = m.relationships?.find((r: any) => r.type === "cover_art");
  const coverFile = coverRel?.attributes?.fileName;
  const titles = collectTitles(a);
  const tagGroups = (a.tags || []).map(localizedTag).filter((tag: any): tag is { name: string; group: string } => Boolean(tag));
  const genres = unique(tagGroups.filter((tag) => tag.group === "genre").map((tag) => tag.name));
  const themes = unique(tagGroups.filter((tag) => tag.group === "theme" || tag.group === "format").map((tag) => tag.name));
  const contentWarnings = unique(tagGroups.filter((tag) => tag.group === "content").map((tag) => tag.name));

  return {
    id: m.id,
    title: titles.title || m.id,
    originalTitle: titles.originalTitle,
    altTitles: titles.altTitles,
    description: chineseText(a.description).slice(0, 320),
    status: a.status || "unknown",
    year: a.year ?? null,
    contentRating: a.contentRating || "safe",
    tags: unique([...genres, ...themes, ...contentWarnings]).slice(0, 10),
    genres,
    themes,
    contentWarnings,
    authors: relationshipNames(m, "author"),
    artists: relationshipNames(m, "artist"),
    externalLinks: buildExternalLinks(a.links),
    coverUrl: coverFile ? `https://uploads.mangadex.org/covers/${m.id}/${coverFile}.256.jpg` : null,
    latestChapter: chapter?.attributes?.chapter || null,
    latestChapterTitle: chapter?.attributes?.title || null,
    updatedAt: chapter?.attributes?.publishAt || a.updatedAt || a.createdAt || "",
    mangaUrl: `https://mangadex.org/title/${m.id}`,
  };
}

async function fetchLatestUpdates(cache: Cache | null): Promise<MangaUpdateItem[] | null> {
  log.info("MangaDex: fetching latest Chinese chapters...");
  const chRes = await acgFetch("/mangadex/chapter?order[publishAt]=desc&limit=50&translatedLanguage[]=zh&includes[]=manga&contentRating[]=safe&contentRating[]=suggestive");
  if (!chRes.ok) {
    log.error(`Chapters HTTP ${chRes.status}`);
    return cache?.data ?? null;
  }

  const chJson = (await chRes.json()) as { data: any[] };
  if (!chJson.data?.length) return cache?.data ?? null;

  const chapterByManga = new Map<string, any>();
  const mangaIds: string[] = [];
  for (const ch of chJson.data) {
    const rel = ch.relationships?.find((r: any) => r.type === "manga");
    if (rel && !chapterByManga.has(rel.id)) {
      chapterByManga.set(rel.id, ch);
      mangaIds.push(rel.id);
    }
  }
  if (!mangaIds.length) return cache?.data ?? null;

  const mUrl = `/mangadex/manga?limit=${mangaIds.length}&includes[]=cover_art&includes[]=author&includes[]=artist&contentRating[]=safe&contentRating[]=suggestive${mangaIds.map((id) => `&ids[]=${id}`).join("")}`;
  const mRes = await acgFetch(mUrl);
  if (!mRes.ok) {
    log.error(`Manga HTTP ${mRes.status}`);
    return cache?.data ?? null;
  }

  const mJson = (await mRes.json()) as { data: any[] };
  return (mJson.data || [])
    .map((m) => mapMangaItem(m, chapterByManga.get(m.id)))
    .filter((item): item is MangaUpdateItem => Boolean(item));
}

async function fetchRankedManga(mode: Exclude<MangaMode, "latest">, cache: Cache | null): Promise<MangaUpdateItem[] | null> {
  const order = mode === "followed" ? "followedCount" : "rating";
  log.info(`MangaDex: fetching ${mode} manga...`);
  const res = await acgFetch(`/mangadex/manga?limit=30&includes[]=cover_art&includes[]=author&includes[]=artist&availableTranslatedLanguage[]=zh&contentRating[]=safe&contentRating[]=suggestive&order[${order}]=desc`);
  if (!res.ok) {
    log.error(`Manga ${mode} HTTP ${res.status}`);
    return cache?.data ?? null;
  }

  const json = (await res.json()) as { data: any[] };
  if (!json.data?.length) return cache?.data ?? null;
  return json.data
    .map((m) => mapMangaItem(m))
    .filter((item): item is MangaUpdateItem => Boolean(item));
}

export async function getMangaUpdates(mode: MangaMode = "latest"): Promise<MangaUpdateItem[] | null> {
  const key = hourKey();
  const cache = mangaCache.get(mode) || null;
  if (cache && cache.fetchDate === key) return cache.data;

  try {
    const items = mode === "latest"
      ? await fetchLatestUpdates(cache)
      : await fetchRankedManga(mode, cache);
    if (!items) return cache?.data ?? null;

    mangaCache.set(mode, { data: items, fetchedAt: Date.now(), fetchDate: key });
    saveCacheFile(`manga-${mode}`, mangaCache.get(mode)!);
    log.info(`MangaDex ${mode}: ${items.length} manga`);
    return items;
  } catch (err) {
    log.error(`MangaDex ${mode} failed:`, err);
    return cache?.data ?? null;
  }
}

export const handleMangaUpdatesRequest: RequestHandler = async (req, res) => {
  const mode = normalizeMangaMode(req.query.mode);
  const data = await getMangaUpdates(mode);
  if (!data) {
    res.set("Cache-Control", FAIL_CACHE);
    res.status(502).json({ error: "Failed" });
    return;
  }
  res.set("Cache-Control", CACHE_CONTROL);
  res.json({ code: 0, data, mode });
};

export const handleMangaCoverRequest = createAcgImageRedirectHandler("manga");

export async function warmUpManga(): Promise<void> {
  await Promise.allSettled(
    (["latest", "followed", "rating"] as MangaMode[]).map((m) => getMangaUpdates(m))
  );
}
