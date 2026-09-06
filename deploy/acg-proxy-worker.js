/**
 * Cloudflare Worker — ACG 外部 API 反向代理
 *
 * 部署方法：
 * 1. 登录 https://dash.cloudflare.com
 * 2. 左侧菜单 → Workers & Pages → Create Worker
 * 3. 粘贴此代码，Deploy
 * 4. 记下 Worker URL（如 https://acg-proxy.xxx.workers.dev）
 * 5. 在次元导航管理面板 ACG 代理设置中：
 *    - 启用代理：✅
 *    - 代理地址：填写你的 Worker URL
 *
 * 或者直接在服务器 .env 中设置 ACG_PROXY_URL=https://你的worker地址
 */

const ALLOWED_ORIGINS = [
  // 添加你的域名
  // "https://your-domain.com",
].concat(
  // 生产推荐方式: 部署时在 Cloudflare Worker Settings 里设置环境变量
  //   ALLOWED_ORIGINS = https://ciyuan.example.com,https://ciyuan.example.org
  // 多个域名用逗号分隔. 上面的源码静态列表作为回退.
  (typeof ALLOWED_ORIGINS_ENV === "string"
    ? ALLOWED_ORIGINS_ENV.split(",").map((s) => s.trim()).filter(Boolean)
    : []),
);

/**
 * 根据请求 Origin 返回应回显的 Access-Control-Allow-Origin.
 * - 命中 ALLOWED_ORIGINS 白名单: 返回具体 Origin
 * - 未命中: 返回 null, 表示不设该头 (浏览器将拒绝跨域读取响应)
 *   旧行为是回显 "*", 因为本 Worker 同时透传 Authorization / Cookie 等敏感头,
 *   通配会让任意第三方网站从浏览器代持用户身份访问上游 API.
 * - 调试需要可显式设环境变量 ACG_PROXY_ALLOW_ALL_ORIGINS=true (不推荐生产).
 */
function corsAllowOriginFor(request) {
  if (typeof ACG_PROXY_ALLOW_ALL_ORIGINS === "string" && ACG_PROXY_ALLOW_ALL_ORIGINS === "true") {
    return "*";
  }
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  // 严格相等, 防御形如 'https://attacker.com?https://your-domain.com' 的拼装.
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

/**
 * 在 OPTIONS 预检和实际响应上统一应用安全 CORS 头.
 * 未命中白名单时不写 ACAO, 仅保留浏览器需需要的其它预检头.
 */
function applyCorsHeaders(headers, request, methods = "GET,HEAD,POST,OPTIONS") {
  const origin = corsAllowOriginFor(request);
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    // 不同域名主体间不共享凭证, 明确 Vary, 避免被中间 CDN 错误缓存.
    headers.set("Vary", "Origin");
  } else {
    headers.delete("Access-Control-Allow-Origin");
  }
  headers.set("Access-Control-Allow-Methods", methods);
  headers.set("Access-Control-Allow-Headers", PASSTHROUGH_HEADERS.join(", "));
  headers.set("Access-Control-Max-Age", "86400");
}

const API_ROUTES = {
  // Bangumi
  "/bangumi": {
    target: "https://api.bgm.tv",
    pathRewrite: (path) => path.replace(/^\/bangumi/, ""),
  },
  "/bangumi-cover": {
    target: "https://lain.bgm.tv",
    pathRewrite: (path) => path.replace(/^\/bangumi-cover/, ""),
    extraHeaders: { "Referer": "https://bgm.tv/" },
  },
  // MangaDex
  "/mangadex": {
    target: "https://api.mangadex.org",
    pathRewrite: (path) => path.replace(/^\/mangadex/, ""),
  },
  "/mangadex-cover": {
    target: "https://uploads.mangadex.org",
    pathRewrite: (path) => path.replace(/^\/mangadex-cover/, ""),
  },
  // VNDB
  "/vndb": {
    target: "https://api.vndb.org",
    pathRewrite: (path) => {
      const nextPath = path.replace(/^\/vndb/, "");
      return nextPath.startsWith("/kana/") ? nextPath : `/kana${nextPath}`;
    },
  },
  "/vndb-cover": {
    target: "https://s2.vndb.org",
    pathRewrite: (path) => path.replace(/^\/vndb-cover/, ""),
  },
  "/vndb-img": {
    target: "https://t.vndb.org",
    pathRewrite: (path) => path.replace(/^\/vndb-img/, ""),
  },
  // Pixiv
  "/pixiv": {
    target: "https://www.pixiv.net",
    pathRewrite: (path) => path.replace(/^\/pixiv/, ""),
    extraHeaders: { "Referer": "https://www.pixiv.net/", "X-Requested-With": "XMLHttpRequest" },
  },
  "/pixiv-img": {
    target: "https://i.pximg.net",
    pathRewrite: (path) => path.replace(/^\/pixiv-img/, ""),
    extraHeaders: { "Referer": "https://www.pixiv.net/" },
  },
};

const ROUTE_KEYS = Object.keys(API_ROUTES).sort((a, b) => b.length - a.length);
const PASSTHROUGH_HEADERS = [
  "Accept",
  "Authorization",
  "Content-Type",
  "If-Modified-Since",
  "If-None-Match",
  "X-Requested-With",
];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      const headers = new Headers();
      applyCorsHeaders(headers, request);
      return new Response(null, { status: 204, headers });
    }

    // 健康检查
    if (path === "/" || path === "/health") {
      const headers = new Headers({ "Content-Type": "application/json" });
      applyCorsHeaders(headers, request);
      return new Response(JSON.stringify({ status: "ok", routes: Object.keys(API_ROUTES) }), {
        headers,
      });
    }

    // 找匹配的路由
    const routeKey = ROUTE_KEYS.find((key) => path.startsWith(key));
    if (!routeKey) {
      const headers = new Headers({ "Content-Type": "application/json" });
      applyCorsHeaders(headers, request);
      return new Response(
        JSON.stringify({ error: "Not found", available: Object.keys(API_ROUTES) }),
        { status: 404, headers },
      );
    }

    const route = API_ROUTES[routeKey];
    const targetPath = route.pathRewrite(path);
    const targetUrl = `${route.target}${targetPath}${url.search}`;

    // 转发请求
    const headers = new Headers();
    headers.set("User-Agent", "CiYuanNav/1.0 (Cloudflare Worker Proxy)");
    if (route.extraHeaders) {
      for (const [k, v] of Object.entries(route.extraHeaders)) {
        headers.set(k, v);
      }
    }
    // 保留 Accept 和 Content-Type
    for (const name of PASSTHROUGH_HEADERS) {
      const value = request.headers.get(name);
      if (value) {
        headers.set(name, value);
      }
    }

    try {
      const resp = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: request.method !== "GET" && request.method !== "HEAD" ? await request.text() : undefined,
      });

      // 复制响应头
      const respHeaders = new Headers(resp.headers);
      applyCorsHeaders(respHeaders, request);
      respHeaders.set("Cache-Control", request.method === "GET" && resp.ok ? "public, max-age=300" : "no-store");

      return new Response(resp.body, {
        status: resp.status,
        headers: respHeaders,
      });
    } catch (err) {
      const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
      applyCorsHeaders(headers, request);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 502,
        headers,
      });
    }
  },
};
