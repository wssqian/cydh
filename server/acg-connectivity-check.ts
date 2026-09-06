import type { RequestHandler } from "express";
import db from "./db";
import { acgFetch, type AcgFetchAttemptRecord, type AcgFetchPolicy } from "./acg-proxy";
import { resolveAcgProxyConfig } from "./acg-features-settings";

type AcgService = "bangumi" | "mangadex" | "vndb" | "pixiv";

interface CheckDefinition {
  label: string;
  minimumExpected: number;
  request: {
    path: string;
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  };
  count: (json: any) => number;
  sample: (json: any) => string[];
}

const SERVICE_DEFINITIONS: Record<AcgService, CheckDefinition> = {
  bangumi: {
    label: "Bangumi",
    minimumExpected: 10,
    request: { path: "/bangumi/calendar" },
    count: (json) => Array.isArray(json) ? json.reduce((sum, day) => sum + (Array.isArray(day?.items) ? day.items.length : 0), 0) : 0,
    sample: (json) => Array.isArray(json)
      ? json.flatMap((day) => Array.isArray(day?.items) ? day.items : [])
        .slice(0, 3)
        .map((item) => item?.name_cn || item?.name || String(item?.id || ""))
        .filter(Boolean)
      : [],
  },
  mangadex: {
    label: "MangaDex",
    minimumExpected: 5,
    request: {
      path: "/mangadex/manga?limit=10&includes[]=cover_art&availableTranslatedLanguage[]=zh&contentRating[]=safe&contentRating[]=suggestive&order[followedCount]=desc",
    },
    count: (json) => Array.isArray(json?.data) ? json.data.length : 0,
    sample: (json) => Array.isArray(json?.data)
      ? json.data.slice(0, 3).map((item: any) => localizedText(item?.attributes?.title) || item?.id).filter(Boolean)
      : [],
  },
  vndb: {
    label: "VNDB",
    minimumExpected: 5,
    request: {
      path: "/vndb/vn",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filters: ["and", ["rating", ">=", 75], ["votecount", ">=", 50], ["devstatus", "=", 0]],
        fields: "title,alttitle,description,image.url,rating,votecount,length,released,devstatus,platforms,tags.name,tags.rating,tags.category,tags.spoiler,titles.title,titles.lang",
        sort: "rating",
        reverse: true,
        results: 10,
      }),
    },
    count: (json) => Array.isArray(json?.results) ? json.results.length : 0,
    sample: (json) => Array.isArray(json?.results)
      ? json.results.slice(0, 3).map((item: any) => item?.title || item?.id).filter(Boolean)
      : [],
  },
  pixiv: {
    label: "Pixiv",
    minimumExpected: 10,
    request: { path: "/pixiv/ranking.php?mode=daily&content=illust&p=1&format=json" },
    count: (json) => Array.isArray(json?.contents) ? json.contents.length : 0,
    sample: (json) => Array.isArray(json?.contents)
      ? json.contents.slice(0, 3).map((item: any) => item?.title || item?.illust_id).filter(Boolean)
      : [],
  },
};

function localizedText(values: Record<string, string> | undefined): string {
  if (!values) {
    return "";
  }
  return values.zh || values["zh-hk"] || values["zh-ro"] || values.ja || values.en || Object.values(values)[0] || "";
}

async function readFailureBody(res: Awaited<ReturnType<typeof acgFetch>>): Promise<string> {
  try {
    const text = await res.text();
    return text.replace(/\s+/g, " ").trim().slice(0, 1000);
  } catch {
    return "";
  }
}

function normalizeService(value: unknown): AcgService | null {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SERVICE_DEFINITIONS, value)
    ? value as AcgService
    : null;
}

export const handleAcgConnectivityCheck: RequestHandler = async (req, res) => {
  const service = normalizeService(req.params.service);
  if (!service) {
    res.status(404).json({ error: "Unknown ACG service" });
    return;
  }

  const definition = SERVICE_DEFINITIONS[service];
  const proxyConfig = resolveAcgProxyConfig(db);
  const policy: AcgFetchPolicy = proxyConfig.proxyUrl ? "configured-only" : "direct-only";
  const attempts: AcgFetchAttemptRecord[] = [];
  const started = Date.now();

  try {
    const upstream = await acgFetch(definition.request.path, {
      method: definition.request.method,
      body: definition.request.body,
      headers: definition.request.headers,
      policy,
      timeout: 20_000,
      onAttempt: (attempt) => attempts.push(attempt),
    });

    const usedAttempt = attempts.find((attempt) => attempt.ok) || attempts.at(-1) || null;
    if (!upstream.ok) {
      const body = await readFailureBody(upstream);
      res.json({
        service,
        label: definition.label,
        ok: false,
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        itemCount: 0,
        minimumExpected: definition.minimumExpected,
        source: usedAttempt?.source || null,
        status: upstream.status,
        error: body ? `HTTP ${upstream.status}: ${body}` : `HTTP ${upstream.status}`,
        attempts,
        proxy: {
          configured: Boolean(proxyConfig.proxyUrl),
          mode: proxyConfig.proxyUrl ? proxyConfig.mode : "none",
          source: proxyConfig.source,
          policy,
        },
      });
      return;
    }

    const json = await upstream.json();
    const itemCount = definition.count(json);
    const warnings = itemCount < definition.minimumExpected
      ? [`返回 ${itemCount} 条，低于预期最少 ${definition.minimumExpected} 条。`]
      : [];

    res.json({
      service,
      label: definition.label,
      ok: warnings.length === 0,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      itemCount,
      minimumExpected: definition.minimumExpected,
      source: usedAttempt?.source || null,
      status: upstream.status,
      sample: definition.sample(json),
      warnings,
      attempts,
      proxy: {
        configured: Boolean(proxyConfig.proxyUrl),
        mode: proxyConfig.proxyUrl ? proxyConfig.mode : "none",
        source: proxyConfig.source,
        policy,
      },
    });
  } catch (error: any) {
    res.json({
      service,
      label: definition.label,
      ok: false,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      itemCount: 0,
      minimumExpected: definition.minimumExpected,
      source: attempts.find((attempt) => attempt.ok)?.source || attempts.at(-1)?.source || null,
      error: error?.message || "ACG connectivity check failed",
      attempts,
      proxy: {
        configured: Boolean(proxyConfig.proxyUrl),
        mode: proxyConfig.proxyUrl ? proxyConfig.mode : "none",
        source: proxyConfig.source,
        policy,
      },
    });
  }
};
