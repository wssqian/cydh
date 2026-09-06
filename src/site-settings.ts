export interface SiteSettings {
  site_name: string;
  footer_text: string;
  search_mode_label: string;
  navigation_search_placeholder: string;
  resource_search_placeholder: string;
  gal_search_enabled: boolean;
}

export const defaultSiteSettings: SiteSettings = {
  site_name: "次元导航",
  footer_text: "次元导航",
  search_mode_label: "纯搜索",
  navigation_search_placeholder: "🔍 搜索海量资源...",
  resource_search_placeholder: "搜索动漫、游戏、漫画...",
  gal_search_enabled: false,
};

export function mergeSiteSettings(settings: Partial<SiteSettings>) {
  const merged = { ...defaultSiteSettings, ...settings };
  // 服务端返回字符串 "true"/"false"，需转为 boolean
  if (typeof merged.gal_search_enabled === "string") {
    merged.gal_search_enabled = merged.gal_search_enabled === "true";
  }
  return merged;
}
