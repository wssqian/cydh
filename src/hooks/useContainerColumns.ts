import { useEffect, useState, type RefObject } from "react";

/**
 * useContainerColumns — 基于容器真实可用宽度自适应计算列数
 *
 * 与 `useMasonryCols`（PixivPage）按 `window.innerWidth` 视口宽度算列数不同，
 * 本 hook 通过 ResizeObserver 读取容器 `contentRect.width`，从而扣除左侧 sidebar
 * padding、右侧 fixed 浮层安全区等占用，得到真正可用于排布列的宽度。
 * 这让列数与系统 OS 缩放、分辨率、分屏解耦——缩放改变容器 px 宽度，
 * hook 自动重算，而不是只在 Tailwind 静态断点处跳变。
 */

/**
 * 列数阈值表：升序排列的 { minWidth, cols }。
 * 计算规则：取容器宽度命中的最深一级（即最大的、不超过宽度的阈值）。
 * 宽度小于所有阈值时回落到第一个（最小列数）。
 */
export type ColumnBreakpoint = { minWidth: number; cols: number };

export const DEFAULT_COLUMN_BREAKPOINTS: ColumnBreakpoint[] = [
  { minWidth: 0, cols: 2 },
  { minWidth: 560, cols: 3 },
  { minWidth: 860, cols: 4 },
  { minWidth: 1180, cols: 5 },
  { minWidth: 1500, cols: 6 },
];

/** 根据容器宽度与阈值表计算列数（纯函数，便于 node 单测）。 */
export function colsForWidth(width: number, breakpoints: ColumnBreakpoint[]): number {
  let cols = breakpoints[0]?.cols ?? 2;
  for (const bp of breakpoints) {
    if (width >= bp.minWidth) cols = bp.cols;
  }
  return cols;
}

/**
 * distributeToColumns — Round-robin 瀑布流列分发
 * 参考 `PixivPage.tsx`，将条目按 `index % colCount` 分发到各列，
 * 保持 DOM 顺序且各列高度近似均匀。
 */
export function distributeToColumns<T>(items: T[], colCount: number): T[][] {
  const cols: T[][] = Array.from({ length: colCount }, () => []);
  items.forEach((item, i) => cols[i % colCount].push(item));
  return cols;
}

/**
 * @param ref    待测容器 ref
 * @param breakpoints  升序阈值表（默认 DEFAULT_COLUMN_BREAKPOINTS）
 * @returns 当前应渲染列数
 */
export function useContainerColumns(
  ref: RefObject<HTMLElement | null>,
  breakpoints: ColumnBreakpoint[] = DEFAULT_COLUMN_BREAKPOINTS,
): number {
  const [cols, setCols] = useState<number>(() => breakpoints[0]?.cols ?? 2);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const update = (width: number) => {
      const next = colsForWidth(width, breakpoints);
      setCols((prev) => (prev === next ? prev : next));
    };

    // 初始读一次，避免首屏停留在默认值
    update(el.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        update(entry.contentRect.width);
      }
    });
    observer.observe(el);

    return () => observer.disconnect();
    // breakpoints 数组稳定时引用不变；不稳定则在调用方 useMemo 兜底
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);

  return cols;
}
