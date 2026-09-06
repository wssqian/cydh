import { useRef, useEffect } from 'react';

/**
 * use3DCardTilt — 3D 卡片倾斜效果 (CSS-only 版本)
 * 
 * 移除 JS 驱动的 onPointerMove，改用纯 CSS :hover transform。
 * 消除 11762 次 dispatchContinuousEvent 调用。
 * 
 * @param deg 倾斜角度 (CSS 已硬编码为 8deg，此参数仅保留兼容)
 * @returns [ref, handlers] onPointerMove/onPointerLeave 已移除，handlers 为空
 */
export function use3DCardTilt(_deg = 8) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    // CSS-only 悬停效果：直接通过 CSS class 控制，
    // 移除 JS 事件监听以减少 dispatchContinuousEvent 调用
    el.style.transform = '';
    el.style.setProperty('--card-3d-glow-x', '50%');
    el.style.setProperty('--card-3d-glow-y', '50%');
  }, []);

  // 返回空 handlers，组件上仍可安全绑定
  return [cardRef, {}] as const;
}
