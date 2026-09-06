import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import { Check, X } from "lucide-react";
import { hapticFeedback } from "../utils/haptic";

// ─── 类型定义 ────────────────────────────────────────────────

export interface ActionSheetItem {
  /** 唯一标识值 */
  value: string;
  /** 显示标签 */
  label: string;
  /** 可选图标（lucide-react 组件） */
  icon?: ReactNode;
  /** 可选描述文本 */
  description?: string;
  /** 禁用状态 */
  disabled?: boolean;
  /** 视觉变体 */
  variant?: "default" | "destructive";
  /** 分组名称（同组项聚在一起，组间有分隔线） */
  group?: string;
}

export interface ActionSheetProps {
  // ── 受控模式 ──
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  // ── 非受控模式 ──
  defaultOpen?: boolean;
  // ── 内容 ──
  /** 顶部标题 */
  title?: string;
  /** 选项列表 */
  items: ActionSheetItem[];
  /** 当前选中值（高亮对应项） */
  selectedValues?: string | string[];
  /** 选择回调 */
  onSelect?: (value: string) => void;
  /** 选择后是否自动关闭（默认 true） */
  closeOnSelect?: boolean;
  /** 多选模式（`selectedValues` 为数组时自动启用） */
  multiSelect?: boolean;
  /** 底部取消按钮文案（默认"取消"） */
  cancelLabel?: string;
  /** 取消回调 */
  onCancel?: () => void;
  /** 自定义 className */
  className?: string;
  /** 屏幕阅读器标签 */
  ariaLabel?: string;
}

// ─── 组件 ─────────────────────────────────────────────────────

