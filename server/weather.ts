import type { Request } from "express";
import { fetch as undiciFetch } from "undici";

export interface WeatherResponse {
  city: string;
  country: string;
  temperature: number;
  humidity: number;
  condition: string;
  weatherIcon: string;
}

interface GeoResult {
  city: string;
  country: string;
}

interface WeatherCacheEntry {
  data: WeatherResponse;
  expiresAt: number;
}

interface GeoCacheEntry {
  geo: GeoResult;
  expiresAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 2000;
const weatherCache = new Map<string, WeatherCacheEntry>();

function evictStaleWeatherCacheEntries() {
  const now = Date.now();
  for (const [key, entry] of weatherCache) {
    if (entry.expiresAt <= now) {
      weatherCache.delete(key);
    }
  }
}

// ── IP 地理位置缓存 ──────────────────────────────────────────────
// 同一 IP 在 GEO_CACHE_TTL 内只查询一次地理位置，避免重复调用外部 API。
const GEO_CACHE_TTL_MS = 60 * 60 * 1000; // 1 小时
const GEO_CACHE_MAX_ENTRIES = 5000;
const geoCache = new Map<string, GeoCacheEntry>();

function evictStaleGeoCacheEntries() {
  const now = Date.now();
  for (const [key, entry] of geoCache) {
    if (entry.expiresAt <= now) {
      geoCache.delete(key);
    }
  }
}

// ── 地理位置 API 速率限制（滑动窗口）──────────────────────────────
// 防止短时间大量刷新导致外部 API 封禁。
const IP9_RATE_LIMIT = 20;    // ip9.com.cn 每分钟最多调用次数
const FALLBACK_RATE_LIMIT = 30; // ip-api.com 每分钟最多调用次数
const IPWHO_RATE_LIMIT = 30;  // ipwho.is 每分钟最多调用次数
const RATE_WINDOW_MS = 60 * 1000;

class SlidingWindowRateLimiter {
  private timestamps: number[] = [];
  private headIndex = 0;
  constructor(private readonly maxCalls: number) {}

  tryAcquire(): boolean {
    const now = Date.now();
    const windowStart = now - RATE_WINDOW_MS;
    // 跳过窗口外的旧记录（惰性清理，O(1) 摊销）
    while (this.headIndex < this.timestamps.length && this.timestamps[this.headIndex] <= windowStart) {
      this.headIndex++;
    }
    // 当跳过的条目积累到一定程度时，压缩数组释放内存
    if (this.headIndex > this.maxCalls * 2) {
      this.timestamps = this.timestamps.slice(this.headIndex);
      this.headIndex = 0;
    }
    const activeCount = this.timestamps.length - this.headIndex;
    if (activeCount >= this.maxCalls) {
      return false;
    }
    this.timestamps.push(now);
    return true;
  }
}

const ip9RateLimiter = new SlidingWindowRateLimiter(IP9_RATE_LIMIT);
const fallbackRateLimiter = new SlidingWindowRateLimiter(FALLBACK_RATE_LIMIT);
const ipwhoRateLimiter = new SlidingWindowRateLimiter(IPWHO_RATE_LIMIT);

// ── 地理位置 API 配置 ────────────────────────────────────────────
const IP9_GEO_API = "https://ip9.com.cn/get";
const IP9_GEO_WITH_IP_API = "https://ip9.com.cn/get/"; // + {ip}
const FALLBACK_GEO_API = "http://ip-api.com/json";
const IPWHO_GEO_API = "https://ipwho.is"; // + /{ip}
const WEATHER_API = "https://uapis.cn/api/v1/misc/weather";

const REQUEST_TIMEOUT_MS = 8000;
const IP9_TIMEOUT_MS = 5000;
const IPWHO_TIMEOUT_MS = 6000;
const REQUEST_HEADERS = { "User-Agent": "ciyuan-nav-weather/1.0" };

interface JsonFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type WeatherFetch = (url: string, init?: unknown) => Promise<JsonFetchResponse>;

let weatherFetch: WeatherFetch = (url, init) => undiciFetch(url, init as any) as unknown as Promise<JsonFetchResponse>;

export function setWeatherFetchForTests(fetcher: WeatherFetch): void {
  weatherFetch = fetcher;
}

export function resetWeatherFetchForTests(): void {
  weatherFetch = (url, init) => undiciFetch(url, init as any) as unknown as Promise<JsonFetchResponse>;
}

export function isPrivateIp(ip: string): boolean {
  const normalized = ip.replace(/^::ffff:/, "");
  if (normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost") {
    return true;
  }
  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(normalized)) {
    return true;
  }
  // 链路本地地址（169.254.x.x）
  if (/^169\.254\./.test(normalized)) {
    return true;
  }
  // IPv6 私有 / 链路本地 / 唯一本地地址
  //   fc00::/7   唯一本地地址（ULA）：fc.. 或 fd..
  //   fe80::/10  链路本地
  //   ::1        回环（已近上面处理）
  // 正则必须匹配前缀之后跟着十六进制或 "::"，而非仅冒号，
  // 否则 "fc00::1" 会被错认成公网（旧正则 /^(fc|fd|fe80):/ 的 bug）
  if (/^(fc|fd)[0-9a-f]{0,2}((::)|(:[0-9a-f]{1,4}){1,})/i.test(normalized)) {
    return true;
  }
  if (/^(fe[89ab])([0-9a-f]{0,2})((::)|(:[0-9a-f]{1,4}){1,})/i.test(normalized)) {
    return true;
  }
  return false;
}

