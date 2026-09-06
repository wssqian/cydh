/* ─────────────────────────────────────────────
 * 响应式瀑布流共用 helper
 * 供 ACG 四页（Pixiv/番剧/漫画/GAL）复用同一套断点列数与 round-robin 分发逻辑。
 * ───────────────────────────────────────────── */
import { useEffect, useState } from "react";

/**
 * 按视口宽度返回瀑布流列数：
 * 2 列起步（移动端），3/3xl 之间逐级递增到 6 列。
 * 与 ACG 美图榜页既有断点保持一致。
 */
export function getMasonryBreakpointCols(): number {
  /* istanbul ignore next */
  if (typeof window === "undefined") return 4;
  if (window.innerWidth >= 1536) return 6;
  if (window.innerWidth >= 1024) return 5;
  if (window.innerWidth >= 768) return 4;
  if (window.innerWidth >= 640) return 3;
  return 2;
}

/**
 * 响应式瀑布流列数 Hook：监听断点 matchMedia 变化更新列数，
 * 避免每次 window resize 都重算（仅断点跨越时变化）。
 */
export function useMasonryCols(): number {
  const [cols, setCols] = useState(getMasonryBreakpointCols);

  useEffect(() => {
    const handler = () => setCols(getMasonryBreakpointCols());
    const queries = [
      window.matchMedia("(min-width: 1536px)"),
      window.matchMedia("(min-width: 1024px)"),
      window.matchMedia("(min-width: 768px)"),
      window.matchMedia("(min-width: 640px)"),
    ];
    queries.forEach((mql) => mql.addEventListener("change", handler));
    return () => queries.forEach((mql) => mql.removeEventListener("change", handler));
  }, []);

  return cols;
}

/**
 * 瀑布流列分组（Round-robin 分发保持 DOM 顺序）
 * 把扁平 items 数组按列号循环分发到各列容器，便于 flex 列渲染。
 */
export function distributeToColumns<T>(items: T[], colCount: number): T[][] {
  const cols: T[][] = Array.from({ length: colCount }, () => []);
  items.forEach((item, i) => cols[i % colCount].push(item));
  return cols;
}
