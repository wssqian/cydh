import { useEffect, useRef, useCallback } from 'react';
import { observeReveal, unobserveReveal } from '../lib/intersection-observer';

/**
 * useScrollReveal — 滚动触发显式动画
 *
 * 使用共享 IntersectionObserver 在元素进入视口时添加 .revealed 类。
 *
 * @优化 使用全局共享 IntersectionObserver 替代每个元素创建独立实例。
 *
 * @param options.threshold 可见比例阈值（默认 0.1）
 * @param options.rootMargin 提前触发距离（默认 '0px 0px -40px'）
 * @param options.once 是否只触发一次（默认 true）
 * @returns [ref] 绑定到需要动画的元素
 */
export function useScrollReveal(options?: {
  threshold?: number;
  rootMargin?: string;
  once?: boolean;
}) {
  const { threshold = 0.08, rootMargin = '0px 0px -40px', once = true } = options ?? {};
  const ref = useRef<HTMLDivElement>(null);
  const onceRef = useRef(once);
  onceRef.current = once;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    observeReveal(el, { threshold, rootMargin, once });
    return () => unobserveReveal(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold, rootMargin]);

  return ref;
}

/**
 * useScrollRevealStagger — 批量滚动动画（带错峰延迟）
 * 自动为子元素添加 stagger 延迟类。
 */
export function useScrollRevealStagger(count: number, options?: {
  threshold?: number;
  rootMargin?: string;
  baseClass?: string;
}) {
  const { baseClass = 'reveal-on-scroll' } = options ?? {};
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // 确保 ref 数组长度正确
  itemRefs.current.length = count;

  const setItemRef = useCallback((index: number) => (el: HTMLDivElement | null) => {
    itemRefs.current[index] = el;
  }, []);

  useEffect(() => {
    const elements = itemRefs.current.filter(Boolean) as HTMLDivElement[];
    elements.forEach((el) => observeReveal(el, { threshold: 0.08, rootMargin: '0px 0px -40px' }));
    return () => {
      elements.forEach((el) => unobserveReveal(el));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  return { containerRef, setItemRef };
}
