import { createContext, useContext } from 'react';
import { DEFAULT_NAVIGATION_GROUP, type NavigationGroup } from './navigation-data';
import { defaultSiteSettings, type SiteSettings } from './site-settings';
import type { Category, SiteResponse } from './types';

type GroupContextType = {
  activeGroup: NavigationGroup | string;
  setActiveGroup: (group: NavigationGroup | string) => void;
  searchOnlyMode: boolean;
  communityUnlocked: boolean;
  /** 首次探查服务端社区会话前的 loading 态 */
  communityChecking: boolean;
  /** 提交口令到服务端解锁；成功 true、失败 false */
  unlockCommunity: (password: string) => Promise<boolean>;
  /** 登出当前社区会话 */
  logoutCommunity: () => Promise<void>;
  /** 标记社区会话已失效（请求 401 时回退到门禁，让用户重新输入口令） */
  markCommunityLocked: () => void;
  categories: Category[];
  sites: SiteResponse[];
  navigationLoading: boolean;
  navigationError: string;
  siteSettings: SiteSettings;
  onHotContentTopChange?: (top: number | null) => void;
  favorites: Set<number>;
  onToggleFavorite: (siteId: number) => void;
};

export const GroupContext = createContext<GroupContextType>({
  activeGroup: DEFAULT_NAVIGATION_GROUP,
  setActiveGroup: () => {},
  searchOnlyMode: false,
  communityUnlocked: false,
  communityChecking: true,
  unlockCommunity: async () => false,
  logoutCommunity: async () => {},
  markCommunityLocked: () => {},
  categories: [],
  sites: [],
  navigationLoading: true,
  navigationError: "",
  siteSettings: defaultSiteSettings,
  favorites: new Set(),
  onToggleFavorite: () => {},
});

export function useGroup() {
  return useContext(GroupContext);
}
