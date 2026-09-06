/**
 * 次元导航 — 服务端结构化日志模块
 *
 * 特性：
 * - 彩色分级输出（DEBUG/INFO/WARN/ERROR）
 * - ISO 时间戳 + 模块标签
 * - LOG_LEVEL 环境变量控制详细程度（debug/info/warn/error，默认 info）
 * - LOG_NO_COLOR 环境变量禁用 ANSI 颜色（用于日志文件重定向）
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

function resolveLevel(): Level {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase();
  if (raw in LEVELS) return raw as Level;
  return "info";
}

const currentLevel = resolveLevel();
const noColor = process.env.LOG_NO_COLOR === "1" || process.env.NO_COLOR !== undefined;

// ── ANSI 颜色 ──────────────────────────────────────────
const C = {
  reset:   noColor ? "" : "\x1b[0m",
  dim:     noColor ? "" : "\x1b[2m",
  bold:    noColor ? "" : "\x1b[1m",
  red:     noColor ? "" : "\x1b[31m",
  green:   noColor ? "" : "\x1b[32m",
  yellow:  noColor ? "" : "\x1b[33m",
  blue:    noColor ? "" : "\x1b[34m",
  magenta: noColor ? "" : "\x1b[35m",
  cyan:    noColor ? "" : "\x1b[36m",
  white:   noColor ? "" : "\x1b[37m",
  bgRed:   noColor ? "" : "\x1b[41m",
  bgGreen: noColor ? "" : "\x1b[42m",
  bgBlue:  noColor ? "" : "\x1b[44m",
};

function timestamp(): string {
  const now = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${C.dim}${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${C.reset}`;
}

function tag(name: string, color: string): string {
  return `${color}${C.bold}[${name}]${C.reset}`;
}

// ── 公共日志函数 ────────────────────────────────────────

function shouldLog(level: Level): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

export function debug(scope: string, ...args: unknown[]): void {
  if (!shouldLog("debug")) return;
  console.log(`${timestamp()} ${tag(scope, C.cyan)} ${C.dim}${args.map(formatArg).join(" ")}${C.reset}`);
}

export function info(scope: string, ...args: unknown[]): void {
  if (!shouldLog("info")) return;
  console.log(`${timestamp()} ${tag(scope, C.green)} ${args.map(formatArg).join(" ")}`);
}

export function warn(scope: string, ...args: unknown[]): void {
  if (!shouldLog("warn")) return;
  console.warn(`${timestamp()} ${tag(scope, C.yellow)} ${C.yellow}${args.map(formatArg).join(" ")}${C.reset}`);
}

export function error(scope: string, ...args: unknown[]): void {
  if (!shouldLog("error")) return;
  console.error(`${timestamp()} ${tag(scope, C.red)} ${C.red}${args.map(formatArg).join(" ")}${C.reset}`);
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack || arg.message;
  }
  if (typeof arg === "object" && arg !== null) {
    try {
      return JSON.stringify(arg, null, 2);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

// ── 启动 Logo ──────────────────────────────────────────

export function printLogo(version: string, port: number | string): void {
  const logo = `
${C.magenta}${C.bold}
   ██████╗██╗   ██╗██╗██╗   ██╗██╗   ██╗ █████╗ ███╗   ██╗
  ██╔════╝╚██╗ ██╔╝██║╚██╗ ██╔╝██║   ██║██╔══██╗████╗  ██║
  ██║      ╚████╔╝ ██║ ╚████╔╝ ██║   ██║███████║██╔██╗ ██║
  ██║       ╚██╔╝  ██║  ╚██╔╝  ╚██╗ ██╔╝██╔══██║██║╚██╗██║
  ╚██████╗   ██║   ██║   ██║    ╚████╔╝ ██║  ██║██║ ╚████║
   ╚═════╝   ╚═╝   ╚═╝   ╚═╝     ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═══╝${C.reset}
${C.dim}  ─────────────────────────────────────────────────────${C.reset}
${C.cyan}  次元导航${C.reset}  ${C.dim}v${version}${C.reset}
${C.green}  Server${C.reset}    ${C.dim}http://0.0.0.0:${port}${C.reset}
${C.dim}  ─────────────────────────────────────────────────────${C.reset}
`;
  console.log(logo);
}

/** 创建绑定到指定模块的便捷 logger */
export function createLogger(scope: string) {
  return {
    debug: (...args: unknown[]) => debug(scope, ...args),
    info:  (...args: unknown[]) => info(scope, ...args),
    warn:  (...args: unknown[]) => warn(scope, ...args),
    error: (...args: unknown[]) => error(scope, ...args),
  };
}

/**
 * 给对外 API 响应准备用户可读的错误文案.
 * - 开发环境 (NODE_ENV !== 'production') 保留原始 e.message 便于调试
 * - 生产环境对未预期异常一律返回 fallback, 避免 SQLite 报错文本、表/列名、
 *   内部路径等敏感信息被透传到前端 (见 SECURITY_REPORT.md F-04)
 *
 * 约定: 本服务面向用户的"业务校验"文案都是预定义中文/英文串, 不依赖异常 message;
 * 运行时不可预期的 Error (db 唯一约束、I/O 错误、解析失败等) 才会带 distinct message,
 * 这些属于需要屏蔽的一类.
 */
export function publicErrorMessage(scope: string, err: unknown, fallback: string): string {
  if (process.env.NODE_ENV !== "production") {
    if (err instanceof Error && err.message) return err.message;
    return fallback;
  }
  // 生产: 详细异常走服务日志, 对外只下发稳定文案.
  // 用 warn 而非 error 级, 避免被 uncaughtException 报警机制重复触发.
  if (err instanceof Error) {
    warn(scope, `masked error to client (fallback=${JSON.stringify(fallback)}): ${err.message}`);
  }
  return fallback;
}
