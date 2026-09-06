import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw, AlertTriangle, RefreshCw, Loader2 } from "lucide-react";

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const ZOOM_FACTOR = 1.1;
const ZOOM_TRANSITION_MS = 180;
const DOUBLE_TAP_MS = 280;
const PAN_STEP = 50;

interface ZoomableImageViewerProps {
  src: string;
  alt: string;
  onClose?: () => void;
  onLoadError?: () => void;
  onLoad?: () => void;
  isLoadingOriginal?: boolean;
  isFallback?: boolean;
  onRetryOriginal?: () => void;
}

export default function ZoomableImageViewer({ src, alt, onClose, onLoadError, onLoad, isLoadingOriginal, isFallback, onRetryOriginal }: ZoomableImageViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  /* ── Render-state (triggers re-render) ── */
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [animate, setAnimate] = useState(false);

  /* ── Ref-state (mutable, no re-render — used in event handlers) ── */
  const stRef = useRef({ scale: 1, x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const posAtDragStart = useRef({ x: 0, y: 0 });
  const lastTapMs = useRef(0);
  const pinchDist = useRef<number | null>(null);
  const pinchScaleStart = useRef(1);
  const pinchCenter = useRef({ x: 0, y: 0 });

  /* keep stRef in sync with render-state */
  useEffect(() => { stRef.current = { scale, x: position.x, y: position.y }; }, [scale, position]);

  /* reset on image change */
  useEffect(() => { setScale(1); setPosition({ x: 0, y: 0 }); setAnimate(false); }, [src]);

  /* ── helpers ── */
  const clampPos = useCallback(
    (pos: { x: number; y: number }, s: number) => {
      const c = containerRef.current;
      const img = imgRef.current;
      if (!c || !img) return pos;
      const cw = c.clientWidth;
      const ch = c.clientHeight;
      const iw = naturalSize.w || img.clientWidth || 1;
      const ih = naturalSize.h || img.clientHeight || 1;
      const mx = Math.max(0, (iw * s - cw) / 2);
      const my = Math.max(0, (ih * s - ch) / 2);
      return { x: Math.max(-mx, Math.min(mx, pos.x)), y: Math.max(-my, Math.min(my, pos.y)) };
    },
    [naturalSize],
  );

  const apply = useCallback(
    (s: number, pos: { x: number; y: number }) => {
      const cs = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
      const cp = clampPos(pos, cs);
      stRef.current = { scale: cs, x: cp.x, y: cp.y };
      setScale(cs);
      setPosition(cp);
    },
    [clampPos],
  );

  const zoomAtPoint = useCallback(
    (newScale: number, clientX?: number, clientY?: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const st = stRef.current;
      let nx: number, ny: number;
      if (clientX !== undefined && clientY !== undefined) {
        const mc = { x: clientX - rect.left, y: clientY - rect.top };
        nx = mc.x - cx - (mc.x - cx - st.x) * (newScale / st.scale);
        ny = mc.y - cy - (mc.y - cy - st.y) * (newScale / st.scale);
      } else {
        nx = st.x;
        ny = st.y;
      }
      setAnimate(true);
      apply(newScale, { x: nx, y: ny });
    },
    [apply],
  );

  /* ── wheel zoom (non-passive so preventDefault works in React 17+) ── */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const st = stRef.current;
      const dir = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, st.scale * dir));
      zoomAtPoint(ns, e.clientX, e.clientY);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [zoomAtPoint]);

  /* ── mouse drag ── */
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      setAnimate(false);
      isDragging.current = true;
      dragStart.current = { x: e.clientX, y: e.clientY };
      posAtDragStart.current = { x: stRef.current.x, y: stRef.current.y };
    },
    [],
  );

  /* drag move/up — attached to window so cursor can leave the element */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const st = stRef.current;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      apply(st.scale, { x: posAtDragStart.current.x + dx, y: posAtDragStart.current.y + dy });
    };
    const onUp = () => {
      isDragging.current = false;
      setAnimate(true);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [apply]);

  /* ── double-tap to zoom toggle ── */
  const onPointerDown = useCallback(() => {
    const now = Date.now();
    if (now - lastTapMs.current < DOUBLE_TAP_MS) {
      const st = stRef.current;
      if (st.scale > 1.5) {
        apply(1, { x: 0, y: 0 });
      } else {
        zoomAtPoint(2.5);
      }
      lastTapMs.current = 0;
    } else {
      lastTapMs.current = now;
    }
  }, [apply, zoomAtPoint]);

  /* ── touch (pinch + single-finger drag) ── */
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        setAnimate(false);
        const t = e.touches;
        pinchDist.current = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
        pinchScaleStart.current = stRef.current.scale;
        pinchCenter.current = {
          x: (t[0].clientX + t[1].clientX) / 2,
          y: (t[0].clientY + t[1].clientY) / 2,
        };
        isDragging.current = false;
      } else if (e.touches.length === 1) {
        setAnimate(false);
        isDragging.current = true;
        dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        posAtDragStart.current = { x: stRef.current.x, y: stRef.current.y };
      }
    },
    [],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const t = e.touches;
        const dist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
        if (pinchDist.current !== null && pinchDist.current > 0) {
          const ratio = dist / pinchDist.current;
          const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchScaleStart.current * ratio));
          zoomAtPoint(ns, pinchCenter.current.x, pinchCenter.current.y);
        }
      } else if (e.touches.length === 1 && isDragging.current) {
        const st = stRef.current;
        const dx = e.touches[0].clientX - dragStart.current.x;
        const dy = e.touches[0].clientY - dragStart.current.y;
        apply(st.scale, { x: posAtDragStart.current.x + dx, y: posAtDragStart.current.y + dy });
      }
    },
    [apply, zoomAtPoint],
  );

  const onTouchEnd = useCallback(() => {
    pinchDist.current = null;
    isDragging.current = false;
    setAnimate(true);
  }, []);

  /* ── keyboard ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = stRef.current;
      switch (e.key) {
        case "=":
        case "+":
          e.preventDefault();
          zoomAtPoint(Math.min(MAX_SCALE, st.scale * ZOOM_FACTOR));
          break;
        case "-":
          e.preventDefault();
          zoomAtPoint(Math.max(MIN_SCALE, st.scale / ZOOM_FACTOR));
          break;
        case "ArrowUp":
        case "ArrowDown":
        case "ArrowLeft":
        case "ArrowRight":
          if (st.scale <= 1) break; /* 非缩放态不处理方向键，留给父组件导航 */
          e.preventDefault();
          switch (e.key) {
            case "ArrowUp": apply(st.scale, { x: st.x, y: st.y - PAN_STEP }); break;
            case "ArrowDown": apply(st.scale, { x: st.x, y: st.y + PAN_STEP }); break;
            case "ArrowLeft": apply(st.scale, { x: st.x - PAN_STEP, y: st.y }); break;
            case "ArrowRight": apply(st.scale, { x: st.x + PAN_STEP, y: st.y }); break;
          }
          break;
        case "Escape":
          onClose?.();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [apply, zoomAtPoint, onClose]);

  /* ── reset ── */
  const reset = useCallback(() => apply(1, { x: 0, y: 0 }), [apply]);
  const zoomIn = useCallback(() => {
    const st = stRef.current;
    zoomAtPoint(Math.min(MAX_SCALE, st.scale * ZOOM_FACTOR));
  }, [zoomAtPoint]);
  const zoomOut = useCallback(() => {
    const st = stRef.current;
    zoomAtPoint(Math.max(MIN_SCALE, st.scale / ZOOM_FACTOR));
  }, [zoomAtPoint]);

  const isZoomed = scale > 1;

  const containerStyle: React.CSSProperties = {
    touchAction: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
  };

  const imgStyle: React.CSSProperties = {
    transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
    willChange: "transform",
    transition: animate ? `transform ${ZOOM_TRANSITION_MS}ms ease-out` : "none",
    cursor: isDragging.current ? "grabbing" : scale > 1 ? "grab" : "zoom-in",
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full flex items-center justify-center overflow-hidden"
      style={containerStyle}
      onMouseDown={onMouseDown}
      onClick={onPointerDown}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        style={imgStyle}
        onLoad={(e) => {
          setNaturalSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
          onLoad?.();
        }}
        onError={onLoadError}
        onDragStart={(e) => e.preventDefault()}
        referrerPolicy="no-referrer"
      />

      {/* ── Loading overlay for original image ── */}
      {isLoadingOriginal && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-10">
          <div className="flex flex-col items-center gap-2 text-white">
            <Loader2 className="w-8 h-8 animate-spin text-white" />
            <span className="text-sm font-medium">正在加载原图...</span>
          </div>
        </div>
      )}

      {/* ── Fallback indicator banner ── */}
      {isFallback && onRetryOriginal && (
        <div className="absolute top-0 left-0 right-0 z-10 bg-amber-500/95 backdrop-blur-sm border-b border-amber-400/50 px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-amber-900 text-sm font-medium">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>正在显示封面略缩图，画质低于原图</span>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRetryOriginal(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-amber-50 text-sm font-semibold hover:bg-amber-500 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            重试原图
          </button>
        </div>
      )}

      {/* ── Top-right controls ── */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 opacity-60 hover:opacity-100 transition-opacity pointer-events-auto">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); zoomOut(); }}
          className="p-1.5 rounded-lg bg-black/40 text-white/80 hover:bg-black/60 hover:text-white transition-colors"
          aria-label="缩小"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className="text-xs text-white/70 tabular-nums min-w-[3rem] text-center select-none pointer-events-none">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); zoomIn(); }}
          className="p-1.5 rounded-lg bg-black/40 text-white/80 hover:bg-black/60 hover:text-white transition-colors"
          aria-label="放大"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── Bottom-center hint / reset ── */}
      {isZoomed ? (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-black/40 backdrop-blur-sm pointer-events-auto">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); reset(); }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            复位
          </button>
          <span className="text-[11px] text-white/40">滚轮 / 双击 / +/- 缩放 · 拖拽平移</span>
        </div>
      ) : (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[11px] text-white/40 pointer-events-none opacity-0 sm:opacity-100 transition-opacity select-none">
          滚轮缩放 · 双击切换 · 拖拽平移
        </div>
      )}
    </div>
  );
}
