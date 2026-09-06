import { useEffect, useRef, useState } from "react";
import { RefreshCw, Check } from "lucide-react";
import type { PullState } from "../hooks/useGesture";

interface RefreshIndicatorProps {
  /** 下拉刷新的百分比进度（0-1） */
  progress: number;
  /** 当前下拉状态 */
  pullState: PullState;
  /** 刷新完成时的回调（用于隐藏指示器） */
  onComplete?: () => void;
}

/**
 * RefreshIndicator — 下拉刷新旋转指示器
 *
 * - 下拉阶段：显示进度圆弧
 * - 到达阈值：旋转图标
 * - 刷新中：持续旋转
 * - 完成：勾号 + 自动隐藏
 */
export function RefreshIndicator({
  progress,
  pullState,
  onComplete,
}: RefreshIndicatorProps) {
  const [visible, setVisible] = useState(false);
  const prevStateRef = useRef(pullState);

  useEffect(() => {
    if (pullState === "pulling" || pullState === "threshold" || pullState === "refreshing") {
      setVisible(true);
    }
    if (pullState === "idle" && prevStateRef.current === "refreshing") {
      // 刷新完成，稍后隐藏
      const timer = setTimeout(() => {
        setVisible(false);
        onComplete?.();
      }, 600);
      return () => clearTimeout(timer);
    }
    prevStateRef.current = pullState;
  }, [pullState, onComplete]);

  if (!visible && pullState === "idle") return null;

  const isRefreshing = pullState === "refreshing";
  const isComplete = pullState === "idle";
  const showProgress = pullState === "pulling" || pullState === "threshold";
  const atThreshold = pullState === "threshold";

  return (
    <div className="flex justify-center pointer-events-none" style={{ marginTop: "-3rem", marginBottom: "0.5rem" }}>
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full glass-card shadow-md transition-transform duration-200 ${
          isRefreshing ? "animate-spin" : ""
        } ${isComplete ? "scale-0 opacity-0" : "scale-100 opacity-100"}`}
        style={{
          transition: "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease",
        }}
      >
        {isRefreshing ? (
          <RefreshCw className="h-5 w-5 text-pink-500" />
        ) : isComplete ? (
          <Check className="h-5 w-5 text-emerald-500" />
        ) : (
          <RefreshCw
            className={`h-5 w-5 transition-colors ${
              atThreshold ? "text-pink-500" : "text-slate-400"
            }`}
            style={{
              transform: `rotate(${progress * 360}deg)`,
              transition: "transform 0.1s linear, color 0.15s ease",
            }}
          />
        )}
      </div>
    </div>
  );
}
