import { useState, useCallback } from "react";

/**
 * useActionSheet — 封装 ActionSheet 的打开/关闭状态
 *
 * 使用方式：
 *   const sheet = useActionSheet();
 *   <button onClick={sheet.openSheet}>打开</button>
 *   <ActionSheet open={sheet.open} onOpenChange={sheet.setOpen} ... />
 */
export function useActionSheet(defaultOpen = false) {
  const [open, setOpen] = useState(defaultOpen);

  const openSheet = useCallback(() => setOpen(true), []);
  const closeSheet = useCallback(() => setOpen(false), []);
  const toggleSheet = useCallback(() => setOpen((prev) => !prev), []);

  return { open, setOpen, openSheet, closeSheet, toggleSheet };
}