import { useCallback, useEffect, useRef, useState } from "react";
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudOff,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  MapPin,
  RefreshCw,
  Settings2,
  Snowflake,
  Sun,
  X,
} from "lucide-react";
import {
  loadWeatherResult,
  resetWeatherClientCache,
  peekWeatherCache,
  getWeatherCityOverride,
  setWeatherCityOverride,
  type WeatherData,
  type WeatherLoadFailureReason,
} from "../weather-client";

type WeatherState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "failed"; reason: WeatherLoadFailureReason | "timeout" }
  | { status: "ready"; data: WeatherData };

/**
 * 天气图标映射（基于 uapis.cn 天气图标代码）
 * 代码表：https://uapis.cn/docs/api-reference/get-misc-weather#enum-list
 */
function weatherIcon(code: string) {
  const n = Number(code);
  // 晴
  if (n === 100 || n === 150 || n === 151) return Sun;
  // 多云
  if (n === 101 || n === 102 || n === 103 || n === 152 || n === 153) return CloudSun;
  // 阴
  if (n === 104 || n === 154) return Cloud;
  // 雾 / 霾 / 沙尘
  if (
    (n >= 500 && n <= 515) ||
    n === 456 || n === 457 ||
    (n >= 300 && n <= 304)
  ) return CloudFog;
  // 雷阵雨
  if (n >= 350 && n <= 351) return CloudLightning;
  // 雪
  if (
    (n >= 400 && n <= 408) ||
    (n >= 450 && n <= 454) ||
    n === 499
  ) return Snowflake;
  // 雨夹雪
  if (n >= 409 && n <= 410) return CloudSnow;
  // 小雨 / 毛毛雨
  if (
    (n >= 305 && n <= 312) ||
    (n >= 323 && n <= 326)
  ) return CloudDrizzle;
  // 中到大暴雨
  if (n >= 313 && n <= 322) return CloudRain;
  // 默认
  return CloudSun;
}

/**
 * 通过同源 /api/public/weather 获取访客天气，由服务端统一处理定位、缓存、降级和超时。
 * 采用延迟加载，不阻塞首屏渲染；慢网络或失败时保留可重试的轻量占位。
 * 点击设置图标在卡片下方内联展开城市输入框。
 */
