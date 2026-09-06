export type SearchGroupId =
  | "web"
  | "anime"
  | "download"
  | "manga"
  | "image"
  | "reverseImage"
  | "tools";

export interface SearchTarget {
  id: string;
  label: string;
  placeholder: string;
  urlTemplate: string;
}

export interface SearchGroup {
  id: SearchGroupId;
  label: string;
  /** 移动端紧凑版标签（可选，省略时使用 label） */
  mobileLabel?: string;
  targets: SearchTarget[];
}

/** 获取某分组的搜索来源列表（移动端底部 Sheet 使用） */
export function getSearchTargetsForSheet(groupId: SearchGroupId): Array<{ id: string; label: string }> {
  const group = findSearchGroup(groupId);
  return group.targets.map(t => ({ id: t.id, label: t.label }));
}

export const SEARCH_GROUPS: SearchGroup[] = [
  {
    id: "web",
    label: "搜索",
    targets: [
      { id: "bing", label: "Bing", placeholder: "微软 Bing 搜索", urlTemplate: "https://cn.bing.com/search?q=%s%" },
      { id: "google", label: "Google", placeholder: "Google 搜索", urlTemplate: "https://www.google.com/search?q=%s%" },
      { id: "sogou", label: "搜狗", placeholder: "搜狗搜索", urlTemplate: "https://www.sogou.com/web?query=%s%" },
      { id: "360", label: "360", placeholder: "360 好搜", urlTemplate: "https://www.so.com/s?q=%s%" },
      { id: "yandex", label: "yandex", placeholder: "yandex 搜索", urlTemplate: "https://yandex.com/search/?text=%s%" },
      { id: "duckduckgo", label: "DuckDuckGo", placeholder: "DuckDuckGo 搜索", urlTemplate: "https://duckduckgo.com/?q=%s%" },
    ],
  },
  {
    id: "anime",
    label: "动漫",
    targets: [
      { id: "cyc-anime", label: "次元城动漫", placeholder: "次元城动漫", urlTemplate: "https://www.cyc-anime.net/search.html?wd=%s%" },
      { id: "girigiri", label: "girigiri爱动漫", placeholder: "girigiri爱动漫", urlTemplate: "https://anime.girigirilove.icu/search/-------------/?wd=%s%" },
      { id: "jzacg", label: "橘子动漫", placeholder: "橘子动漫", urlTemplate: "https://www.jzacg.com/search/-------------/?wd=%s%" },
      { id: "age", label: "AGE动漫", placeholder: "AGE 动漫", urlTemplate: "https://www.agemys.org/search?query=%s%" },
      { id: "bahamut", label: "动画疯", placeholder: "动画疯搜索，请输入繁体", urlTemplate: "https://ani.gamer.com.tw/search.php?keyword=%s%" },
      { id: "bilibili", label: "哔哩哔哩", placeholder: "哔哩哔哩", urlTemplate: "https://search.bilibili.com/bangumi?keyword=%s%" },
      { id: "acfun", label: "AcFun", placeholder: "AcFun", urlTemplate: "https://www.acfun.cn/search?type=bgm&keyword=%s%" },
    ],
  },
  {
    id: "download",
    label: "下载",
    targets: [
      { id: "dmhy", label: "动漫花园", placeholder: "动漫花园", urlTemplate: "https://share.dmhy.org/topics/list?keyword=%s%" },
      { id: "nyaa", label: "Nyaa", placeholder: "Nyaa.si", urlTemplate: "https://nyaa.si/?f=0&c=0_0&q=%s%" },
      { id: "mikan", label: "蜜柑计划", placeholder: "蜜柑计划", urlTemplate: "https://mikanime.tv/Home/Search?searchstr=%s%" },
    ],
  },
  {
    id: "manga",
    label: "漫画",
    targets: [
      { id: "dmzj", label: "动漫之家", placeholder: "动漫之家", urlTemplate: "https://manhua.dmzj.com/tags/search.shtml?s=%s%" },
      { id: "copymanga", label: "拷贝漫画", placeholder: "拷贝漫画", urlTemplate: "https://www.mangacopy.com/search?q=%s%" },
      { id: "komiic", label: "Komiic漫画", placeholder: "Komiic 漫画", urlTemplate: "https://komiic.com/search/%s%" },
      { id: "soman", label: "搜漫", placeholder: "搜漫", urlTemplate: "https://www.hisoman.com/search.html?keyword=%s%" },
    ],
  },
  {
    id: "image",
    label: "美图",
    targets: [
      { id: "pixiv-tag", label: "pixiv", placeholder: "pixiv", urlTemplate: "https://www.pixiv.net/tags/%s%" },
      { id: "pixiv-artwork", label: "pixiv作品", placeholder: "请输入作品 id", urlTemplate: "https://www.pixiv.net/artworks/%s%" },
      { id: "pixiv-user", label: "pixiv画师", placeholder: "请输入画师 id", urlTemplate: "https://www.pixiv.net/users/%s%/artworks" },
      { id: "pixiv-re", label: "pixiv作品反代", placeholder: "请输入作品 id", urlTemplate: "https://pixiv.re/%s%.png" },
    ],
  },
  {
    id: "reverseImage",
    label: "搜图",
    targets: [
      { id: "saucenao", label: "SauceNAO", placeholder: "请输入图片 url 链接", urlTemplate: "https://saucenao.com/search.php?url=%s%" },
      { id: "ascii2d", label: "二次元画像詳細検索", placeholder: "请输入图片 url 链接", urlTemplate: "https://ascii2d.net/search/url/%s%" },
      { id: "yandex-image", label: "yandex", placeholder: "请输入图片 url 链接", urlTemplate: "https://yandex.com/images/search?rpt=imageview&url=%s%" },
      { id: "google-lens", label: "google", placeholder: "请输入图片 url 链接", urlTemplate: "https://lens.google.com/uploadbyurl?url=%s%" },
      { id: "tineye", label: "tineye", placeholder: "请输入图片 url 链接", urlTemplate: "https://www.tineye.com/search/?url=%s%" },
      { id: "trace", label: "以图搜番", placeholder: "请输入图片 url 链接", urlTemplate: "https://trace.moe/?auto&url=%s%" },
    ],
  },
  {
    id: "tools",
    label: "工具",
    targets: [
      { id: "web-archive", label: "网页时光机", placeholder: "输入网址，不带 https:// 和 /", urlTemplate: "https://web.archive.org/web/*/%s%" },
      { id: "translate", label: "在线翻译", placeholder: "自动转中文（Google）", urlTemplate: "https://translate.google.com/?sl=auto&tl=zh-CN&text=%s%" },
      { id: "website-preview", label: "网站预览", placeholder: "输入网址", urlTemplate: "https://s0.wp.com/mshots/v1/%s%" },
      { id: "ping", label: "在线ping", placeholder: "输入网址，不带 https:// 和 /", urlTemplate: "https://www.itdog.cn/ping/%s%" },
    ],
  },
];

