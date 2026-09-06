import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useNavigate } from "react-router-dom";

/**
 * 手势方向锁
 */
type AxisLock = "x" | "y" | null;

/**
 * 下拉刷新状态
 */
export type PullState = "idle" | "pulling" | "threshold" | "refreshing";

/**
 * useGesture — 轻量级手势引擎 Hook
 *
 * 覆盖四种移动端手势：
 * 1. swipeRight: 从左侧边缘向右滑 → navigate(-1)
 * 2. pullToRefresh: 下拉 → 触发 refresh 回调
 * 3. cardSwipe: 卡片水平滑动 → 回调提供方向
 * 4. longPress: 长按 500ms → 显示上下文菜单
 *
 * 所有手势自动在 `pointer: coarse` 设备上启用。
 */
export function useGesture(options: {
  /** 拖拽指示器容器的 ref（元素会收到 CSS 自定义属性通知）*/
  containerRef?: RefObject<HTMLElement | null>;
  /** 下拉刷新回调 */
  onRefresh?: () => void;
  /** 卡片滑动回调：direction = "left" | "right" */
  onCardSwipe?: (direction: "left" | "right") => void;
  /** 长按回调 */
  onLongPress?: (event: PointerEvent) => void;
} = {}) {
  const navigate = useNavigate();

  // ─── 通用手势状态 ───
  const stateRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    axisLock: null as AxisLock,
    // 长按
    longPressTimer: null as ReturnType<typeof setTimeout> | null,
    longPressFired: false,
    // 下拉刷新
    pullState: "idle" as PullState,
    pullDistance: 0,
    // 边缘滑动返回
    isEdgeSwipe: false,
  });

  // ─── 重置状态 ───
  const reset = useCallback(() => {
    const s = stateRef.current;
    if (s.longPressTimer !== null) {
      clearTimeout(s.longPressTimer);
      s.longPressTimer = null;
    }
    s.active = false;
    s.axisLock = null;
    s.longPressFired = false;
    s.isEdgeSwipe = false;
    s.pullState = "idle";
    s.pullDistance = 0;
  }, []);

  // ─── Thresholds ───
  const EDGE_THRESHOLD = 24;      // 左边边缘 px
  const SWIPE_THRESHOLD = 60;     // 滑动返回 px
  const PULL_THRESHOLD = 60;      // 下拉刷新 px
  const LONG_PRESS_MS = 500;      // 长按 ms
  const AXIS_LOCK_ANGLE = 30;     // 轴锁定角度

  const onPointerDown = useCallback((event: PointerEvent) => {
    // 仅在 touch 设备上激活手势
    if (event.pointerType !== "touch") return;

    const s = stateRef.current;
    s.active = true;
    s.startX = event.clientX;
    s.startY = event.clientY;
    s.lastX = event.clientX;
    s.lastY = event.clientY;
    s.axisLock = null;
    s.longPressFired = false;
    s.isEdgeSwipe = event.clientX <= EDGE_THRESHOLD;

    // 开始长按计时
    s.longPressTimer = setTimeout(() => {
      if (s.active && !s.longPressFired && s.axisLock === null) {
        s.longPressFired = true;
        options.onLongPress?.(event);
      }
    }, LONG_PRESS_MS);

    // 通知容器
    options.containerRef?.current?.style.setProperty("--gesture-active", "1");
  }, [options.onLongPress, options.containerRef]);

  const onPointerMove = useCallback((event: PointerEvent) => {
    const s = stateRef.current;
    if (!s.active || event.pointerType !== "touch") return;

    const dx = event.clientX - s.startX;
    const dy = event.clientY - s.startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    s.lastX = event.clientX;
    s.lastY = event.clientY;

    // 轴锁定（首次有足够位移时决定）
    if (s.axisLock === null) {
      if (absDx > 10 || absDy > 10) {
        const angle = (Math.atan2(absDy, absDx) * 180) / Math.PI;
        s.axisLock = angle > AXIS_LOCK_ANGLE ? "y" : "x";
        // 确定轴后取消长按（用户正在滑动）
        if (s.longPressTimer !== null) {
          clearTimeout(s.longPressTimer);
          s.longPressTimer = null;
        }
      }
    }

    // 锁定为 x 轴：边缘滑动返回
    if (s.axisLock === "x" && s.isEdgeSwipe && dx > 0) {
      event.preventDefault();
      const progress = Math.min(dx / SWIPE_THRESHOLD, 1);
      options.containerRef?.current?.style.setProperty("--gesture-swipe-progress", String(progress));
      return;
    }

    // 锁定为 y 轴：下拉刷新
    if (s.axisLock === "y" && dy > 0 && options.onRefresh) {
      event.preventDefault();
      s.pullDistance = dy;
      s.pullState = dy >= PULL_THRESHOLD ? "threshold" : "pulling";
      options.containerRef?.current?.style.setProperty("--gesture-pull", String(Math.min(dy / PULL_THRESHOLD, 1)));
      return;
    }

    // 卡片滑动（轻量 x 方向）
    if (s.axisLock === "x" && !s.isEdgeSwipe && options.onCardSwipe && absDx > 5) {
      event.preventDefault();
      options.containerRef?.current?.style.setProperty("--gesture-card-dx", String(dx));
    }
  }, [options.onRefresh, options.onCardSwipe, options.containerRef]);

  const onPointerUp = useCallback((event: PointerEvent) => {
    const s = stateRef.current;
    if (!s.active || event.pointerType !== "touch") return;

    // 边缘滑动返回——触发导航
    if (s.axisLock === "x" && s.isEdgeSwipe && (event.clientX - s.startX) >= SWIPE_THRESHOLD) {
      navigate(-1);
    }

    // 下拉刷新——触发刷新
    if (s.axisLock === "y" && s.pullDistance >= PULL_THRESHOLD && options.onRefresh) {
      s.pullState = "refreshing";
      options.onRefresh();
    }

    // 卡片滑动完成
    if (s.axisLock === "x" && !s.isEdgeSwipe && options.onCardSwipe) {
      const totalDx = event.clientX - s.startX;
      if (Math.abs(totalDx) >= 50) {
        options.onCardSwipe(totalDx > 0 ? "right" : "left");
      }
    }

    // 清理
    reset();
    options.containerRef?.current?.style.removeProperty("--gesture-active");
    options.containerRef?.current?.style.removeProperty("--gesture-swipe-progress");
    options.containerRef?.current?.style.removeProperty("--gesture-pull");
    options.containerRef?.current?.style.removeProperty("--gesture-card-dx");
  }, [navigate, options.onRefresh, options.onCardSwipe, options.containerRef, reset]);

  useEffect(() => {
    const el = options.containerRef?.current ?? document.body;

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", reset);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", reset);
    };
  }, [options.containerRef, onPointerDown, onPointerMove, onPointerUp, reset]);
}