export function WeatherCard() {
  // 2.1: 初始化时直读模块级缓存——命中则直接 ready，跳过 loading 闪烁
  const [state, setState] = useState<WeatherState>(() => {
    const cached = peekWeatherCache();
    return cached
      ? { status: "ready", data: cached }
      : { status: "idle" };
  });
  const isFirstMount = useRef(!peekWeatherCache());
  const [retryNonce, setRetryNonce] = useState(0);
  const [showCityInput, setShowCityInput] = useState(false);
  const [cityInput, setCityInput] = useState(getWeatherCityOverride());
  const requestIdRef = useRef(0);
  const cityInputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const retryWeather = useCallback(() => {
    resetWeatherClientCache();
    setRetryNonce((value) => value + 1);
  }, []);

  const applyCityOverride = useCallback(() => {
    const trimmed = cityInput.trim();
    setWeatherCityOverride(trimmed);
    setShowCityInput(false);
    resetWeatherClientCache();
    setRetryNonce((value) => value + 1);
  }, [cityInput]);

  const clearCityOverride = useCallback(() => {
    setCityInput("");
    setWeatherCityOverride("");
    setShowCityInput(false);
    resetWeatherClientCache();
    setRetryNonce((value) => value + 1);
  }, []);

  const toggleCityInput = useCallback(() => {
    setShowCityInput((prev) => {
      if (!prev) {
        setCityInput(getWeatherCityOverride());
        setTimeout(() => cityInputRef.current?.focus(), 50);
      }
      return !prev;
    });
  }, []);

  // 点击外部或 Escape 关闭城市输入
  useEffect(() => {
    if (!showCityInput) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowCityInput(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowCityInput(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showCityInput]);

  // 3.1/3.2/4.1: 取天气主逻辑——缓存在时立即后台静默刷新，首次加载保持延迟
  useEffect(() => {
    let cancelled = false;
    let idleHandle: number | null = null;
    let timerId: number | null = null;
    let slowTimer: number | null = null;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    // 当组件以 ready 初始化（缓存命中），在新 effect 里直接异步请求后台刷新
    // 请求成功时静默更新，失败时不降级为 failed
    const isStaleRevalidate = isFirstMount.current === false && state.status === "ready";
    const isUserRetry = retryNonce > 0;
    // 首次挂载后标记为非首次
    if (isFirstMount.current) {
      isFirstMount.current = false;
    }

    const fetchWeather = (isBackground: boolean) => {
      if (cancelled) return;
      loadWeatherResult()
        .then((result) => {
          if (cancelled || requestIdRef.current !== requestId) return;
          if (result.status === "ready") {
            setState({ status: "ready", data: result.data });
          } else if (!isBackground) {
            // 非静默模式（用户主动重试或首次加载）才展示失败态
            setState({ status: "failed", reason: result.reason });
          }
          // isBackground === true && result.failed: 静默，保持已有 ready 数据
        })
        .catch(() => {
          if (!cancelled && requestIdRef.current === requestId && !isBackground) {
            setState({ status: "failed", reason: "request-failed" });
          }
        });
    };

    if (isUserRetry) {
      // 用户手动重试：直接获取，无延迟
      setState({ status: "loading" });
      timerId = null;
      fetchWeather(false);
    } else if (isStaleRevalidate || retryNonce > 0) {
      // 3.1: 缓存存在时立即后台静默刷新，不经过 loading，无 1.5s 延迟
      // 设置一个短慢超时（仅对首次用户重试，不对静默刷新）
      fetchWeather(true);
    } else {
      // 首次加载（retryNonce === 0 且状态 idle）：保留延迟 + idle 策略
      setState({ status: "loading" });

      const scheduleFetch = () => {
        if (cancelled) return;
        const idleWindow = window as typeof window & {
          requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
          cancelIdleCallback?: (handle: number) => void;
        };
        if (idleWindow.requestIdleCallback) {
          idleHandle = idleWindow.requestIdleCallback(() => fetchWeather(false), { timeout: 2500 });
          return;
        }
        fetchWeather(false);
      };

      timerId = window.setTimeout(scheduleFetch, 1500);

      slowTimer = window.setTimeout(() => {
        if (cancelled || requestIdRef.current !== requestId) return;
        setState((prev) => (
          prev.status === "loading"
            ? { status: "failed", reason: "timeout" }
            : prev
        ));
      }, 10000);
    }

    return () => {
      cancelled = true;
      if (timerId !== null) clearTimeout(timerId);
      if (slowTimer !== null) clearTimeout(slowTimer);
      if (idleHandle !== null) {
        const idleWindow = window as typeof window & { cancelIdleCallback?: (handle: number) => void };
        idleWindow.cancelIdleCallback?.(idleHandle);
      }
    };
  }, [retryNonce]);

  if (state.status === "idle") {
    return null;
  }

  // 设置按钮（复用于所有非 loading 状态）
  const settingsBtn = (
    <button
      type="button"
      className="liquid-button inline-flex h-6 shrink-0 items-center rounded-full px-1.5 text-xs text-slate-400 transition-colors hover:text-pink-500 dark:text-slate-500"
      onClick={toggleCityInput}
      aria-label="设置天气城市"
      title="手动指定城市"
    >
      <Settings2 className="h-3.5 w-3.5" />
    </button>
  );

  // 城市覆盖输入组件
  const CityOverrideInput = showCityInput ? (
    <div className="glass-card mt-1.5 flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
      <input
        ref={cityInputRef}
        type="text"
        value={cityInput}
        onChange={(e) => setCityInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyCityOverride(); } }}
        placeholder="输入城市名（如 北京）"
        className="liquid-input w-40 rounded-lg bg-transparent px-2.5 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 dark:text-slate-200 dark:placeholder:text-slate-500 outline-none"
        aria-label="城市名称"
      />
      <button
        type="button"
        className="liquid-button inline-flex h-7 shrink-0 items-center rounded-full bg-pink-500/10 px-3 text-xs font-medium text-pink-600 transition-colors hover:bg-pink-500/20 dark:text-pink-400"
        onClick={applyCityOverride}
        aria-label="确认"
      >
        确定
      </button>
      {!!getWeatherCityOverride() && (
        <button
          type="button"
          className="liquid-button inline-flex h-7 shrink-0 items-center rounded-full px-2 text-xs text-slate-400 transition-colors hover:text-red-400"
          onClick={clearCityOverride}
          aria-label="清除城市覆盖"
          title="恢复自动定位"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  ) : null;

  if (state.status === "loading") {
    const loadingCity = getWeatherCityOverride();
    return (
      <div ref={wrapperRef}>
        <div
          className="weather-card glass-card flex w-fit min-w-44 items-center gap-3 rounded-2xl px-3 py-3 text-sm sm:gap-3 sm:px-4 lg:gap-2.5 lg:px-3"
          role="status"
          aria-live="polite"
        >
          <div className="h-5 w-5 rounded-full bg-slate-300/50 dark:bg-slate-600/50 animate-pulse" />
          {loadingCity ? (
            <span className="text-xs text-slate-500 dark:text-slate-400">正在查询 {loadingCity}…</span>
          ) : (
            <div className="h-3.5 w-24 rounded bg-slate-300/50 dark:bg-slate-600/50 animate-pulse" />
          )}
        </div>
        {CityOverrideInput}
      </div>
    );
  }

  if (state.status === "failed") {
    const overrideCity = getWeatherCityOverride();
    const message = state.reason === "timeout"
      ? (overrideCity ? `查询 ${overrideCity} 较慢` : "天气加载较慢")
      : (overrideCity ? `${overrideCity} 天气暂不可用` : "天气暂不可用");
    const label = `${message}，可手动重试`;

    return (
      <div ref={wrapperRef}>
        <div
          className="weather-card glass-card flex max-w-full items-center gap-3 overflow-hidden rounded-2xl px-3 py-3 text-sm text-slate-600 transition-colors dark:text-slate-300 sm:gap-3 sm:px-4 lg:gap-2.5 lg:px-3"
          role="status"
          aria-live="polite"
          aria-label={label}
          title={label}
        >
          <CloudOff className="h-5 w-5 shrink-0 text-slate-400 dark:text-slate-500" />
          <span className="max-w-28 truncate sm:max-w-36">{message}</span>
          <button
            type="button"
            className="liquid-button ml-1 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-slate-600 transition-colors hover:text-pink-500 dark:text-slate-300"
            onClick={retryWeather}
            aria-label="重新获取天气"
            title="重新获取天气"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">重试</span>
          </button>
          {settingsBtn}
        </div>
        {CityOverrideInput}
      </div>
    );
  }

  const { data } = state;
  const Icon = weatherIcon(data.weatherIcon);
  const temperature = Number.isInteger(data.temperature) ? String(data.temperature) : data.temperature.toFixed(1);
  const hasCityOverride = !!getWeatherCityOverride();
  const label = hasCityOverride
    ? `${data.city} ${data.condition} ${temperature}°C，湿度 ${data.humidity}%（手动指定）`
    : `${data.city} ${data.condition} ${temperature}°C，湿度 ${data.humidity}%`;

  return (
    <div ref={wrapperRef}>
      <div
        className="weather-card glass-card flex max-w-full items-center gap-3 overflow-hidden rounded-2xl px-3 py-3 text-sm transition-colors hover:border-white/60 sm:gap-3 sm:px-4 lg:gap-2.5 lg:px-3"
        aria-label={label}
        title={label}
      >
        <Icon className="w-6 h-6 text-pink-500 shrink-0 drop-shadow-sm" />
        <span className="shrink-0 text-base font-bold tabular-nums text-slate-800 dark:text-white">
          {temperature}°C
        </span>
        <span className="max-w-20 truncate font-medium text-slate-600 dark:text-slate-300 sm:max-w-28">
          {data.condition}
        </span>
        <span className="max-w-24 truncate text-slate-500 dark:text-slate-400 sm:max-w-32">
          {hasCityOverride && <MapPin className="inline h-3.5 w-3.5 mr-0.5 text-pink-400" />}
          {data.city}
        </span>
        <span className="hidden shrink-0 items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 sm:flex">
          <Droplets className="w-4 h-4" />
          {data.humidity}%
        </span>
        {settingsBtn}
      </div>
      {CityOverrideInput}
    </div>
  );
}
