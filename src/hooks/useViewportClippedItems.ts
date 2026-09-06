import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

/**
 * useViewportClippedItems — 热点卡片虚拟滚动 hook
 *
 * 设计意图（纯搜索界面热点展示）：
 *   按"实时加载"语义 —— 滚动时动态显示/隐藏进入/离开视口的卡片，
 *   避免一次性渲染上百张卡片导致的 DOM/内存开销。
 *
 * 工作机制：
 *   1. 维护渲染区间 [visibleStart, visibleEnd]，初始 [0, preRenderCount)
 *   2. 在区间末尾放底 sentinel、在区间起始放顶 sentinel
 *   3. IntersectionObserver 相对浏览器视口（root: null）监测两个 sentinel：
 *      - 底 sentinel 进入视口 → 扩 visibleEnd（+= scrollPageSize），向下继续
 *      - 顶 sentinel 进入视口 → 收缩 visibleStart（向上滚回首屏）
 *      - 底 sentinel 离开视口且其 top > viewport（在下方过远）→ 可选回收
 *   4. 滚动事件触发 IntersectionObserver 回调，自动实现"实时加载"
 *
 * 与单向裁剪（旧 B 方案）的区别：
 *   - 滚动可访问所有内容
 *   - 区间外卡片不渲染（DOM 节省），滚动到下方时按需扩展
 *   - 区间内有 overscan 缓冲，避免滚太快出现空白
 *
 * 返回值：
 *   - clipRef：附加到容器（含 sentinel）的 ref
 *   - visibleStart、visibleEnd：渲染区间（闭开区间）
 *   - clippedItems 切片由调用方计算
 *   - isClipped：是否存在未渲染的区间外卡片
 *
 * 客户端生效；无 IntersectionObserver 时退化为渲染全部。
 */

interface ViewportClipOptions {
  /** 初始预渲染数量 */
  preRenderCount?: number;
  /** 滚动到边界时一次扩展的卡片量 */
  scrollPageSize?: number;
  /** 区间前后保留的缓冲卡片数 */
  overscan?: number;
}

interface ViewportClipResult {
  clipRef: RefObject<HTMLDivElement | null>;
  visibleStart: number;
  visibleEnd: number;
  /** 已渲染卡片数 = visibleEnd - visibleStart */
  visibleCount: number;
  /** 是否存在区间外的未渲染卡片 */
  isClipped: boolean;
}

const DEFAULT_PRE_RENDER = 24;
const DEFAULT_PAGE_SIZE = 16;
const DEFAULT_OVERSCAN = 6;

export function useViewportClippedItems(
  totalItems: number,
  options: ViewportClipOptions = {},
): ViewportClipResult {
  const {
    preRenderCount = DEFAULT_PRE_RENDER,
    scrollPageSize = DEFAULT_PAGE_SIZE,
    overscan = DEFAULT_OVERSCAN,
  } = options;

  // 初始渲染前 preRenderCount 张 + overscan 缓冲
  const [visibleEnd, setVisibleEnd] = useState<number>(() =>
    Math.min(totalItems, preRenderCount + overscan),
  );
  const [visibleStart, setVisibleStart] = useState<number>(0);
  const clipRef = useRef<HTMLDivElement>(null);

  // 总数变化时重置
  useEffect(() => {
    setVisibleEnd(Math.min(totalItems, preRenderCount + overscan));
    setVisibleStart(0);
  }, [totalItems, preRenderCount, overscan]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    const container = clipRef.current;
    if (!container) return;

    let rafHandle: number | null = null;

    // 扩展下边界
    const extendEnd = () => {
      rafHandle = null;
      setVisibleEnd((prev) => {
        if (prev >= totalItems) return prev;
        return Math.min(totalItems, prev + scrollPageSize);
      });
    };
    // 收缩上边界（起点向前回退）
    const retreatStart = () => {
      rafHandle = null;
      setVisibleStart((prev) => {
        if (prev <= 0) return prev;
        return Math.max(0, prev - scrollPageSize);
      });
    };
    // 上方 sentinel 离开视口上方 → 可回收区间上方卡片
    const shrinkStart = () => {
      rafHandle = null;
      setVisibleStart((prev) => {
        const next = Math.min(prev + scrollPageSize, Math.max(0, visibleEnd - overscan * 2));
        return next > prev ? next : prev;
      });
    };

    // 顶/底 sentinel：渲染区间首尾放置不可见占位元素
    let topSentinel: HTMLDivElement | null = null;
    let bottomSentinel: HTMLDivElement | null = null;
    let topObserver: IntersectionObserver | null = null;
    let bottomObserver: IntersectionObserver | null = null;

    const ensureSentinels = () => {
      // 顶 sentinel：在容器最前面插一个零高度占位
      if (!topSentinel) {
        topSentinel = document.createElement("div");
        topSentinel.setAttribute("data-clip-sentinel", "top");
        topSentinel.style.height = "1px";
        topSentinel.style.width = "1px";
        topSentinel.style.pointerEvents = "none";
        container.insertBefore(topSentinel, container.firstChild);
      }
      // 底 sentinel：在末尾追加
      if (!bottomSentinel) {
        bottomSentinel = document.createElement("div");
        bottomSentinel.setAttribute("data-clip-sentinel", "bottom");
        bottomSentinel.style.height = "1px";
        bottomSentinel.style.width = "1px";
        bottomSentinel.style.pointerEvents = "none";
        container.appendChild(bottomSentinel);
      }
    };
    ensureSentinels();

    // 底 sentinel：进入视口（isIntersecting）→ 扩展
    const scheduleExtend = () => {
      if (rafHandle !== null) return;
      rafHandle = requestAnimationFrame(extendEnd);
    };
    // 顶 sentinel：进入视口（isIntersecting）→ 向前回退
    const scheduleRetreat = () => {
      if (rafHandle !== null) return;
      rafHandle = requestAnimationFrame(retreatStart);
    };
    // 顶 sentinel：完全离视口上方回收上方空间
    const scheduleShrink = () => {
      if (rafHandle !== null) return;
      rafHandle = requestAnimationFrame(shrinkStart);
    };

    topObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) scheduleRetreat();
          else if (entry.boundingClientRect.bottom < 0) scheduleShrink();
        }
      },
      { root: null, rootMargin: "200px 0px 200px 0px", threshold: 0 },
    );
    bottomObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) scheduleExtend();
        }
      },
      { root: null, rootMargin: "200px 0px 200px 0px", threshold: 0 },
    );

    if (topSentinel) topObserver.observe(topSentinel);
    if (bottomSentinel) bottomObserver.observe(bottomSentinel);

    // 仅监听 resize，移除冗余的 scroll 兜底（IntersectionObserver 已覆盖滚动检测）
    // 避免 getBoundingClientRect 触发强制布局
    window.addEventListener("resize", scheduleExtend);

    return () => {
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
      topObserver?.disconnect();
      bottomObserver?.disconnect();
      window.removeEventListener("resize", scheduleExtend);
      if (topSentinel) topSentinel.remove();
      if (bottomSentinel) bottomSentinel.remove();
    };
  }, [totalItems, scrollPageSize, overscan]);

  const visibleCount = Math.max(0, visibleEnd - visibleStart);
  const isClipped = visibleCount < totalItems;

  const result = useMemo(
    () => ({ clipRef, visibleStart, visibleEnd, visibleCount, isClipped }),
    [clipRef, visibleStart, visibleEnd, visibleCount, isClipped],
  );
  return result;
}
