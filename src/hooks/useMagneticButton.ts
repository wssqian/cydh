import { useRef, useCallback, useEffect } from 'react';

/**
 * useMagneticButton — 磁性按钮效果
 */
export function useMagneticButton(strength = 0.25) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef<number>(0);
  const isFinePointer = useRef(false);

  useEffect(() => {
    isFinePointer.current = window.matchMedia('(pointer: fine)').matches;
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isFinePointer.current || !btnRef.current || e.pointerType !== 'mouse') return;
    // 仅记录坐标，getBoundingClientRect（强制同步布局）延迟到 rAF 中执行，
    // 避免 pointermove 高频事件造成 layout thrashing
    const px = e.clientX;
    const py = e.clientY;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const btn = btnRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const x = px - rect.left - rect.width / 2;
      const y = py - rect.top - rect.height / 3;
      btn.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
    });
  }, [strength]);

  const handlePointerLeave = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    if (!btnRef.current) return;
    btnRef.current.style.transform = '';
  }, []);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  return [btnRef, { onPointerMove: handlePointerMove, onPointerLeave: handlePointerLeave }] as const;
}
