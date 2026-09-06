import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, } from 'node:fs';
import path from 'node:path';

/**
 * 轻量 token→过期时间戳 持久化存储。
 *
 * 解决 server.ts + ./server/*-auth.ts 原先把会话存在内存 Map 里的问题：
 * 服务端进程一旦重启（开发热重载、PM2/容器滚动、部署更新）所有登录就失效，
 * 表现为前端"输入口令后时不时失效"——明明几分钟前刚解锁，刷新或切换页面
 * 后又被踢回门禁。把会话表落到磁盘文件，进程重启后立即恢复。
 *
 * 文件位置：data/ 目录下，与 nav.db 同级，避免污染现有 SQLite 结构。
 * 写入用 tmp + rename 原子替换，防止写一半进程被 kill 损坏文件。
 *
 * 纯 node:fs 不引第三方包，esbuild --packages=external 不影响。
 */

export interface SessionStoreOptions {
  /** 文件名，例如 'community-sessions.json' */
  fileName: string;
}

export class SessionStore {
  private filePath: string;
  /** 内存缓存：token → expiresAt(ms epoch) */
  private sessions = new Map<string, number>();
  /** 脏标记：只有 add/remove 才会落盘，校验时只读内存 */
  private dirty = false;
  /** 是否已从磁盘加载（懒初始化，首次访问时触发） */
  private loaded = false;

  constructor(options: SessionStoreOptions) {
    const dataDir = process.env.NAV_DATA_DIR
      ? path.resolve(process.env.NAV_DATA_DIR)
      : path.join(process.cwd(), 'data');
    mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, options.fileName);
  }

  private loadFromDisk() {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.filePath)) {
      return;
    }
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, number>;
      const now = Date.now();
      for (const [token, expiresAt] of Object.entries(parsed)) {
        if (typeof expiresAt === 'number' && expiresAt > now) {
          this.sessions.set(token, expiresAt);
        }
      }
      // 加载后若有过期被清理，则标记 dirty 待持久化
      if (Object.keys(parsed).length !== this.sessions.size) {
        this.dirty = true;
        this.persist();
      }
    } catch {
      // 损坏文件忽略（首次写入会覆盖重建）
    }
  }

  private persist() {
    this.dirty = false;
    try {
      const tmp = `${this.filePath}.tmp`;
      const obj: Record<string, number> = {};
      for (const [token, expiresAt] of this.sessions) {
        obj[token] = expiresAt;
      }
      writeFileSync(tmp, JSON.stringify(obj), 'utf-8');
      renameSync(tmp, this.filePath);
    } catch {
      // 落盘失败不阻断键效校验，内存中仍有效；下次变更再尝试。
    }
  }

  /** 清除全部已过期会话。返回是否做了实际删除。 */
  clearExpired(): boolean {
    this.loadFromDisk();
    const now = Date.now();
    let deleted = 0;
    for (const [token, expiresAt] of this.sessions) {
      if (expiresAt <= now) {
        this.sessions.delete(token);
        deleted += 1;
      }
    }
    if (deleted > 0) {
      this.dirty = true;
      this.persist();
    }
    return deleted > 0;
  }

  get(token: string): number | undefined {
    this.loadFromDisk();
    return this.sessions.get(token);
  }

  set(token: string, expiresAt: number) {
    this.loadFromDisk();
    this.sessions.set(token, expiresAt);
    this.dirty = true;
    this.persist();
  }

  delete(token: string): boolean {
    this.loadFromDisk();
    const existed = this.sessions.delete(token);
    if (existed) {
      this.dirty = true;
      this.persist();
    }
    return existed;
  }

  has(token: string): boolean {
    this.loadFromDisk();
    return this.sessions.has(token);
  }
}
