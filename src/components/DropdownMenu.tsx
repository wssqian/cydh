import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
  type KeyboardEvent,
  type HTMLAttributes,
} from "react";
import { Check } from "lucide-react";

// ─── 类型定义 ────────────────────────────────────────────────

export interface DropdownMenuItem {
  /** 菜单项类型 */
  type?: "item" | "divider" | "section";
  /** 唯一标识值 */
  value?: string;
  /** 显示标签 */
  label?: string;
  /** 可选图标（lucide-react 组件） */
  icon?: ReactNode;
  /** 可选描述文本 */
  description?: string;
  /** 键盘快捷键提示 */
  shortcut?: string;
  /** 禁用状态 */
  disabled?: boolean;
  /** 选中状态 */
  selected?: boolean;
  /** 项点击回调（覆盖父级 onSelect） */
  onSelect?: (value: string) => void;
}

export interface DropdownMenuProps {
  // ── 受控模式 ──
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  // ── 非受控模式 ──
  defaultOpen?: boolean;
  // ── 内容 ──
  /** 菜单项列表 */
  items: DropdownMenuItem[];
  /** 选择回调（接受 value） */
  onSelect?: (value: string) => void;
  /** 菜单打开时回调 */
  onOpen?: () => void;
  /** 面板 className */
  panelClassName?: string;
  /** aria label */
  ariaLabel?: string;
  // ── 触发元素 ──
  /** 触发按钮内容（如果在非 renderProp 模式下使用） */
  triggerLabel?: string;
  triggerIcon?: ReactNode;
  triggerClassName?: string;
  // ── render prop: 自定义触发元素 ──
  children?: ReactNode;
  /** render 模式：children 为函数 (props) => ReactNode */
  renderTrigger?: (props: {
    isOpen: boolean;
    toggle: () => void;
    triggerRef: React.RefObject<HTMLButtonElement | null>;
  }) => ReactNode;
}

// ─── 组件 ─────────────────────────────────────────────────────

