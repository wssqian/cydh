import path from "node:path";
import fs from "node:fs";

function resolveAcgCacheDir(): string {
  const dataPath = process.env.NAV_DATA_DIR
    ? path.resolve(process.env.NAV_DATA_DIR)
    : path.join(process.cwd(), "data");
  return path.join(dataPath, "acg-cache");
}

export function loadCacheFile<T>(name: string): { data: T; fetchedAt: number; fetchDate: string } | null {
  try {
    const filePath = path.join(resolveAcgCacheDir(), `${name}.json`);
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.fetchedAt === "number" && typeof parsed.fetchDate === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveCacheFile(name: string, entry: { data: unknown; fetchedAt: number; fetchDate: string }): void {
  try {
    const dir = resolveAcgCacheDir();
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(entry), "utf-8");
  } catch {
    // 静默降级：磁盘写入失败不影响内存缓存
  }
}
