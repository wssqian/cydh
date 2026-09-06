import { useCallback, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Star,
  Globe,
  Film,
  Wrench,
  Layers,
  MoreHorizontal,
  Compass,
  type LucideIcon,
} from "lucide-react";
import {
  mobileNavigationGroups,
  type MobileNavGroup,
} from "../navigation-data";
import { FAVORITES_GROUP_LABEL } from "../favorites";
import { hapticFeedback } from "../utils/haptic";
import { ActionSheet, type ActionSheetItem } from "./ActionSheet";

/**
 * 底部导航栏图标映射
 */
const ICON_MAP: Record<string, LucideIcon> = {
  Star,
  Globe,
  Film,
  Wrench,
  Layers,
  MoreHorizontal,
  Compass,
};

function resolveIcon(iconName: string): LucideIcon {
  return ICON_MAP[iconName] || Compass;
}

interface MobileBottomNavProps {
  communityUnlocked: boolean;
  activeGroup: string;
  onGroupChange: (group: string) => void;
  /** 是否可见（搜索模式下隐藏） */
  visible?: boolean;
}

/**
 * MobileBottomNav — 移动端底部导航标签栏
 *
 * - ≤1023px 视口时固定定位在屏幕底部
 * - 最多展示 5 个标签（含"更多"溢出入口）
 * - 与 App.tsx 的 activeGroup/onGroupChange 联动
 * - `visible` prop 控制显示（搜索模式=false时完全隐藏）
 *
 * ⚠️ Hooks 规则：所有 React Hook（useState/useCallback/useEffect等）
 * 必须在早期 return 之前声明，确保跨渲染 Hook 调用顺序恒定。
 */
export function MobileBottomNav({
  communityUnlocked,
  activeGroup,
  onGroupChange,
  visible = true,
}: MobileBottomNavProps) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const { tabs, overflowTabs } = mobileNavigationGroups(communityUnlocked);
  const hasOverflow = overflowTabs.length > 0;

  // ── 所有 Hook 在此之上（visible early return 之下） ──
  const handleTabClick = useCallback(
    (group: MobileNavGroup) => {
      if (group.overflow) {
        setOverflowOpen((prev) => !prev);
        return;
      }
      setOverflowOpen(false);
      hapticFeedback.light();
      onGroupChange(group.label);
      if (location.pathname !== "/") {
        navigate("/");
      }
    },
    [onGroupChange, navigate, location.pathname],
  );

  const handleOverflowItemClick = useCallback(
    (group: MobileNavGroup) => {
      setOverflowOpen(false);
      hapticFeedback.light();
      onGroupChange(group.label);
      if (location.pathname !== "/") {
        navigate("/");
      }
    },
    [onGroupChange, navigate, location.pathname],
  );

  // ── 缓存溢出菜单项，避免每次渲染都新建 icon JSX 导致 ActionSheet 重算 ──
  const overflowItems: ActionSheetItem[] = useMemo(
    () =>
      overflowTabs.map((group) => {
        const Icon = resolveIcon(group.icon);
        return {
          value: group.label,
          label: group.label,
          icon: <Icon className="h-4 w-4" aria-hidden="true" />,
        };
      }),
    [overflowTabs],
  );

  const isActive = useCallback(
    (label: string): boolean => label === activeGroup && location.pathname === "/",
    [activeGroup, location.pathname],
  );

  // ── visible=false: 不渲染 DOM、不执行非 Hook 计算 ──
  if (!visible) return null;

  return (
    <>
      <nav className="mobile-bottom-nav" aria-label="主导航">
        <div className="mobile-bottom-nav-inner">
          {tabs.map((group) => {
            const Icon = resolveIcon(group.icon);
            const active = isActive(group.label);
            return (
              <button
                key={group.label}
                type="button"
                onClick={() => handleTabClick(group)}
                className={`mobile-bottom-nav-tab${active ? " active" : ""}`}
                aria-label={group.label}
                aria-current={active ? "page" : undefined}
              >
                <Icon
                  className="mobile-bottom-nav-icon"
                  aria-hidden="true"
                  strokeWidth={active ? 2.5 : 2}
                />
                <span className="mobile-bottom-nav-label">
                  {group.label}
                </span>
                {active && (
                  <span className="mobile-bottom-nav-indicator" />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* 溢出菜单 - 基于 ActionSheet */}
      <ActionSheet
        open={overflowOpen}
        onOpenChange={setOverflowOpen}
        title="切换分类"
        items={overflowItems}
        selectedValues={activeGroup}
        onSelect={(value) => {
          const group = overflowTabs.find((g) => g.label === value);
          if (group) handleOverflowItemClick(group);
        }}
      />
    </>
  );
}