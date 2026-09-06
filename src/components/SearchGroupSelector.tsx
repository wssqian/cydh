import { SEARCH_GROUPS, type SearchGroupId } from "../search-experience";
import { DropdownMenu, type DropdownMenuItem } from "./DropdownMenu";
import { ChevronDown } from "lucide-react";
import {
  Globe,
  Film,
  Download,
  BookOpen,
  Image,
  ScanSearch,
  Wrench,
} from "lucide-react";

// ─── 搜索分组图标映射 ───
const GROUP_ICONS: Record<SearchGroupId, typeof Globe> = {
  web: Globe,
  anime: Film,
  download: Download,
  manga: BookOpen,
  image: Image,
  reverseImage: ScanSearch,
  tools: Wrench,
};

export interface SearchGroupSelectorProps {
  /** 当前激活的分组 ID */
  activeGroupId: SearchGroupId;
  /** 分组变更回调 */
  onGroupChange: (id: SearchGroupId) => void;
  /** 额外自定义 className */
  className?: string;
}

/**
 * SearchGroupSelector — 搜索分组下拉选择器
 *
 * 基于 DropdownMenu 构建，替代原先的 SearchGroupSelect 内联实现。
 * 使用 renderTrigger 模式自定义触发按钮外观。
 */
export function SearchGroupSelector({
  activeGroupId,
  onGroupChange,
  className = "",
}: SearchGroupSelectorProps) {
  const activeGroup = SEARCH_GROUPS.find((g) => g.id === activeGroupId);
  const Icon = GROUP_ICONS[activeGroupId] || Globe;

  const items: DropdownMenuItem[] = SEARCH_GROUPS.map((group) => {
    const GIcon = GROUP_ICONS[group.id] || Globe;
    return {
      value: group.id,
      label: group.mobileLabel || group.label,
      icon: <GIcon className="h-4 w-4" />,
      selected: group.id === activeGroupId,
    };
  });

  return (
    <DropdownMenu
      items={items}
      onSelect={(value) => onGroupChange(value as SearchGroupId)}
      panelClassName="w-48"
      renderTrigger={({ isOpen, triggerRef }) => (
        <button
          ref={triggerRef}
          type="button"
          className={`flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 transition-all liquid-button glass-hover ${className}`}
        >
          {activeGroup && (
            <Icon className="h-4 w-4 text-pink-500 dark:text-pink-400 shrink-0" />
          )}
          <span>{activeGroup?.mobileLabel || activeGroup?.label || "选择"}</span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-200 ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </button>
      )}
    />
  );
}