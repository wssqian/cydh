import type { Category, SiteResponse } from "./types";

export const NAVIGATION_DATA_UPDATED_EVENT = "navigation-data-updated";
const NAVIGATION_DATA_UPDATED_KEY = "navigationDataUpdatedAt";
// ★ 第一级导航分组 — 扩展为更细粒度的分类，避免所有内容涌入「其他导航」
export const NAVIGATION_GROUPS = [
  "次元社区",
  "影音娱乐",
  "实用工具",
  "资源下载",
  "社交网盘",
  "其他导航",
] as const;
export type NavigationGroup = typeof NAVIGATION_GROUPS[number];
export const DEFAULT_NAVIGATION_GROUP: NavigationGroup = "影音娱乐";

/**
 * 导航分组图标映射（用于移动端底部导航栏）
 */
export const NAVIGATION_GROUP_ICONS: Record<string, string> = {
  "收藏资源": "Star",
  "次元社区": "Globe",
  "影音娱乐": "Film",
  "实用工具": "Wrench",
  "资源下载": "Download",
  "社交网盘": "Share2",
  "其他导航": "Layers",
};

/**
 * 移动端导航分组数据（含图标和溢出标记）
 */
export interface MobileNavGroup {
  label: string;
  icon: string;
  /** 是否为"更多"溢出入口 */
  overflow?: boolean;
}

export interface MobileNavData {
  /** 底部标签栏（最多 5 个，末位可能为"更多"） */
  tabs: MobileNavGroup[];
  /** 折叠到"更多"中的溢出分组 */
  overflowTabs: MobileNavGroup[];
}

/**
 * 获取移动端底部导航栏分组。
 * - 分组 ≤5 时全部展示为 tab
 * - 分组 >5 时前 4 个为 tab，第 5 个为"更多"入口，其余折叠到 overflowTabs
 */
export function mobileNavigationGroups(communityUnlocked: boolean): MobileNavData {
  const groups = visibleNavigationGroups(communityUnlocked);
  const MAX_TABS = 5;

  const toGroup = (label: string): MobileNavGroup => ({
    label,
    icon: NAVIGATION_GROUP_ICONS[label] || "Circle",
  });

  if (groups.length <= MAX_TABS) {
    return { tabs: groups.map(label => toGroup(label)), overflowTabs: [] };
  }

  const tabs = groups.slice(0, MAX_TABS - 1).map(label => toGroup(label));
  const overflowTabs = groups.slice(MAX_TABS - 1).map(label => toGroup(label));
  tabs.push({ label: "更多", icon: "MoreHorizontal", overflow: true });

  return { tabs, overflowTabs };
}

interface NavigationSite {
  id?: number;
  category_id: number;
  name: string;
  url?: string;
  description?: string | null;
  tags?: string[];
  source: string | null;
  weight?: number;
}

export interface NavigationSection<S extends NavigationSite = SiteResponse> extends Category {
  sites: S[];
  restricted: boolean;
}

const RESTRICTED_CONTENT_PATTERN = /(?:\br\s*[-_ ]?\s*18\b|18\s*禁|成人(?:向|内容)?|限制级|nsfw|无码|里番)/i;
const COMMUNITY_CONTENT_PATTERN = /(美图|动漫|漫画|小说|ACG|ASMR|网盘|磁力|本子)/i;

export function initialSearchOnlyMode() {
  return true;
}

export function visibleNavigationGroups(communityUnlocked: boolean) {
  return NAVIGATION_GROUPS.filter((group) => communityUnlocked || group !== "次元社区");
}

export function isSiteVisibleOnHome(site: Pick<SiteResponse, "source">) {
  if (!site.source) {
    return true;
  }

  try {
    return !new URL(site.source).pathname.startsWith("/q/");
  } catch {
    return true;
  }
}

function isRestrictedText(text: string | null | undefined) {
  return Boolean(text && RESTRICTED_CONTENT_PATTERN.test(text));
}

export function isCommunityCategoryName(name: string | null | undefined) {
  return Boolean(name && !isRestrictedText(name) && COMMUNITY_CONTENT_PATTERN.test(name));
}

function isRestrictedSite(site: Pick<NavigationSite, "name" | "description" | "tags">) {
  return [site.name, site.description, ...(site.tags || [])].some(isRestrictedText);
}

export function sortSitesForDisplay<S extends NavigationSite>(sites: readonly S[]) {
  return [...sites].sort((left, right) => {
    const restrictedOrder = Number(isRestrictedSite(left)) - Number(isRestrictedSite(right));
    if (restrictedOrder !== 0) {
      return restrictedOrder;
    }

    return (right.weight || 0) - (left.weight || 0) || (right.id || 0) - (left.id || 0);
  });
}