/**
 * 判断 IP 是否为可公开定位的公网地址。
 * 过滤掉回环、私网、链路本地和未指定地址。
 */
export function isPublicIp(ip: string): boolean {
  if (!ip || isPrivateIp(ip)) return false;
  const normalized = ip.replace(/^::ffff:/, "");
  // 过滤 IPv6 未指定地址
  if (normalized === "::" || normalized === "0.0.0.0") return false;
  return true;
}

/**
 * 从请求中提取真实客户端 IP。
 *
 * 优先级：
 * 1. cf-connecting-ip：Cloudflare 代理保证的真实客户端 IP（不可伪造）
 * 2. x-real-ip：Nginx 等反向代理常用的真实 IP 头
 * 3. x-forwarded-for：多级代理链，取最左侧的公网 IP
 * 4. req.ip：Express 解析后的直接连接 IP（受 trust proxy 设置影响）
 *
 * 每一级都验证是否为公网 IP，只有公网 IP 才会被采用；
 * 如果所有候选都是私有/回环地址，返回空字符串让调用方走降级路径。
 */
export function extractClientIp(req: Request): string {
  // 1. Cloudflare 代理的保证真实客户端 IP，优先级最高
  const cfConnectingIp = req.headers["cf-connecting-ip"];
  if (typeof cfConnectingIp === "string") {
    const candidate = cfConnectingIp.trim().replace(/^::ffff:/, "");
    if (isPublicIp(candidate)) {
      return candidate;
    }
  }

  // 2. Nginx/Caddy 等反向代理设置的真实 IP
  const xRealIp = req.headers["x-real-ip"];
  if (typeof xRealIp === "string") {
    const candidate = xRealIp.trim().replace(/^::ffff:/, "");
    if (isPublicIp(candidate)) {
      return candidate;
    }
  }

  // 3. X-Forwarded-For 代理链，取第一个公网 IP
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    for (const segment of forwarded.split(",")) {
      const candidate = segment.trim().replace(/^::ffff:/, "");
      if (candidate && isPublicIp(candidate)) {
        return candidate;
      }
    }
  }

  // 4. Express 解析的直接连接 IP（受 trust proxy 设置影响）
  const directIp = (req.ip || "").replace(/^::ffff:/, "");
  if (directIp && isPublicIp(directIp)) {
    return directIp;
  }

  // 所有来源都是私有/回环地址，返回空字符串让调用方走降级路径
  return "";
}

