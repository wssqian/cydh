import {
  findSearchGroup,
  type SearchGroupId,
  type SearchTarget,
} from "../search-experience";
import { ActionSheet, type ActionSheetItem } from "./ActionSheet";
import { Search } from "lucide-react";

export interface SearchProviderSheetProps {
  /** 是否打开 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 当前搜索分组 ID */
  groupId: SearchGroupId;
  /** 当前选中的目标 ID */
  activeTargetId: string;
  /** 选择回调 */
  onTargetChange: (targetId: string) => void;
}

/**
 * SearchProviderSheet — 移动端搜索来源选择面板
 *
 * 基于 ActionSheet 构建，为当前搜索分组的所有 targets 提供选择列表。
 * 已在 UnifiedSearchView 和 SearchOnlyHome 中使用。
 */
export function SearchProviderSheet({
  open,
  onClose,
  groupId,
  activeTargetId,
  onTargetChange,
}: SearchProviderSheetProps) {
  const group = findSearchGroup(groupId);

  const items: ActionSheetItem[] = group.targets.map((target: SearchTarget) => ({
    value: target.id,
    label: target.label,
    icon: <Search className="h-4 w-4" />,
  }));

  return (
    <ActionSheet
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={`选择搜索来源 · ${group.mobileLabel || group.label}`}
      items={items}
      selectedValues={activeTargetId}
      onSelect={(value) => {
        onTargetChange(value);
        onClose();
      }}
    />
  );
}