export const DEFAULT_SEARCH_GROUP_ID: SearchGroupId = "web";

/** 搜索分组图标名称映射（供组件层通过 lucide-react 查找对应图标组件） */
export const SEARCH_GROUP_ICON_NAMES: Record<SearchGroupId, string> = {
  web: "Globe",
  anime: "Film",
  download: "Download",
  manga: "BookOpen",
  image: "Image",
  reverseImage: "ScanSearch",
  tools: "Wrench",
};

export function findSearchGroup(groupId: SearchGroupId) {
  return SEARCH_GROUPS.find((group) => group.id === groupId) || SEARCH_GROUPS[0];
}

export function findSearchTarget(groupId: SearchGroupId, targetId: string) {
  const group = findSearchGroup(groupId);
  return group.targets.find((target) => target.id === targetId) || group.targets[0];
}

export function buildSearchTargetUrl(target: SearchTarget, query: string) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return "";
  }
  return target.urlTemplate.replace("%s%", encodeURIComponent(trimmedQuery));
}

// GAL 搜索平台配置 — 数据来源: searchbox.club/api
export type GalPlatformCategory = "resource" | "patch";

export interface GalSearchPlatform {
  id: string;
  name: string;
  url: string;
  category: GalPlatformCategory;
  /** 需要登录/付费等标记 */
  tags?: string[];
}