async function fetchJson<T>(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await weatherFetch(url, {
      headers: REQUEST_HEADERS,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 通过 ip9.com.cn 获取地理位置信息。
 * 当传入 ip 参数时，尝试使用 /get/{ip} 查询指定 IP 的位置；
 * 不传 ip 或指定 IP 查询失败时，回退到无参 /get（获取请求出口位置）。
 * 受滑动窗口速率限制保护（默认每分钟 20 次），超限时直接跳过。
 */
async function geolocateIp9(ip?: string): Promise<GeoResult | null> {
  if (!ip9RateLimiter.tryAcquire()) {
    return null;
  }

  type Ip9Response = {
    code?: number;
    ret?: number;
    ip?: string;
    country?: string;
    province?: string;
    city?: string;
    districts?: string;
    isp?: string;
    data?: {
      ip?: string;
      country?: string;
      prov?: string;
      city?: string;
      isp?: string;
    };
  };

  // 如果指定了 IP，先尝试 IP 指定接口
  if (ip) {
    try {
      const data = await fetchJson<Ip9Response>(
        `${IP9_GEO_WITH_IP_API}${encodeURIComponent(ip)}`,
        IP9_TIMEOUT_MS,
      );
      const isSuccess = data.code === 200 || data.ret === 200;
      if (isSuccess) {
        const city = data.data?.city || data.city || data.data?.prov || data.province || "";
        if (city) {
          return {
            city,
            country: data.data?.country || data.country || "China",
          };
        }
      }
    } catch {
      // IP 指定查询失败，继续使用无参查询
    }
    // IP 指定接口用了一次配额，无参接口再尝试一次
    if (!ip9RateLimiter.tryAcquire()) {
      return null;
    }
  }

  // 无参接口：查询当前请求出口 IP 的位置
  try {
    const data = await fetchJson<Ip9Response>(IP9_GEO_API, IP9_TIMEOUT_MS);

    const isSuccess = data.code === 200 || data.ret === 200;
    if (!isSuccess) {
      return null;
    }

    const city = data.data?.city || data.city || data.data?.prov || data.province || "";
    if (!city) {
      return null;
    }

    return {
      city,
      country: data.data?.country || data.country || "China",
    };
  } catch {
    return null;
  }
}

/**
 * 降级方案：通过 ip-api.com 查询指定 IP 的地理位置。
 * 同样受速率限制保护（默认每分钟 30 次）。
 */
async function geolocateIpFallback(ip: string): Promise<GeoResult | null> {
  if (!fallbackRateLimiter.tryAcquire()) {
    return null;
  }
  try {
    const data = await fetchJson<{
      status: string;
      city?: string;
      country?: string;
    }>(`${FALLBACK_GEO_API}/${ip}?fields=status,country,city`, REQUEST_TIMEOUT_MS);
    if (data.status !== "success" || !data.city) {
      return null;
    }
    return { city: data.city, country: data.country || "" };
  } catch {
    return null;
  }
}

/**
 * 降级方案：通过 ipwho.is 查询指定 IP 的地理位置。
 * 免费 API，无需 API key，受速率限制保护（默认每分钟 30 次）。
 * 返回结构：{ success: true, city: "...", country: "..." }
 */
async function geolocateIpWho(ip: string): Promise<GeoResult | null> {
  if (!ipwhoRateLimiter.tryAcquire()) {
    return null;
  }
  try {
    const data = await fetchJson<{
      success?: boolean;
      city?: string;
      country?: string;
    }>(`${IPWHO_GEO_API}/${encodeURIComponent(ip)}`, IPWHO_TIMEOUT_MS);
    if (data.success === false || !data.city) {
      return null;
    }
    return { city: data.city, country: data.country || "" };
  } catch {
    return null;
  }
}

async function fetchWeatherForCity(city: string): Promise<WeatherResponse | null> {
  try {
    const encodedCity = encodeURIComponent(city);
    const data = await fetchJson<{
      city?: string;
      weather?: string;
      weather_icon?: string;
      temperature?: number;
      humidity?: number;
    }>(`${WEATHER_API}?city=${encodedCity}`);

    if (!data.weather || data.temperature === undefined) {
      return null;
    }

    return {
      city: data.city || city,
      country: "China",
      temperature: Number(data.temperature) || 0,
      humidity: Number(data.humidity) || 0,
      condition: data.weather,
      weatherIcon: data.weather_icon || "100",
    };
  } catch {
    return null;
  }
}

/**
 * 获取指定 IP 的天气信息。
 *
 * 定位降级链（按优先级）：
 * 公网 IP：ip-api.com → ipwho.is → ip9.com.cn(按 IP 查询) → ip9.com.cn(出口 IP)
 * 私有/无 IP：ip9.com.cn(出口 IP) → ip-api.com(出口 IP) → 返回 null
 *
 * 三层防护确保外部地理定位 API 不被封禁：
 * 1. IP 地理缓存（1 小时）：同一 IP 在缓存有效期内不重复查询地理位置
 * 2. 天气缓存（30 分钟）：同一城市共享天气数据
 * 3. 滑动窗口速率限制：ip9.com.cn 每分钟 ≤20 次，ip-api.com 每分钟 ≤30 次，ipwho.is 每分钟 ≤30 次
 */
export async function getWeather(ip: string): Promise<WeatherResponse | null> {
  // ── 第一层：IP 地理缓存（1 小时 TTL）──
  // 空 IP 使用 "anonymous" 作为缓存键，避免每次都重新查询
  const cacheIp = ip || "__anonymous__";
  const geoCached = geoCache.get(cacheIp);
  let geo: GeoResult | null = null;

  if (geoCached && geoCached.expiresAt > Date.now()) {
    geo = geoCached.geo;
  } else {
    // ── 第二层：按速率限制调用外部 API ──
    if (isPublicIp(ip)) {
      // 公网 IP：依次尝试多个地理定位服务
      // 1. ip-api.com（最常用，支持按 IP 查询）
      geo = await geolocateIpFallback(ip);

      // 2. ipwho.is（免费备用）
      if (!geo) {
        geo = await geolocateIpWho(ip);
      }

      // 3. ip9.com.cn（尝试按 IP 查询，再回退到出口 IP）
      if (!geo) {
        geo = await geolocateIp9(ip);
      }
    } else {
      // 私有 IP 或空 IP：使用出口 IP 定位（开发环境和直连场景的兜底）
      geo = await geolocateIp9();
    }

    // 缓存本次 IP 的地理位置结果
    if (geo) {
      if (geoCache.size >= GEO_CACHE_MAX_ENTRIES) {
        evictStaleGeoCacheEntries();
        if (geoCache.size >= GEO_CACHE_MAX_ENTRIES) {
          const oldestKey = geoCache.keys().next().value;
          if (oldestKey !== undefined) {
            geoCache.delete(oldestKey);
          }
        }
      }
      geoCache.set(cacheIp, {
        geo,
        expiresAt: Date.now() + GEO_CACHE_TTL_MS,
      });
    }
  }

  if (!geo) {
    return null;
  }

  // ── 第三层：天气缓存（同一城市共享，30 分钟 TTL）──
  const cacheKey = geo.city;
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const weather = await fetchWeatherForCity(geo.city);
  if (weather) {
    if (weatherCache.size >= CACHE_MAX_ENTRIES) {
      evictStaleWeatherCacheEntries();
      if (weatherCache.size >= CACHE_MAX_ENTRIES) {
        const oldestKey = weatherCache.keys().next().value;
        if (oldestKey !== undefined) {
          weatherCache.delete(oldestKey);
        }
      }
    }
    weatherCache.set(cacheKey, {
      data: weather,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }
  return weather;
}

export function clearWeatherCache(): void {
  weatherCache.clear();
  geoCache.clear();
}

/**
 * 直接按城市名称获取天气（跳过 IP 地理定位）。
 * 用于用户手动指定城市、客户端传入 city 参数等场景。
 * 仍使用天气缓存（30 分钟 TTL）避免重复查询。
 */
export async function getWeatherForCity(city: string): Promise<WeatherResponse | null> {
  if (!city || !city.trim()) return null;
  const normalizedCity = city.trim();

  // 仍使用天气缓存
  const cached = weatherCache.get(normalizedCity);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const weather = await fetchWeatherForCity(normalizedCity);
  if (weather) {
    if (weatherCache.size >= CACHE_MAX_ENTRIES) {
      evictStaleWeatherCacheEntries();
      if (weatherCache.size >= CACHE_MAX_ENTRIES) {
        const oldestKey = weatherCache.keys().next().value;
        if (oldestKey !== undefined) {
          weatherCache.delete(oldestKey);
        }
      }
    }
    weatherCache.set(normalizedCity, {
      data: weather,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }
  return weather;
}
