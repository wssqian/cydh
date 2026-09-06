/**
 * 更新后健康检查模块
 */

import type { HealthCheckResult, HealthCheck, UpdateMethod } from './types.js';

const HEALTH_CHECK_TIMEOUT_MS = 60_000;
const INDIVIDUAL_CHECK_TIMEOUT_MS = 10_000;

async function checkHttpHealth(baseUrl: string): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), INDIVIDUAL_CHECK_TIMEOUT_MS);
    
    const response = await fetch(`${baseUrl}/api/health`, {
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    const duration = Date.now() - start;
    
    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      return {
        name: 'http_health',
        passed: true,
        message: `HTTP 健康检查通过 (${response.status})`,
        durationMs: duration,
        details: { status: response.status, data },
      };
    }
    
    return {
      name: 'http_health',
      passed: false,
      message: `HTTP 健康检查失败: ${response.status} ${response.statusText}`,
      durationMs: duration,
      details: { status: response.status },
    };
  } catch (error: any) {
    return {
      name: 'http_health',
      passed: false,
      message: `HTTP 健康检查异常: ${error.message}`,
      durationMs: Date.now() - start,
      details: { error: error.message },
    };
  }
}

async function checkPublicApis(baseUrl: string): Promise<HealthCheck> {
  const start = Date.now();
  const apis = [
    '/api/public/categories',
    '/api/public/sites',
    '/api/public/settings',
  ];
  
  const results: Record<string, { ok: boolean; status?: number; error?: string }> = {};
  let allPassed = true;
  
  for (const api of apis) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), INDIVIDUAL_CHECK_TIMEOUT_MS);
      
      const response = await fetch(`${baseUrl}${api}`, {
        signal: controller.signal,
      });
      
      clearTimeout(timeout);
      // 403 表示公共 API 被管理员主动禁用（合法配置），不作为健康检查失败
      const ok = response.ok || response.status === 403;
      results[api] = { ok, status: response.status };
      if (!ok) allPassed = false;
    } catch (error: any) {
      results[api] = { ok: false, error: error.message };
      allPassed = false;
    }
  }
  
  return {
    name: 'public_apis',
    passed: allPassed,
    message: allPassed ? '核心公共 API 响应正常' : '部分公共 API 响应异常',
    durationMs: Date.now() - start,
    details: { apis: results },
  };
}

async function checkVersionConsistency(expectedVersion: string): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const { readFileSync } = await import('node:fs');
    const path = (await import('node:path')).default;
    
    const root = process.cwd().endsWith('/dist') || process.cwd().endsWith('\\dist')
      ? path.dirname(process.cwd())
      : process.cwd();
    
    const pkgPath = path.join(root, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const actualVersion = pkg.version || '0.0.0';
    
    const match = actualVersion === expectedVersion.replace(/^[vV]/, '');
    
    return {
      name: 'version_consistency',
      passed: match,
      message: match 
        ? `版本一致: ${actualVersion}` 
        : `版本不一致: 期望 ${expectedVersion}，实际 ${actualVersion}`,
      durationMs: Date.now() - start,
      details: { expected: expectedVersion, actual: actualVersion },
    };
  } catch (error: any) {
    return {
      name: 'version_consistency',
      passed: false,
      message: `版本检查失败: ${error.message}`,
      durationMs: Date.now() - start,
      details: { error: error.message },
    };
  }
}

async function checkDatabaseConnectivity(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    // 这里需要访问数据库，但健康检查运行在更新后，数据库应该可用
    // 简化实现：检查数据库文件是否存在
    const { existsSync } = await import('node:fs');
    const path = (await import('node:path')).default;
    
    const root = process.cwd().endsWith('/dist') || process.cwd().endsWith('\\dist')
      ? path.dirname(process.cwd())
      : process.cwd();
    
    const dbPath = path.join(root, 'data', 'nav.db');
    const exists = existsSync(dbPath);
    
    return {
      name: 'database',
      passed: exists,
      message: exists ? '数据库文件存在' : '数据库文件不存在',
      durationMs: Date.now() - start,
      details: { path: dbPath },
    };
  } catch (error: any) {
    return {
      name: 'database',
      passed: false,
      message: `数据库检查失败: ${error.message}`,
      durationMs: Date.now() - start,
      details: { error: error.message },
    };
  }
}

async function checkStaticAssets(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const { existsSync } = await import('node:fs');
    const path = (await import('node:path')).default;
    
    const root = process.cwd().endsWith('/dist') || process.cwd().endsWith('\\dist')
      ? path.dirname(process.cwd())
      : process.cwd();
    
    const distPath = path.join(root, 'dist');
    const indexPath = path.join(distPath, 'index.html');
    const serverPath = path.join(distPath, 'server.cjs');
    
    const distExists = existsSync(distPath);
    const indexExists = existsSync(indexPath);
    const serverExists = existsSync(serverPath);
    
    const allExist = distExists && indexExists && serverExists;
    
    return {
      name: 'static_assets',
      passed: allExist,
      message: allExist 
        ? '静态资源完整 (dist/, index.html, server.cjs)' 
        : `静态资源缺失: dist=${distExists}, index.html=${indexExists}, server.cjs=${serverExists}`,
      durationMs: Date.now() - start,
      details: { dist: distExists, index: indexExists, server: serverExists },
    };
  } catch (error: any) {
    return {
      name: 'static_assets',
      passed: false,
      message: `静态资源检查失败: ${error.message}`,
      durationMs: Date.now() - start,
      details: { error: error.message },
    };
  }
}

export async function runHealthChecks(
  baseUrl: string,
  expectedVersion: string,
  method: UpdateMethod
): Promise<HealthCheckResult> {
  const checks: HealthCheck[] = [];
  
  // 并行执行健康检查
  const [httpHealth, publicApis, versionCheck, database, staticAssets] = await Promise.all([
    checkHttpHealth(baseUrl),
    checkPublicApis(baseUrl),
    checkVersionConsistency(expectedVersion),
    checkDatabaseConnectivity(),
    checkStaticAssets(),
  ]);
  
  checks.push(httpHealth);
  checks.push(publicApis);
  checks.push(versionCheck);
  checks.push(database);
  checks.push(staticAssets);
  
  const allPassed = checks.every(c => c.passed);
  
  return {
    success: allPassed,
    checks,
    error: allPassed ? undefined : '健康检查失败，将触发回滚',
  };
}