import type Database from "better-sqlite3";
import { randomBytes } from "node:crypto";

export interface DailyVisitorCount {
  date: string;
  visitors: number;
}

const visitStatsSchema = `
  CREATE TABLE IF NOT EXISTS daily_visitors (
      visit_date TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (visit_date, visitor_id)
  );
`;
export const VISITOR_COOKIE_NAME = "ciyuan_visitor";

export function initializeVisitStats(database: Database.Database) {
  database.exec(visitStatsSchema);
}

export function resolveVisitDate(
  now = new Date(),
  timeZone = process.env.VISIT_TIMEZONE || "Asia/Shanghai",
) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Unable to calculate visit date.");
  }
  return `${year}-${month}-${day}`;
}

export function normalizeVisitorId(value: unknown) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{16,96}$/.test(value)) {
    return null;
  }
  return value;
}

export function createVisitorId() {
  return randomBytes(24).toString("base64url");
}

export function readDailyVisitorCount(
  database: Database.Database,
  date = resolveVisitDate(),
): DailyVisitorCount {
  const result = database
    .prepare("SELECT COUNT(*) AS visitors FROM daily_visitors WHERE visit_date = ?")
    .get(date) as { visitors: number };
  return { date, visitors: result.visitors };
}

export function recordDailyVisitor(
  database: Database.Database,
  visitorId: string,
  date = resolveVisitDate(),
) {
  database.prepare(`
    INSERT OR IGNORE INTO daily_visitors (visit_date, visitor_id)
    VALUES (?, ?)
  `).run(date, visitorId);
  return readDailyVisitorCount(database, date);
}
