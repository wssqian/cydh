import type Database from "better-sqlite3";

export const PUBLIC_API_ENABLED_SETTING = "public_api_enabled";

export function isPublicApiEnabled(database: Database.Database) {
  const setting = database
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(PUBLIC_API_ENABLED_SETTING) as { value?: string } | undefined;
  return setting?.value === "true";
}
