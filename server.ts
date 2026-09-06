import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import { readFileSync } from "node:fs";
import { createLogger, printLogo, publicErrorMessage } from "./server/logger";
import compression from "compression";
import express from "express";
import helmet from "helmet";
import path from "path";
import { rateLimit } from "express-rate-limit";
import db from "./server/db";
import {
  clearAdminSessionCookie,
  createAdminSession,
  getAdminSessionToken,
  requireAdminSession,
  revokeAdminSession,
  setAdminSessionCookie,
  assertSecureAdminConfiguration,
  shouldSetSecureAdminCookie,
} from "./server/admin-auth";
import {
  assertSecureCommunityConfiguration,
  clearCommunitySessionCookie,
  createCommunitySession,
  getCommunitySessionToken,
  requireCommunitySession,
  revokeCommunitySession,
  setCommunitySessionCookie,
  isValidCommunitySession,
} from "./server/community-auth";
import { readScraperSettings, resolveScraperProxyUrl } from "./server/scraper-settings";
import { resolveMinimumScraperIntervalMs, ScraperJobQueue } from "./server/scraper-jobs";
import { startScraperCron } from "./server/scraper-cron";
import {
  createVisitorId,
  normalizeVisitorId,
  readDailyVisitorCount,
  recordDailyVisitor,
  VISITOR_COOKIE_NAME,
} from "./server/visit-stats";
import { isPublicApiEnabled, PUBLIC_API_ENABLED_SETTING } from "./server/public-api-settings";
import { normalizeSiteSetting, readSiteSettings, SITE_SETTING_KEYS } from "./server/site-settings";
import { configureTrustedProxy } from "./server/trusted-proxy";
import { resolveIconCacheDirectory } from "./server/icon-cache-path";
import { PublicCatalogCache } from "./server/public-catalog-cache";
import { extractClientIp, getWeather, getWeatherForCity } from "./server/weather";

// DailyHot API imports
import {
  getPublicDailyHotItems,
  getPublicDailyHotPlatforms,
  getDailyHotSettings,
  updateDailyHotSettings,
  runDailyHotManually,
  getDailyHotStatus,
  getDailyHotStatistics,
} from "./server/dailyhot-api-routes";
import { restartDailyHotCronFromSettings } from "./server/dailyhot-jobs";
import { handleAnimeCoverRequest, handleAnimeScheduleRequest } from "./server/anime-schedule";
import { handleBangumiCalendarRequest, handleBangumiCoverRequest, warmUpBangumi } from "./server/bangumi-schedule";
import { handleMangaCoverRequest, handleMangaUpdatesRequest, warmUpManga } from "./server/manga-news";
import { handleGalCoverRequest, handleGalRecommendationsRequest, handleGalSearchRequest, warmUpGal } from "./server/vndb-gal";
import { handlePixivImageRequest, handlePixivRankingRequest, warmUpPixiv } from "./server/pixiv-ranking";
import { handleAcgConnectivityCheck } from "./server/acg-connectivity-check";
import { readAcgFeaturesSettings, validateAcgProxyUrl } from "./server/acg-features-settings";
import {
  checkForUpdates,
  getLastCheckResult,
  getUpdateJobStatus,
  readUpdaterSettings,
  restartAutoCheckCron,
  saveUpdaterSettings,
  startAutoCheckCron,
  startReleaseUpdate,
  startSourceUpdate,
  executeUpdatePipeline,
  readUpdaterConfig,
  saveUpdaterConfig,
  queryAuditLog,
  getAuditLogStats,
  rollback,
  listBackups,
  sendTestNotification,
  recoverRunningJobs,
  isWithinMaintenanceWindow,
  getNextMaintenanceWindowStart,
  cancelUpdateJob,
} from "./server/updater";
import { getSiteCheckJobStatus, runSiteChecks, readLatestCheckResults } from "./server/site-checker";
import {
  createSubmission,
  deleteSubmission,
  ensureSubmissionTable,
  listSubmissions,
  updateSubmissionStatus,
  getUnreadCount,
} from "./server/submission";
import {
  readEmailSettings,
  saveEmailSettings,
  sendEmail,
  EMAIL_SETTING_KEYS,
} from "./server/mailer";
import { exportAllData, importAllData } from "./server/data-io";
import { exportBundle, previewBundle, importBundle } from "./server/data-portable";

const log = createLogger("Server");

function installProcessGuards() {
  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled promise rejection; server remains online for diagnosis:", reason);
  });
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    log.error(`Uncaught exception from ${origin}; the service manager should restart the process:`, error);
  });
}

function resolvePort() {
  const requestedPort = process.env.PORT || "3123";
  const port = Number(requestedPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: ${requestedPort}`);
  }
  return port;
}

function readCookie(request: express.Request, name: string) {
  const cookies = request.headers.cookie?.split(";") || [];
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split("=");
    if (key === name) {
      return decodeURIComponent(value.join("="));
    }
  }
  return undefined;
}

const blockCrossSiteMutation: express.RequestHandler = (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    next();
    return;
  }
  if (req.get("Sec-Fetch-Site") === "cross-site") {
    res.status(403).json({ error: "Cross-site request rejected" });
    return;
  }
  const origin = req.get("Origin");
  if (!origin) {
    next();
    return;
  }
  try {
    if (new URL(origin).host !== req.get("host")) {
      res.status(403).json({ error: "Cross-site request rejected" });
      return;
    }
  } catch {
    res.status(403).json({ error: "Invalid request origin" });
    return;
  }
  next();
};

function logInternalApiError(scope: string, err: unknown) {
  log.error("API", `${scope} failed:`, err);
}

function requireHttpUrl(value: unknown, fieldName: string, allowEmpty = false) {
  if (allowEmpty && (value === undefined || value === null || value === "")) {
    return "";
  }
  if (typeof value !== "string" || value.length > 2048) {
    throw new Error(`${fieldName} must be valid`);
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${fieldName} must use http:// or https://`);
  }
  return parsed.toString();
}

