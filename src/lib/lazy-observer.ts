/**
 * Lazy render observer — 共享一个 IntersectionObserver，用于视口外元素延迟渲染。
 *
 * 与滚动揭示动画不同：此 Observer 在元素进入视口（含缓冲）时调用一次 callback，
 * 随后自动取消观察。调用方通常在 callback 内部 setState 并渲染真实内容。
 */

interface LazyCallback {
  /** 进入视口时触发一次 */
  onEnter: () => void;
}

const LAZY_ROOT_MARGIN = "200px 0px";
const LAZY_THRESHOLD = 0;
// 预热窗口：占位符 shimmer 动画只对即将进入视口的元素启用（视口外数百张占位卡零动画）
const LAZY_WARMUP_ROOT_MARGIN = "400px 0px";

let lazyObserver: IntersectionObserver | null = null;
const lazyMap = new WeakMap<Element, LazyCallback>();
let warmupObserver: IntersectionObserver | null = null;
const warmupMap = new WeakMap<Element, LazyCallback>();

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function getWarmupObserver(): IntersectionObserver {
  if (!warmupObserver) {
    warmupObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const callback = warmupMap.get(entry.target);
          if (!callback) continue;
          callback.onEnter();
          // 预热触发后即取消观察；后续由懒加载 observer 接管渲染
          warmupObserver?.unobserve(entry.target);
          warmupMap.delete(entry.target);
        }
      },
      {
        rootMargin: LAZY_WARMUP_ROOT_MARGIN,
        threshold: LAZY_THRESHOLD,
      },
    );
  }
  return warmupObserver;
}

function getLazyObserver(): IntersectionObserver {
  if (!lazyObserver) {
    lazyObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const callback = lazyMap.get(entry.target);
          if (!callback) continue;
          callback.onEnter();
          // 触发一次后即取消观察，避免滚动出去后再回来反复触发
          lazyObserver?.unobserve(entry.target);
          lazyMap.delete(entry.target);
        }
      },
      {
        rootMargin: LAZY_ROOT_MARGIN,
        threshold: LAZY_THRESHOLD,
      },
    );
  }
  return lazyObserver;
}

/**
 * 注册元素到预热观察器。
 * 进入预热窗口（视口外 800px）时回调一次，调用方借此启用占位符动画；
 * 视口外更远的元素保持静态，避免大量离屏 shimmer 动画的合成器/主线程开销。
 */
export function observeWarmup(element: Element | null, callback: LazyCallback): void {
  if (!element) return;

  // 减少动画偏好：无需预热，直接回调（动画本身被 CSS 禁用）
  if (prefersReducedMotion()) {
    callback.onEnter();
    return;
  }

  warmupMap.set(element, callback);
  getWarmupObserver().observe(element);
}

/**
 * 取消注册预热观察
 */
export function unobserveWarmup(element: Element | null): void {
  if (!element) return;
  warmupObserver?.unobserve(element);
  warmupMap.delete(element);
}

/**
 * 注册元素到懒加载 Observer。
 * 若元素已经在视口中，会同步触发 callback，避免短暂闪烁。
 */
export function observeLazy(element: Element | null, callback: LazyCallback): void {
  if (!element) return;

  // 减少动画偏好：直接显示
  if (prefersReducedMotion()) {
    callback.onEnter();
    return;
  }

  lazyMap.set(element, callback);
  getLazyObserver().observe(element);
}

/**
 * 取消注册元素
 */
export function unobserveLazy(element: Element | null): void {
  if (!element) return;
  lazyObserver?.unobserve(element);
  lazyMap.delete(element);
}

/**
 * 销毁共享 Observer（测试用）
 */
export function destroyLazyObserver(): void {
  if (lazyObserver) {
    lazyObserver.disconnect();
    lazyObserver = null;
  }
  if (warmupObserver) {
    warmupObserver.disconnect();
    warmupObserver = null;
  }
}