export function DropdownMenu({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  items,
  onSelect: parentOnSelect,
  onOpen,
  panelClassName = "",
  ariaLabel = "Menu",
  triggerLabel,
  triggerIcon,
  triggerClassName = "",
  children,
  renderTrigger,
}: DropdownMenuProps) {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = isControlled ? controlledOpen : internalOpen;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef<{ chars: string; timer: ReturnType<typeof setTimeout> | null }>({ chars: "", timer: null });
  // D2: 直接响应 internalOpen，不经过 visible/animating 两阶段
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

  const toggle = useCallback(() => {
    if (!open) onOpen?.();
    setOpen(!open);
  }, [open, setOpen, onOpen]);

  // ── 入场/退场动画管理：直接响应 open ──
  useEffect(() => {
    if (open) {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setLeaving(false);
      // 打开后聚焦首项
      requestAnimationFrame(() => {
        const firstItem = panelRef.current?.querySelector<HTMLButtonElement>(
          '[role="menuitem"]:not([disabled])'
        );
        firstItem?.focus();
      });
    } else {
      // 退出：保持 DOM 挂载以便 exit 动画播放完成
      setLeaving(true);
      closeTimerRef.current = window.setTimeout(() => {
        setLeaving(false);
      }, 150);
    }
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [open]);

  // ── 点击外部关闭 ──
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        panelRef.current &&
        !panelRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    // delay 避免打开事件的同一 click 触发关闭
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [open, setOpen]);

  // ── 键盘处理 ──
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;

      const focusable = Array.from(
        panel.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
      );

      // Trigger handler
      if (e.currentTarget === triggerRef.current) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (!open) {
            setOpen(true);
            onOpen?.();
          }
        }
        return;
      }

      const currentIdx = focusable.indexOf(document.activeElement as HTMLButtonElement);

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
          break;
        case "ArrowDown":
          e.preventDefault();
          if (currentIdx < focusable.length - 1) {
            focusable[currentIdx + 1].focus();
          } else {
            focusable[0].focus();
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          if (currentIdx > 0) {
            focusable[currentIdx - 1].focus();
          } else {
            focusable[focusable.length - 1].focus();
          }
          break;
        case "Home":
          e.preventDefault();
          focusable[0].focus();
          break;
        case "End":
          e.preventDefault();
          focusable[focusable.length - 1].focus();
          break;
        case "Tab":
          // 非焦点陷阱：Tab 关闭菜单
          e.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
          break;
        default:
          // Type-ahead: 单字符匹配
          if (e.key.length === 1 && e.key.match(/\S/)) {
            e.preventDefault();
            const chars = typeaheadRef.current;
            chars.chars += e.key.toLowerCase();
            if (chars.timer) clearTimeout(chars.timer);
            chars.timer = setTimeout(() => { chars.chars = ""; }, 500);

            const matchIdx = focusable.findIndex((btn) => {
              const label = btn.textContent?.trim().toLowerCase() || "";
              return label.startsWith(chars.chars);
            });
            if (matchIdx >= 0) focusable[matchIdx].focus();
          }
          break;
      }
    },
    [open, setOpen, onOpen],
  );

  // ── 项选择处理 ──
  const handleItemSelect = useCallback(
    (item: DropdownMenuItem) => {
      if (item.disabled) return;
      const value = item.value || item.label || "";
      if (item.onSelect) {
        item.onSelect(value);
      } else {
        parentOnSelect?.(value);
      }
      setOpen(false);
    },
    [parentOnSelect, setOpen],
  );

  // ── 默认触发按钮 ──
  const defaultTrigger = (
    <button
      ref={triggerRef}
      type="button"
      onClick={toggle}
      onKeyDown={handleKeyDown}
      aria-haspopup="menu"
      aria-expanded={open}
      className={`dropdown-menu-trigger ${triggerClassName}`}
    >
      {triggerIcon && <span className="shrink-0">{triggerIcon}</span>}
      {triggerLabel && <span>{triggerLabel}</span>}
    </button>
  );

  const triggerContent = renderTrigger
    ? renderTrigger({ isOpen: open, toggle, triggerRef })
    : children || defaultTrigger;

  return (
    <div className="dropdown-menu-container">
      {triggerContent}
      {(open || leaving) && (
        <div
          ref={panelRef}
          role="menu"
          aria-label={ariaLabel}
          aria-orientation="vertical"
          onKeyDown={handleKeyDown}
          className={`dropdown-menu-panel ${panelClassName} ${open ? "dropdown-menu-panel-enter" : "dropdown-menu-panel-exit"}`}
        >
          {items.map((item, idx) => {
            if (item.type === "divider") {
              return <div key={`div-${idx}`} className="dropdown-menu-divider my-1" role="separator" />;
            }
            if (item.type === "section") {
              return (
                <div key={`sec-${idx}`} className="dropdown-menu-section-header px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {item.label}
                </div>
              );
            }
            return (
              <button
                key={item.value || `item-${idx}`}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => handleItemSelect(item)}
                className={`dropdown-menu-item flex w-full items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                  item.disabled
                    ? "opacity-40 cursor-not-allowed"
                    : item.selected
                      ? "bg-pink-50/60 text-pink-600 font-medium dark:bg-pink-900/20 dark:text-pink-400"
                      : "text-slate-700 hover:bg-black/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.06]"
                }`}
              >
                {item.icon && (
                  <span className={`shrink-0 h-4 w-4 flex items-center justify-center ${item.selected ? "text-pink-500" : "text-slate-400 dark:text-slate-500"}`}>
                    {item.icon}
                  </span>
                )}
                <span className="flex-1">{item.label}</span>
                {item.description && (
                  <span className="text-xs text-slate-400 dark:text-slate-500">{item.description}</span>
                )}
                {item.shortcut && (
                  <span className="ml-auto text-xs text-slate-400 dark:text-slate-500 font-mono tracking-tight">
                    {item.shortcut}
                  </span>
                )}
                {item.selected && <Check className="h-3.5 w-3.5 text-pink-500 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}