async function startServer() {
  assertSecureAdminConfiguration();
  assertSecureCommunityConfiguration();
  const app = express();
  const PORT = resolvePort();
  const publicDataCacheControl = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
  const publicCatalogCache = new PublicCatalogCache();
  const scraperJobs = new ScraperJobQueue(async (trigger) => {
    const { runScraper } = await import("./server/scraper");
    const result = await runScraper({ force: trigger === "manual" });
    if (!result.skipped) {
      publicCatalogCache.clear();
    }
    return result;
  });
  const restartScraperCron = () => startScraperCron(db, () => {
    const started = scraperJobs.start("scheduled");
    if (!started.accepted) {
      log.info("Scraper", `Scheduled trigger skipped: ${started.reason}.`);
    }
  });
  restartScraperCron();
  restartDailyHotCronFromSettings();
  startAutoCheckCron(db);
  recoverRunningJobs(db);
  ensureSubmissionTable();

  configureTrustedProxy(app);
  app.disable("x-powered-by");
  app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === "production" ? {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'", "https://cdn.jsdelivr.net", "https://fastly.jsdelivr.net"],
        fontSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["*", "data:", "blob:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", "https://cdn.jsdelivr.net", "https://fastly.jsdelivr.net", "https://cubism.live2d.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fastly.jsdelivr.net"],
        upgradeInsecureRequests: null,
      },
    } : false,
    strictTransportSecurity: process.env.NODE_ENV === "production" ? undefined : false,
  }));
  app.use(compression({ threshold: 1024 }));
  app.use(express.json({ limit: "5mb" }));
  app.use("/cached-icons", express.static(resolveIconCacheDirectory(), {
    fallthrough: false,
    immutable: true,
    maxAge: "30d",
  }));

  const rateLimitDefaults = {
    standardHeaders: "draft-7" as const,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
  };
  const publicApiLimiter = rateLimit({ ...rateLimitDefaults, windowMs: 60 * 1000, limit: 120 });
  const adminApiLimiter = rateLimit({ ...rateLimitDefaults, windowMs: 60 * 1000, limit: 90 });
  const loginLimiter = rateLimit({
    ...rateLimitDefaults,
    windowMs: 15 * 60 * 1000,
    limit: 5,
    skipSuccessfulRequests: true,
    message: { error: "Too many login attempts, please try again later" },
  });
  const visitLimiter = rateLimit({
    ...rateLimitDefaults,
    windowMs: 60 * 1000,
    limit: 6,
    message: { error: "Visit recording rate limit exceeded" },
  });
  const communityLimiter = rateLimit({
    ...rateLimitDefaults,
    windowMs: 15 * 60 * 1000,
    limit: 20,
    skipSuccessfulRequests: true,
    message: { error: "Too many community unlock attempts, please try again later" },
  });
  app.use("/api/public", publicApiLimiter);
  app.use("/api/admin", adminApiLimiter);

  // --- API Routes ---
  const readCategories = () => db.prepare("SELECT * FROM categories ORDER BY sort_order ASC").all();
  const readSites = (category: unknown, featured: unknown) => {
    let query = `
      SELECT sites.*, categories.name as category_name, categories.slug as category_slug
      FROM sites
      LEFT JOIN categories ON sites.category_id = categories.id
      WHERE sites.is_hidden = 0
    `;
    const params: unknown[] = [];

    if (typeof category === "string" && category) {
      query += " AND categories.slug = ?";
      params.push(category);
    }

    if (featured === "1" || featured === "true") {
      query += " AND sites.is_featured = 1";
    }

    query += " ORDER BY sites.weight DESC, sites.id DESC";
    return (db.prepare(query).all(...params) as any[]).map((site) => ({
      ...site,
      tags: site.tags ? JSON.parse(site.tags) : [],
    }));
  };
  const readSearchIndex = () => {
    const sites = db.prepare(`
      SELECT sites.id, sites.name, sites.url, sites.description, sites.icon_url, sites.local_icon_path, sites.tags, categories.name as category_name
      FROM sites
      LEFT JOIN categories ON sites.category_id = categories.id
      WHERE sites.is_hidden = 0
    `).all();

    return (sites as any[]).map((site) => ({
      ...site,
      tags: site.tags ? JSON.parse(site.tags) : [],
    }));
  };
  const sitesCacheKey = (category: unknown, featured: unknown) => {
    const categoryKey = typeof category === "string" ? category : "";
    const featuredKey = featured === "1" || featured === "true" ? "1" : "0";
    return `sites:${categoryKey}:${featuredKey}`;
  };
  const requirePublicApiEnabled: express.RequestHandler = (_req, res, next) => {
    if (!isPublicApiEnabled(db)) {
      res.set("Cache-Control", "no-store");
      res.status(403).json({ error: "Public API is currently disabled" });
      return;
    }
    next();
  };

  app.get("/api/health", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ status: "ok" });
  });

  // Public Data APIs
  app.get("/api/public/categories", requirePublicApiEnabled, (req, res) => {
    try {
      publicCatalogCache.sendJson(req, res, "categories", publicDataCacheControl, () => JSON.stringify(readCategories()));
    } catch (e: any) {
      logInternalApiError("public categories", e);
      res.status(500).json({ error: "Category data temporarily unavailable" });
    }
  });

  app.get("/api/public/sites", requirePublicApiEnabled, (req, res) => {
    try {
      const { category, featured } = req.query;
      publicCatalogCache.sendJson(
        req,
        res,
        sitesCacheKey(category, featured),
        publicDataCacheControl,
        () => JSON.stringify(readSites(category, featured)),
      );
    } catch (e: any) {
      logInternalApiError("public sites", e);
      res.status(500).json({ error: "Site data temporarily unavailable" });
    }
  });

  app.get("/api/public/search-index", requirePublicApiEnabled, (req, res) => {
    try {
      publicCatalogCache.sendJson(req, res, "search-index", publicDataCacheControl, () => JSON.stringify(readSearchIndex()));
    } catch (e: any) {
      logInternalApiError("public search index", e);
      res.status(500).json({ error: "Search index temporarily unavailable" });
    }
  });

  app.get("/api/public/settings", (req, res) => {
    try {
      publicCatalogCache.sendJson(req, res, "settings", publicDataCacheControl, () => {
        const site = readSiteSettings(db);
        const acg = readAcgFeaturesSettings(db);
        return JSON.stringify({ ...site, gal_search_enabled: acg.gal_search_enabled });
      });
    } catch (e: any) {
      logInternalApiError("public settings", e);
      res.status(500).json({ error: "Site settings temporarily unavailable" });
    }
  });

  app.post("/api/public/visits", visitLimiter, blockCrossSiteMutation, (req, res) => {
    try {
      let visitorId = normalizeVisitorId(readCookie(req, VISITOR_COOKIE_NAME));
      if (!visitorId) {
        visitorId = createVisitorId();
        const secure = shouldSetSecureAdminCookie() ? "; Secure" : "";
        res.append(
          "Set-Cookie",
          `${VISITOR_COOKIE_NAME}=${encodeURIComponent(visitorId)}; Path=/api/public/visits; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`,
        );
      }
      recordDailyVisitor(db, visitorId);
      res.set("Cache-Control", "no-store");
      res.status(204).end();
    } catch (e: any) {
      logInternalApiError("visitor recording", e);
      res.status(500).json({ error: "Visit recording temporarily unavailable" });
    }
  });


  app.get("/api/public/weather", async (req, res) => {
    try {
      const overrideCity = typeof req.query.city === "string" ? req.query.city.trim() : "";
      let weather;
      if (overrideCity) {
        weather = await getWeatherForCity(overrideCity);
      } else {
        const ip = extractClientIp(req);
        weather = await getWeather(ip);
      }
      res.set("Cache-Control", "private, no-store");
      if (!weather) {
        res.status(204).end();
        return;
      }
      res.json(weather);
    } catch (e: any) {
      logInternalApiError("public weather", e);
      res.status(204).end();
    }
  });

  app.get("/api/public/anime-schedule", handleAnimeScheduleRequest);
  app.get("/api/public/anime-schedule/cover", handleAnimeCoverRequest);

  app.get("/api/public/bangumi-calendar", requireCommunitySession, handleBangumiCalendarRequest);
  app.get("/api/public/bangumi-cover", requireCommunitySession, handleBangumiCoverRequest);
  app.get("/api/public/manga-updates", requireCommunitySession, handleMangaUpdatesRequest);
  app.get("/api/public/manga-cover", requireCommunitySession, handleMangaCoverRequest);
  app.get("/api/public/gal-recommendations", requireCommunitySession, handleGalRecommendationsRequest);
  app.get("/api/public/gal-search", requireCommunitySession, handleGalSearchRequest);
  app.get("/api/public/gal-cover", requireCommunitySession, handleGalCoverRequest);
  app.get("/api/public/pixiv-ranking", requireCommunitySession, handlePixivRankingRequest);
  app.get("/api/public/pixiv-image", requireCommunitySession, handlePixivImageRequest);

  // Community access (gate for ACG endpoints above)
  app.post("/api/public/community/unlock", communityLimiter, (req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const token = createCommunitySession(password);
    if (!token) {
      res.status(401).json({ error: "Incorrect password" });
      return;
    }
    setCommunitySessionCookie(res, token);
    res.json({ unlocked: true });
  });

  app.get("/api/public/community/session", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ unlocked: isValidCommunitySession(getCommunitySessionToken(req)) });
  });

  app.post("/api/public/community/logout", (req, res) => {
    revokeCommunitySession(getCommunitySessionToken(req));
    clearCommunitySessionCookie(res);
    res.json({ unlocked: false });
  });

  // DailyHot public APIs
  app.get("/api/public/hot-items", (req, res) => {
    getPublicDailyHotItems(req, res);
  });

  app.get("/api/public/hot-platforms", (req, res) => {
    getPublicDailyHotPlatforms(req, res);
  });

  // Public submissions API (rate limited to prevent abuse)
  const submissionLimiter = rateLimit({
    ...rateLimitDefaults,
    windowMs: 60 * 60 * 1000,
    limit: 10,
    message: { error: "提交过于频繁，请一小时后再试" },
  });

  app.post("/api/public/submissions", submissionLimiter, blockCrossSiteMutation, (req, res) => {
    try {
      const { type, content, contact } = req.body || {};
      if (!type || !content) {
        res.status(400).json({ error: "请填写完整信息" });
        return;
      }
      const clientIp = extractClientIp(req);
      const submission = createSubmission({ type, content, contact, ip: clientIp });
      res.status(201).json({ success: true, id: submission.id });
    } catch (e: any) {
      res.status(400).json({ error: publicErrorMessage("submissions", e, "提交失败") });
    }
  });

  // Admin authentication and protected APIs
  app.use("/api/admin", blockCrossSiteMutation);

  app.post("/api/admin/auth/login", loginLimiter, (req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const token = createAdminSession(password);
    if (!token) {
      res.status(401).json({ error: "Incorrect password" });
      return;
    }
    setAdminSessionCookie(res, token);
    res.json({ success: true });
  });

  app.get("/api/admin/auth/session", requireAdminSession, (_req, res) => {
    res.json({ authenticated: true });
  });

  app.post("/api/admin/auth/logout", (req, res) => {
    revokeAdminSession(getAdminSessionToken(req));
    clearAdminSessionCookie(res);
    res.json({ success: true });
  });

  app.use("/api/admin", requireAdminSession);

  app.get("/api/admin/analytics/visits/today", (_req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(readDailyVisitorCount(db));
    } catch (e: any) {
      logInternalApiError("admin visitor statistics", e);
      res.status(500).json({ error: "Visitor stats temporarily unavailable" });
    }
  });

  app.get("/api/admin/categories", (_req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(readCategories());
    } catch (e: any) {
      logInternalApiError("admin categories", e);
      res.status(500).json({ error: "Category data temporarily unavailable" });
    }
  });

  // Create category (used by URL import auto-creation)
  app.post("/api/admin/categories", (req, res) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        res.status(400).json({ error: "分类名称不能为空" });
        return;
      }
      const slug = name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-|-$/g, "") || name.trim();
      const existing = db.prepare("SELECT id FROM categories WHERE name = ?").get(name.trim());
      if (existing) {
        res.json({ id: (existing as { id: number }).id, name: name.trim(), slug, created: false });
        return;
      }
      const result = db.prepare("INSERT INTO categories (name, slug, icon, sort_order) VALUES (?, ?, ?, 0)").run(name.trim(), slug, req.body.icon || null);
      const newId = Number(result.lastInsertRowid);
      res.json({ id: newId, name: name.trim(), slug, created: true });
    } catch (e: any) {
      logInternalApiError("admin category create", e);
      res.status(500).json({ error: publicErrorMessage("admin category create", e, "创建分类失败") });
    }
  });

  // Update category
  app.put("/api/admin/categories/:id", (req, res) => {
    try {
      const catId = parseInt(req.params.id, 10);
      if (!Number.isInteger(catId) || catId < 1) {
        res.status(400).json({ error: "无效的分类 ID" });
        return;
      }
      const existing = db.prepare("SELECT id FROM categories WHERE id = ?").get(catId);
      if (!existing) {
        res.status(404).json({ error: "分类不存在" });
        return;
      }
      const { name, icon, slug, sort_order } = req.body;
      if (name !== undefined && (!name || typeof name !== "string" || !name.trim())) {
        res.status(400).json({ error: "分类名称不能为空" });
        return;
      }
      const updates: string[] = [];
      const params: any[] = [];
      if (name !== undefined) { updates.push("name = ?"); params.push(name.trim()); }
      if (icon !== undefined) { updates.push("icon = ?"); params.push(icon || null); }
      if (slug !== undefined) { updates.push("slug = ?"); params.push(slug); }
      if (sort_order !== undefined) { updates.push("sort_order = ?"); params.push(Number(sort_order)); }
      if (updates.length === 0) {
        res.status(400).json({ error: "没有要更新的字段" });
        return;
      }
      params.push(catId);
      db.prepare(`UPDATE categories SET ${updates.join(", ")} WHERE id = ?`).run(...params);
      publicCatalogCache.clear();
      res.json({ success: true });
    } catch (e: any) {
      logInternalApiError("admin category update", e);
      res.status(500).json({ error: publicErrorMessage("admin category update", e, "更新分类失败") });
    }
  });

  // Delete category
  app.delete("/api/admin/categories/:id", (req, res) => {
    try {
      const catId = parseInt(req.params.id, 10);
      if (!Number.isInteger(catId) || catId < 1) {
        res.status(400).json({ error: "无效的分类 ID" });
        return;
      }
      const existing = db.prepare("SELECT id FROM categories WHERE id = ?").get(catId);
      if (!existing) {
        res.status(404).json({ error: "分类不存在" });
        return;
      }
      // 获取 move_to 参数，如果不提供则拒绝（防止误删）
      const moveTo = req.body?.move_to ? parseInt(req.body.move_to, 10) : null;
      if (moveTo !== null && (!Number.isInteger(moveTo) || moveTo < 1 || moveTo === catId)) {
        res.status(400).json({ error: "无效的目标分类" });
        return;
      }
      db.transaction(() => {
        if (moveTo) {
          // 将该分类下的站点移到目标分类
          db.prepare("UPDATE sites SET category_id = ? WHERE category_id = ?").run(moveTo, catId);
        } else {
          // 没有目标分类时，只允许删除空分类
          const count = db.prepare("SELECT COUNT(*) as cnt FROM sites WHERE category_id = ?").get(catId) as { cnt: number };
          if (count.cnt > 0) {
            throw new Error(`该分类下有 ${count.cnt} 个站点，请先移动或删除它们`);
          }
        }
        db.prepare("DELETE FROM categories WHERE id = ?").run(catId);
        db.prepare("UPDATE categories SET parent_id = NULL WHERE parent_id = ?").run(catId);
      })();
      publicCatalogCache.clear();
      res.json({ success: true });
    } catch (e: any) {
      logInternalApiError("admin category delete", e);
      res.status(500).json({ error: publicErrorMessage("admin category delete", e, "删除分类失败") });
    }
  });

  // Batch move sites to a category
  app.post("/api/admin/sites/batch-move", (req, res) => {
    try {
      const { siteIds, toCategoryId } = req.body;
      if (!Array.isArray(siteIds) || siteIds.length === 0) {
        res.status(400).json({ error: "请选择要移动的站点" });
        return;
      }
      const catId = parseInt(toCategoryId, 10);
      if (!Number.isInteger(catId) || catId < 1) {
        res.status(400).json({ error: "无效的目标分类" });
        return;
      }
      const catExists = db.prepare("SELECT id FROM categories WHERE id = ?").get(catId);
      if (!catExists) {
        res.status(404).json({ error: "目标分类不存在" });
        return;
      }
      const stmt = db.prepare("UPDATE sites SET category_id = ? WHERE id = ?");
      let moved = 0;
      db.transaction(() => {
        for (const id of siteIds) {
          const nid = parseInt(id, 10);
          if (Number.isInteger(nid) && nid > 0) {
            stmt.run(catId, nid);
            moved++;
          }
        }
      })();
      publicCatalogCache.clear();
      res.json({ success: true, moved });
    } catch (e: any) {
      logInternalApiError("admin batch move", e);
      res.status(500).json({ error: publicErrorMessage("admin sites batch-move", e, "批量移动失败") });
    }
  });

  // Batch delete sites
  app.post("/api/admin/sites/batch-delete", (req, res) => {
    try {
      const { siteIds } = req.body;
      if (!Array.isArray(siteIds) || siteIds.length === 0) {
        res.status(400).json({ error: "请选择要删除的站点" });
        return;
      }
      const stmt = db.prepare("DELETE FROM sites WHERE id = ?");
      let deleted = 0;
      db.transaction(() => {
        for (const id of siteIds) {
          const nid = parseInt(id, 10);
          if (Number.isInteger(nid) && nid > 0) {
            stmt.run(nid);
            deleted++;
          }
        }
      })();
      publicCatalogCache.clear();
      res.json({ success: true, deleted });
    } catch (e: any) {
      logInternalApiError("admin batch delete", e);
      res.status(500).json({ error: publicErrorMessage("admin sites batch-delete", e, "批量删除失败") });
    }
  });

  // Import preview - validate and preview import data without committing
  app.post("/api/admin/data/import/preview", (req, res) => {
    let body = "";
    let aborted = false;
    req.setEncoding("utf-8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf-8") > 50 * 1024 * 1024) {
        aborted = true;
        req.destroy();
        if (!res.headersSent) res.status(413).json({ error: "文件过大" });
      }
    });
    req.on("end", () => {
      if (aborted || !body) {
        if (!res.headersSent) res.status(400).json({ error: "请上传有效的数据文件" });
        return;
      }
      try {
        const importData = JSON.parse(body);
        // 基本校验
        if (!importData || importData.version !== 1 || !importData.data) {
          res.status(400).json({ error: "无效的导入文件格式或不支持的数据版本" });
          return;
        }
        const preview = {
          categories: Array.isArray(importData.data.categories) ? importData.data.categories.length : 0,
          sites: Array.isArray(importData.data.sites) ? importData.data.sites.length : 0,
          settings: Array.isArray(importData.data.settings) ? importData.data.settings.length : 0,
          dailyhotItems: Array.isArray(importData.data.dailyhot_items) ? importData.data.dailyhot_items.length : 0,
          acgCacheFiles: importData.data.acg_cache ? Object.keys(importData.data.acg_cache).length : 0,
          exportedAt: importData.exportedAt || "未知",
          version: importData.version || 1,
          sampleCategories: Array.isArray(importData.data.categories)
            ? importData.data.categories.slice(0, 10).map((c: any) => c.name || c.id)
            : [],
          sampleSites: Array.isArray(importData.data.sites)
            ? importData.data.sites.slice(0, 10).map((s: any) => ({ name: s.name, url: s.url }))
            : [],
        };
        res.json(preview);
      } catch (e: any) {
        res.status(400).json({ error: "JSON 解析失败: " + (e.message || "未知错误") });
      }
    });
    req.on("error", () => {
      if (!res.headersSent) res.status(400).json({ error: "请求体读取失败" });
    });
  });

  app.get("/api/admin/sites", (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(readSites(req.query.category, req.query.featured));
    } catch (e: any) {
      logInternalApiError("admin sites", e);
      res.status(500).json({ error: "Site data temporarily unavailable" });
    }
  });

  app.post("/api/admin/scraper/run", (_req, res) => {
    const started = scraperJobs.start("manual");
    if (!started.accepted) {
      const error = started.reason === "running"
        ? "Scraper is already running, please wait"
        : "Trigger too frequent, please try again later";
      res.status(429).json({ error, retryAfterMs: started.retryAfterMs, job: started.job });
      return;
    }
    res.status(202).json({ success: true, job: started.job });
  });

  app.get("/api/admin/scraper/status", (_req, res) => {
    res.json({ job: scraperJobs.status() || null });
  });

  app.get("/api/admin/settings", (req, res) => {
    try {
      const settings = db.prepare('SELECT * FROM settings').all();
      const settingsMap = settings.reduce((acc: any, row: any) => {
        acc[row.key] = row.value;
        return acc;
      }, {});
      res.json(settingsMap);
    } catch (e: any) {
      logInternalApiError("admin settings read", e);
      res.status(500).json({ error: "Settings temporarily unavailable" });
    }
  });

  app.post("/api/admin/settings", (req, res) => {
     try {
       const submitted = req.body as Record<string, unknown>;
       const allowedKeys = new Set([
         "scraper_url",
         "scraper_interval_hours",
         "scraper_enabled",
         "scraper_proxy_enabled",
         "scraper_proxy_url",
         PUBLIC_API_ENABLED_SETTING,
         ...SITE_SETTING_KEYS,
       ]);
       const settings = Object.fromEntries(
         Object.entries(submitted || {})
           .filter(([key]) => allowedKeys.has(key))
           .map(([key, value]) => [key, String(value)]),
       );
       if (settings[PUBLIC_API_ENABLED_SETTING] !== undefined) {
         settings[PUBLIC_API_ENABLED_SETTING] = settings[PUBLIC_API_ENABLED_SETTING] === "true" ? "true" : "false";
       }
       for (const [key, value] of Object.entries(settings)) {
         if (SITE_SETTING_KEYS.has(key)) {
           settings[key] = normalizeSiteSetting(key, value) || "";
         }
       }
       if (settings.scraper_url !== undefined) {
         settings.scraper_url = requireHttpUrl(settings.scraper_url, "Scraper URL", true);
       }
       if (settings.scraper_interval_hours !== undefined) {
         const interval = Number(settings.scraper_interval_hours);
         if (!Number.isFinite(interval) || interval <= 0) {
        res.status(400).json({ error: "Scraper interval must be a positive number" });
           return;
         }
         const minimumHours = resolveMinimumScraperIntervalMs() / (60 * 60 * 1000);
         if (interval < minimumHours) {
          res.status(400).json({ error: `Scraper interval must be at least ${minimumHours} hours` });
           return;
         }
       }
       const current = readScraperSettings(db);
       resolveScraperProxyUrl({ ...current, ...settings });
       const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
       db.transaction(() => {
         for (const [key, value] of Object.entries(settings)) {
           stmt.run(key, String(value));
         }
       })();
       if (settings.scraper_interval_hours || settings.scraper_enabled) {
         restartScraperCron();
       }
       if (
         settings[PUBLIC_API_ENABLED_SETTING] !== undefined
         || Object.keys(settings).some((key) => SITE_SETTING_KEYS.has(key))
       ) {
         publicCatalogCache.clear();
       }
       res.json({ success: true });
     } catch (e: any) {
      if (e instanceof Error && /URL|interval|display/.test(e.message)) {
         res.status(400).json({ error: publicErrorMessage("admin settings save", e, "设置保存失败") });
         return;
       }
       logInternalApiError("admin settings save", e);
      res.status(500).json({ error: "Failed to save settings" });
     }
  });

  app.post("/api/admin/sites", (req, res) => {
     try {
       const { name, url, description, category_id, tags, icon_url, is_featured } = req.body;
       const normalizedName = typeof name === "string" ? name.trim() : "";
       const normalizedDescription = typeof description === "string" ? description.trim() : "";
       const normalizedCategoryId = Number(category_id);
       if (!normalizedName || normalizedName.length > 120 || normalizedDescription.length > 500) {
        res.status(400).json({ error: "Invalid site name or description" });
         return;
       }
       if (!Number.isInteger(normalizedCategoryId) || normalizedCategoryId < 1) {
        res.status(400).json({ error: "Invalid category" });
         return;
       }
       if (!Array.isArray(tags) || tags.length > 20 || tags.some((tag) => typeof tag !== "string" || tag.length > 40)) {
        res.status(400).json({ error: "Invalid tags" });
         return;
       }
       const normalizedUrl = requireHttpUrl(url, "Site URL");
       const normalizedIconUrl = requireHttpUrl(icon_url, "Icon URL", true);
       const stmt = db.prepare(`
         INSERT INTO sites (name, url, description, category_id, tags, icon_url, is_featured)
         VALUES (?, ?, ?, ?, ?, ?, ?)
       `);
       const result = stmt.run(
         normalizedName,
         normalizedUrl,
         normalizedDescription,
         normalizedCategoryId,
         JSON.stringify(tags.map((tag) => tag.trim()).filter(Boolean)),
         normalizedIconUrl,
         is_featured ? 1 : 0,
       );
       publicCatalogCache.clear();
       res.json({ success: true, id: result.lastInsertRowid });
     } catch (e: any) {
       if (e instanceof Error && e.message.includes("URL")) {
         res.status(400).json({ error: publicErrorMessage("admin site create", e, "添加资源失败") });
         return;
       }
       logInternalApiError("admin site create", e);
      res.status(500).json({ error: "Failed to save site" });
     }
  });

  app.delete("/api/admin/sites/:id", (req, res) => {
    try {
      const stmt = db.prepare('DELETE FROM sites WHERE id = ?');
      stmt.run(req.params.id);
      publicCatalogCache.clear();
      res.json({ success: true });
    } catch (e: any) {
      logInternalApiError("admin site deletion", e);
      res.status(500).json({ error: "Failed to delete site" });
    }
  });

  // Admin update site (edit)
  app.put("/api/admin/sites/:id", (req, res) => {
    try {
      const siteId = parseInt(req.params.id, 10);
      if (!Number.isInteger(siteId) || siteId < 1) {
        res.status(400).json({ error: "Invalid site ID" });
        return;
      }

      const existing = db.prepare('SELECT id FROM sites WHERE id = ?').get(siteId);
      if (!existing) {
        res.status(404).json({ error: "Site not found" });
        return;
      }

      const { name, url, description, category_id, tags, icon_url, is_featured } = req.body;
      const normalizedName = typeof name === "string" ? name.trim() : "";
      const normalizedDescription = typeof description === "string" ? description.trim() : "";
      const normalizedCategoryId = Number(category_id);

      if (!normalizedName || normalizedName.length > 120 || normalizedDescription.length > 500) {
        res.status(400).json({ error: "Invalid site name or description" });
        return;
      }
      if (!Number.isInteger(normalizedCategoryId) || normalizedCategoryId < 1) {
        res.status(400).json({ error: "Invalid category" });
        return;
      }
      if (!Array.isArray(tags) || tags.length > 20 || tags.some((tag) => typeof tag !== "string" || tag.length > 40)) {
        res.status(400).json({ error: "Invalid tags" });
        return;
      }

      const normalizedUrl = requireHttpUrl(url, "Site URL");
      const normalizedIconUrl = requireHttpUrl(icon_url, "Icon URL", true);

      db.prepare(`
        UPDATE sites SET name = ?, url = ?, description = ?, category_id = ?, tags = ?, icon_url = ?, is_featured = ?
        WHERE id = ?
      `).run(
        normalizedName,
        normalizedUrl,
        normalizedDescription,
        normalizedCategoryId,
        JSON.stringify(tags.map((t: string) => t.trim()).filter(Boolean)),
        normalizedIconUrl,
        is_featured ? 1 : 0,
        siteId,
      );

      publicCatalogCache.clear();
      res.json({ success: true });
    } catch (e: any) {
      if (e instanceof Error && e.message.includes("URL")) {
        res.status(400).json({ error: publicErrorMessage("admin site update", e, "更新资源失败") });
        return;
      }
      logInternalApiError("admin site update", e);
      res.status(500).json({ error: "Failed to update site" });
    }
  });

  // DailyHot Admin APIs
  app.get("/api/admin/dailyhot/settings", (req, res) => { getDailyHotSettings(req, res); });
  app.post("/api/admin/dailyhot/settings", (req, res) => { updateDailyHotSettings(req, res); });
  app.post("/api/admin/dailyhot/run", (req, res) => { runDailyHotManually(req, res); });
  app.get("/api/admin/dailyhot/status", (req, res) => { getDailyHotStatus(req, res); });
  app.get("/api/admin/dailyhot/statistics", (req, res) => { getDailyHotStatistics(req, res); });

  // Submission Admin APIs
  app.get("/api/admin/submissions", (req, res) => {
    try {
      const { status, type, page, pageSize } = req.query;
      const result = listSubmissions({
        status: typeof status === "string" ? status : undefined,
        type: typeof type === "string" ? type : undefined,
        page: page ? parseInt(page as string, 10) : undefined,
        pageSize: pageSize ? parseInt(pageSize as string, 10) : undefined,
      });
      res.json(result);
    } catch (e: any) {
      logInternalApiError("admin submissions list", e);
      res.status(500).json({ error: "Failed to list submissions" });
    }
  });

  app.patch("/api/admin/submissions/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { status, admin_note } = req.body || {};
      if (!id || !status) {
        res.status(400).json({ error: "Invalid parameters" });
        return;
      }
      const updated = updateSubmissionStatus(id, status, admin_note);
      res.json({ success: true, submission: updated });
    } catch (e: any) {
      logInternalApiError("admin submission update", e);
      res.status(500).json({ error: publicErrorMessage("admin submission update", e, "Failed to update submission") });
    }
  });

  app.delete("/api/admin/submissions/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) { res.status(400).json({ error: "Invalid ID" }); return; }
      deleteSubmission(id);
      res.json({ success: true });
    } catch (e: any) {
      logInternalApiError("admin submission delete", e);
      res.status(500).json({ error: publicErrorMessage("admin submission delete", e, "Failed to delete submission") });
    }
  });

  app.get("/api/admin/submissions/unread-count", (_req, res) => {
    try {
      res.json({ count: getUnreadCount() });
    } catch (e: any) {
      logInternalApiError("admin submissions count", e);
      res.status(500).json({ error: "Failed to get unread count" });
    }
  });

  // Email Admin APIs
  app.get("/api/admin/email/settings", (_req, res) => {
    try {
      const settings = readEmailSettings();
      // 掩盖 API Key，仅返回前后各4位，防止泄露
      if (settings.resend_api_key && settings.resend_api_key.length > 8) {
        const key = settings.resend_api_key;
        settings.resend_api_key = key.slice(0, 4) + "*" .repeat(key.length - 8) + key.slice(-4);
      }
      res.json({ settings });
    } catch (e: any) {
      logInternalApiError("email settings read", e);
      res.status(500).json({ error: "Failed to read email settings" });
    }
  });

  app.post("/api/admin/email/settings", (req, res) => {
    try {
      const body = req.body || {};
      const updates: Record<string, any> = {};

      if (body.resend_api_key !== undefined) {
        // 拒绝掩盖值（含星号），防止前端掩盖后的值被意外提交
        if (typeof body.resend_api_key === 'string' && body.resend_api_key.includes('*')) {
          // 忽略，不更新
        } else {
          updates.resend_api_key = String(body.resend_api_key);
        }
      }
      if (body.from_addr !== undefined) updates.from_addr = String(body.from_addr);
      if (body.from_name !== undefined) updates.from_name = String(body.from_name);
      if (body.notify_on_submission !== undefined) updates.notify_on_submission = Boolean(body.notify_on_submission);
      if (body.notify_on_error !== undefined) updates.notify_on_error = Boolean(body.notify_on_error);
      if (body.admin_recipients !== undefined) {
        if (Array.isArray(body.admin_recipients)) {
          updates.admin_recipients = body.admin_recipients.map((s: string) => s.trim()).filter(Boolean);
        } else {
          updates.admin_recipients = String(body.admin_recipients).split(',').map((s: string) => s.trim()).filter(Boolean);
        }
      }

      saveEmailSettings(updates);
      const savedSettings = readEmailSettings();
      // 掩盖 API Key
      if (savedSettings.resend_api_key && savedSettings.resend_api_key.length > 8) {
        const key = savedSettings.resend_api_key;
        savedSettings.resend_api_key = key.slice(0, 4) + "*".repeat(key.length - 8) + key.slice(-4);
      }
      res.json({ success: true, settings: savedSettings });
    } catch (e: any) {
      logInternalApiError("email settings save", e);
      res.status(500).json({ error: "Failed to save email settings" });
    }
  });

  app.post("/api/admin/email/test", async (req, res) => {
    try {
      const { recipient, resend_api_key, from_addr, from_name } = req.body || {};
      if (!recipient) {
        res.status(400).json({ success: false, message: "请提供收件人地址" });
        return;
      }

      // 直接传入配置参数，无需先保存到 DB
      const result = await sendEmail(
        recipient,
        "[次元导航] 测试邮件",
        `这是一封来自次元导航系统的测试邮件。\n\n如果收到此邮件，说明 Resend 邮箱配置正确。\n发送时间: ${new Date().toLocaleString('zh-CN')}`,
        { resend_api_key, from_addr, from_name },
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ── 数据导入/导出 ─────────────────────────────────

  app.get("/api/admin/data/export", (_req, res) => {
    try {
      const data = exportAllData();
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="nav-data-${new Date().toISOString().slice(0, 10)}.json"`);
      res.json(data);
    } catch (e: any) {
      logInternalApiError("data export", e);
      res.status(500).json({ error: "导出失败: " + (e.message || "未知错误") });
    }
  });

  // Data import — 使用自定义 body 读取（50MB 无限制）避免 express.json() limit 拦截
  app.post("/api/admin/data/import", (req, res) => {
    let body = "";
    let aborted = false;
    req.setEncoding("utf-8");
    req.on("data", (chunk: string) => {
      body += chunk;
      // 限制 50MB
      if (Buffer.byteLength(body, "utf-8") > 50 * 1024 * 1024) {
        aborted = true;
        req.destroy();
        if (!res.headersSent) res.status(413).json({ error: "文件过大，最大支持 50MB" });
      }
    });
    req.on("end", () => {
      if (aborted || !body) {
        if (!res.headersSent) res.status(400).json({ error: "请上传有效的数据文件" });
        return;
      }
      try {
        const importData = JSON.parse(body);
        const result = importAllData(importData);
        res.json(result);
      } catch (e: any) {
        logInternalApiError("data import", e);
        if (!res.headersSent) res.status(400).json({ error: publicErrorMessage("admin data import", e, "导入失败") });
      }
    });
    req.on("error", () => {
      if (!res.headersSent) res.status(400).json({ error: "请求体读取失败" });
    });
  });

  // ---- Data bundle v2 APIs（便携导出/导入） ----
  // 导出：生成 tar.gz bundle 供下载
  app.get("/api/admin/data/bundle/export", async (_req, res) => {
    try {
      const result = await exportBundle();
      const stat = fs.statSync(result.filePath);
      res.setHeader("Content-Type", "application/gzip");
      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(result.filePath)}"`);
      res.setHeader("Content-Length", String(stat.size));
      const stream = fs.createReadStream(result.filePath);
      stream.pipe(res);
    } catch (e: any) {
      logInternalApiError("data bundle export", e);
      res.status(500).json({ error: publicErrorMessage("admin data bundle export", e, "导出失败") });
    }
  });

  // 上传 bundle 到临时文件（多路复用，供预览/导入）
  const readBundleUpload = (req: express.Request): Promise<string> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      req.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > 200 * 1024 * 1024) {
          reject(new Error("上传文件过大（> 200MB）"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (chunks.length === 0) {
          reject(new Error("上传内容为空"));
          return;
        }
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guga-upload-"));
        const filePath = path.join(dir, "upload.tar.gz");
        fs.writeFileSync(filePath, Buffer.concat(chunks));
        resolve(filePath);
      });
      req.on("error", () => reject(new Error("请求体读取失败")));
    });

  // 预览：校验 bundle 并返回统计，不落库
  app.post("/api/admin/data/bundle/import/preview", async (req, res) => {
    let filePath: string | undefined;
    try {
      filePath = await readBundleUpload(req);
      const summary = await previewBundle(filePath);
      res.json({ success: true, ...summary });
    } catch (e: any) {
      logInternalApiError("data bundle preview", e);
      if (!res.headersSent) res.status(400).json({ error: publicErrorMessage("admin data bundle preview", e, "预览失败") });
    } finally {
      if (filePath) {
        try { fs.rmSync(path.dirname(filePath), { recursive: true, force: true }); } catch {}
      }
    }
  });

  // 导入：校验后执行导入
  app.post("/api/admin/data/bundle/import", async (req, res) => {
    let filePath: string | undefined;
    try {
      filePath = await readBundleUpload(req);
      const result = await importBundle(filePath);
      res.json(result);
    } catch (e: any) {
      logInternalApiError("data bundle import", e);
      if (!res.headersSent) res.status(400).json({ error: publicErrorMessage("admin data bundle import", e, "导入失败") });
    } finally {
      if (filePath) {
        try { fs.rmSync(path.dirname(filePath), { recursive: true, force: true }); } catch {}
      }
    }
  });

  // Updater Admin APIs
  app.get("/api/admin/updater/check", async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const channel = (req.query.channel as 'stable' | 'beta' | 'nightly') || 'stable';
      const { fetchLatestRelease, fetchTags } = await import("./server/updater/github.js");
      const { readPackageVersion } = await import("./server/updater/source-update.js");
      const { compareVersions, getLatestVersionFromTags } = await import("./server/updater/version.js");
      const currentVersion = readPackageVersion();
      let latestRelease = null;
      let latestTag = null;
      try {
        if (channel === 'nightly') {
          const tags = await fetchTags();
          latestTag = getLatestVersionFromTags(tags);
        } else {
          latestRelease = await fetchLatestRelease(channel);
        }
      } catch {}
      const latestVersion = latestRelease?.tag_name || latestTag;
      const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;
      res.json({
        currentVersion,
        latestVersion: latestVersion || null,
        latestTag: latestRelease?.tag_name || latestTag || null,
        releaseUrl: latestRelease?.html_url || null,
        releaseBody: latestRelease?.body || null,
        publishedAt: latestRelease?.published_at || null,
        hasUpdate,
        hasGitRemote: false, // 简化
        hasRelease: !!latestRelease,
        channel,
        checkedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      logInternalApiError("updater check", e);
      res.status(500).json({ error: "Update check failed: " + (e.message || "Unknown error") });
    }
  });

  app.get("/api/admin/updater/status", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ job: getUpdateJobStatus() || null, lastCheck: getLastCheckResult() || null });
  });

  app.get("/api/admin/updater/settings", (_req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json({ settings: readUpdaterConfig(db) });
    } catch (e: any) {
      logInternalApiError("updater settings read", e);
      res.status(500).json({ error: "Failed to read updater settings" });
    }
  });

  app.post("/api/admin/updater/settings", (req, res) => {
    try {
      const settings = req.body || {};
      saveUpdaterConfig(db, settings);
      restartAutoCheckCron(db);
      res.json({ success: true, settings: readUpdaterConfig(db) });
    } catch (e: any) {
      logInternalApiError("updater settings save", e);
      res.status(500).json({ error: "Failed to save updater settings" });
    }
  });

  app.post("/api/admin/updater/update-source", async (req, res) => {
    try {
      const options = req.body || {};
      const job = await executeUpdatePipeline(db, 'source', options);
      res.status(202).json({ success: true, job });
    } catch (e: any) {
      const status = e.message.includes("\u6b63\u5728\u8fd0\u884c") || e.message.includes("\u9891\u7e41") ? 429 : 500;
      res.status(status).json({ error: publicErrorMessage("admin updater update-source", e, "更新源任务调度失败") });
    }
  });

  app.post("/api/admin/updater/update-release", async (req, res) => {
    try {
      const options = req.body || {};
      const job = await executeUpdatePipeline(db, 'release', options);
      res.status(202).json({ success: true, job });
    } catch (e: any) {
      const status = e.message.includes("\u6b63\u5728\u8fd0\u884c") || e.message.includes("\u9891\u7e41") ? 429 : 500;
      res.status(status).json({ error: publicErrorMessage("admin updater update-release", e, "更新发布任务调度失败") });
    }
  });

  // 取消更新任务
  app.post("/api/admin/updater/cancel", (_req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const result = cancelUpdateJob();
      if (result.success) {
        res.json({ success: true, job: result.job });
      } else {
        res.status(409).json({ success: false, error: result.error });
      }
    } catch (e: any) {
      logInternalApiError("updater cancel", e);
      res.status(500).json({ error: "Cancel update failed: " + e.message });
    }
  });

  // 审计日志
  app.get("/api/admin/updater/audit-log", (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const query = {
        event: req.query.event as 'check' | 'preflight' | 'update_start' | 'update_success' | 'update_failed' | 'health_check' | 'rollback_success' | 'rollback_failed' | 'update_deferred_outside_window' | undefined,
        channel: req.query.channel as 'stable' | 'beta' | 'nightly' | undefined,
        method: req.query.method as 'source' | 'release' | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
        page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
        pageSize: req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : undefined,
      };
      const result = queryAuditLog(db, query);
      res.json(result);
    } catch (e: any) {
      logInternalApiError("updater audit-log", e);
      res.status(500).json({ error: "Failed to query audit log" });
    }
  });

  // 审计统计
  app.get("/api/admin/updater/audit-stats", (_req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(getAuditLogStats(db));
    } catch (e: any) {
      logInternalApiError("updater audit-stats", e);
      res.status(500).json({ error: "Failed to get audit stats" });
    }
  });

  // 手动回滚
  app.post("/api/admin/updater/rollback", async (req, res) => {
    try {
      const { backupId } = req.body || {};
      if (!backupId) {
        res.status(400).json({ error: "缺少 backupId 参数" });
        return;
      }
      const result = await rollback(backupId);
      if (result.success) {
        res.json({ success: true, restoredVersion: result.restoredVersion });
      } else {
        res.status(500).json({ success: false, error: result.error });
      }
    } catch (e: any) {
      logInternalApiError("updater rollback", e);
      res.status(500).json({ error: "Rollback failed: " + e.message });
    }
  });

  // 备份列表
  app.get("/api/admin/updater/backups", async (_req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const backups = await listBackups();
      res.json({ backups });
    } catch (e: any) {
      logInternalApiError("updater backups", e);
      res.status(500).json({ error: "Failed to list backups" });
    }
  });

  // 测试通知
  app.post("/api/admin/updater/test-notification", async (req, res) => {
    try {
      const settings = readUpdaterConfig(db);
      const result = await sendTestNotification(settings);
      res.json({ success: true, result });
    } catch (e: any) {
      logInternalApiError("updater test-notification", e);
      res.status(500).json({ error: "Test notification failed: " + e.message });
    }
  });

  // 维护窗口状态
  app.get("/api/admin/updater/maintenance-window", (req, res) => {
    try {
      const settings = readUpdaterConfig(db);
      const { maintenance_window } = settings;
      const nextStart = getNextMaintenanceWindowStart(maintenance_window.start_hour, maintenance_window.end_hour, maintenance_window.timezone);
      const isInWindow = isWithinMaintenanceWindow(maintenance_window.start_hour, maintenance_window.end_hour, maintenance_window.timezone);
      res.json({
        window: maintenance_window,
        isInWindow,
        nextWindowStart: nextStart?.toISOString() || null,
      });
    } catch (e: any) {
      logInternalApiError("updater maintenance-window", e);
      res.status(500).json({ error: "Failed to get maintenance window status" });
    }
  });

  // Site Health Check APIs
  app.post("/api/admin/site-checks/run", (_req, res) => {
    try {
      const job = runSiteChecks(db);
      res.status(202).json({ success: true, job: { id: job.id, total: job.total } });
    } catch (e: any) {
      logInternalApiError("site checks run", e);
      res.status(500).json({ error: "Failed to start health check" });
    }
  });

  app.get("/api/admin/site-checks/status", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ job: getSiteCheckJobStatus() || null });
  });

  app.get("/api/admin/site-checks/results", (_req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json({ results: readLatestCheckResults(db) });
    } catch (e: any) {
      logInternalApiError("site checks results", e);
      res.status(500).json({ error: "Failed to read check results" });
    }
  });

  // ACG \u6570\u636e\u4ee3\u7406\u8bbe\u7f6e API
  app.get("/api/admin/acg-settings", (_req, res) => {
    try {
      res.json({ settings: readAcgFeaturesSettings(db) });
    } catch (e: any) { logInternalApiError("ACG settings read", e); res.status(500).json({ error: "Failed" }); }
  });

  app.post("/api/admin/acg-settings", (req, res) => {
    try {
      const { acg_proxy_enabled, acg_proxy_url, gal_search_enabled } = req.body || {};
      const updates: Record<string, string> = {};
      if (acg_proxy_enabled !== undefined) updates.acg_proxy_enabled = acg_proxy_enabled ? "true" : "false";
      if (acg_proxy_url !== undefined) {
        const url = String(acg_proxy_url).trim();
        if (url) { validateAcgProxyUrl(url); }
        updates.acg_proxy_url = url;
      }
      if (gal_search_enabled !== undefined) updates.gal_search_enabled = gal_search_enabled ? "true" : "false";
      const stmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
      for (const [key, value] of Object.entries(updates)) stmt.run(key, value);
      // GAL 搜索开关变更会影响公开设置，清除缓存
      if (gal_search_enabled !== undefined) publicCatalogCache.clear();
      res.json({ success: true });
    } catch (e: any) {
      if (e instanceof TypeError) { res.status(400).json({ error: "Invalid URL" }); return; }
      logInternalApiError("ACG settings save", e); res.status(500).json({ error: "Failed" });
    }
  });

  app.get("/api/admin/acg-check/:service", handleAcgConnectivityCheck);

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found" });
  });

  app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.path.startsWith("/api/")) {
      next(error);
      return;
    }
    if (error?.type === "entity.too.large") {
      res.status(413).json({ error: "Request body too large" });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: "Invalid request format" });
      return;
    }
    logInternalApiError("unhandled request", error);
      res.status(500).json({ error: "Service temporarily unavailable" });
  });


  // --- Frontend Delivery ---
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
        const distPath = path.join(process.cwd(), "dist");
    app.use("/assets", express.static(path.join(distPath, "assets"), {
      fallthrough: false, immutable: true, maxAge: "1y",
    }));
    app.use(express.static(distPath, {
      maxAge: "1d",
      setHeaders(res, filePath) {
        if (path.basename(filePath) === "index.html") {
          res.setHeader("Cache-Control", "no-cache");
          return;
        }
        res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      },
    }));
    app.get("*", (_req, res) => {
      res.set("Cache-Control", "no-cache");
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const { version: pkgVersion } = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf-8"));
  printLogo(pkgVersion, PORT);
  const httpServer = app.listen(PORT, "0.0.0.0", () => {
    log.info("Server", `Listening on http://0.0.0.0:${PORT}`);
    setTimeout(() => {
      Promise.allSettled([
        warmUpBangumi(),
        warmUpManga(),
        warmUpGal(),
        warmUpPixiv(),
      ]).then((results) => {
        const succeeded = results.filter((r) => r.status === "fulfilled").length;
        log.debug("ACG pre-warm", `${succeeded}/${results.length} modules warmed`);
      });
    }, 2000);
  });
  httpServer.on("error", (error) => {
    log.error("HTTP listener failed:", error);
    process.exit(1);
  });
}

installProcessGuards();
void startServer().catch((error) => {
  log.error("Startup failed:", error);
  process.exit(1);
});