export function buildNavigationSections<S extends NavigationSite>(
  categories: readonly Category[],
  sites: readonly S[],
) {
  return categories
    .map((category) => {
      const visibleSites = sortSitesForDisplay(
        sites.filter((site) => site.category_id === category.id && isSiteVisibleOnHome(site)),
      );
      return {
        ...category,
        sites: visibleSites,
        restricted: isRestrictedText(category.name) || visibleSites.some(isRestrictedSite),
      };
    })
    .filter((section) => section.sites.length > 0) as NavigationSection<S>[];
}

export function buildSidebarSections<S extends NavigationSite & { url: string }>(
  categories: readonly Category[],
  sites: readonly S[],
) {
  return categories
    .map((category) => {
      const visibleSites = sortSitesForDisplay(
        sites.filter((site) => site.category_id === category.id && site.url !== `/category/${category.slug}`),
      );
      return {
        ...category,
        sites: visibleSites,
        restricted: isRestrictedText(category.name) || visibleSites.some(isRestrictedSite),
      };
    })
    .filter((section) => section.sites.length > 0) as NavigationSection<S>[];
}

export function groupForSection(section: NavigationSection<NavigationSite>): NavigationGroup {
  if (section.restricted) {
    return "其他导航";
  }

  // ★ 次元社区 — ACG / 动漫 / 漫画 / 游戏 / 美图 / 小说 / ASMR 等
  if (isCommunityCategoryName(section.name)) {
    return "次元社区";
  }

  // ★ 影音娱乐 — 影视 / 音乐 / 直播 / 视频平台 / 影视评分 / 字幕
  if (/(影视|电影|电视剧|综艺|动漫[影视看]|在线[影视]|音乐|直播|视频平台|字幕|评分|电台|番剧|卡通|电影下载|追剧|看剧|影院|片库)/.test(section.name)) {
    return "影音娱乐";
  }

  // ★ 实用工具 — 软件 / 工具 / 办公 / 编程 / 图片编辑 / 浏览器扩展 / AI / 驱动 / 硬件
  if (/(工具|软件|素材|插件|扩展|AI|人工智能|办公|编程|代码|图片编辑|图像处理|驱动|硬件|天梯|系统|实用|效率|生产|思维导图|笔记|写作|OCR|翻译|压缩|解压|清理|优化|防毒|安全|密码|VPN|代理|测速|网速|存储|同步|备份|恢复)/.test(section.name)) {
    return "实用工具";
  }

  // ★ 资源下载 — 下载站 / 镜像 / APK / MOD / BT / 磁力 / 电子书 / 壁纸
  if (/(下载|镜像|APK|MOD|磁力|BT|种子|电子书|书籍|壁纸|资源[站库]|资源分享|网盘[搜索]|电影下载|游戏下载|软件下载|源码|模板|字体|素材[下库])/.test(section.name)) {
    return "资源下载";
  }

  // ★ 社交网盘 — 网盘 / 社交 / 论坛 / 社区 / 文件传输 / 邮箱 / 临时邮箱
  if (/(网盘|云盘|社交|论坛|社区|文件传输|互传|邮箱|邮件|临时邮箱|博客|微博|贴吧|群组|讨论|问答|知识分享)/.test(section.name)) {
    return "社交网盘";
  }

  // 兜底 → 其他导航
  return "其他导航";
}

export function groupNavigationSections<S extends NavigationSite>(sections: readonly NavigationSection<S>[]) {
  const groups = Object.fromEntries(
    NAVIGATION_GROUPS.map((group) => [group, [] as NavigationSection<S>[]]),
  ) as Record<NavigationGroup, NavigationSection<S>[]>;

  sections.forEach((section) => {
    groups[groupForSection(section)].push(section);
  });

  NAVIGATION_GROUPS.forEach((group) => {
    groups[group].sort((left, right) => (
      Number(left.restricted) - Number(right.restricted)
      || left.sort_order - right.sort_order
      || left.name.localeCompare(right.name, "zh-CN")
    ));
  });

  return groups;
}

export function announceNavigationDataUpdated() {
  window.localStorage.setItem(NAVIGATION_DATA_UPDATED_KEY, String(Date.now()));
  window.dispatchEvent(new Event(NAVIGATION_DATA_UPDATED_EVENT));
}

export function subscribeNavigationDataUpdated(callback: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === NAVIGATION_DATA_UPDATED_KEY) {
      callback();
    }
  };

  window.addEventListener(NAVIGATION_DATA_UPDATED_EVENT, callback);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(NAVIGATION_DATA_UPDATED_EVENT, callback);
    window.removeEventListener("storage", handleStorage);
  };
}