export const GAL_SEARCH_PLATFORMS: GalSearchPlatform[] = [
  // GAL 资源 (来源: api.searchbox.club/platforms/gal)
  { id: "steamgal",    name: "SteamGal",       url: "https://steamgalgame.com",        category: "resource" },
  { id: "shinnku",     name: "真红小站",        url: "https://www.shinnku.com",         category: "resource" },
  { id: "galzone",     name: "Gal领域",         url: "https://galgame.zone",            category: "resource" },
  { id: "kungal",      name: "鲲Galgame",       url: "https://www.kungal.com",          category: "resource" },
  { id: "inarigal",    name: "稻荷GAL",         url: "https://inarigal.com",            category: "resource" },
  { id: "nysoure",     name: "Nysoure",         url: "https://nysoure.com",             category: "resource", tags: ["magic"] },
  { id: "galgamex",    name: "Galgamex",        url: "https://www.galgamex.top",        category: "resource" },
  { id: "nullcloud",   name: "未知云盘",        url: "https://www.nullcloud.top",       category: "resource" },
  { id: "zi0",         name: "梓澪の妙妙屋",    url: "https://zi0.cc",                  category: "resource" },
  { id: "momoyu",      name: "摸摸鱼ACG",       url: "https://acgs.ccwink.com",         category: "resource" },
  { id: "qingju",      name: "青桔ACG",         url: "https://www.qingju.org",          category: "resource" },
  { id: "sayafx",      name: "月谣",            url: "https://www.sayafx.vip",           category: "resource" },
  { id: "lzacg",       name: "量子acg",         url: "https://lzacg.org",               category: "resource" },
  { id: "galzy",       name: "紫缘Gal",         url: "https://galzy.eu.org",             category: "resource" },
  { id: "ggbases",     name: "GGBases",         url: "https://www.ggbases.com",         category: "resource" },
  { id: "gallibrary",  name: "GAL图书馆",       url: "https://gallibrary.pw",            category: "resource" },
  { id: "acgs-one",    name: "绮梦ACG",         url: "https://game.acgs.one",            category: "resource" },
  { id: "nyantaku",    name: "喵源领域",        url: "https://www.nyantaku.com",         category: "resource", tags: ["Login"] },
  { id: "05fx",        name: "05的资源小站",    url: "https://05fx.022016.xyz",          category: "resource" },
  { id: "xxacg",       name: "xxacg",           url: "https://xxacg.net",                category: "resource", tags: ["Login", "magic"] },
  // GAL 补丁 (来源: api.searchbox.club/platforms/patch)
  { id: "kungal-patch", name: "鲲Galgame补丁",  url: "https://www.moyu.moe",            category: "patch" },
  { id: "2dfan",        name: "2dfan",           url: "https://2dfan.com",               category: "patch", tags: ["magic"] },
  { id: "yuaitongmeng", name: "御爱同萌",       url: "https://www.ai2.moe",             category: "patch" },
];

/** 生成平台搜索 URL（大多数站点直接跳转首页，由用户在站内搜索） */
export function buildGalPlatformSearchUrl(platform: GalSearchPlatform, query: string): string {
  const q = query.trim();
  if (!q) return platform.url;
  // 大多数站点不暴露公共搜索 API，直接跳转首页
  return platform.url;
}
