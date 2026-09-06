import { memo, useEffect, useRef, useState } from "react";
import { ResourceCard } from "./ResourceCard";
import type { SiteResponse } from "../types";
import { observeLazy, unobserveLazy, observeWarmup, unobserveWarmup } from "../lib/lazy-observer";

interface LazyResourceCardProps {
  site: SiteResponse;
  isFavorited?: boolean;
  onToggleFavorite?: (siteId: number) => void;
  gridStagger?: number;
}

/**
 * LazyResourceCard — 视口懒加载包装
 *
 * 不在当前屏幕可视区域（含底部 200px 缓冲）内的卡片仅渲染占位 DOM，
 * 不触发 favicon 图片请求与收藏按钮渲染，从而降低首屏 DOM 节点数与网络开销。
 *
 * 进入视口后渲染真实 ResourceCard，并保持挂载（不反向卸载）。
 */
export const LazyResourceCard = memo(function LazyResourceCard({
  site,
  isFavorited,
  onToggleFavorite,
  gridStagger,
}: LazyResourceCardProps) {
  const [visible, setVisible] = useState(false);
  // 预热：进入视口外 800px 窗口后才启用占位符 shimmer 动画，
  // 更远的离屏占位卡保持完全静态（零动画、零合成层）
  const [warm, setWarm] = useState(false);
  const placeholderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = placeholderRef.current;
    if (!el) return;

    observeWarmup(el, { onEnter: () => setWarm(true) });
    observeLazy(el, {
      onEnter: () => setVisible(true),
    });

    return () => {
      unobserveWarmup(el);
      unobserveLazy(el);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (visible) {
    return (
      <ResourceCard
        site={site}
        isFavorited={isFavorited}
        onToggleFavorite={onToggleFavorite}
        gridStagger={gridStagger}
      />
    );
  }

  return (
    <div
      ref={placeholderRef}
      className={`lazy-card-placeholder resource-card flex flex-row items-center gap-3 overflow-hidden rounded-2xl p-4 min-h-[4.5rem] bg-white/45 dark:bg-slate-800/40 border border-white/25 dark:border-white/10${warm ? " shimmer-warm" : ""}`}
      aria-hidden="true"
    >
      {/* 图标占位 — 圆形 shimmer */}
      <div className="w-10 h-10 rounded-full shrink-0 image-loading-shimmer" />
      <div className="flex-1 min-w-0 space-y-1.5">
        {/* 标题占位 */}
        <div className="h-4 w-2/3 rounded-md skeleton-shimmer" />
        {/* 描述占位 */}
        <div className="h-3 w-1/2 rounded-md skeleton-shimmer" />
      </div>
      {/* 右侧收藏图标占位 — 仅在可能显示收藏按钮时保留空间 */}
      {onToggleFavorite && <div className="w-8 h-8 shrink-0" />}
      {/* 箭头占位 */}
      <div className="w-4 h-4 shrink-0" />
    </div>
  );
});
