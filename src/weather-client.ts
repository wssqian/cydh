export interface WeatherData {
  city: string;
  temperature: number;
  humidity: number;
  condition: string;
  weatherIcon: string;
}

type Fetcher = typeof fetch;
export type WeatherLoadFailureReason = "unavailable" | "request-failed";
export type WeatherLoadResult =
  | { status: "ready"; data: WeatherData }
  | { status: "failed"; reason: WeatherLoadFailureReason };

interface CachedWeather {
  data: WeatherData;
  expiresAt: number;
}

const SERVER_WEATHER_URL = "/api/public/weather";
const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000;
const SERVER_TIMEOUT_MS = 8000;

// 用户手动指定的城市偏好 localStorage 键
const CITY_OVERRIDE_KEY = "weatherCityOverride";

let cachedWeather: CachedWeather | null = null;
let weatherPromise: Promise<WeatherLoadResult> | null = null;

/**
 * 获取用户手动指定的城市偏好。
 * 返回空字符串表示使用 IP 自动定位。
 */
export function getWeatherCityOverride(): string {
  try {
    return localStorage.getItem(CITY_OVERRIDE_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

/**
 * 设置用户手动指定的城市偏好。
 * 传入空字符串则清除覆盖，恢复 IP 自动定位。
 */
export function setWeatherCityOverride(city: string): void {
  try {
    if (city && city.trim()) {
      localStorage.setItem(CITY_OVERRIDE_KEY, city.trim());
    } else {
      localStorage.removeItem(CITY_OVERRIDE_KEY);
    }
  } catch {
    // localStorage 不可用时静默忽略
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numericValue(value: unknown, fallback = 0): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeWeatherPayload(payload: unknown, fallbackCity = ""): WeatherData | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const data = payload as {
    city?: unknown;
    weather?: unknown;
    condition?: unknown;
    weather_icon?: unknown;
    weatherIcon?: unknown;
    temperature?: unknown;
    humidity?: unknown;
  };
  const condition = stringValue(data.weather) || stringValue(data.condition);
  const hasTemperature = data.temperature !== undefined && data.temperature !== null && data.temperature !== "";
  if (!condition || !hasTemperature) {
    return null;
  }
  const city = stringValue(data.city) || fallbackCity;
  if (!city) {
    return null;
  }
  return {
    city,
    temperature: numericValue(data.temperature),
    humidity: numericValue(data.humidity),
    condition,
    weatherIcon: stringValue(data.weather_icon) || stringValue(data.weatherIcon) || "100",
  };
}

async function fetchWithTimeout(fetcher: Fetcher, url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, {
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timer);
  }
}

async function fetchServerWeather(fetcher: Fetcher): Promise<WeatherData | null> {
  // 如果用户手动指定了城市，将其作为查询参数传给服务端
  const cityOverride = getWeatherCityOverride();
  const url = cityOverride
    ? `${SERVER_WEATHER_URL}?city=${encodeURIComponent(cityOverride)}`
    : SERVER_WEATHER_URL;

  const response = await fetchWithTimeout(fetcher, url, SERVER_TIMEOUT_MS);
  if (!response.ok) {
    if (response.status === 204) {
      return null;
    }
    throw new Error(`HTTP ${response.status}`);
  }
  if (response.status === 204) {
    return null;
  }
  return normalizeWeatherPayload(await response.json());
}

async function fetchWeatherFromSources(fetcher: Fetcher): Promise<WeatherLoadResult> {
  try {
    const serverWeather = await fetchServerWeather(fetcher);
    if (serverWeather) {
      return { status: "ready", data: serverWeather };
    }
    return { status: "failed", reason: "unavailable" };
  } catch {
    return { status: "failed", reason: "request-failed" };
  }
}

export function loadWeatherResult(fetcher: Fetcher = fetch): Promise<WeatherLoadResult> {
  const now = Date.now();
  if (cachedWeather && cachedWeather.expiresAt > now) {
    return Promise.resolve({ status: "ready", data: cachedWeather.data });
  }
  if (weatherPromise) {
    return weatherPromise;
  }

  const pendingWeather = fetchWeatherFromSources(fetcher)
    .then((result) => {
      if (result.status === "ready") {
        cachedWeather = {
          data: result.data,
          expiresAt: Date.now() + WEATHER_CACHE_TTL_MS,
        };
      }
      return result;
    });
  weatherPromise = pendingWeather;
  void pendingWeather.finally(() => {
    if (weatherPromise === pendingWeather) {
      weatherPromise = null;
    }
  });

  return pendingWeather;
}

export async function loadWeatherData(fetcher: Fetcher = fetch): Promise<WeatherData | null> {
  const result = await loadWeatherResult(fetcher);
  return result.status === "ready" ? result.data : null;
}

export function resetWeatherClientCache(): void {
  cachedWeather = null;
  weatherPromise = null;
}

/**
 * 同步检查模块级天气缓存——返回未过期的缓存数据，否则返回 null。
 * 用于无需 await 的 render-phase 缓存命中，避免组件挂载时不必要的 loading 闪烁。
 */
export function peekWeatherCache(): WeatherData | null {
  if (cachedWeather && cachedWeather.expiresAt > Date.now()) {
    return cachedWeather.data;
  }
  return null;
}
