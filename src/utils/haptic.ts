/**
 * haptic.ts — 触感反馈工具函数
 *
 * 封装 navigator.vibrate API，提供带语义的触感反馈方法。
 * 仅在 touch-enabled 设备（pointer: coarse）上生效。
 * 可通过 userPreference 全局开关控制。
 */

let _hapticEnabled = true;

/** 全局开关：启用/禁用触感反馈 */
export function setHapticEnabled(enabled: boolean): void {
  _hapticEnabled = enabled;
}

/** 查询当前触感反馈是否启用 */
export function isHapticEnabled(): boolean {
  return _hapticEnabled;
}

/** 设备是否支持振动 API */
function canVibrate(): boolean {
  return _hapticEnabled
    && typeof navigator !== "undefined"
    && "vibrate" in navigator
    && window.matchMedia("(pointer: coarse)").matches;
}

export const hapticFeedback = {
  /** 轻触反馈（10ms）—— 用于导航切换、按钮点击 */
  light(): void {
    if (canVibrate()) {
      navigator.vibrate(10);
    }
  },

  /** 中等反馈（15ms）—— 用于下拉刷新触发 */
  medium(): void {
    if (canVibrate()) {
      navigator.vibrate(15);
    }
  },

  /** 短促反馈（8ms）—— 用于卡片滑动完成 */
  short(): void {
    if (canVibrate()) {
      navigator.vibrate(8);
    }
  },

  /** 长按反馈（12ms）—— 用于上下文菜单出现 */
  longPress(): void {
    if (canVibrate()) {
      navigator.vibrate(12);
    }
  },

  /** 自定义振动 */
  custom(ms: number): void {
    if (canVibrate()) {
      navigator.vibrate(ms);
    }
  },
};