export function ActionSheet({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  title,
  items,
  selectedValues,
  onSelect,
  closeOnSelect = true,
  multiSelect: multiSelectProp,
  cancelLabel = "取消",
  onCancel,
  className = "",
  ariaLabel,
}: ActionSheetProps) {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = isControlled ? controlledOpen : internalOpen;
  const isMulti = multiSelectProp ?? (Array.isArray(selectedValues));

  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  // D1: 直接响应 open，不再经过 visible/animating 两阶段
  const [leaving, setLeaving] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  // ── 打开/关闭 ──
  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      controlledOnOpenChange?.(next);
    },
    [isControlled, controlledOnOpenChange],
  );

  const close = useCallback(() => {
    setOpen(false);
    onCancel?.();
  }, [setOpen, onCancel]);

  // ── 入场/退场动画管理：直接响应 open，移除两阶段渲染 ──
  useEffect(() => {
    if (open) {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setLeaving(false);
      triggerRef.current = document.activeElement as HTMLElement | null;
      document.body.style.overflow = "hidden";
      // 打开后聚焦首项
      requestAnimationFrame(() => firstItemRef.current?.focus());
      return () => {
        document.body.style.overflow = "";
      };
    } else {
      // 退出：设置 leaving 保持 DOM 挂载，以便 exit 动画播放完成后才 unmount
      setLeaving(true);
      closeTimerRef.current = window.setTimeout(() => {
        setLeaving(false);
        document.body.style.overflow = "";
        triggerRef.current?.focus();
        triggerRef.current = null;
      }, 200);
      return () => {
        if (closeTimerRef.current) {
          clearTimeout(closeTimerRef.current);
          closeTimerRef.current = null;
        }
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  // ── 选择处理 ──
  const handleSelect = useCallback(
    (value: string) => {
      hapticFeedback.light();
      onSelect?.(value);
      if (closeOnSelect) {
        setOpen(false);
      }
    },
    [onSelect, closeOnSelect, setOpen],
  );

  // ── 键盘处理 ──
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;

      const focusableButtons = Array.from(
        panel.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]:not([disabled]), [data-action="cancel"]'
        )
      );
      const currentIdx = focusableButtons.indexOf(document.activeElement as HTMLButtonElement);

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          close();
          break;
        case "ArrowDown":
          e.preventDefault();
          if (currentIdx < focusableButtons.length - 1) {
            focusableButtons[currentIdx + 1].focus();
          } else {
            focusableButtons[0].focus();
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          if (currentIdx > 0) {
            focusableButtons[currentIdx - 1].focus();
          } else {
            focusableButtons[focusableButtons.length - 1].focus();
          }
          break;
        case "Home":
          e.preventDefault();
          focusableButtons[0].focus();
          break;
        case "End":
          e.preventDefault();
          focusableButtons[focusableButtons.length - 1].focus();
          break;
        case "Tab":
          // 焦点陷阱：Tab 在最后和第一个之间循环
          e.preventDefault();
          if (e.shiftKey) {
            focusableButtons[focusableButtons.length - 1].focus();
          } else {
            focusableButtons[0].focus();
          }
          break;
      }
    },
    [close],
  );

  // ── 分组处理 ──
  const grouped = useMemo(() => groupItems(items), [items]);

  // ── 选中状态判断 ──
  const isSelected = (value: string) => {
    if (Array.isArray(selectedValues)) return selectedValues.includes(value);
    return selectedValues === value;
  };

  if (!open && !leaving) return null;

  return (
    <>
      {/* 背景遮罩 */}
      <div
        className={`action-sheet-backdrop ${open ? "action-sheet-backdrop-enter" : "action-sheet-backdrop-exit"}`}
        onClick={close}
        aria-hidden="true"
      />
      {/* 面板 */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || title || "Actions"}
        aria-labelledby={title ? "action-sheet-title" : undefined}
        className={`action-sheet ${className} ${open ? "action-sheet-enter" : "action-sheet-exit"}`}
        onKeyDown={handleKeyDown}
        style={{ overscrollBehavior: "contain" }}
      >
        <div className="action-sheet-container mx-auto w-full max-w-lg glass-card rounded-t-3xl px-2 pb-6 pt-2">
          {/* 拖动手柄 */}
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-300/60 dark:bg-slate-600/60" />

          {/* 标题 */}
          {title && (
            <div id="action-sheet-title" className="px-4 pb-2 pt-1 text-sm font-medium text-slate-500 dark:text-slate-400">
              {title}
            </div>
          )}

          {/* 选项列表 */}
          <div className="action-sheet-items max-h-[50vh] overflow-y-auto px-2">
            {grouped.map((group, gi) => (
              <div key={gi} className="action-sheet-group">
                {group.label && (
                  <div className="action-sheet-group-header px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    {group.label}
                  </div>
                )}
                {group.items.map((item) => {
                  const selected = isSelected(item.value);
                  const isDestructive = item.variant === "destructive";
                  return (
                    <button
                      key={item.value}
                      ref={gi === 0 && group.items.indexOf(item) === 0 ? firstItemRef : undefined}
                      type="button"
                      role="menuitem"
                      disabled={item.disabled}
                      onClick={() => {
                        if (!item.disabled) handleSelect(item.value);
                      }}
                      className={`action-sheet-item flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors ${
                        item.disabled
                          ? "opacity-40 cursor-not-allowed"
                          : selected && !isMulti
                            ? "bg-pink-50 text-pink-600 font-medium dark:bg-pink-900/20 dark:text-pink-400"
                            : selected && isMulti
                              ? "bg-pink-50/50 text-pink-600 dark:bg-pink-900/10 dark:text-pink-400"
                              : isDestructive
                                ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                                : "text-slate-700 hover:bg-black/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.06]"
                      }`}
                    >
                      {item.icon && (
                        <span className={`shrink-0 ${selected ? "text-pink-500 dark:text-pink-400" : isDestructive ? "text-red-500" : "text-slate-400 dark:text-slate-500"}`}>
                          {item.icon}
                        </span>
                      )}
                      <span className="flex-1 text-sm">{item.label}</span>
                      {item.description && (
                        <span className="text-xs text-slate-400 dark:text-slate-500">{item.description}</span>
                      )}
                      {isMulti && selected && (
                        <Check className="h-4 w-4 text-pink-500 shrink-0" />
                      )}
                      {!isMulti && selected && (
                        <Check className="h-4 w-4 text-pink-500 shrink-0" />
                      )}
                    </button>
                  );
                })}
                {/* 组间分隔线 */}
                {gi < grouped.length - 1 && (
                  <div className="mx-4 my-1 border-t border-slate-200/50 dark:border-slate-700/50" />
                )}
              </div>
            ))}
          </div>

          {/* 取消按钮 */}
          <button
            type="button"
            data-action="cancel"
            onClick={close}
            className="mt-3 w-full rounded-xl py-3 text-center text-sm font-medium text-slate-500 hover:bg-black/[0.04] dark:text-slate-400 dark:hover:bg-white/[0.06] transition-colors"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── 工具函数 ─────────────────────────────────────────────────

function groupItems(
  items: ActionSheetItem[]
): Array<{ label?: string; items: ActionSheetItem[] }> {
  const map = new Map<string | undefined, ActionSheetItem[]>();
  const order: (string | undefined)[] = [];

  for (const item of items) {
    if (!map.has(item.group)) {
      map.set(item.group, []);
      order.push(item.group);
    }
    map.get(item.group)!.push(item);
  }

  return order.map((label) => ({
    label,
    items: map.get(label)!,
  }));
}